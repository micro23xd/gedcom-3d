import {afterEach, describe, expect, it} from 'vitest';
import {parseDate} from '../src/gedcom/date';
import {setLang} from '../src/i18n';
import {DEMO} from './fixture';

afterEach(() => setLang('de'));

describe('parseDate', () => {
  it.each([
    ['14 MAR 1989', 1989, 'exact', '14. März 1989', '14 March 1989'],
    ['MAR 1720', 1720, 'exact', 'März 1720', 'March 1720'],
    ['1750', 1750, 'exact', '1750', '1750'],
    ['ABT 1750', 1750, 'abt', 'um 1750', 'about 1750'],
    ['EST 1700', 1700, 'est', 'geschätzt 1700', 'estimated 1700'],
    ['BEF 1800', 1800, 'bef', 'vor 1800', 'before 1800'],
    ['BEF 12 FEB 1800', 1800, 'bef', 'vor 12. Februar 1800', 'before 12 February 1800'],
    ['AFT 1650', 1650, 'aft', 'nach 1650', 'after 1650'],
    ['BET 1740 AND 1746', 1743, 'bet', 'zwischen 1740 und 1746', 'between 1740 and 1746'],
    ['FROM JUL 1916', 1916, 'from', 'ab Juli 1916', 'from July 1916'],
    ['FROM 1951 TO 1953', 1952, 'fromto', 'von 1951 bis 1953', 'from 1951 to 1953'],
    ['1700/01', 1700, 'exact', '1700', '1700'],
    ['14.03.1989', 1989, 'exact', '14. März 1989', '14 March 1989'],
    ['03.1961', 1961, 'exact', 'März 1961', 'March 1961'],
  ])('%s', (raw, year, qualifier, de, en) => {
    setLang('de');
    const d = parseDate(raw);
    expect(d?.year).toBe(year);
    expect(d?.qualifier).toBe(qualifier);
    expect(d?.display).toBe(de);
    setLang('en');
    expect(parseDate(raw)?.display).toBe(en);
  });

  it('rejects what it cannot read', () => {
    expect(parseDate('')).toBeUndefined();
    expect(parseDate('sometime')).toBeUndefined();
    expect(parseDate('32 JAN 1900')).toBeUndefined();
    expect(parseDate('14.13.1989')).toBeUndefined();
  });

  it('reads every DATE in the demo', () => {
    const unread = DEMO.split(/\r?\n/)
      .map((l) => /^\s*\d+ DATE (.+)$/.exec(l)?.[1])
      .filter((v): v is string => !!v)
      .filter((v) => !parseDate(v));
    expect(unread).toEqual([]);
  });
});
