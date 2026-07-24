// Wiring: content loading, the fixed-timestep loop, input capture,
// event dispatch to renderer and audio, settings, saves and debug.

import { tuning } from './config/tuning.ts';
import { validateItems } from './sim/items.ts';
import { validateCreatures } from './sim/creatures.ts';
import { validateLevel, type LevelDef, FACING_SIDE } from './sim/world.ts';
import {
  initGame,
  step,
  lightRadius,
  lightIntensity,
  serializeGame,
  deserializeGame,
  flushQueue,
  hashGame,
  type Content,
  type GameState,
  type SavedGame,
} from './sim/step.ts';
import { parse, type CommandIntent } from './sim/parser.ts';
import { EventBus, type SimEvent } from './sim/events.ts';
import { CameraTween } from './render/camera.ts';
import { buildScene, drawScene } from './render/wireframe.ts';
import {
  creatureInserts,
  visibleCreatures,
  logPlaceholders,
  clearFaceCache,
  faceCredits,
  type FaceMode,
} from './render/billboard.ts';
import { drawHud, drawLookOverlay, drawEndCard, formatString, type HudState } from './render/hud.ts';
import { drawText } from './render/font.ts';
import { CrtPass } from './render/crt.ts';
import { AudioEngine } from './audio/engine.ts';
import { Cues } from './audio/cues.ts';
import { Heartbeat } from './audio/heartbeat.ts';

import pkg from '../package.json';
import stringsRaw from './data/strings.json';
import itemsRaw from './data/items.json';
import creaturesRaw from './data/creatures.json';
import level1 from './data/levels/1.json';
import level2 from './data/levels/2.json';
import level3 from './data/levels/3.json';
import level4 from './data/levels/4.json';
import level5 from './data/levels/5.json';

// ---------------------------------------------------------------------------
// Content

const strings = stringsRaw as Record<string, string>;

function loadContent(): Content {
  const levels: Record<number, LevelDef> = {};
  for (const raw of [level1, level2, level3, level4, level5]) {
    const level = validateLevel(raw, `levels/${(raw as LevelDef).id}.json`);
    levels[level.id] = level;
  }
  return {
    items: validateItems(itemsRaw, 'items.json'),
    creatures: validateCreatures(creaturesRaw, 'creatures.json'),
    levels,
    tuning,
  };
}

const content = loadContent();
logPlaceholders(content);
console.info(`DUNGEONS OF CARAROSS v${pkg.version}`);

// ---------------------------------------------------------------------------
// Settings

type PaletteName = keyof typeof tuning.render.palettes;

interface Settings {
  palette: PaletteName;
  faceMode: FaceMode;
  crt: boolean;
  muted: boolean;
  arrowKeys: boolean;
}

const SETTINGS_KEY = 'caraross.settings';

function loadSettings(): Settings {
  const defaults: Settings = {
    palette: tuning.render.defaultPalette,
    faceMode: 'A',
    crt: false,
    muted: false,
    arrowKeys: true,
  };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...defaults, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    // Fall through to defaults.
  }
  return defaults;
}

const settings = loadSettings();

function saveSettings(): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage may be unavailable; settings just will not persist.
  }
}

function palette(): { fg: string; bg: string } {
  return tuning.render.palettes[settings.palette];
}

// ---------------------------------------------------------------------------
// Canvas plumbing

const stage = document.getElementById('stage')!;
const internal = document.createElement('canvas');
internal.width = tuning.render.internalWidth;
internal.height = tuning.render.internalHeight;
const ictx = internal.getContext('2d')!;

let displayCanvas: HTMLCanvasElement | null = null;
let displayCtx: CanvasRenderingContext2D | null = null;
let crtPass: CrtPass | null = null;

function setupDisplay(): void {
  if (displayCanvas) displayCanvas.remove();
  displayCanvas = document.createElement('canvas');
  const scale = Math.max(
    1,
    Math.floor(
      Math.min(
        window.innerWidth / tuning.render.internalWidth,
        window.innerHeight / tuning.render.internalHeight,
      ),
    ),
  );
  displayCanvas.width = tuning.render.internalWidth * scale;
  displayCanvas.height = tuning.render.internalHeight * scale;
  stage.appendChild(displayCanvas);
  crtPass = null;
  displayCtx = null;
  if (settings.crt) {
    crtPass = CrtPass.create(displayCanvas);
  }
  if (!crtPass) {
    displayCtx = displayCanvas.getContext('2d')!;
    displayCtx.imageSmoothingEnabled = false;
  }
}

