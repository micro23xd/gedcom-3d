/**
 * The tree as a graph for the scene: which records become nodes, and which
 * edges join them, under the current filter and node-type settings.
 *
 * Persons are always nodes. Families become small union knots between parents
 * and children, or give way to direct parent→child edges. Events, places and
 * sources are optional node types.
 * Every node carries the year it is pinned to on the time axis.
 */

import type {LinkObject, NodeObject} from '3d-force-graph';
import {Evidence} from './evidence';
import {GEvent, Tree, childrenOf, descendantsOf, parentsOf, partnersOf, spousesOf} from './model';
import {Line, LineInfo} from './lines';
import {Key, t} from './i18n';
import {Settings} from './settings';
import {FamilyTime, PersonTime} from './timeline';

export type NodeKind = 'person' | 'union' | 'event' | 'place' | 'source';

export interface GNode extends NodeObject {
  id: string;
  kind: NodeKind;
  /** Person, family, event or source id, or the place name. */
  ref: string;
  /** The person an event node belongs to, or the family. */
  owner?: string;
  label: string;
  year?: number;
  estimated: boolean;
  /** A size factor, 1 = normal. */
  weight: number;
}

export type LinkKind = 'partner' | 'child' | 'descent' | 'event' | 'place' | 'source';

export interface GLink extends LinkObject<GNode> {
  source: string | GNode;
  target: string | GNode;
  kind: LinkKind;
}

export interface Context {
  tree: Tree;
  evidence: Evidence;
  times: {persons: Map<string, PersonTime>; families: Map<string, FamilyTime>};
  generations: Map<string, number>;
  lines: Line[];
  lineInfo: Map<string, LineInfo>;
  root: string;
}

export interface GraphData {
  nodes: GNode[];
  links: GLink[];
  /** Enabled events left out for want of a date. */
  undatedEvents: number;
}

/** An event tag's name in the interface language. */
export function eventLabel(tag: GEvent['tag']): string {
  return t(`event.${tag}` as Key);
}

/** Hop distance and direction-restricted sets from the root. */
function withinGenerations(tree: Tree, root: string, max: number, step: (id: string) => string[]): Set<string> {
  const dist = new Map<string, number>([[root, 0]]);
  const queue = [root];
  while (queue.length) {
    const x = queue.shift() as string;
    const d = dist.get(x) as number;
    if (max > 0 && d >= max) continue;
    for (const y of step(x)) {
      if (!dist.has(y) && tree.persons.has(y)) {
        dist.set(y, d + 1);
        queue.push(y);
      }
    }
  }
  return new Set(dist.keys());
}

export function scopePersons(ctx: Context, s: Settings): Set<string> {
  const {tree, root} = ctx;
  let out: Set<string>;
  switch (s.scope) {
    case 'ancestors':
      out = withinGenerations(tree, root, s.generations, (x) => parentsOf(tree, x));
      break;
    case 'descendants':
      out = withinGenerations(tree, root, s.generations, (x) => childrenOf(tree, x));
      break;
    case 'lineage': {
      const up = withinGenerations(tree, root, s.generations, (x) => parentsOf(tree, x));
      const down = withinGenerations(tree, root, s.generations, (x) => childrenOf(tree, x));
      out = new Set([...up, ...down]);
      break;
    }
    default:
      out = s.generations > 0
        ? withinGenerations(tree, root, s.generations, (x) => [
            ...parentsOf(tree, x), ...childrenOf(tree, x), ...partnersOf(tree, x),
          ])
        : new Set(tree.persons.keys());
  }
  if (!s.showDetached) {
    for (const id of [...out]) if (ctx.evidence.persons.get(id)?.detached && id !== root) out.delete(id);
  }
  return out;
}

