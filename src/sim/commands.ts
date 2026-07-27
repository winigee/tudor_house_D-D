// CommandIntent to state mutation, with tick costs. A command's effect
// resolves at the end of its tick cost; the cost and the exertion are
// paid when it starts.

import type { CommandIntent } from './parser.ts';
import { matchItemWords } from './parser.ts';
import type { GameState, Content } from './step.ts';
import type { SimEvent } from './events.ts';
import type { Hand } from './player.ts';
import { otherHand } from './player.ts';
import type { ItemDef, WeaponDef, RingDef } from './items.ts';
import { instantiate } from './items.ts';
import { resolveSwing } from './combat.ts';
import {
  FACING_SIDE,
  OPPOSITE,
  DELTA,
  canPass,
  hasWall,
  doorAt,
  stairsAt,
  type Facing,
  type Side,
} from './world.ts';

export function intentCost(content: Content, state: GameState, intent: CommandIntent): number {
  const costs = content.tuning.commands.costs;
  switch (intent.verb) {
    case 'MOVE':
      return costs.MOVE;
    case 'BACK':
      return costs.BACK;
    case 'TURN':
      return intent.dir === 'AROUND' ? costs.TURN_AROUND : intent.dir === 'LEFT' ? costs.TURN_LEFT : costs.TURN_RIGHT;
    case 'ATTACK': {
      const inst = state.player.hands[intent.hand];
      if (inst) {
        const def = content.items[inst.defId]!;
        if (def.kind === 'weapon') return def.swingCostTicks;
      }
      return costs.ATTACK_EMPTY;
    }
    case 'GET':
      return costs.GET;
    case 'DROP':
      return costs.DROP;
    case 'PULL':
      return costs.PULL;
    case 'STOW':
      return costs.STOW;
    case 'LOOK':
      return costs.LOOK;
    case 'EXAMINE':
      return costs.EXAMINE;
    case 'REVEAL':
      return costs.REVEAL;
    case 'USE': {
      const inst = state.player.hands[intent.hand];
      return inst ? Math.max(1, Math.round(content.items[inst.defId]!.exertionToUse)) : 1;
    }
    case 'INCANT':
      return costs.INCANT;
    case 'CLIMB':
      return costs.CLIMB;
    case 'ZSAVE':
      return costs.ZSAVE;
    case 'ZLOAD':
      return costs.ZLOAD;
    case 'DEBUG':
      return 0;
  }
}

export function intentExertion(content: Content, state: GameState, intent: CommandIntent): number {
  const ex = content.tuning.commands.exertion;
  switch (intent.verb) {
    case 'MOVE':
      return ex.MOVE;
    case 'BACK':
      return ex.BACK;
    case 'TURN':
      return ex.TURN;
    case 'ATTACK':
      return ex.ATTACK;
    case 'GET':
      return ex.GET;
    case 'DROP':
      return ex.DROP;
    case 'PULL':
      return ex.PULL;
    case 'STOW':
      return ex.STOW;
    case 'LOOK':
      return ex.LOOK;
    case 'EXAMINE':
      return ex.EXAMINE;
    case 'REVEAL':
      return ex.REVEAL;
    case 'INCANT':
      return ex.INCANT;
    case 'CLIMB':
      return ex.CLIMB;
    case 'USE': {
      const inst = state.player.hands[intent.hand];
      return inst ? content.items[inst.defId]!.exertionToUse : 0;
    }
    case 'ZSAVE':
    case 'ZLOAD':
    case 'DEBUG':
      return 0;
  }
}

function displayName(content: Content, inst: { defId: string; identified: boolean }): string {
  const def = content.items[inst.defId]!;
  return inst.identified ? def.revealedName : def.name;
}

function creatureInCell(state: GameState, levelId: number, x: number, y: number) {
  return state.creatures.find((c) => c.levelId === levelId && c.x === x && c.y === y && c.hp > 0);
}

