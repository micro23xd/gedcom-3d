/**
 * The tree as typed records: persons, families, their events and citations,
 * sources and media. Built once from the parsed GEDCOM; everything downstream
 * (evidence, timeline, graph, panel) reads this and never the raw lines.
 */

import {GDate, parseDate} from './gedcom/date';
import {t as tr} from './i18n';
import {GedNode, all, first, isPointer, parseGedcom, stripAt, text, val} from './gedcom/parse';

/** Every event tag the tree uses. Order is the panel's order within a year. */
export const EVENT_TAGS = [
  'BIRT', 'CHR', 'RELI', 'OCCU', 'RESI', 'EMIG', 'EVEN', 'MARR', 'DIV', 'DEAT', 'BURI',
] as const;
export type EventTag = (typeof EVENT_TAGS)[number];

export interface Citation {
  sourceId: string;
  page?: string;
  quay?: number;
  note?: string;
}

export interface GEvent {
  /** Stable id: owner xref, tag and position, e.g. `IBAUER62:BIRT:0`. */
  id: string;
  tag: EventTag;
  owner: string;
  ownerIsFam: boolean;
  /** An EVEN's TYPE, an OCCU's or RELI's own value. */
  value?: string;
  type?: string;
  dateRaw?: string;
  date?: GDate;
  place?: string;
  cause?: string;
  note?: string;
  citations: Citation[];
  media: string[];
}

export interface Person {
  id: string;
  given: string;
  surname: string;
  /** "Given Surname", as the viewer prints it. */
  name: string;
  otherNames: string[];
  sex?: 'M' | 'F';
  events: GEvent[];
  famc: {fam: string; pedi?: string}[];
  fams: string[];
  notes: string[];
  media: string[];
  refns: string[];
}

export interface Family {
  id: string;
  husb?: string;
  wife?: string;
  children: string[];
  events: GEvent[];
  notes: string[];
}

export interface Source {
  id: string;
  title: string;
  author?: string;
  publ?: string;
  www?: string;
  note?: string;
}

export interface Media {
  id: string;
  /** URL resolved against the GEDCOM's own URL; empty unless on the same server. */
  url: string;
  title?: string;
  form?: string;
  note?: string;
}

export interface Tree {
  persons: Map<string, Person>;
  families: Map<string, Family>;
  sources: Map<string, Source>;
  media: Map<string, Media>;
}

function citations(node: GedNode): Citation[] {
  return all(node, 'SOUR').map((s) => {
    const q = val(s, 'QUAY');
    const n = first(s, 'NOTE');
    const quay = q !== undefined ? Number(q) : NaN;
    return {
      sourceId: stripAt(s.value),
      page: first(s, 'PAGE') ? text(first(s, 'PAGE') as GedNode) : undefined,
      quay: Number.isFinite(quay) ? quay : undefined,
      note: n ? text(n) : undefined,
    };
  });
}

function mediaRefs(node: GedNode, tree: Tree, baseUrl: string, ownerId: string): string[] {
  return all(node, 'OBJE').map((o, i) => {
    if (isPointer(o.value)) return stripAt(o.value);
    // Inline OBJE: register it under a synthetic id.
    const id = `${ownerId}:OBJE:${i}`;
    tree.media.set(id, mediaRecord(id, o, baseUrl));
    return id;
  });
}

/**
 * A media file's URL, only if it is served by the same server as the GEDCOM.
 * A foreign tree may link images on a portal or a `C:\` path; requesting the
 * one would tell a third party what is being looked at, the other cannot load.
 */
function localUrl(path: string, baseUrl: string): string {
  try {
    const url = new URL(path, baseUrl);
    return url.origin === new URL(baseUrl).origin ? url.href : '';
  } catch {
    return '';
  }
}

function mediaRecord(id: string, node: GedNode, baseUrl: string): Media {
  const file = first(node, 'FILE');
  const n = first(node, 'NOTE');
  return {
    id,
    url: file ? localUrl(file.value, baseUrl) : '',
    title: (file && val(file, 'TITL')) ?? val(node, 'TITL'),
    form: (file && val(file, 'FORM')) ?? val(node, 'FORM'),
    note: n ? text(n) : undefined,
  };
}

function events(rec: GedNode, ownerIsFam: boolean, tree: Tree, baseUrl: string): GEvent[] {
  const out: GEvent[] = [];
  const counts: Record<string, number> = {};
  for (const node of rec.children) {
    if (!(EVENT_TAGS as readonly string[]).includes(node.tag)) continue;
    const tag = node.tag as EventTag;
    const n = counts[tag] ?? 0;
    counts[tag] = n + 1;
    const id = `${rec.xref}:${tag}:${n}`;
    const dateRaw = val(node, 'DATE');
    const note = first(node, 'NOTE');
    out.push({
      id,
      tag,
      owner: rec.xref as string,
      ownerIsFam,
      value: node.value && node.value !== 'Y' ? text(node) : undefined,
      type: val(node, 'TYPE'),
      dateRaw,
      date: parseDate(dateRaw),
      place: val(node, 'PLAC'),
      cause: val(node, 'CAUS'),
      note: note ? text(note) : undefined,
      citations: citations(node),
      media: mediaRefs(node, tree, baseUrl, id),
    });
  }
  return out;
}

function notes(rec: GedNode): string[] {
  return all(rec, 'NOTE').map(text);
}

