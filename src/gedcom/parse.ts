/**
 * A lenient GEDCOM 5.5.1 line reader: levels, xrefs and tags into a record
 * tree, with helpers for the lookups every other module needs. CONT and CONC
 * stay in the tree as children; `text()` joins them.
 */

export interface GedNode {
  level: number;
  xref?: string;
  tag: string;
  value: string;
  children: GedNode[];
}

const LINE_RE = /^(\d+)\s+(?:(@[^@]+@)\s+)?(\S+)(?:\s(.*))?$/;

export function parseGedcom(text: string): GedNode[] {
  const records: GedNode[] = [];
  const stack: GedNode[] = [];
  // CRLF, LF, or the bare CR that old Mac exports (MacFamilyTree) write.
  for (const raw of text.replace(/^﻿/, '').split(/\r\n|\r|\n/)) {
    const line = raw.replace(/^\s+/, '');
    if (!line) continue;
    const m = LINE_RE.exec(line);
    if (!m) continue;
    const level = Number(m[1]);
    const node: GedNode = {
      level,
      xref: m[2] ? stripAt(m[2]) : undefined,
      tag: m[3],
      value: m[4] ?? '',
      children: [],
    };
    stack.length = level;
    if (level === 0) records.push(node);
    else stack[level - 1]?.children.push(node);
    stack[level] = node;
  }
  return records;
}

export function stripAt(value: string): string {
  return value.trim().replace(/^@/, '').replace(/@$/, '');
}

export function isPointer(value: string): boolean {
  return /^@[^@]+@$/.test(value.trim());
}

export function first(node: GedNode, tag: string): GedNode | undefined {
  return node.children.find((c) => c.tag === tag);
}

export function all(node: GedNode, tag: string): GedNode[] {
  return node.children.filter((c) => c.tag === tag);
}

/** Value of the first node down a tag path, or undefined when absent/empty. */
export function val(node: GedNode, ...path: string[]): string | undefined {
  let cur: GedNode | undefined = node;
  for (const tag of path) {
    cur = cur && first(cur, tag);
  }
  return cur && cur.value ? cur.value : undefined;
}

/** A node's value with its CONT (new line) and CONC (same line) joined. */
export function text(node: GedNode): string {
  let out = node.value;
  for (const c of node.children) {
    if (c.tag === 'CONT') out += '\n' + c.value;
    else if (c.tag === 'CONC') out += c.value;
  }
  return out;
}