function killCreature(
  content: Content,
  state: GameState,
  c: NonNullable<ReturnType<typeof creatureInCell>>,
  events: SimEvent[],
): void {
  const def = content.creatures[c.defId]!;
  events.push({ type: 'creatureDied', defId: c.defId, at: [c.x, c.y] });
  events.push({ type: 'message', key: 'creature_died', params: { creature: def.name } });
  const runtime = state.levels[c.levelId]!;
  for (const drop of def.drops) {
    if (state.rng.chance(drop.chance)) {
      const itemDef = content.items[drop.itemId];
      if (itemDef) runtime.floorItems.push({ inst: instantiate(itemDef), x: c.x, y: c.y });
    }
  }
  state.creatures = state.creatures.filter((k) => k.uid !== c.uid);
  if (def.tier >= 5) {
    state.status = 'won';
    events.push({ type: 'victory' });
    events.push({ type: 'message', key: 'victory_line' });
  }
}

function tryMove(content: Content, state: GameState, dir: 'forward' | 'back', events: SimEvent[]): void {
  const p = state.player;
  const level = content.levels[p.levelId]!;
  const side: Side = dir === 'forward' ? FACING_SIDE[p.facing]! : OPPOSITE[FACING_SIDE[p.facing]!];
  if (!canPass(level, p.x, p.y, side, { throughSecret: true })) {
    events.push({ type: 'bump' });
    events.push({ type: 'message', key: 'blocked' });
    p.exertion += content.tuning.commands.exertion.BUMP;
    return;
  }
  // Walking through a wall bit means a secret door.
  if (hasWall(level, p.x, p.y, side)) {
    const door = doorAt(level, p.x, p.y, side);
    if (door && door.secret) {
      const key = `${door.at[0]},${door.at[1]},${door.side}`;
      const runtime = state.levels[p.levelId]!;
      if (!runtime.discoveredSecrets.includes(key)) {
        runtime.discoveredSecrets.push(key);
        events.push({ type: 'secretFound' });
        events.push({ type: 'message', key: 'secret_door_found' });
      }
    }
  }
  const [dx, dy] = DELTA[side];
  p.x += dx;
  p.y += dy;
  events.push({ type: 'moved' });
}

function resolveAttack(content: Content, state: GameState, hand: Hand, events: SimEvent[]): void {
  const p = state.player;
  const inst = p.hands[hand];
  const def = inst ? content.items[inst.defId]! : null;
  if (!inst || !def || def.kind !== 'weapon') {
    events.push({ type: 'message', key: 'attack_no_weapon' });
    return;
  }
  const level = content.levels[p.levelId]!;
  // A creature that has closed into the player's cell takes priority.
  let target = creatureInCell(state, p.levelId, p.x, p.y) ?? null;
  if (!target) {
    const side = FACING_SIDE[p.facing]!;
    if (canPass(level, p.x, p.y, side, { throughSecret: false })) {
      const [dx, dy] = DELTA[side];
      target = creatureInCell(state, p.levelId, p.x + dx, p.y + dy) ?? null;
    }
  }
  const outcome = resolveSwing(state.rng, { def: def as WeaponDef, inst }, target, content.creatures);
  events.push({ type: 'swing', hand, hit: outcome.hit });
  if (!outcome.hit) {
    events.push({ type: 'message', key: 'swing_missed' });
  } else {
    const cdef = content.creatures[outcome.target!.defId]!;
    events.push({
      type: 'message',
      key: 'swing_hit',
      params: { creature: cdef.name },
    });
    // Being struck alerts the creature even outside its sense range.
    if (!outcome.killed && outcome.target!.state === 'idle') outcome.target!.state = 'hunting';
    if (outcome.killed) killCreature(content, state, outcome.target!, events);
  }
  if (outcome.broke) {
    p.hands[hand] = null;
    events.push({ type: 'itemBroke', kind: 'weapon' });
    events.push({ type: 'message', key: 'weapon_broke', params: { item: def.revealedName } });
  }
}

function fireBolt(content: Content, state: GameState, ring: RingDef, inst: { charges?: number }, events: SimEvent[]): void {
  if ((inst.charges ?? 0) <= 0) {
    events.push({ type: 'message', key: 'ring_dead' });
    return;
  }
  inst.charges = (inst.charges ?? 0) - 1;
  const p = state.player;
  const level = content.levels[p.levelId]!;
  const side = FACING_SIDE[p.facing]!;
  const [dx, dy] = DELTA[side];
  let x = p.x;
  let y = p.y;
  const damageType = ring.effect === 'fire_bolt' ? 'fire' : 'ice';
  events.push({ type: 'message', key: 'bolt_fired' });
  while (canPass(level, x, y, side, { throughSecret: false })) {
    x += dx;
    y += dy;
    const target = creatureInCell(state, p.levelId, x, y);
    if (target) {
      const cdef = content.creatures[target.defId]!;
      const raw = state.rng.int(ring.boltDamage?.[0] ?? 2, ring.boltDamage?.[1] ?? 6);
      const dmg = Math.round(raw * cdef.damageMultipliers[damageType]);
      target.hp -= dmg;
      events.push({ type: 'message', key: 'bolt_hit', params: { creature: cdef.name } });
      if (target.hp <= 0) killCreature(content, state, target, events);
      else if (target.state === 'idle') target.state = 'hunting';
      return;
    }
  }
  events.push({ type: 'message', key: 'bolt_missed' });
}

