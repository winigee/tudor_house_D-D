// Photo pipeline (spec section 7). Reads author-supplied photographs
// from assets_src/creatures/<creatureId>/face.{jpg,png} and writes:
//   src/assets/faces/<id>_96.png   96x96 1-bit Atkinson-dithered PNG
//   src/assets/faces/<id>_48.png   48x48 variant
//   src/data/faces.json            manifest with contours and credits
// Lit pixels are white and opaque; dark pixels are transparent, so the
// renderer can tint to any phosphor colour without a rebuild.
// Run with: npm run build:faces

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = join(ROOT, 'assets_src', 'creatures');
const OUT_DIR = join(ROOT, 'src', 'assets', 'faces');
const MANIFEST = join(ROOT, 'src', 'data', 'faces.json');

interface FaceEntry {
  img96: string;
  img48: string;
  contours: number[][];
  sourceWidth: number;
  sourceHeight: number;
  credit?: string;
}

/** Atkinson dithering over a grayscale buffer; returns a bit per pixel. */
function atkinson(gray: Float64Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  const buf = Float64Array.from(gray);
  const spread: [number, number][] = [
    [1, 0],
    [2, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
    [0, 2],
  ];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const old = buf[i]!;
      const bit = old > 127 ? 1 : 0;
      out[i] = bit;
      const err = (old - bit * 255) / 8;
      for (const [dx, dy] of spread) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        buf[ny * w + nx]! += err;
      }
    }
  }
  return out;
}

async function ditheredPng(input: Buffer, size: number, outPath: string): Promise<void> {
  const { data, info } = await sharp(input)
    .resize(size, size, { fit: 'cover', position: 'centre' })
    .grayscale()
    .normalise()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const gray = new Float64Array(info.width * info.height);
  for (let i = 0; i < gray.length; i++) gray[i] = data[i]!;
  const bits = atkinson(gray, info.width, info.height);
  const rgba = Buffer.alloc(info.width * info.height * 4);
  for (let i = 0; i < bits.length; i++) {
    const v = bits[i]! ? 255 : 0;
    rgba[i * 4] = 255;
    rgba[i * 4 + 1] = 255;
    rgba[i * 4 + 2] = 255;
    rgba[i * 4 + 3] = v; // shape lives in alpha; colour applied at draw time
  }
  await sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toFile(outPath);
}

/**
 * Edge pass for mode B: Gaussian blur, Sobel gradients, hysteresis
 * threshold (a compact Canny), then chain tracing into polylines with
 * coordinates normalised to 0..1.
 */
async function contours(input: Buffer, size = 96): Promise<number[][]> {
  const { data, info } = await sharp(input)
    .resize(size, size, { fit: 'cover', position: 'centre' })
    .grayscale()
    .normalise()
    .blur(1.2)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const g = (x: number, y: number): number =>
    data[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))]!;
  const mag = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx =
        -g(x - 1, y - 1) - 2 * g(x - 1, y) - g(x - 1, y + 1) +
        g(x + 1, y - 1) + 2 * g(x + 1, y) + g(x + 1, y + 1);
      const gy =
        -g(x - 1, y - 1) - 2 * g(x, y - 1) - g(x + 1, y - 1) +
        g(x - 1, y + 1) + 2 * g(x, y + 1) + g(x + 1, y + 1);
      mag[y * w + x] = Math.hypot(gx, gy);
    }
  }
  let max = 0;
  for (const m of mag) max = Math.max(max, m);
  const high = max * 0.28;
  const low = max * 0.12;
  // Hysteresis: strong edges seed, weak edges join if connected.
  const edge = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let i = 0; i < mag.length; i++) {
    if (mag[i]! >= high) {
      edge[i] = 1;
      stack.push(i);
    }
  }
  while (stack.length > 0) {
    const i = stack.pop()!;
    const x = i % w;
    const y = Math.floor(i / w);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (!edge[ni] && mag[ni]! >= low) {
          edge[ni] = 1;
          stack.push(ni);
        }
      }
    }
  }
  // Chain tracing into polylines.
  const used = new Uint8Array(w * h);
  const lines: number[][] = [];
  for (let start = 0; start < edge.length; start++) {
    if (!edge[start] || used[start]) continue;
    const chain: [number, number][] = [];
    let cur = start;
    while (cur >= 0) {
      used[cur] = 1;
      const x = cur % w;
      const y = Math.floor(cur / w);
      chain.push([x, y]);
      let next = -1;
      for (let dy = -1; dy <= 1 && next < 0; dy++) {
        for (let dx = -1; dx <= 1 && next < 0; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const ni = ny * w + nx;
          if (edge[ni] && !used[ni]) next = ni;
        }
      }
      cur = next;
    }
    if (chain.length >= 8) {
      // Keep every third point to hold the manifest small.
      const flat: number[] = [];
      for (let i = 0; i < chain.length; i += 3) {
        flat.push(Number((chain[i]![0] / w).toFixed(3)), Number((chain[i]![1] / h).toFixed(3)));
      }
      lines.push(flat);
    }
  }
  // Longest chains first; cap the set so distant draws stay cheap.
  lines.sort((a, b) => b.length - a.length);
  return lines.slice(0, 24);
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const manifest: Record<string, FaceEntry> = {};
  if (!existsSync(SRC_DIR)) {
    writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
    console.log(`no ${SRC_DIR}; wrote empty faces.json`);
    return;
  }
  const dirs = readdirSync(SRC_DIR, { withFileTypes: true }).filter((d) => d.isDirectory());
  for (const dir of dirs) {
    const id = dir.name;
    const base = join(SRC_DIR, id);
    const source = ['face.png', 'face.jpg', 'face.jpeg']
      .map((n) => join(base, n))
      .find((p) => existsSync(p));
    if (!source) {
      console.warn(`skipping ${id}: no face.{png,jpg}`);
      continue;
    }
    const input = readFileSync(source);
    const meta = await sharp(input).metadata();
    const out96 = join(OUT_DIR, `${id}_96.png`);
    const out48 = join(OUT_DIR, `${id}_48.png`);
    await ditheredPng(input, 96, out96);
    await ditheredPng(input, 48, out48);
    const entry: FaceEntry = {
      img96: `assets/faces/${id}_96.png`,
      img48: `assets/faces/${id}_48.png`,
      contours: await contours(input),
      sourceWidth: meta.width ?? 0,
      sourceHeight: meta.height ?? 0,
    };
    const creditPath = join(base, 'credit.txt');
    if (existsSync(creditPath)) entry.credit = readFileSync(creditPath, 'utf8').trim();
    manifest[id] = entry;
    console.log(`built faces for ${id}`);
  }
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`wrote ${MANIFEST} with ${Object.keys(manifest).length} entries`);
}

void main();
