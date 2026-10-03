import {describe, expect, it} from 'vitest';
import {computeEvidence} from '../src/evidence';
import {Context, buildGraph, lineageNodeIds} from '../src/graph';
import {computeLines, defaultAnchors} from '../src/lines';
import {DEFAULTS, merge} from '../src/settings';
import {computeGenerations, computeTimes} from '../src/timeline';
import {ROOT, tree} from './fixture';

const {lines, info} = computeLines(tree, ROOT, defaultAnchors(tree, ROOT));
const ctx: Context = {
  tree,
  evidence: computeEvidence(tree, {seed: ROOT}),
  times: computeTimes(tree),
  generations: computeGenerations(tree, ROOT),
  lines,
  lineInfo: info,
  root: ROOT,
};
const endpoints = (l: {source: unknown; target: unknown}) =>
  [l.source, l.target].map((x) => (typeof x === 'string' ? x : (x as {id: string}).id));

describe('buildGraph', () => {
  it('draws every person and joins only nodes that exist', () => {
    const g = buildGraph(ctx, DEFAULTS);
    const ids = new Set(g.nodes.map((n) => n.id));
    expect(g.nodes.filter((n) => n.kind === 'person').length).toBe(tree.persons.size);
    for (const l of g.links) for (const e of endpoints(l)) expect(ids.has(e)).toBe(true);
  });

  it('adds dated events only, and counts the rest', () => {
    const g = buildGraph(ctx, merge(DEFAULTS, {events: {...DEFAULTS.events, DEAT: true}}));
    const deaths = g.nodes.filter((n) => n.kind === 'event');
    for (const n of deaths) expect(n.year).toBeDefined();
    const all = [...tree.persons.values()].flatMap((p) => p.events.filter((e) => e.tag === 'DEAT'));
    expect(deaths.length + g.undatedEvents).toBe(all.length);
  });

  it('adds places and sources as hubs', () => {
    const g = buildGraph(ctx, merge(DEFAULTS, {showPlaces: true, showSources: true}));
    expect(g.nodes.some((n) => n.kind === 'place' && n.ref === 'Ashby')).toBe(true);
    expect(g.nodes.some((n) => n.kind === 'source' && n.ref === 'S_PARISH')).toBe(true);
  });

  it('keeps the ancestors scope to the root and their forebears', () => {
    const g = buildGraph(ctx, merge(DEFAULTS, {scope: 'ancestors', generations: 2}));
    const persons = g.nodes.filter((n) => n.kind === 'person').map((n) => n.ref);
    expect(persons).toContain(ROOT);
    expect(persons.length).toBe(7);
  });

  it('highlights the lineage of the root through both parents', () => {
    const g = buildGraph(ctx, DEFAULTS);
    const lit = lineageNodeIds(ctx, ROOT, g);
    expect(lit.size).toBeGreaterThan(50);
    expect(lit.has(`p:${ROOT}`)).toBe(true);
  });
});