function resolveUse(content: Content, state: GameState, hand: Hand, events: SimEvent[]): void {
  const p = state.player;
  const inst = p.hands[hand];
  if (!inst) {
    events.push({ type: 'message', key: 'hand_empty' });
    return;
  }
  const def = content.items[inst.defId]!;
  switch (def.kind) {
    case 'torch':
      if (inst.lit) events.push({ type: 'message', key: 'torch_already_lit' });
      else {
        inst.lit = true;
        events.push({ type: 'message', key: 'torch_lit', params: { item: displayName(content, inst) } });
      }
      break;
    case 'flask': {
      inst.identified = true;
      if (def.effect === 'heal') {
        p.pulse = Math.max(content.tuning.pulse.resting, p.pulse - def.magnitude);
      } else {
        p.exertion = Math.max(0, p.exertion - def.magnitude);
      }
      events.push({ type: 'message', key: 'flask_drunk', params: { item: def.revealedName } });
      p.hands[hand] = null;
      break;
    }
    case 'ring': {
      inst.identified = true;
      if (def.effect === 'reveal') events.push({ type: 'message', key: 'ring_hums' });
      else fireBolt(content, state, def, inst, events);
      break;
    }
    case 'scroll': {
      inst.identified = true;
      const word = def.word.toUpperCase();
      if (!p.knownWords.includes(word)) p.knownWords.push(word);
      events.push({ type: 'message', key: 'scroll_read', params: { word } });
      p.hands[hand] = null; // the scroll crumbles once read
      break;
    }
    case 'weapon':
    case 'shield':
      events.push({ type: 'message', key: 'nothing_happens' });
      break;
  }
}

function resolveExamine(content: Content, state: GameState, hand: Hand, events: SimEvent[]): void {
  const inst = state.player.hands[hand];
  if (!inst) {
    events.push({ type: 'message', key: 'hand_empty' });
    return;
  }
  const def = content.items[inst.defId]!;
  if (!inst.identified && def.kind !== 'torch' && def.kind !== 'weapon' && def.kind !== 'shield') {
    events.push({ type: 'message', key: 'examine_unknown', params: { item: def.name } });
    return;
  }
  const lines: { key: string; params?: Record<string, string | number> }[] = [];
  lines.push({ key: 'examine_name', params: { item: displayName(content, inst) } });
  switch (def.kind) {
    case 'weapon':
      lines.push({
        key: 'examine_weapon',
        params: { min: def.damage[0], max: def.damage[1], type: def.damageType, durability: inst.durability ?? 0 },
      });
      break;
    case 'torch':
      lines.push({
        key: 'examine_torch',
        params: { radius: def.radius, left: Math.max(0, Math.round((inst.burnLeft ?? 0) / content.tuning.sim.tickHz)) },
      });
      break;
    case 'ring':
      lines.push({ key: 'examine_ring', params: { charges: inst.charges ?? 0 } });
      break;
    case 'flask':
      lines.push({ key: 'examine_flask' });
      break;
    case 'scroll':
      lines.push({ key: 'examine_scroll', params: { word: def.word.toUpperCase() } });
      break;
    case 'shield':
      lines.push({
        key: 'examine_shield',
        params: { block: Math.round(def.block * 100), durability: inst.durability ?? 0 },
      });
      break;
  }
  events.push({ type: 'examine', lines });
}

