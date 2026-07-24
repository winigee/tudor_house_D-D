import { describe, expect, it } from 'vitest';
import { parse, matchItemWords } from '../src/sim/parser.ts';

describe('parser', () => {
  it('parses full verbs', () => {
    const r = parse('MOVE');
    expect(r).toEqual({ ok: true, intents: [{ verb: 'MOVE' }] });
  });

  it('accepts shortest unambiguous abbreviations', () => {
    expect(parse('M')).toEqual({ ok: true, intents: [{ verb: 'MOVE' }] });
    expect(parse('A L')).toEqual({ ok: true, intents: [{ verb: 'ATTACK', hand: 'LEFT' }] });
    expect(parse('T A')).toEqual({ ok: true, intents: [{ verb: 'TURN', dir: 'AROUND' }] });
    expect(parse('C U')).toEqual({ ok: true, intents: [{ verb: 'CLIMB', dir: 'UP' }] });
    expect(parse('G R')).toEqual({ ok: true, intents: [{ verb: 'GET', hand: 'RIGHT' }] });
    expect(parse('S L')).toEqual({ ok: true, intents: [{ verb: 'STOW', hand: 'LEFT' }] });
  });

  it('parses PULL with item words and hand', () => {
    expect(parse('PU SW R')).toEqual({
      ok: true,
      intents: [{ verb: 'PULL', itemWords: ['SW'], hand: 'RIGHT' }],
    });
    expect(parse('PULL PINE TORCH LEFT')).toEqual({
      ok: true,
      intents: [{ verb: 'PULL', itemWords: ['PINE', 'TORCH'], hand: 'LEFT' }],
    });
  });

  it('chains several commands in one submission', () => {
    const r = parse('M M T L A R');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.intents).toEqual([
        { verb: 'MOVE' },
        { verb: 'MOVE' },
        { verb: 'TURN', dir: 'LEFT' },
        { verb: 'ATTACK', hand: 'RIGHT' },
      ]);
    }
  });

  it('rejects ambiguous verb abbreviations with candidates', () => {
    const r = parse('Z 1');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errorKey).toBe('parse_ambiguous');
      expect(String(r.params?.candidates)).toContain('ZSAVE');
      expect(String(r.params?.candidates)).toContain('ZLOAD');
    }
  });

  it('resolves ZS and ZL', () => {
    expect(parse('ZS 1')).toEqual({ ok: true, intents: [{ verb: 'ZSAVE', slot: '1' }] });
    expect(parse('ZL 1')).toEqual({ ok: true, intents: [{ verb: 'ZLOAD', slot: '1' }] });
  });

  it('rejects rubbish', () => {
    const r = parse('FROBNICATE NOW');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorKey).toBe('parse_unknown');
  });

  it('rejects missing arguments', () => {
    const r = parse('TURN');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorKey).toBe('parse_missing_argument');
  });

  it('rejects bad arguments', () => {
    const r = parse('TURN UP');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorKey).toBe('parse_bad_argument');
  });

  it('parses INCANT with its word', () => {
    expect(parse('I VESPER')).toEqual({ ok: true, intents: [{ verb: 'INCANT', word: 'VESPER' }] });
  });

  it('is case-insensitive and whitespace-tolerant', () => {
    expect(parse('  move   move ')).toEqual({
      ok: true,
      intents: [{ verb: 'MOVE' }, { verb: 'MOVE' }],
    });
  });

  it('returns no intents for an empty line', () => {
    expect(parse('')).toEqual({ ok: true, intents: [] });
  });

  it('only accepts debug commands when enabled', () => {
    const off = parse('$TELEPORT 3 3', false);
    expect(off.ok).toBe(false);
    const on = parse('$TELEPORT 3 3', true);
    expect(on).toEqual({
      ok: true,
      intents: [{ verb: 'DEBUG', cmd: 'TELEPORT', args: ['3', '3'] }],
    });
  });

  it('matches item words against names', () => {
    const names = ['PINE TORCH', 'LUNAR TORCH', 'WOODEN SWORD'];
    expect(matchItemWords(['PI'], names)).toEqual([0]);
    expect(matchItemWords(['TO'], names)).toEqual([0, 1]);
    expect(matchItemWords(['SW'], names)).toEqual([2]);
    expect(matchItemWords(['LU', 'TO'], names)).toEqual([1]);
    expect(matchItemWords(['XX'], names)).toEqual([]);
  });
});
