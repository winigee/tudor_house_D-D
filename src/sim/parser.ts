// Text to CommandIntent. Accepts one or more commands per submission,
// separated by spaces, and the shortest unambiguous abbreviation of
// every verb and noun. Item words resolve against the pack later, at
// execution time, because the pack can change while commands queue.

export type HandWord = 'LEFT' | 'RIGHT';
export type TurnWord = 'LEFT' | 'RIGHT' | 'AROUND';
export type ClimbWord = 'UP' | 'DOWN';

export type CommandIntent =
  | { verb: 'MOVE' }
  | { verb: 'BACK' }
  | { verb: 'LOOK' }
  | { verb: 'TURN'; dir: TurnWord }
  | { verb: 'ATTACK'; hand: HandWord }
  | { verb: 'GET'; hand: HandWord }
  | { verb: 'DROP'; hand: HandWord }
  | { verb: 'STOW'; hand: HandWord }
  | { verb: 'EXAMINE'; hand: HandWord }
  | { verb: 'REVEAL'; hand: HandWord }
  | { verb: 'USE'; hand: HandWord }
  | { verb: 'PULL'; itemWords: string[]; hand: HandWord }
  | { verb: 'INCANT'; word: string }
  | { verb: 'CLIMB'; dir: ClimbWord }
  | { verb: 'ZSAVE'; slot: string }
  | { verb: 'ZLOAD'; slot: string }
  | { verb: 'DEBUG'; cmd: string; args: string[] };

export type ParseResult =
  | { ok: true; intents: CommandIntent[] }
  | { ok: false; errorKey: string; params?: Record<string, string | number> };

const VERBS = [
  'MOVE',
  'BACK',
  'TURN',
  'ATTACK',
  'GET',
  'DROP',
  'PULL',
  'STOW',
  'LOOK',
  'EXAMINE',
  'REVEAL',
  'USE',
  'INCANT',
  'CLIMB',
  'ZSAVE',
  'ZLOAD',
] as const;

type Verb = (typeof VERBS)[number];

/** All candidates for which `token` is a prefix. */
function matchWord<T extends string>(token: string, words: readonly T[]): T[] {
  const exact = words.filter((w) => w === token);
  if (exact.length === 1) return exact;
  return words.filter((w) => w.startsWith(token));
}

function matchHand(token: string): HandWord | null {
  const m = matchWord(token, ['LEFT', 'RIGHT'] as const);
  return m.length === 1 ? m[0]! : null;
}

export function parse(line: string, debugEnabled = false): ParseResult {
  const tokens = line.trim().toUpperCase().split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return { ok: true, intents: [] };

  const intents: CommandIntent[] = [];
  let i = 0;

  const need = (verb: Verb): ParseResult => ({
    ok: false,
    errorKey: 'parse_missing_argument',
    params: { verb },
  });

  while (i < tokens.length) {
    const tok = tokens[i]!;

    if (debugEnabled && tok.startsWith('$')) {
      // Debug commands swallow the rest of the line.
      intents.push({ verb: 'DEBUG', cmd: tok.slice(1), args: tokens.slice(i + 1) });
      i = tokens.length;
      break;
    }

    const verbs = matchWord(tok, VERBS);
    if (verbs.length === 0) {
      return { ok: false, errorKey: 'parse_unknown', params: { word: tok } };
    }
    if (verbs.length > 1) {
      return {
        ok: false,
        errorKey: 'parse_ambiguous',
        params: { word: tok, candidates: verbs.join(' ') },
      };
    }
    const verb = verbs[0]!;
    i++;

    switch (verb) {
      case 'MOVE':
      case 'BACK':
      case 'LOOK':
        intents.push({ verb });
        break;

      case 'TURN': {
        const arg = tokens[i];
        if (arg === undefined) return need(verb);
        const dirs = matchWord(arg, ['LEFT', 'RIGHT', 'AROUND'] as const);
        if (dirs.length !== 1)
          return { ok: false, errorKey: 'parse_bad_argument', params: { verb, word: arg } };
        intents.push({ verb, dir: dirs[0]! });
        i++;
        break;
      }

      case 'CLIMB': {
        const arg = tokens[i];
        if (arg === undefined) return need(verb);
        const dirs = matchWord(arg, ['UP', 'DOWN'] as const);
        if (dirs.length !== 1)
          return { ok: false, errorKey: 'parse_bad_argument', params: { verb, word: arg } };
        intents.push({ verb, dir: dirs[0]! });
        i++;
        break;
      }

      case 'ATTACK':
      case 'GET':
      case 'DROP':
      case 'STOW':
      case 'EXAMINE':
      case 'REVEAL':
      case 'USE': {
        const arg = tokens[i];
        if (arg === undefined) return need(verb);
        const hand = matchHand(arg);
        if (hand === null)
          return { ok: false, errorKey: 'parse_bad_argument', params: { verb, word: arg } };
        intents.push({ verb, hand });
        i++;
        break;
      }

      case 'PULL': {
        // Item words up to the first token that reads as a hand.
        const itemWords: string[] = [];
        let hand: HandWord | null = null;
        while (i < tokens.length) {
          const t = tokens[i]!;
          const h = matchHand(t);
          if (h !== null) {
            hand = h;
            i++;
            break;
          }
          itemWords.push(t);
          i++;
        }
        if (hand === null || itemWords.length === 0) return need(verb);
        intents.push({ verb, itemWords, hand });
        break;
      }

      case 'INCANT': {
        const arg = tokens[i];
        if (arg === undefined) return need(verb);
        intents.push({ verb, word: arg });
        i++;
        break;
      }

      case 'ZSAVE':
      case 'ZLOAD': {
        const arg = tokens[i];
        if (arg === undefined) return need(verb);
        intents.push({ verb, slot: arg });
        i++;
        break;
      }
    }
  }

  return { ok: true, intents };
}

/**
 * Match item words against a list of candidate display names.
 * Each token must prefix-match successive words of the name, in order,
 * skipping name words freely, so "PI TO" and "TO" both match
 * "PINE TORCH". Returns candidate indices.
 */
export function matchItemWords(itemWords: string[], names: string[]): number[] {
  const out: number[] = [];
  for (let idx = 0; idx < names.length; idx++) {
    const words = names[idx]!.toUpperCase().split(/\s+/);
    let wi = 0;
    let matched = 0;
    for (const tok of itemWords) {
      while (wi < words.length && !words[wi]!.startsWith(tok)) wi++;
      if (wi >= words.length) break;
      matched++;
      wi++;
    }
    if (matched === itemWords.length) out.push(idx);
  }
  return out;
}
