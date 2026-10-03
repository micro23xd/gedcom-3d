/**
 * Bloodlines: which of the root's lines each person belongs to.
 *
 * Anchors are, by default, the root's four grandparents and the partners of
 * the root and of the root's siblings (the in-law lines). A person belongs to
 * every line whose anchor is themself or an ancestor of theirs — a pedigree
 * collapse puts someone in two. The root's own family below the grandparents
 * is the core. Everyone else inherits the line of their nearest member relative,
 * marked as collateral so it can be drawn fainter.
 */

import {Tree, ancestorsOf, childrenOf, descendantsOf, parentsOf, partnersOf, siblingsOf} from './model';

export interface Line {
  anchor: string;
  label: string;
}

export interface LineInfo {
  /** Indices into the lines array; empty for the core and the unassigned. */
  lines: number[];
  core: boolean;
  collateral: boolean;
}

function birthSurname(tree: Tree, id: string): string {
  return tree.persons.get(id)?.surname || id;
}

/**
 * Whom to centre a file on when nothing says: the person with the deepest
 * pedigree. Siblings tie; among them, the one with a family of their own in
 * the file wins, then the youngest — in a family's own export that is nearly
 * always the person it was made for.
 */
export function deepestPedigree(tree: Tree): string | undefined {
  let best: string | undefined;
  let bestKey: number[] = [];
  for (const p of tree.persons.values()) {
    const key = [
      ancestorsOf(tree, p.id).size,
      partnersOf(tree, p.id).length + childrenOf(tree, p.id).length,
      p.events.find((e) => (e.tag === 'BIRT' || e.tag === 'CHR') && e.date)?.date?.year ?? -Infinity,
    ];
    const better = key.findIndex((v, i) => v !== bestKey[i]);
    if (!best || (better >= 0 && key[better] > bestKey[better])) {
      best = p.id;
      bestKey = key;
    }
  }
  return best;
}

export function defaultAnchors(tree: Tree, root: string): string[] {
  const grand = parentsOf(tree, root).flatMap((p) => parentsOf(tree, p));
  const inLaws = [root, ...siblingsOf(tree, root)].flatMap((x) => partnersOf(tree, x));
  return [...new Set([...grand, ...inLaws])].filter((id) => tree.persons.has(id));
}

export function computeLines(tree: Tree, root: string, anchors: string[]): {lines: Line[]; info: Map<string, LineInfo>} {
  const lines = anchors.map((a) => ({anchor: a, label: birthSurname(tree, a)}));
  const info = new Map<string, LineInfo>();

  anchors.forEach((a, i) => {
    for (const id of [a, ...ancestorsOf(tree, a)]) {
      const cur = info.get(id) ?? {lines: [], core: false, collateral: false};
      if (!cur.lines.includes(i)) cur.lines.push(i);
      info.set(id, cur);
    }
  });

  // The core: the root's parents and everyone descended from them, bar the lines' own members.
  const parents = parentsOf(tree, root);
  const core = new Set<string>([root, ...parents]);
  for (const p of parents) for (const d of descendantsOf(tree, p)) core.add(d);
  if (!parents.length) for (const d of descendantsOf(tree, root)) core.add(d);
  for (const id of core) if (!info.has(id)) info.set(id, {lines: [], core: true, collateral: false});

  // Collaterals: breadth-first from all members, through blood first, partners last.
  const queue = [...info.keys()];
  while (queue.length) {
    const x = queue.shift() as string;
    const from = info.get(x) as LineInfo;
    const next = [...parentsOf(tree, x), ...childrenOf(tree, x), ...siblingsOf(tree, x), ...partnersOf(tree, x)];
    for (const y of next) {
      if (info.has(y) || !tree.persons.has(y)) continue;
      info.set(y, {lines: [...from.lines], core: from.core && from.lines.length === 0, collateral: true});
      queue.push(y);
    }
  }
  for (const id of tree.persons.keys()) if (!info.has(id)) info.set(id, {lines: [], core: false, collateral: true});
  return {lines, info};
}
