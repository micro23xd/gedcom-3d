/**
 * Files as other programs write them: bare CR line ends and numeric dates
 * (old Mac exports), Windows-1252 (ANSI), ANSEL. Each reads and draws.
 */
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {computeEvidence} from '../src/evidence';
import {Context, buildGraph} from '../src/graph';
import {decodeGedcom} from '../src/gedcom/decode';
import {computeLines, deepestPedigree, defaultAnchors} from '../src/lines';
import {buildTree} from '../src/model';
import {DEFAULTS} from '../src/settings';
import {computeGenerations, computeTimes} from '../src/timeline';
import {BASE_URL, REPO} from './fixture';

const load = (name: string) => {
  const decoded = decodeGedcom(new Uint8Array(readFileSync(REPO + 'test/fixtures/' + name)).buffer);
  return {...decoded, tree: buildTree(decoded.text, BASE_URL + name)};
};

describe('format fixtures', () => {
  for (const name of ['cr-dotted.ged', 'ansi.ged', 'ansel.ged']) {
    it(`${name} reads and draws`, () => {
      const {tree} = load(name);
      expect(tree.persons.size).toBe(2);
      const root = deepestPedigree(tree) as string;
      const {lines, info} = computeLines(tree, root, defaultAnchors(tree, root));
      const ctx: Context = {
        tree,
        evidence: computeEvidence(tree, {seed: root}),
        times: computeTimes(tree),
        generations: computeGenerations(tree, root),
        lines,
        lineInfo: info,
        root,
      };
      const g = buildGraph(ctx, DEFAULTS);
      expect(g.nodes.filter((n) => n.kind === 'person').length).toBe(2);
    });
  }

  it('reads bare CR line ends and dotted dates', () => {
    const {tree} = load('cr-dotted.ged');
    expect(tree.persons.get('I1')?.events[0].date?.display).toBe('14. März 1989');
    expect(tree.persons.get('I2')?.events[0].date?.display).toBe('März 1961');
  });

  it('reads Windows-1252 umlauts', () => {
    expect(load('ansi.ged').tree.persons.get('I1')?.name).toBe('Jürgen Brenner');
  });

  it('warns about ANSEL', () => {
    expect(load('ansel.ged').warning).toMatch(/ANSEL/);
  });
});

describe('media', () => {
  const ged = (file: string) => `0 HEAD\n0 @I1@ INDI\n1 NAME A /B/\n1 OBJE @M1@\n0 @M1@ OBJE\n1 FILE ${file}\n0 TRLR\n`;
  const url = (file: string) => buildTree(ged(file), 'http://127.0.0.1:8080/data/x.ged').media.get('M1')?.url;

  it('keeps files on this server', () => {
    expect(url('../sources/a.jpg')).toBe('http://127.0.0.1:8080/sources/a.jpg');
  });

  it('never points at another host or a local disk path', () => {
    expect(url('https://www.example.org/photo.jpg')).toBe('');
    expect(url('C:\\Users\\x\\photo.jpg')).toBe('');
    expect(url('file:///Users/x/photo.jpg')).toBe('');
  });
});