setupDisplay();
window.addEventListener('resize', setupDisplay);

// ---------------------------------------------------------------------------
// Game state and HUD state

const params = new URLSearchParams(location.search);
const debugEnabled = params.get('debug') === '1';
const seedParam = params.get('seed');

function newSeed(): number {
  return seedParam ? Number(seedParam) >>> 0 : (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
}

const game: { state: GameState } = { state: initGame(content, newSeed(), debugEnabled) };

const hud: HudState = {
  log: [],
  inputBuffer: '',
  lookOverlay: null,
  portrait: null,
  strings,
};

function pushLog(key: string, paramsMap?: Record<string, string | number>): void {
  pushLogText(formatString(strings, key, paramsMap));
}

function pushLogText(text: string): void {
  // Wrap onto the 42-column log rather than clipping.
  let rest = text;
  while (rest.length > 42) {
    let cut = rest.lastIndexOf(' ', 42);
    if (cut <= 0) cut = 42;
    hud.log.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  hud.log.push(rest);
  if (hud.log.length > 40) hud.log.splice(0, hud.log.length - 40);
}

pushLog('intro_1');
pushLog('intro_2');
pushLog('intro_3');

// Creatures whose name shows on the mode C plate: struck at least once.
const knownCreatures = new Set<string>();

// ---------------------------------------------------------------------------
// Audio

const engine = new AudioEngine();
engine.setMuted(settings.muted);
const cues = new Cues(engine);
const heartbeat = new Heartbeat(engine);

// ---------------------------------------------------------------------------
// Save and load

function handleSave(slot: string): void {
  try {
    const saved = serializeGame(game.state);
    localStorage.setItem(tuning.save.storagePrefix + slot, JSON.stringify(saved));
    pushLog('save_done', { slot });
  } catch {
    pushLog('save_failed');
  }
}

function handleLoad(slot: string): void {
  const raw = localStorage.getItem(tuning.save.storagePrefix + slot);
  if (!raw) {
    pushLog('load_missing', { slot });
    return;
  }
  try {
    const saved = JSON.parse(raw) as SavedGame;
    game.state = deserializeGame(content, saved, debugEnabled);
    tween.snap();
    pushLog('load_done', { slot });
  } catch (err) {
    if (err instanceof Error && /schema version/i.test(err.message)) pushLog('load_version', { slot });
    else pushLog('load_missing', { slot });
  }
}

// ---------------------------------------------------------------------------
// Sim events

const bus = new EventBus();

bus.subscribe((ev: SimEvent) => {
  switch (ev.type) {
    case 'message':
      pushLog(ev.key, ev.params);
      break;
    case 'look':
      hud.lookOverlay = { pack: ev.pack, floor: ev.floor };
      break;
    case 'examine':
      for (const line of ev.lines) pushLog(line.key, line.params);
      break;
    case 'footstep':
      cues.footstep(ev.soundId, ev.distance, ev.bearing);
      break;
    case 'swing':
      cues.swing(ev.hit);
      break;
    case 'playerHit':
      cues.playerHit(ev.blocked);
      break;
    case 'creatureDied':
      knownCreatures.add(ev.defId);
      cues.creatureDied();
      break;
    case 'torchDied':
      cues.torchOut();
      break;
    case 'bump':
      lastBumpMs = performance.now();
      cues.bump();
      break;
    case 'climbed':
      tween.snap();
      cues.climb();
      break;
    case 'secretFound':
      cues.secret();
      break;
    case 'incant':
      cues.incant();
      break;
    case 'death':
      cues.death();
      break;
    case 'victory':
      cues.victory();
      break;
    case 'saveRequested':
      handleSave(ev.slot);
      break;
    case 'loadRequested':
      handleLoad(ev.slot);
      break;
    case 'moved':
    case 'turned':
      break;
  }
});

// ---------------------------------------------------------------------------
// Input

const pendingIntents: CommandIntent[] = [];
let paused = false;
let stepOnce = false;
let debugMap = true;

function submitLine(line: string, echo = true): void {
  // Echo typed submissions into the log so entered commands visibly
  // scroll away (the key-binding layer stays silent).
  if (echo) pushLogText(`>${line.trim().toUpperCase()}`);
  const result = parse(line, debugEnabled);
  if (!result.ok) {
    pushLog(result.errorKey, result.params);
    return;
  }
  pendingIntents.push(...result.intents);
}

function restart(): void {
  game.state = initGame(content, newSeed(), debugEnabled);
  hud.log = [];
  hud.lookOverlay = null;
  hud.inputBuffer = '';
  pendingIntents.length = 0;
  knownCreatures.clear();
  tween.snap();
  pushLog('intro_1');
  pushLog('intro_2');
  pushLog('intro_3');
}

window.addEventListener('keydown', (ev) => {
  engine.ensure();

  if (game.state.status !== 'playing') {
    if (ev.key.length === 1 || ev.key === 'Enter' || ev.key === ' ') restart();
    return;
  }

  // Any key dismisses the LOOK overlay; the key still types below.
  if (hud.lookOverlay) hud.lookOverlay = null;

  if (debugEnabled && ev.key === 'F8') {
    paused = !paused;
    ev.preventDefault();
    return;
  }
  if (debugEnabled && ev.key === 'F9') {
    stepOnce = true;
    ev.preventDefault();
    return;
  }
  if (debugEnabled && ev.key === 'F10') {
    debugMap = !debugMap;
    ev.preventDefault();
    return;
  }

  if (ev.key === 'Escape') {
    if (game.state.queue.length > 0) {
      flushQueue(game.state);
      pushLog('queue_flushed');
    }
    hud.inputBuffer = '';
    return;
  }

  if (settings.arrowKeys) {
    // The accessibility layer enqueues exactly what the parser produces.
    const bound: Record<string, string> = {
      ArrowUp: 'MOVE',
      ArrowDown: 'BACK',
      ArrowLeft: 'TURN LEFT',
      ArrowRight: 'TURN RIGHT',
      z: 'ATTACK LEFT',
      x: 'ATTACK RIGHT',
    };
    const keyId = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
    const line = bound[keyId];
    if (line && hud.inputBuffer.length === 0) {
      submitLine(line, false);
      ev.preventDefault();
      return;
    }
  }

  if (ev.key === 'Enter') {
    const line = hud.inputBuffer;
    hud.inputBuffer = '';
    if (line.trim().length > 0) submitLine(line);
    return;
  }
  if (ev.key === 'Backspace') {
    hud.inputBuffer = hud.inputBuffer.slice(0, -1);
    return;
  }
  if (ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
    if (hud.inputBuffer.length < 60) hud.inputBuffer += ev.key.toUpperCase();
    ev.preventDefault();
  }
});

window.addEventListener('pointerdown', () => engine.ensure());

// ---------------------------------------------------------------------------
// Debug overlay

function drawDebugOverlay(): void {
  const level = content.levels[game.state.player.levelId]!;
  const cell = tuning.debug.mapCellPx;
  if (!debugMap) {
    ictx.fillStyle = palette().fg;
    drawText(ictx, `TICK ${game.state.tick}${paused ? ' PAUSED' : ''}`, 4, 4);
    return;
  }
  const mapW = level.size.w * cell;
  const mapH = level.size.h * cell;
  const ox = tuning.render.internalWidth - mapW - 4;
  const oy = 4;
  ictx.save();
  ictx.globalAlpha = 0.85;
  ictx.fillStyle = '#000';
  ictx.fillRect(ox - 2, oy - 2, mapW + 4, mapH + 4);
  ictx.globalAlpha = 1;
  ictx.strokeStyle = '#444';
  ictx.strokeRect(ox - 1.5, oy - 1.5, mapW + 3, mapH + 3);
  const { fg } = palette();
  for (let y = 0; y < level.size.h; y++) {
    for (let x = 0; x < level.size.w; x++) {
      const walls = level.cells[y * level.size.w + x]!.walls;
      ictx.fillStyle = '#222';
      if (walls !== 15) ictx.fillRect(ox + x * cell, oy + y * cell, cell - 1, cell - 1);
    }
  }
  const runtime = game.state.levels[game.state.player.levelId]!;
  ictx.fillStyle = '#886';
  for (const item of runtime.floorItems) {
    ictx.fillRect(ox + item.x * cell + 1, oy + item.y * cell + 1, cell - 3, cell - 3);
  }
  ictx.fillStyle = '#a33';
  for (const c of game.state.creatures) {
    if (c.levelId !== game.state.player.levelId) continue;
    ictx.fillRect(ox + c.x * cell, oy + c.y * cell, cell - 1, cell - 1);
  }
  ictx.fillStyle = fg;
  ictx.fillRect(ox + game.state.player.x * cell, oy + game.state.player.y * cell, cell - 1, cell - 1);
  drawText(ictx, `TICK ${game.state.tick}${paused ? ' PAUSED' : ''}`, 4, 4);
  drawText(ictx, `HASH ${hashGame(game.state).slice(0, 6)}`, 4, 14);
  ictx.restore();
}

// ---------------------------------------------------------------------------
// Main loop

const tween = new CameraTween();
const TICK_MS = 1000 / tuning.sim.tickHz;
let accumulator = 0;
let lastTime = performance.now();
let wasFaint = false;
let lastBumpMs = -Infinity;

function facingAngle(): number {
  return (game.state.player.facing * Math.PI) / 2;
}

/** Eye position: cell centre pulled back along the facing (tunnel view). */
function eyeTarget(): { x: number; z: number } {
  const p = game.state.player;
  const a = facingAngle();
  const back = tuning.render.cameraBackOff;
  return {
    x: p.x + 0.5 - Math.sin(a) * back,
    z: p.y + 0.5 + Math.cos(a) * back,
  };
}

function frame(now: number): void {
  requestAnimationFrame(frame);
  accumulator += now - lastTime;
  lastTime = now;
  if (accumulator > 500) accumulator = 500;

  // Fixed-timestep simulation; the renderer interpolates below.
  while (accumulator >= TICK_MS) {
    accumulator -= TICK_MS;
    if (paused && !stepOnce) continue;
    stepOnce = false;
    const submitted = pendingIntents.splice(0, pendingIntents.length);
    const events = step(content, game.state, submitted);
    bus.publish(events);
  }

  const p = game.state.player;
  const faint = p.pulse >= tuning.pulse.faintThreshold;
  if (faint && !wasFaint && game.state.status === 'playing') pushLog('faint_warning');
  wasFaint = faint;

  const { fg, bg } = palette();
  ictx.fillStyle = bg;
  ictx.fillRect(0, 0, internal.width, internal.height);

  const eye = eyeTarget();
  const cam = tween.update(eye.x, eye.z, facingAngle(), now);
  const radius = lightRadius(content, game.state);
  const brightest = radius > 0 ? lightIntensity(content, game.state) : 1;

  ictx.save();
  ictx.beginPath();
  ictx.rect(0, 0, tuning.render.internalWidth, tuning.render.worldHeight);
  ictx.clip();
  const scene = buildScene(content, game.state, radius, brightest, now);
  const seen = visibleCreatures(content, game.state, cam, radius, scene.visible);
  const inserts = creatureInserts(ictx, content, game.state, cam, seen, settings.faceMode, fg, radius, brightest);
  drawScene(ictx, scene, cam, fg, inserts);
  // A blocked step flashes the view border so the wall is unmissable.
  if (now - lastBumpMs < 160) {
    ictx.strokeStyle = fg;
    ictx.lineWidth = 2;
    ictx.strokeRect(1, 1, tuning.render.internalWidth - 2, tuning.render.worldHeight - 2);
  }
  ictx.restore();

  // Mode C portrait: nearest visible creature.
  if (settings.faceMode === 'C' && seen.length > 0) {
    const nearest = seen.reduce((a, b) => (a.depth < b.depth ? a : b));
    hud.portrait = {
      defId: nearest.creature.defId,
      name: knownCreatures.has(nearest.creature.defId)
        ? content.creatures[nearest.creature.defId]!.name
        : null,
    };
  } else {
    hud.portrait = null;
  }

  drawHud(ictx, content, game.state, hud, fg, now);
  drawLookOverlay(ictx, hud, fg);
  if (game.state.status !== 'playing') drawEndCard(ictx, hud, game.state.status, fg, now);
  if (debugEnabled) drawDebugOverlay();

  heartbeat.update(p.pulse, game.state.status === 'playing' && !engine.isMuted);

  if (crtPass) {
    crtPass.present(internal);
  } else if (displayCtx && displayCanvas) {
    displayCtx.imageSmoothingEnabled = false;
    displayCtx.drawImage(internal, 0, 0, displayCanvas.width, displayCanvas.height);
  }
}

requestAnimationFrame(frame);

// ---------------------------------------------------------------------------
// Settings panel

function buildPanel(): void {
  const panel = document.getElementById('panel')!;
  const gear = document.getElementById('gear')!;
  gear.addEventListener('click', () => {
    panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
  });

  const h = (html: string): HTMLElement => {
    const div = document.createElement('div');
    div.innerHTML = html;
    return div.firstElementChild as HTMLElement;
  };

  const title = h(`<h3>${formatString(strings, 'title')} v${pkg.version}</h3>`);
  panel.appendChild(title);

  // Phosphor palette.
  const paletteRow = h(`<label>${formatString(strings, 'settings_palette')}: <select></select></label>`);
  const paletteSel = paletteRow.querySelector('select')!;
  for (const name of Object.keys(tuning.render.palettes)) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name.toUpperCase();
    if (name === settings.palette) opt.selected = true;
    paletteSel.appendChild(opt);
  }
  paletteSel.addEventListener('change', () => {
    settings.palette = paletteSel.value as PaletteName;
    clearFaceCache();
    saveSettings();
  });
  panel.appendChild(paletteRow);

  // Face mode.
  const faceRow = h(`<label>${formatString(strings, 'settings_faces')}: <select>
    <option value="A">A DITHERED BILLBOARD</option>
    <option value="B">B CONTOUR LINES</option>
    <option value="C">C PORTRAIT PANEL</option>
  </select></label>`);
  const faceSel = faceRow.querySelector('select')!;
  faceSel.value = settings.faceMode;
  faceSel.addEventListener('change', () => {
    settings.faceMode = faceSel.value as FaceMode;
    saveSettings();
  });
  panel.appendChild(faceRow);

  // CRT toggle.
  const crtRow = h(`<label><input type="checkbox"> ${formatString(strings, 'settings_crt')}</label>`);
  const crtBox = crtRow.querySelector('input')!;
  crtBox.checked = settings.crt;
  crtBox.addEventListener('change', () => {
    settings.crt = crtBox.checked;
    saveSettings();
    setupDisplay();
  });
  panel.appendChild(crtRow);

  // Mute.
  const audioRow = h(`<label><input type="checkbox"> ${formatString(strings, 'settings_audio')}</label>`);
  const audioBox = audioRow.querySelector('input')!;
  audioBox.checked = !settings.muted;
  audioBox.addEventListener('change', () => {
    settings.muted = !audioBox.checked;
    engine.setMuted(settings.muted);
    saveSettings();
  });
  panel.appendChild(audioRow);

  // Arrow key layer.
  const keysRow = h(`<label><input type="checkbox"> ${formatString(strings, 'settings_keys')}</label>`);
  const keysBox = keysRow.querySelector('input')!;
  keysBox.checked = settings.arrowKeys;
  keysBox.addEventListener('change', () => {
    settings.arrowKeys = keysBox.checked;
    saveSettings();
  });
  panel.appendChild(keysRow);

  // Save export / import.
  const exportBtn = h(`<button>${formatString(strings, 'settings_export')}</button>`);
  exportBtn.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(serializeGame(game.state))], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'caraross-save.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });
  panel.appendChild(exportBtn);

  const importBtn = h(`<button>${formatString(strings, 'settings_import')}</button>`);
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'application/json';
  fileInput.style.display = 'none';
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    void file.text().then((text) => {
      try {
        const saved = JSON.parse(text) as SavedGame;
        game.state = deserializeGame(content, saved, debugEnabled);
        tween.snap();
        pushLog('load_done', { slot: 'FILE' });
      } catch (err) {
        if (err instanceof Error && /schema version/i.test(err.message)) pushLog('load_version', { slot: 'FILE' });
        else pushLog('load_missing', { slot: 'FILE' });
      }
    });
  });
  importBtn.addEventListener('click', () => fileInput.click());
  panel.appendChild(importBtn);
  panel.appendChild(fileInput);

  // Credits.
  panel.appendChild(h(`<h3>${formatString(strings, 'credits_header')}</h3>`));
  const credits = faceCredits();
  const creditText =
    credits.length === 0
      ? formatString(strings, 'credits_none')
      : credits.map((c) => `${c.creatureId}: ${c.credit}`).join('\n');
  panel.appendChild(h(`<div class="credits">${creditText}</div>`));
  panel.appendChild(h(`<div class="credits">${formatString(strings, 'about')}</div>`));
}

buildPanel();
