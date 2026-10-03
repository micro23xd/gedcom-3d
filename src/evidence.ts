/**
 * How well is each fact evidenced, and where does the research still have to
 * continue?
 *
 * A fact is an event (birth, baptism, death, burial, marriage) that asserts a
 * date or a place. Its quality is the best QUAY among its citations, sorted
 * into four tiers: a record (QUAY 3), a secondary witness (QUAY 2), only a
 * hint (QUAY 0–1, or a citation without QUAY), or no citation at all. A
 * person's state is their weakest fact. "Frontier" means a person whose
 * parents are unknown; "detached" one not connected to the seed person through
 * any family. The rules are kept simple and exact so that an external
 * classifier can be held to the same counts (test/crosscheck.spec.ts).
 */

import {Citation, GEvent, Tree, spousesOf} from './model';

export const FACT_TAGS = ['BIRT', 'CHR', 'DEAT', 'BURI', 'MARR'] as const;


export type Bucket = 'record' | 'secondary' | 'hint' | 'unsourced' | 'none';

/** Worst first — the order in which a person's state is decided. */
const BUCKET_ORDER: Bucket[] = ['unsourced', 'hint', 'secondary', 'record', 'none'];

export interface Fact {
  event: GEvent;
  bucket: Exclude<Bucket, 'none'>;
  bestQuay?: number;
  unexplained: boolean;
  pending: boolean;
}

export interface PersonEvidence {
  facts: Fact[];
  /** Worst bucket over the person's facts and marriages; `keine` if none. */
  state: Bucket;
  frontier: boolean;
  detached: boolean;
}

export interface Evidence {
  persons: Map<string, PersonEvidence>;
  /** Keyed by event id, for the panel's dots. */
  facts: Map<string, Fact>;
  summary: {
    individuals: number;
    families: number;
    facts: number;
    record: number;
    secondary: number;
    hint: number;
    unsourced: number;
  };
  queues: {
    unsourced: number;
    hint: number;
    unexplained: number;
    pending: number;
    frontier: number;
    detached: number;
  };
}

export function bucketFor(cites: Citation[]): {bucket: Exclude<Bucket, 'none'>; bestQuay?: number} {
  if (!cites.length) return {bucket: 'unsourced'};
  const quays = cites.map((c) => c.quay).filter((q): q is number => q !== undefined);
  const bestQuay = quays.length ? Math.max(...quays) : undefined;
  if (bestQuay === 3) return {bucket: 'record', bestQuay};
  if (bestQuay === 2) return {bucket: 'secondary', bestQuay};
  return {bucket: 'hint', bestQuay};
}

function factsOf(events: GEvent[], hasNote: boolean, pendingSource?: string): Fact[] {
  return events
    .filter((e) => (FACT_TAGS as readonly string[]).includes(e.tag))
    .filter((e) => e.dateRaw !== undefined || e.place !== undefined)
    .map((event) => {
      const {bucket, bestQuay} = bucketFor(event.citations);
      return {
        event,
        bucket,
        bestQuay,
        unexplained: bestQuay !== undefined && bestQuay <= 1 && !hasNote,
        pending: !!pendingSource && event.citations.some((c) => c.sourceId === pendingSource && !c.page),
      };
    });
}

function worse(a: Bucket, b: Bucket): Bucket {
  return BUCKET_ORDER.indexOf(a) <= BUCKET_ORDER.indexOf(b) ? a : b;
}

export interface EvidenceOptions {
  /** Whom "detached" is measured from; the first person when absent. */
  seed?: string;
  /**
   * A source whose citations without a PAGE form a work queue of their own
   * ("pending": trusted, but the reference is incomplete). Off when absent.
   */
  pendingSource?: string;
}

/** Everyone connected to the seed through any family. */
export function reachableFrom(tree: Tree, seed: string | undefined): Set<string> {
  const byMember = new Map<string, string[]>();
  for (const fam of tree.families.values()) {
    const members = [...spousesOf(fam), ...fam.children];
    for (const m of members) {
      const list = byMember.get(m) ?? [];
      list.push(...members);
      byMember.set(m, list);
    }
  }
  const reached = new Set<string>();
  const stack = seed ? [seed] : [];
  while (stack.length) {
    const x = stack.pop() as string;
    if (reached.has(x) || !tree.persons.has(x)) continue;
    reached.add(x);
    for (const m of byMember.get(x) ?? []) if (!reached.has(m)) stack.push(m);
  }
  return reached;
}

export function computeEvidence(tree: Tree, options: EvidenceOptions = {}): Evidence {
  const famFacts = new Map<string, Fact[]>();
  for (const fam of tree.families.values()) famFacts.set(fam.id, factsOf(fam.events, fam.notes.length > 0, options.pendingSource));

  const seed = options.seed && tree.persons.has(options.seed) ? options.seed : tree.persons.keys().next().value;
  const reachable = reachableFrom(tree, seed);
  const persons = new Map<string, PersonEvidence>();
  const facts = new Map<string, Fact>();
  const all: Fact[] = [];

  for (const list of famFacts.values()) all.push(...list);
  for (const p of tree.persons.values()) {
    const own = factsOf(p.events, p.notes.length > 0, options.pendingSource);
    all.push(...own);
    const marriages = p.fams.flatMap((f) => (famFacts.get(f) ?? []).filter((x) => x.event.tag === 'MARR'));
    const frontier = p.famc.length
      ? p.famc.every((f) => {
          const fam = tree.families.get(f.fam);
          return !fam || spousesOf(fam).length === 0;
        })
      : true;
    persons.set(p.id, {
      facts: own,
      state: [...own, ...marriages].reduce<Bucket>((acc, f) => worse(acc, f.bucket), 'none'),
      frontier,
      detached: !reachable.has(p.id),
    });
  }
  for (const f of all) facts.set(f.event.id, f);

  const count = (pred: (f: Fact) => boolean) => all.filter(pred).length;
  const people = [...persons.values()];
  return {
    persons,
    facts,
    summary: {
      individuals: tree.persons.size,
      families: tree.families.size,
      facts: all.length,
      record: count((f) => f.bucket === 'record'),
      secondary: count((f) => f.bucket === 'secondary'),
      hint: count((f) => f.bucket === 'hint'),
      unsourced: count((f) => f.bucket === 'unsourced'),
    },
    queues: {
      unsourced: count((f) => f.bucket === 'unsourced'),
      // The hint queue proper: a citation with a numeric QUAY of 1 or less.
      hint: count((f) => f.bestQuay !== undefined && f.bestQuay <= 1),
      unexplained: count((f) => f.unexplained),
      pending: count((f) => f.pending),
      frontier: people.filter((p) => p.frontier).length,
      detached: people.filter((p) => p.detached).length,
    },
  };
}