export function buildTree(gedcom: string, baseUrl: string): Tree {
  const records = parseGedcom(gedcom);
  const tree: Tree = {persons: new Map(), families: new Map(), sources: new Map(), media: new Map()};

  for (const rec of records) {
    if (rec.tag === 'OBJE' && rec.xref) tree.media.set(rec.xref, mediaRecord(rec.xref, rec, baseUrl));
  }
  for (const rec of records) {
    if (!rec.xref) continue;
    if (rec.tag === 'INDI') {
      const names = all(rec, 'NAME');
      const primary = names.find((n) => !val(n, 'TYPE')) ?? names[0];
      const given = (primary && (val(primary, 'GIVN') ?? primary.value.split('/')[0].trim())) || '';
      const surname = (primary && (val(primary, 'SURN') ?? primary.value.split('/')[1]?.trim())) || '';
      const sex = val(rec, 'SEX');
      tree.persons.set(rec.xref, {
        id: rec.xref,
        given,
        surname,
        name: [given, surname].filter(Boolean).join(' ') || '?',
        otherNames: names
          .filter((n) => n !== primary)
          .map((n) => {
            const type = val(n, 'TYPE');
            const shown = n.value.replace(/\//g, '').replace(/\s+/g, ' ').trim();
            return type === 'married' ? tr('name.married', {name: shown}) : type ? `${shown} (${type})` : shown;
          }),
        sex: sex === 'M' || sex === 'F' ? sex : undefined,
        events: events(rec, false, tree, baseUrl),
        famc: all(rec, 'FAMC').map((f) => ({fam: stripAt(f.value), pedi: val(f, 'PEDI')})),
        fams: all(rec, 'FAMS').map((f) => stripAt(f.value)),
        notes: notes(rec),
        media: mediaRefs(rec, tree, baseUrl, rec.xref),
        refns: all(rec, 'REFN').map((r) => r.value),
      });
    } else if (rec.tag === 'FAM') {
      const h = val(rec, 'HUSB');
      const w = val(rec, 'WIFE');
      tree.families.set(rec.xref, {
        id: rec.xref,
        husb: h ? stripAt(h) : undefined,
        wife: w ? stripAt(w) : undefined,
        children: all(rec, 'CHIL').map((c) => stripAt(c.value)),
        events: events(rec, true, tree, baseUrl),
        notes: notes(rec),
      });
    } else if (rec.tag === 'SOUR') {
      const n = first(rec, 'NOTE');
      const titl = first(rec, 'TITL');
      tree.sources.set(rec.xref, {
        id: rec.xref,
        title: titl ? text(titl) : rec.xref,
        author: val(rec, 'AUTH'),
        publ: first(rec, 'PUBL') ? text(first(rec, 'PUBL') as GedNode) : undefined,
        www: val(rec, 'WWW'),
        note: n ? text(n) : undefined,
      });
    }
  }
  return tree;
}

// --- relationships --------------------------------------------------------

export function spousesOf(fam: Family): string[] {
  return [fam.husb, fam.wife].filter((x): x is string => !!x);
}

export function parentsOf(tree: Tree, id: string): string[] {
  const p = tree.persons.get(id);
  if (!p) return [];
  return p.famc.flatMap((f) => {
    const fam = tree.families.get(f.fam);
    return fam ? spousesOf(fam) : [];
  });
}

export function childrenOf(tree: Tree, id: string): string[] {
  const p = tree.persons.get(id);
  if (!p) return [];
  return p.fams.flatMap((f) => tree.families.get(f)?.children ?? []);
}

export function partnersOf(tree: Tree, id: string): string[] {
  const p = tree.persons.get(id);
  if (!p) return [];
  return p.fams.flatMap((f) => {
    const fam = tree.families.get(f);
    return fam ? spousesOf(fam).filter((s) => s !== id) : [];
  });
}

export function siblingsOf(tree: Tree, id: string): string[] {
  const p = tree.persons.get(id);
  if (!p) return [];
  const out = new Set<string>();
  for (const f of p.famc) {
    for (const c of tree.families.get(f.fam)?.children ?? []) if (c !== id) out.add(c);
  }
  return [...out];
}

/** All ancestors of `id` (not including `id`). */
export function ancestorsOf(tree: Tree, id: string): Set<string> {
  const out = new Set<string>();
  const stack = parentsOf(tree, id);
  while (stack.length) {
    const x = stack.pop() as string;
    if (out.has(x)) continue;
    out.add(x);
    stack.push(...parentsOf(tree, x));
  }
  return out;
}

/** All descendants of `id` (not including `id`). */
export function descendantsOf(tree: Tree, id: string): Set<string> {
  const out = new Set<string>();
  const stack = childrenOf(tree, id);
  while (stack.length) {
    const x = stack.pop() as string;
    if (out.has(x)) continue;
    out.add(x);
    stack.push(...childrenOf(tree, x));
  }
  return out;
}

/** The first birth-like and death-like event, as the chart reads a life. */
export function birthLike(p: Person): GEvent | undefined {
  return p.events.find((e) => e.tag === 'BIRT') ?? p.events.find((e) => e.tag === 'CHR');
}

export function deathLike(p: Person): GEvent | undefined {
  return p.events.find((e) => e.tag === 'DEAT') ?? p.events.find((e) => e.tag === 'BURI');
}
