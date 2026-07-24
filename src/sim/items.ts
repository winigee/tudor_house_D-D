// Item definitions (static content) and item instances (mutable state).

export type ItemKind = 'weapon' | 'torch' | 'ring' | 'flask' | 'scroll' | 'shield';
export type DamageType = 'physical' | 'fire' | 'ice';

export interface ItemDefBase {
  id: string;
  name: string;
  revealedName: string;
  kind: ItemKind;
  weight: number;
  exertionToUse: number;
  identified: boolean;
}

export interface WeaponDef extends ItemDefBase {
  kind: 'weapon';
  damage: [number, number];
  damageType: DamageType;
  swingCostTicks: number;
  durability: number;
}

export interface TorchDef extends ItemDefBase {
  kind: 'torch';
  radius: number;
  burnTicks: number;
  intensity: number;
}

export type RingEffect = 'fire_bolt' | 'ice_bolt' | 'reveal';

export interface RingDef extends ItemDefBase {
  kind: 'ring';
  effect: RingEffect;
  charges: number;
  /** Bolt rings roll damage from this range. */
  boltDamage?: [number, number];
}

export type FlaskEffect = 'heal' | 'vigor';

export interface FlaskDef extends ItemDefBase {
  kind: 'flask';
  effect: FlaskEffect;
  magnitude: number;
}

export type IncantEffect = 'fear' | 'light' | 'calm';

export interface ScrollDef extends ItemDefBase {
  kind: 'scroll';
  word: string;
  effect: IncantEffect;
}

export interface ShieldDef extends ItemDefBase {
  kind: 'shield';
  block: number;
  durability: number;
}

export type ItemDef = WeaponDef | TorchDef | RingDef | FlaskDef | ScrollDef | ShieldDef;

/** A live item. Only mutable fields beyond the def id live here. */
export interface ItemInstance {
  defId: string;
  identified: boolean;
  durability?: number;
  burnLeft?: number;
  lit?: boolean;
  charges?: number;
}

const KINDS: ItemKind[] = ['weapon', 'torch', 'ring', 'flask', 'scroll', 'shield'];

export function validateItems(raw: unknown, path: string): Record<string, ItemDef> {
  if (!Array.isArray(raw)) throw new Error(`Content error in ${path}: root must be an array`);
  const out: Record<string, ItemDef> = {};
  raw.forEach((entry, i) => {
    const fail = (field: string, why: string): never => {
      throw new Error(`Content error in ${path} entry ${i} field "${field}": ${why}`);
    };
    const d = entry as ItemDef;
    if (typeof d.id !== 'string' || d.id.length === 0) fail('id', 'must be a non-empty string');
    if (out[d.id]) fail('id', `duplicate id ${d.id}`);
    if (!KINDS.includes(d.kind)) fail('kind', `must be one of ${KINDS.join(', ')}`);
    for (const f of ['name', 'revealedName'] as const) {
      if (typeof d[f] !== 'string') fail(f, 'must be a string');
    }
    for (const f of ['weight', 'exertionToUse'] as const) {
      if (typeof d[f] !== 'number') fail(f, 'must be a number');
    }
    if (typeof d.identified !== 'boolean') fail('identified', 'must be a boolean');
    switch (d.kind) {
      case 'weapon':
        if (!Array.isArray(d.damage) || d.damage.length !== 2) fail('damage', 'must be [min,max]');
        if (!['physical', 'fire', 'ice'].includes(d.damageType)) fail('damageType', 'bad type');
        if (typeof d.swingCostTicks !== 'number') fail('swingCostTicks', 'must be a number');
        if (typeof d.durability !== 'number') fail('durability', 'must be a number');
        break;
      case 'torch':
        if (typeof d.radius !== 'number') fail('radius', 'must be a number');
        if (typeof d.burnTicks !== 'number') fail('burnTicks', 'must be a number');
        if (typeof d.intensity !== 'number') fail('intensity', 'must be a number');
        break;
      case 'ring':
        if (!['fire_bolt', 'ice_bolt', 'reveal'].includes(d.effect)) fail('effect', 'bad effect');
        if (typeof d.charges !== 'number') fail('charges', 'must be a number');
        break;
      case 'flask':
        if (!['heal', 'vigor'].includes(d.effect)) fail('effect', 'bad effect');
        if (typeof d.magnitude !== 'number') fail('magnitude', 'must be a number');
        break;
      case 'scroll':
        if (typeof d.word !== 'string' || d.word.length === 0) fail('word', 'must be a word');
        if (!['fear', 'light', 'calm'].includes(d.effect)) fail('effect', 'bad effect');
        break;
      case 'shield':
        if (typeof d.block !== 'number' || d.block < 0 || d.block > 1) fail('block', 'must be 0..1');
        if (typeof d.durability !== 'number') fail('durability', 'must be a number');
        break;
    }
    out[d.id] = d;
  });
  return out;
}

export function instantiate(def: ItemDef): ItemInstance {
  const inst: ItemInstance = { defId: def.id, identified: def.identified };
  switch (def.kind) {
    case 'weapon':
    case 'shield':
      inst.durability = def.durability;
      break;
    case 'torch':
      inst.burnLeft = def.burnTicks;
      inst.lit = false;
      break;
    case 'ring':
      inst.charges = def.charges;
      break;
    case 'flask':
    case 'scroll':
      break;
  }
  return inst;
}

export function displayNameKeyed(def: ItemDef, inst: ItemInstance): string {
  return inst.identified ? def.revealedName : def.name;
}

export function itemWeight(def: ItemDef): number {
  return def.weight;
}
