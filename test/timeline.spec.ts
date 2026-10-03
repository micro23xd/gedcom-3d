import {describe, expect, it} from 'vitest';
import {computeTimes} from '../src/timeline';
import {computeLines, deepestPedigree, defaultAnchors} from '../src/lines';
import {ROOT, personNamed, tree} from './fixture';

describe('computeTimes', () => {
  const {persons} = computeTimes(tree);

  it('never overrides a real date', () => {
    for (const p of tree.persons.values()) {
      const b = p.events.find((e) => e.tag === 'BIRT' && e.date)?.date?.year;
      if (b !== undefined) expect([p.id, persons.get(p.id)?.year, persons.get(p.id)?.source]).toEqual([p.id, b, 'date']);
    }
  });

  it('leaves people nothing dates undated', () => {
    for (const name of ['Kaspar Ostermann', 'Gertrud Ostermann', 'Rosa Ostermann']) {
      const p = personNamed(name);
      expect(persons.get(p!.id)).toMatchObject({source: 'none'});
      expect(persons.get(p!.id)?.year).toBeUndefined();
    }
  });

  it('places everyone else', () => {
    const none = [...persons.values()].filter((t) => t.year === undefined).length;
    expect(none).toBe(3);
  });
});

describe('computeLines', () => {
  const {lines, info} = computeLines(tree, ROOT, defaultAnchors(tree, ROOT));
  const labels = (id: string) => info.get(id)?.lines.map((i) => lines[i].label).sort();

  it('anchors on the grandparents and the in-law line', () => {
    expect(lines.map((l) => l.label).sort()).toEqual(['Brenner', 'Hartwell', 'Lindqvist', 'Moreau', 'Sommer']);
  });

  it('puts the root in the core', () => {
    expect(info.get(ROOT)).toMatchObject({core: true, collateral: false});
  });

  it('puts the collapse ancestor in both lines', () => {
    const matthias = personNamed('Matthias Falk');
    expect(labels(matthias!.id)).toEqual(['Brenner', 'Hartwell']);
  });
});

describe('deepestPedigree', () => {
  it('finds the root a file is made for', () => {
    // Clara and her brother Tobias share the pedigree; she has a husband in
    // the file, so she wins the tie although he is younger.
    expect(deepestPedigree(tree)).toBe(ROOT);
  });
});
