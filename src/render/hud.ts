// HUD bands under the world view: hand panels, pulse bar, message log,
// command line with block cursor. Plus the LOOK overlay, the mode C
// portrait panel, and the death and victory cards.

import { tuning } from '../config/tuning.ts';
import type { Content, GameState } from '../sim/step.ts';
import type { ItemKind } from '../sim/items.ts';
import { drawText, textWidth, ADVANCE, LINE_HEIGHT } from './font.ts';
import { faceImage } from './billboard.ts';

const W = tuning.render.internalWidth;
const H = tuning.render.internalHeight;
const WORLD_H = tuning.render.worldHeight;

// Band layout inside the 68 rows under the world view. The log's last
// line must end above the divider or messages paint over the prompt,
// and the command row keeps clear bottom margin so it survives the
// CRT pass's barrel curve.
const HANDS_Y = WORLD_H + 2; // 126..143
const HANDS_H = 18;
const PULSE_Y = HANDS_Y + HANDS_H + 2; // 146..150
const PULSE_H = 5;
const LOG_Y = PULSE_Y + PULSE_H + 3; // 154, 162, 170
const LOG_LINES = 3;
const LOG_PITCH = 8;
const DIVIDER_Y = H - 13; // 179
const CMD_Y = H - 11; // 181..187, 4 rows of margin below

export interface HudState {
  log: string[];
  inputBuffer: string;
  lookOverlay: { pack: string[]; floor: string[] } | null;
  portrait: { defId: string; name: string | null } | null;
  strings: Record<string, string>;
}

export function formatString(strings: Record<string, string>, key: string, params?: Record<string, string | number>): string {
  let s = strings[key] ?? key.toUpperCase();
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.replaceAll(`{${k}}`, String(v));
    }
  }
  return s;
}

function drawItemIcon(ctx: CanvasRenderingContext2D, kind: ItemKind, x: number, y: number, fg: string): void {
  // 9x9 icons, one per kind, drawn as pixels.
  ctx.fillStyle = fg;
  const px = (dx: number, dy: number) => ctx.fillRect(x + dx, y + dy, 1, 1);
  switch (kind) {
    case 'weapon':
      for (let i = 0; i < 6; i++) px(7 - i, i);
      px(2, 4); px(4, 6); px(1, 7); px(2, 6);
      break;
    case 'torch':
      for (let i = 3; i < 9; i++) px(4, i);
      px(3, 2); px(5, 2); px(4, 1); px(3, 0); px(5, 0);
      break;
    case 'ring':
      px(3, 2); px(4, 2); px(5, 2); px(2, 3); px(6, 3); px(2, 4); px(6, 4); px(2, 5); px(6, 5); px(3, 6); px(4, 6); px(5, 6); px(4, 0); px(4, 1);
      break;
    case 'flask':
      px(3, 0); px(4, 0); px(5, 0); px(4, 1); px(4, 2); px(3, 3); px(5, 3);
      for (let dy = 4; dy < 8; dy++) { px(2, dy); px(6, dy); }
      px(3, 8); px(4, 8); px(5, 8); px(3, 5); px(4, 5); px(5, 5); px(3, 6); px(4, 6); px(5, 6); px(3, 7); px(4, 7); px(5, 7);
      break;
    case 'scroll':
      for (let dy = 1; dy < 8; dy++) { px(2, dy); px(6, dy); }
      px(3, 0); px(4, 0); px(5, 0); px(3, 8); px(4, 8); px(5, 8);
      px(3, 3); px(4, 3); px(5, 3); px(3, 5); px(4, 5);
      break;
    case 'shield':
      px(2, 0); px(3, 0); px(4, 0); px(5, 0); px(6, 0);
      px(2, 1); px(6, 1); px(2, 2); px(6, 2); px(2, 3); px(6, 3);
      px(3, 4); px(5, 4); px(3, 5); px(5, 5); px(4, 6); px(4, 7);
      px(4, 1); px(4, 2); px(4, 3);
      break;
  }
}

