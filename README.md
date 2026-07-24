# DAGGORATH.JS

A browser reimplementation of the 1982 wireframe dungeon crawl
*Dungeons of Daggorath* (Tandy / DynaMicro), built from the written
specification alone: no original code, strings, maps or sprite data.
TypeScript, Canvas 2D, Web Audio; no runtime dependencies; ships as a
static bundle.

## The four pillars

1. White vector lines on black, drawn at 256x192 and upscaled
   nearest-neighbour.
2. Everything is typed: a parser drives the game, with shortest
   unambiguous abbreviations (`PU SW R` = `PULL SWORD RIGHT`).
3. No hit points. You have a pulse. Exertion raises it, rest lowers
   it, and above the ceiling your heart bursts.
4. Sound is information: you hear a creature's footfalls — what it is,
   roughly where — before you see a line of it.

## Play

```
npm install
npm run dev        # http://localhost:5173
```

You begin with a pine torch and a wooden sword in your pack, in the
dark. Try: `PULL TORCH LEFT`, `USE LEFT`, `PULL SWORD RIGHT`, then
`MOVE`, `TURN LEFT`, `ATTACK RIGHT`. `LOOK` lists pack and floor.
`CLIMB DOWN` takes stairs. `ZSAVE 1` / `ZLOAD 1` save and restore.
Escape flushes queued commands. The arrow keys and Z/X mirror the
movement and attack verbs (toggle in the settings panel, top right).

The Ross waits on floor 5, and the CarrotAss prowls the deep floors
before him.

## Commands

`MOVE BACK TURN ATTACK GET DROP PULL STOW LOOK EXAMINE REVEAL USE
INCANT CLIMB ZSAVE ZLOAD` — every verb and noun abbreviates to its
shortest unambiguous prefix, and several commands chain in one line:
`M M T L A R`.

## Build and test

```
npm test             # 45 Vitest cases: parser, pulse, combat, paths, replays
npm run build        # typecheck + static bundle in dist/ (~33 kB gzipped)
npm run build:levels # regenerate the five floors (deterministic)
npm run build:faces  # photo pipeline, see below
```

Debug tools live behind `?debug=1`: top-down map (F10 toggles), pause
(F8), single-step (F9), tick counter, and typed `$TELEPORT x y`,
`$SPAWN id`, `$PULSE` (freeze), `$TORCH` (refill). Add `&seed=n` for a
reproducible dungeon.

## Creature faces

Drop a photograph at `assets_src/creatures/<creatureId>/face.jpg` (any
size), optionally with a `credit.txt` beside it, then `npm run
build:faces`. The pipeline writes 96px and 48px 1-bit Atkinson-dithered
PNGs plus an edge-contour path set, and the manifest
`src/data/faces.json`. No code change is needed; creatures without a
photograph use procedural wireframe placeholders (the console lists
them once at boot). Three display modes in settings: A dithered
billboard (default), B contour lines, C portrait panel. Credits print
in the settings panel.

## Deploying

`npm run build` emits a fully static `dist/` — host it anywhere. The
game fetches nothing at runtime; saves live in `localStorage` with
JSON export/import in the settings panel.

On Cloudflare, `wrangler.jsonc` deploys `dist/` as an assets-only
Worker. In the Git-connected Workers flow use build command
`npm run build` and deploy command `npx wrangler deploy` (project name
`dungeons-of-caraross`, matching the config); in the classic Pages
flow use build command `npm run build` with output directory `dist`
and no deploy command.

## Architecture

`src/sim/` is a pure, deterministic 30 Hz simulation — no DOM, no
Canvas, no audio, every random draw through a seeded RNG owned by the
game state. `src/render/` and `src/audio/` are adapters that consume
typed events. Replay tests pin the simulation: a recorded command log
plus a seed must reach a stored state hash. See `DECISIONS.md` for
every judgement call the spec left open.