function resolveReveal(content: Content, state: GameState, hand: Hand, events: SimEvent[]): void {
  const p = state.player;
  const inst = p.hands[hand];
  if (!inst) {
    events.push({ type: 'message', key: 'hand_empty' });
    return;
  }
  if (inst.identified) {
    events.push({ type: 'message', key: 'already_identified' });
    return;
  }
  // A charge comes from a ring of seeing in the other hand, or from the
  // target itself when it is such a ring.
  const other = p.hands[otherHand(hand)];
  let source: typeof inst | null = null;
  if (other && content.items[other.defId]!.kind === 'ring' && (content.items[other.defId] as RingDef).effect === 'reveal' && (other.charges ?? 0) > 0) {
    source = other;
  } else if (content.items[inst.defId]!.kind === 'ring' && (content.items[inst.defId] as RingDef).effect === 'reveal' && (inst.charges ?? 0) > 0) {
    source = inst;
  }
  if (!source) {
    events.push({ type: 'message', key: 'reveal_fails' });
    return;
  }
  source.charges = (source.charges ?? 0) - 1;
  inst.identified = true;
  events.push({ type: 'message', key: 'revealed', params: { item: displayName(content, inst) } });
}

function resolveIncant(content: Content, state: GameState, word: string, events: SimEvent[]): void {
  const p = state.player;
  const w = word.toUpperCase();
  const known = p.knownWords.includes(w);
  const scroll = Object.values(content.items).find(
    (d): d is Extract<ItemDef, { kind: 'scroll' }> => d.kind === 'scroll' && d.word.toUpperCase() === w,
  );
  if (!known || !scroll) {
    events.push({ type: 'message', key: 'incant_fizzles' });
    return;
  }
  events.push({ type: 'incant', word: w, effect: scroll.effect });
  switch (scroll.effect) {
    case 'fear':
      state.fearTicks = content.tuning.creatures.fearTicks;
      events.push({ type: 'message', key: 'incant_fear' });
      break;
    case 'light':
      state.lightBoostTicks = content.tuning.light.incantLightTicks;
      events.push({ type: 'message', key: 'incant_light' });
      break;
    case 'calm':
      p.pulse = Math.max(content.tuning.pulse.resting, p.pulse - content.tuning.incant.calmAmount);
      events.push({ type: 'message', key: 'incant_calm' });
      break;
  }
}

function resolveClimb(content: Content, state: GameState, dir: 'UP' | 'DOWN', events: SimEvent[]): void {
  const p = state.player;
  const level = content.levels[p.levelId]!;
  const stairs = stairsAt(level, p.x, p.y, dir);
  if (!stairs) {
    events.push({ type: 'message', key: dir === 'UP' ? 'no_stairs_up' : 'no_stairs_down' });
    return;
  }
  const target = content.levels[stairs.to];
  if (!target) {
    // The way exists but leads out of the dungeon: floor 1's entry
    // ladder is sealed behind the player, so say so rather than
    // claiming there is nothing here.
    events.push({ type: 'message', key: 'stairs_sealed' });
    return;
  }
  // Arrive at the matching stairs on the target floor.
  const back = (dir === 'UP' ? target.features.stairsDown : target.features.stairsUp) ?? [];
  const arrival = back.find((s) => s.to === level.id) ?? { at: [p.x, p.y] as [number, number] };
  p.levelId = target.id;
  p.x = arrival.at[0];
  p.y = arrival.at[1];
  events.push({ type: 'climbed', to: target.id });
  events.push({ type: 'message', key: dir === 'UP' ? 'climbed_up' : 'climbed_down', params: { floor: target.id } });
}

