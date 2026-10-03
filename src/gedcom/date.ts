import {Key, t} from '../i18n';

/**
 * GEDCOM dates, as far as this tree uses them: exact days, month-years, bare
 * years, numeric dates as German exports write them (14.03.1989), the qualifiers ABT, EST, CAL, BEF, AFT, INT and the ranges BET … AND …
 * and FROM … TO …. Each parses to a layout year and a display string in the interface language.
 */

export type Qualifier =
  | 'exact'
  | 'abt'
  | 'est'
  | 'cal'
  | 'bef'
  | 'aft'
  | 'bet'
  | 'from'
  | 'to'
  | 'fromto';

export interface Point {
  year: number;
  month?: number;
  day?: number;
}

export interface GDate {
  raw: string;
  qualifier: Qualifier;
  start: Point;
  end?: Point;
  /** The year the layout uses: the point itself, a range's midpoint. */
  year: number;
  /** Fractional year for ordering events. */
  sort: number;
  display: string;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function parsePoint(text: string): Point | undefined {
  // Some exports write German numeric dates: 14.03.1989, 03.1989.
  const dotted = /^(?:(\d{1,2})\.)?(\d{1,2})\.(\d{3,4})$/.exec(text.trim());
  if (dotted) {
    const day = dotted[1] ? Number(dotted[1]) : undefined;
    const month = Number(dotted[2]);
    if (month < 1 || month > 12 || (day !== undefined && (day < 1 || day > 31))) return undefined;
    return {year: Number(dotted[3]), month, day};
  }
  const parts = text.trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (!parts.length) return undefined;
  const yearText = parts.pop() as string;
  // Dual dating ("1700/01") keeps the first year.
  const ym = /^(\d{3,4})(?:\/\d{1,2})?$/.exec(yearText);
  if (!ym) return undefined;
  const point: Point = {year: Number(ym[1])};
  if (parts.length) {
    const month = MONTHS.indexOf(parts.pop() as string);
    if (month < 0) return undefined;
    point.month = month + 1;
    if (parts.length) {
      const day = Number(parts.pop());
      if (!Number.isInteger(day) || day < 1 || day > 31 || parts.length) return undefined;
      point.day = day;
    }
  }
  return point;
}

function sortOf(p: Point): number {
  return p.year + ((p.month ?? 7) - 1) / 12 + ((p.day ?? 15) - 1) / 372;
}

export function formatPoint(p: Point): string {
  const month = p.month ? t(`month.${p.month}` as Key) : '';
  if (p.day && p.month) return t('date.day', {day: p.day, month, year: p.year});
  if (p.month) return t('date.month', {month, year: p.year});
  return String(p.year);
}

export function parseDate(raw: string | undefined): GDate | undefined {
  if (!raw) return undefined;
  const text = raw.trim().replace(/\(.*\)/, '').trim();
  const up = text.toUpperCase();
  const make = (qualifier: Qualifier, start: Point, end?: Point): GDate => {
    const year = end ? Math.round((start.year + end.year) / 2) : start.year;
    const sort = end ? (sortOf(start) + sortOf(end)) / 2 : sortOf(start);
    return {raw, qualifier, start, end, year, sort, display: display(qualifier, start, end)};
  };

  let m = /^BET\s+(.+?)\s+AND\s+(.+)$/.exec(up);
  if (m) {
    const a = parsePoint(m[1]);
    const b = parsePoint(m[2]);
    return a && b ? make('bet', a, b) : undefined;
  }
  m = /^FROM\s+(.+?)(?:\s+TO\s+(.+))?$/.exec(up);
  if (m) {
    const a = parsePoint(m[1]);
    const b = m[2] ? parsePoint(m[2]) : undefined;
    if (!a) return undefined;
    return b ? make('fromto', a, b) : make('from', a);
  }
  m = /^(ABT|EST|CAL|BEF|AFT|TO|INT)\s+(.+)$/.exec(up);
  if (m) {
    const p = parsePoint(m[2]);
    if (!p) return undefined;
    const q = m[1] === 'INT' ? 'exact' : (m[1].toLowerCase() as Qualifier);
    return make(q, p);
  }
  const p = parsePoint(up);
  return p ? make('exact', p) : undefined;
}

function display(q: Qualifier, a: Point, b?: Point): string {
  const d = formatPoint(a);
  switch (q) {
    case 'bet':
    case 'fromto':
      return t(`date.${q}`, {a: d, b: formatPoint(b as Point)});
    case 'exact':
      return d;
    default:
      return t(`date.${q}`, {d});
  }
}

export function isApproximate(d: GDate): boolean {
  return d.qualifier !== 'exact';
}
