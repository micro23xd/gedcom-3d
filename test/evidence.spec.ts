import {describe, expect, it} from 'vitest';
import {bucketFor, computeEvidence} from '../src/evidence';
import {ROOT, personNamed, tree} from './fixture';

describe('bucketFor', () => {
  it('takes the best QUAY', () => {
    expect(bucketFor([])).toEqual({bucket: 'unsourced'});
    expect(bucketFor([{sourceId: 'S', quay: 1}, {sourceId: 'S', quay: 3}])).toEqual({bucket: 'record', bestQuay: 3});
    expect(bucketFor([{sourceId: 'S', quay: 2}])).toEqual({bucket: 'secondary', bestQuay: 2});
    expect(bucketFor([{sourceId: 'S'}])).toEqual({bucket: 'hint', bestQuay: undefined});
  });
});

describe('computeEvidence', () => {
  const ev = computeEvidence(tree, {seed: ROOT, pendingSource: 'S_LOCAL'});

  it('sorts every fact into exactly one bucket', () => {
    const {facts, record, secondary, hint, unsourced} = ev.summary;
    expect(record + secondary + hint + unsourced).toBe(facts);
    expect(record && secondary && hint).toBeTruthy();
  });

  it('marks the unconnected family as detached, measured from the seed', () => {
    expect(ev.persons.get(personNamed('Samuel Hartwell', 1802)!.id)?.detached).toBe(true);
    expect(ev.persons.get(ROOT)?.detached).toBe(false);
  });

  it('counts the pending source only when asked to', () => {
    expect(ev.queues.pending).toBeGreaterThan(0);
    expect(computeEvidence(tree, {seed: ROOT}).queues.pending).toBe(0);
  });
});
