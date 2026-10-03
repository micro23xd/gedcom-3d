/**
 * Where on the time axis each person and family sits.
 *
 * A person sits at their birth, or their christening. Anyone without either
 * gets a layout-only estimate — from their own dated events first, then from
 * dated relatives (parent +30, child −30, spouse and sibling ±0), iterated so
 * estimates propagate. Estimates are flagged and drawn as such; they are never
 * written anywhere and never shown as a date.
 */

import {GEvent, Person, Tree, childrenOf, parentsOf, partnersOf, siblingsOf, spousesOf} from './model';

export type TimeSource = 'date' | 'event' | 'relatives' | 'none';

export interface PersonTime {
  year?: number;
  source: TimeSource;
  /** End of the life line: death/burial, or undefined if unknown. */
  death?: number;
}

export interface FamilyTime {
  year?: number;
  estimated: boolean;
}

export const GENERATION_YEARS = 30;

/** Own events, as offsets back to a likely birth year. */
const EVENT_OFFSETS: Partial<Record<GEvent['tag'], number>> = {
  MARR: 25,
  OCCU: 30,
  RESI: 30,
  EMIG: 25,
  RELI: 20,
  EVEN: 30,
  DIV: 35,
  DEAT: 60,
  BURI: 60,
};

function dated(p: Person, tag: string): number | undefined {
  return p.events.find((e) => e.tag === tag && e.date)?.date?.year;
}

export function computeTimes(tree: Tree): {persons: Map<string, PersonTime>; families: Map<string, FamilyTime>} {
  const persons = new Map<string, PersonTime>();

  for (const p of tree.persons.values()) {
    const death = dated(p, 'DEAT') ?? dated(p, 'BURI');
    const birth = dated(p, 'BIRT') ?? dated(p, 'CHR');
    if (birth !== undefined) {
      persons.set(p.id, {year: birth, source: 'date', death});
      continue;
    }
    // Own events, including marriages recorded on the family.
    const own: number[] = [];
    const evs = [...p.events, ...p.fams.flatMap((f) => tree.families.get(f)?.events ?? [])];
    for (const e of evs) {
      const off = EVENT_OFFSETS[e.tag];
      if (off !== undefined && e.date) own.push(e.date.year - off);
    }
    if (own.length) persons.set(p.id, {year: Math.min(...own), source: 'event', death});
    else persons.set(p.id, {source: 'none', death});
  }

  // Relatives, iterated: each round may date someone the next round can use.
  for (let round = 0; round < 12; round++) {
    const updates: [string, number][] = [];
    for (const p of tree.persons.values()) {
      const t = persons.get(p.id) as PersonTime;
      if (t.year !== undefined) continue;
      const guesses: number[] = [];
      const at = (id: string) => persons.get(id)?.year;
      for (const x of parentsOf(tree, p.id)) if (at(x) !== undefined) guesses.push((at(x) as number) + GENERATION_YEARS);
      for (const x of childrenOf(tree, p.id)) if (at(x) !== undefined) guesses.push((at(x) as number) - GENERATION_YEARS);
      for (const x of [...partnersOf(tree, p.id), ...siblingsOf(tree, p.id)]) if (at(x) !== undefined) guesses.push(at(x) as number);
      if (guesses.length) updates.push([p.id, Math.round(guesses.reduce((a, b) => a + b, 0) / guesses.length)]);
    }
    if (!updates.length) break;
    for (const [id, year] of updates) {
      const t = persons.get(id) as PersonTime;
      persons.set(id, {...t, year, source: 'relatives'});
    }
  }

  const families = new Map<string, FamilyTime>();
  for (const fam of tree.families.values()) {
    const marr = fam.events.find((e) => e.tag === 'MARR' && e.date)?.date?.year;
    if (marr !== undefined) {
      families.set(fam.id, {year: marr, estimated: false});
      continue;
    }
    const kids = fam.children.map((c) => persons.get(c)).filter((t) => t?.source === 'date').map((t) => t?.year as number);
    if (kids.length) {
      families.set(fam.id, {year: Math.min(...kids) - 1, estimated: true});
      continue;
    }
    const parents = spousesOf(fam).map((s) => persons.get(s)?.year).filter((y): y is number => y !== undefined);
    if (parents.length) {
      families.set(fam.id, {year: Math.max(...parents) + 25, estimated: true});
      continue;
    }
    const anyKid = fam.children.map((c) => persons.get(c)?.year).filter((y): y is number => y !== undefined);
    families.set(fam.id, anyKid.length ? {year: Math.min(...anyKid) - 1, estimated: true} : {estimated: true});
  }
  return {persons, families};
}

/**
 * Generation of everyone reachable from the root: parents +1, children −1,
 * partners equal. Breadth-first, so the shortest route decides.
 */
export function computeGenerations(tree: Tree, root: string): Map<string, number> {
  const gen = new Map<string, number>([[root, 0]]);
  const queue = [root];
  while (queue.length) {
    const x = queue.shift() as string;
    const g = gen.get(x) as number;
    const visit = (ids: string[], d: number) => {
      for (const id of ids) {
        if (!gen.has(id)) {
          gen.set(id, g + d);
          queue.push(id);
        }
      }
    };
    visit(parentsOf(tree, x), 1);
    visit(childrenOf(tree, x), -1);
    visit(partnersOf(tree, x), 0);
  }
  return gen;
}

/** Alive in `year`, reading an unknown death generously but not forever. */
export function aliveIn(t: PersonTime, year: number, now: number): boolean {
  if (t.year === undefined || t.year > year) return false;
  const end = t.death ?? Math.min(t.year + 75, now);
  return year <= end;
}