export function drawHud(
  ctx: CanvasRenderingContext2D,
  content: Content,
  state: GameState,
  hud: HudState,
  fg: string,
  nowMs: number,
): void {
  const s = hud.strings;
  ctx.fillStyle = fg;
  ctx.strokeStyle = fg;
  ctx.lineWidth = 1;

  // Frame under the world view.
  ctx.strokeRect(0.5, WORLD_H + 0.5, W - 1, H - WORLD_H - 1);

  // Hand panels.
  const panelW = W / 2;
  for (const [i, hand] of (['LEFT', 'RIGHT'] as const).entries()) {
    const x = i * panelW;
    ctx.strokeRect(x + 0.5, HANDS_Y + 0.5, panelW - 1, HANDS_H - 1);
    drawText(ctx, formatString(s, i === 0 ? 'hud_left' : 'hud_right'), x + 3, HANDS_Y + 2);
    const inst = state.player.hands[hand];
    if (inst) {
      const def = content.items[inst.defId]!;
      const name = inst.identified ? def.revealedName : def.name;
      drawItemIcon(ctx, def.kind, x + 3, HANDS_Y + 8, fg);
      drawText(ctx, name.slice(0, 18), x + 15, HANDS_Y + 9);
      if (def.kind === 'torch' && inst.lit) {
        // A lit torch pulses its icon.
        if (Math.floor(nowMs / 300) % 2 === 0) ctx.fillRect(x + 6, HANDS_Y + 6, 2, 2);
      }
    } else {
      drawText(ctx, formatString(s, 'hud_empty_hand'), x + 15, HANDS_Y + 9);
    }
  }

  // Pulse bar: resting..ceiling mapped across the width. No number.
  const frac = Math.max(
    0,
    Math.min(1, (state.player.pulse - tuning.pulse.resting) / (tuning.pulse.ceiling - tuning.pulse.resting)),
  );
  ctx.strokeRect(0.5, PULSE_Y + 0.5, W - 1, PULSE_H - 1);
  const barW = Math.round((W - 4) * frac);
  if (barW > 0) {
    // Above the faint threshold the bar itself flickers.
    const faint = state.player.pulse >= tuning.pulse.faintThreshold;
    if (!faint || Math.floor(nowMs / 150) % 2 === 0) {
      ctx.fillRect(2, PULSE_Y + 1, barW, PULSE_H - 3);
    }
  }

  // Message log or portrait panel (mode C swaps it while a creature shows).
  if (hud.portrait) {
    const size = 32;
    const px = 4;
    const py = LOG_Y - 15;
    ctx.fillStyle = '#000';
    ctx.fillRect(px - 2, py - 2, size + 4, size + 4);
    ctx.fillStyle = fg;
    ctx.strokeRect(px - 1.5, py - 1.5, size + 3, size + 3);
    const img = faceImage(content, hud.portrait.defId, fg, 48);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, px, py, size, size);
    if (hud.portrait.name) drawText(ctx, hud.portrait.name, px + size + 6, py + size - 8);
  } else {
    for (let i = 0; i < LOG_LINES; i++) {
      const line = hud.log[hud.log.length - LOG_LINES + i];
      if (line) drawText(ctx, line.slice(0, 42), 3, LOG_Y + i * LOG_PITCH);
    }
  }

  // Divider between the log and the command row.
  ctx.fillRect(0, DIVIDER_Y, W, 1);

  // Command line with blinking block cursor.
  const prompt = '>';
  const shown = `${prompt}${hud.inputBuffer}`.slice(-42);
  drawText(ctx, shown, 3, CMD_Y);
  if (Math.floor(nowMs / tuning.render.cursorBlinkMs) % 2 === 0) {
    ctx.fillRect(3 + textWidth(shown), CMD_Y, ADVANCE - 1, 7);
  }
}

/** LOOK overlay: pack and floor listings, dismissed by the next key. */
export function drawLookOverlay(
  ctx: CanvasRenderingContext2D,
  hud: HudState,
  fg: string,
): void {
  if (!hud.lookOverlay) return;
  const s = hud.strings;
  const lines: string[] = [];
  lines.push(formatString(s, 'look_pack_header'));
  if (hud.lookOverlay.pack.length === 0) lines.push(` ${formatString(s, 'look_empty')}`);
  for (const item of hud.lookOverlay.pack) lines.push(` ${item}`);
  lines.push(formatString(s, 'look_floor_header'));
  if (hud.lookOverlay.floor.length === 0) lines.push(` ${formatString(s, 'look_empty')}`);
  for (const item of hud.lookOverlay.floor) lines.push(` ${item}`);

  const boxW = 170;
  const boxH = lines.length * LINE_HEIGHT + 10;
  const x = (W - boxW) / 2;
  const y = 12;
  ctx.fillStyle = '#000';
  ctx.fillRect(x, y, boxW, boxH);
  ctx.strokeStyle = fg;
  ctx.strokeRect(x + 0.5, y + 0.5, boxW - 1, boxH - 1);
  ctx.fillStyle = fg;
  lines.forEach((line, i) => drawText(ctx, line.slice(0, 27), x + 5, y + 5 + i * LINE_HEIGHT));
}

/** Full-screen card for death and victory. */
export function drawEndCard(
  ctx: CanvasRenderingContext2D,
  hud: HudState,
  status: 'dead' | 'won',
  fg: string,
  nowMs: number,
): void {
  const s = hud.strings;
  ctx.fillStyle = '#000';
  ctx.globalAlpha = 0.85;
  ctx.fillRect(0, 0, W, WORLD_H);
  ctx.globalAlpha = 1;
  ctx.fillStyle = fg;
  const lines =
    status === 'dead'
      ? [formatString(s, 'death_line'), formatString(s, 'death_restart')]
      : [formatString(s, 'victory_line'), formatString(s, 'victory_epilogue'), formatString(s, 'death_restart')];
  lines.forEach((line, i) => {
    const y = WORLD_H / 2 - lines.length * LINE_HEIGHT + i * (LINE_HEIGHT + 4);
    if (i === lines.length - 1 && Math.floor(nowMs / 600) % 2 === 0) return;
    drawText(ctx, line, (W - textWidth(line)) / 2, y);
  });
}