/** Resolve the effect of a completed command. */
export function resolveIntent(
  content: Content,
  state: GameState,
  intent: CommandIntent,
  events: SimEvent[],
): void {
  const p = state.player;
  const runtime = state.levels[p.levelId]!;

  switch (intent.verb) {
    case 'MOVE':
      tryMove(content, state, 'forward', events);
      break;
    case 'BACK':
      tryMove(content, state, 'back', events);
      break;
    case 'TURN': {
      const delta = intent.dir === 'LEFT' ? 3 : intent.dir === 'RIGHT' ? 1 : 2;
      p.facing = ((p.facing + delta) % 4) as Facing;
      events.push({ type: 'turned' });
      break;
    }
    case 'ATTACK':
      resolveAttack(content, state, intent.hand, events);
      break;
    case 'GET': {
      if (p.hands[intent.hand]) {
        events.push({ type: 'message', key: 'hand_full' });
        break;
      }
      const here = runtime.floorItems.filter((f) => f.x === p.x && f.y === p.y);
      const top = here[here.length - 1];
      if (!top) {
        events.push({ type: 'message', key: 'floor_empty' });
        break;
      }
      runtime.floorItems = runtime.floorItems.filter((f) => f !== top);
      p.hands[intent.hand] = top.inst;
      events.push({ type: 'message', key: 'got_item', params: { item: displayName(content, top.inst) } });
      break;
    }
    case 'DROP': {
      const inst = p.hands[intent.hand];
      if (!inst) {
        events.push({ type: 'message', key: 'hand_empty' });
        break;
      }
      p.hands[intent.hand] = null;
      runtime.floorItems.push({ inst, x: p.x, y: p.y });
      events.push({ type: 'message', key: 'dropped_item', params: { item: displayName(content, inst) } });
      break;
    }
    case 'PULL': {
      if (p.hands[intent.hand]) {
        events.push({ type: 'message', key: 'hand_full' });
        break;
      }
      const names = p.pack.map((inst) => displayName(content, inst));
      const matches = matchItemWords(intent.itemWords, names);
      const idx = matches[0];
      if (idx === undefined) {
        events.push({ type: 'message', key: 'not_in_pack', params: { item: intent.itemWords.join(' ') } });
        break;
      }
      const inst = p.pack[idx]!;
      p.pack.splice(idx, 1);
      p.hands[intent.hand] = inst;
      events.push({ type: 'message', key: 'pulled_item', params: { item: displayName(content, inst) } });
      break;
    }
    case 'STOW': {
      const inst = p.hands[intent.hand];
      if (!inst) {
        events.push({ type: 'message', key: 'hand_empty' });
        break;
      }
      p.hands[intent.hand] = null;
      p.pack.push(inst);
      events.push({ type: 'message', key: 'stowed_item', params: { item: displayName(content, inst) } });
      break;
    }
    case 'LOOK': {
      const pack = p.pack.map((inst) => displayName(content, inst));
      const floor = runtime.floorItems
        .filter((f) => f.x === p.x && f.y === p.y)
        .map((f) => displayName(content, f.inst));
      events.push({ type: 'look', pack, floor });
      break;
    }
    case 'EXAMINE':
      resolveExamine(content, state, intent.hand, events);
      break;
    case 'REVEAL':
      resolveReveal(content, state, intent.hand, events);
      break;
    case 'USE':
      resolveUse(content, state, intent.hand, events);
      break;
    case 'INCANT':
      resolveIncant(content, state, intent.word, events);
      break;
    case 'CLIMB':
      resolveClimb(content, state, intent.dir, events);
      break;
    case 'ZSAVE':
      events.push({ type: 'saveRequested', slot: intent.slot });
      break;
    case 'ZLOAD':
      events.push({ type: 'loadRequested', slot: intent.slot });
      break;
    case 'DEBUG':
      resolveDebug(content, state, intent, events);
      break;
  }
}

function resolveDebug(
  content: Content,
  state: GameState,
  intent: Extract<CommandIntent, { verb: 'DEBUG' }>,
  events: SimEvent[],
): void {
  if (!state.debug.enabled) return;
  const p = state.player;
  switch (intent.cmd) {
    case 'TELEPORT': {
      const x = Number(intent.args[0]);
      const y = Number(intent.args[1]);
      const level = content.levels[p.levelId]!;
      if (Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < level.size.w && y < level.size.h) {
        p.x = x;
        p.y = y;
        events.push({ type: 'moved' });
      }
      break;
    }
    case 'SPAWN': {
      const defId = (intent.args[0] ?? '').toLowerCase();
      if (content.creatures[defId]) {
        state.creatures.push({
          uid: state.uidCounter++,
          defId,
          levelId: p.levelId,
          x: p.x,
          y: p.y,
          hp: content.creatures[defId]!.health,
          state: 'idle',
          moveCooldown: content.creatures[defId]!.movePeriodTicks,
          attackCooldown: content.creatures[defId]!.attackPeriodTicks,
          spawnIndex: -1,
        });
      }
      break;
    }
    case 'PULSE':
      state.debug.pulseFrozen = !state.debug.pulseFrozen;
      break;
    case 'TORCH':
      for (const hand of ['LEFT', 'RIGHT'] as const) {
        const inst = p.hands[hand];
        if (inst) {
          const def = content.items[inst.defId]!;
          if (def.kind === 'torch') inst.burnLeft = def.burnTicks;
        }
      }
      break;
  }
}
