import {describe, expect, it} from 'vitest';
import {DEMO, ROOT, tree} from './fixture';
import {ancestorsOf, parentsOf} from '../src/model';

const count = (re: RegExp) => DEMO.split(/\r?\n/).filter((l) => re.test(l)).length;

describe('buildTree', () => {
  it('reads every record', () => {
    expect(tree.persons.size).toBe(count(/^0 @[^@]+@ INDI\b/));
    expect(tree.families.size).toBe(count(/^0 @[^@]+@ FAM\b/));
    expect(tree.sources.size).toBe(count(/^0 @[^@]+@ SOUR\b/));
  });

  it('reads the root', () => {
    const clara = tree.persons.get(ROOT);
    expect(clara?.sex).toBe('F');
    expect(clara?.otherNames).toEqual(['verh. Clara Sommer']);
    expect(clara?.events.find((e) => e.tag === 'BIRT')?.date?.year).toBe(1994);
    expect(parentsOf(tree, ROOT).length).toBe(2);
    expect(ancestorsOf(tree, ROOT).size).toBeGreaterThan(50);
  });

  it('keeps FAMS and FAMC two-sided', () => {
    for (const fam of tree.families.values()) {
      for (const c of fam.children) expect(tree.persons.get(c)?.famc.map((f) => f.fam)).toContain(fam.id);
    }
  });

  it('resolves media on this server and drops media anywhere else', () => {
    expect(tree.media.get('M_PORTRAIT')?.url).toBe('http://127.0.0.1:5173/demo/media/portrait.png');
    expect(tree.media.get('M_REMOTE')?.url).toBe('');
  });
});