function median(xs: number[]): number | undefined {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

export function placeKey(place: string): string {
  return place.split(',')[0].trim();
}

export function buildGraph(ctx: Context, s: Settings): GraphData {
  const {tree, evidence, times} = ctx;
  const persons = scopePersons(ctx, s);
  const nodes: GNode[] = [];
  const links: GLink[] = [];
  const linkKeys = new Set<string>();
  const addLink = (source: string, target: string, kind: LinkKind) => {
    const k = `${source}>${target}`;
    if (source === target || linkKeys.has(k)) return;
    linkKeys.add(k);
    links.push({source, target, kind});
  };

  const descCount = new Map<string, number>();
  if (s.sizeBy === 'descendants') for (const id of persons) descCount.set(id, descendantsOf(tree, id).size);

  for (const id of persons) {
    const p = tree.persons.get(id);
    if (!p) continue;
    const t = times.persons.get(id);
    let weight = 1;
    if (s.sizeBy === 'descendants') weight = 0.7 + Math.log1p(descCount.get(id) ?? 0) * 0.35;
    if (s.sizeBy === 'sources') {
      const good = (evidence.persons.get(id)?.facts ?? []).filter((f) => (f.bestQuay ?? 0) >= 2).length;
      weight = 0.7 + good * 0.25;
    }
    nodes.push({
      id: `p:${id}`,
      kind: 'person',
      ref: id,
      label: p.name,
      year: t?.year,
      estimated: t?.source !== 'date',
      weight,
    });
  }

  // Families: union knots, or direct edges.
  const famNode = new Map<string, string>();
  for (const fam of tree.families.values()) {
    const parents = spousesOf(fam).filter((x) => persons.has(x));
    const kids = fam.children.filter((x) => persons.has(x));
    if (parents.length + kids.length < 2 || !parents.length) continue;
    if (s.showUnions) {
      const nid = `f:${fam.id}`;
      famNode.set(fam.id, nid);
      const names = spousesOf(fam).map((x) => tree.persons.get(x)?.name ?? '?');
      const ft = times.families.get(fam.id);
      nodes.push({
        id: nid,
        kind: 'union',
        ref: fam.id,
        label: `⚭ ${names.join(' & ')}`,
        year: ft?.year,
        estimated: ft?.estimated ?? true,
        weight: 1,
      });
      for (const x of parents) addLink(`p:${x}`, nid, 'partner');
      for (const c of kids) addLink(nid, `p:${c}`, 'child');
    } else {
      for (const x of parents) for (const c of kids) addLink(`p:${x}`, `p:${c}`, 'descent');
    }
  }

  // Events of the persons and families in view.
  type Owned = {ev: GEvent; ownerNodes: string[]};
  const owned: Owned[] = [];
  for (const id of persons) {
    for (const ev of tree.persons.get(id)?.events ?? []) owned.push({ev, ownerNodes: [`p:${id}`]});
  }
  for (const fam of tree.families.values()) {
    const parents = spousesOf(fam).filter((x) => persons.has(x));
    if (!parents.length) continue;
    const union = famNode.get(fam.id);
    for (const ev of fam.events) owned.push({ev, ownerNodes: union ? [union] : parents.map((x) => `p:${x}`)});
  }

  let undatedEvents = 0;
  const eventNode = new Map<string, string>();
  for (const {ev, ownerNodes} of owned) {
    if (!s.events[ev.tag]) continue;
    if (!ev.date) {
      undatedEvents++;
      continue;
    }
    const nid = `e:${ev.id}`;
    eventNode.set(ev.id, nid);
    const what = ev.tag === 'EVEN' ? ev.type ?? eventLabel('EVEN') : eventLabel(ev.tag);
    nodes.push({
      id: nid,
      kind: 'event',
      ref: ev.id,
      owner: ev.owner,
      label: `${what} · ${ev.date.display}`,
      year: ev.date.year,
      estimated: ev.date.qualifier !== 'exact',
      weight: 1,
    });
    for (const o of ownerNodes) addLink(o, nid, 'event');
  }

  const nodeYear = new Map(nodes.map((n) => [n.id, n.year]));
  const yearOf = (o: Owned): number | undefined => o.ev.date?.year ?? nodeYear.get(o.ownerNodes[0]);
  const from = (o: Owned) => (eventNode.has(o.ev.id) ? [eventNode.get(o.ev.id) as string] : o.ownerNodes);

  if (s.showPlaces) {
    const years = new Map<string, number[]>();
    const count = new Map<string, number>();
    for (const o of owned) {
      if (!o.ev.place) continue;
      const key = placeKey(o.ev.place);
      if (!key) continue;
      const y = yearOf(o);
      if (y !== undefined) years.set(key, [...(years.get(key) ?? []), y]);
      count.set(key, (count.get(key) ?? 0) + 1);
      for (const f of from(o)) addLink(f, `o:${key}`, 'place');
    }
    for (const [key, n] of count) {
      nodes.push({
        id: `o:${key}`,
        kind: 'place',
        ref: key,
        label: key,
        year: median(years.get(key) ?? []),
        estimated: true,
        weight: 0.8 + Math.log1p(n) * 0.3,
      });
    }
  }

  if (s.showSources) {
    const years = new Map<string, number[]>();
    const count = new Map<string, number>();
    for (const o of owned) {
      for (const c of o.ev.citations) {
        if (!tree.sources.has(c.sourceId)) continue;
        const y = yearOf(o);
        if (y !== undefined) years.set(c.sourceId, [...(years.get(c.sourceId) ?? []), y]);
        count.set(c.sourceId, (count.get(c.sourceId) ?? 0) + 1);
        for (const f of from(o)) addLink(f, `s:${c.sourceId}`, 'source');
      }
    }
    for (const [sid, n] of count) {
      nodes.push({
        id: `s:${sid}`,
        kind: 'source',
        ref: sid,
        label: tree.sources.get(sid)?.title ?? sid,
        year: median(years.get(sid) ?? []),
        estimated: true,
        weight: 0.8 + Math.log1p(n) * 0.3,
      });
    }
  }

  return {nodes, links, undatedEvents};
}

/** Ancestors and descendants of a person, as node ids, for highlighting. */
export function lineageNodeIds(ctx: Context, personId: string, data: GraphData): Set<string> {
  const {tree} = ctx;
  const people = new Set<string>([personId]);
  const walk = (start: string, step: (id: string) => string[]) => {
    const stack = [start];
    while (stack.length) {
      const x = stack.pop() as string;
      for (const y of step(x)) {
        if (!people.has(y)) {
          people.add(y);
          stack.push(y);
        }
      }
    }
  };
  walk(personId, (x) => parentsOf(tree, x));
  walk(personId, (x) => childrenOf(tree, x));
  const partners = partnersOf(tree, personId);
  partners.forEach((x) => people.add(x));

  const ids = new Set<string>([...people].map((x) => `p:${x}`));
  for (const n of data.nodes) {
    if (n.kind === 'union') {
      const fam = tree.families.get(n.ref);
      if (!fam) continue;
      const parentsIn = spousesOf(fam).filter((x) => people.has(x));
      // A union on the lineage joins a lineage parent to a lineage child,
      // or is one of the selected person's own marriages.
      const joins = parentsIn.length && fam.children.some((c) => people.has(c));
      if (joins || spousesOf(fam).includes(personId)) ids.add(n.id);
    } else if (n.kind === 'event' && n.owner) {
      if (people.has(n.owner) || ids.has(`f:${n.owner}`)) ids.add(n.id);
    }
  }
  return ids;
}
