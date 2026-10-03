import {describe, expect, it} from 'vitest';
import {DEFAULTS, diff, merge} from '../src/settings';

describe('merge', () => {
  it('gives a state saved before a setting existed its default', () => {
    const old = {nodeSize: 5, labels: 'near'} as const;
    const s = merge(DEFAULTS, old);
    expect(s.nodeSize).toBe(5);
    expect(s.pointerRadius).toBe(DEFAULTS.pointerRadius);
    expect(s.pointerMax).toBe(DEFAULTS.pointerMax);
  });

  it('drops keys that no longer exist', () => {
    const s = merge(DEFAULTS, {gone: 1} as never);
    expect('gone' in s).toBe(false);
  });

  it('translates values saved under their old German names', () => {
    const s = merge(DEFAULTS, {personShape: 'lebenslinie', colorBy: 'evidenz', labels: 'nah', scope: 'verwandte', timeFlow: 'abwärts'} as never);
    expect([s.personShape, s.colorBy, s.labels, s.scope, s.timeFlow]).toEqual(['lifeline', 'evidence', 'near', 'lineage', 'down']);
  });

  it('exports only what differs from the defaults', () => {
    expect(diff(merge(DEFAULTS, {pointerRadius: 0}))).toEqual({pointerRadius: 0});
  });
});
