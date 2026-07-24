// Typed events emitted by the simulation each tick. The sim never
// formats player-facing text; it emits string keys into strings.json
// plus parameters, and the adapters (render, audio, main) do the rest.

export type MessageParams = Record<string, string | number>;

export type SimEvent =
  | { type: 'message'; key: string; params?: MessageParams }
  | { type: 'moved' }
  | { type: 'turned' }
  | { type: 'bump' }
  | { type: 'climbed'; to: number }
  | {
      type: 'footstep';
      creatureDefId: string;
      soundId: string;
      /** Euclidean distance in cells from the player. */
      distance: number;
      /** Bearing in radians relative to the player's facing; 0 = ahead, positive = right. */
      bearing: number;
    }
  | { type: 'swing'; hand: 'LEFT' | 'RIGHT'; hit: boolean }
  | { type: 'playerHit'; shock: number; blocked: boolean }
  | { type: 'creatureDied'; defId: string; at: [number, number] }
  | { type: 'torchDied' }
  | { type: 'itemBroke'; kind: string }
  | { type: 'look'; pack: string[]; floor: string[] }
  | { type: 'examine'; lines: { key: string; params?: MessageParams }[] }
  | { type: 'incant'; word: string; effect: string }
  | { type: 'death' }
  | { type: 'victory' }
  | { type: 'saveRequested'; slot: string }
  | { type: 'loadRequested'; slot: string }
  | { type: 'secretFound' };

/** Adapter-side subscription bus. The sim itself only returns arrays. */
export type EventHandler = (ev: SimEvent) => void;

export class EventBus {
  private handlers: EventHandler[] = [];

  subscribe(fn: EventHandler): () => void {
    this.handlers.push(fn);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== fn);
    };
  }

  publish(events: readonly SimEvent[]): void {
    for (const ev of events) {
      for (const h of this.handlers) h(ev);
    }
  }
}
