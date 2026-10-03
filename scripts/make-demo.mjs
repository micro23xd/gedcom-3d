#!/usr/bin/env node
/**
 * Writes the demo tree and the small format fixtures. Everyone in them is
 * invented. The generator is seeded, so the output is the same on every run;
 * the files are committed, and `npm run demo` rewrites them.
 *
 *   public/demo/demo.ged          ~400 people over ~1650–2020, four lines meeting
 *                                 in one root, a pedigree collapse, an in-law
 *                                 line, undated and detached people, sources
 *                                 of every QUAY, notes, a portrait
 *   public/demo/media/portrait.png
 *   test/fixtures/cr-dotted.ged   bare CR line ends, dates as 14.03.1989
 *   test/fixtures/ansi.ged        CHAR ANSI, Windows-1252 bytes
 *   test/fixtures/ansel.ged       CHAR ANSEL
 */

import {mkdirSync, writeFileSync} from 'node:fs';
import {deflateSync} from 'node:zlib';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// --- deterministic randomness ------------------------------------------------

let seed = 20261003;
function rand() {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const chance = (p) => rand() < p;
const between = (a, b) => a + Math.floor(rand() * (b - a + 1));

// --- the world ---------------------------------------------------------------

const MALE = ['Johann', 'Peter', 'Jakob', 'Georg', 'Heinrich', 'Wilhelm', 'Friedrich', 'Karl', 'Thomas', 'William',
  'Henry', 'Samuel', 'Pierre', 'Louis', 'Anders', 'Erik', 'Lars', 'Matthias', 'Adam', 'Martin', 'Konrad', 'Paul'];
const FEMALE = ['Anna', 'Maria', 'Elisabeth', 'Katharina', 'Margaretha', 'Barbara', 'Sophie', 'Clara', 'Mary', 'Sarah',
  'Ellen', 'Marie', 'Louise', 'Ingrid', 'Karin', 'Elin', 'Magdalena', 'Eva', 'Johanna', 'Agnes', 'Helene', 'Rosa'];
const MODERN_M = ['Jonas', 'Lukas', 'Daniel', 'Michael', 'Stefan', 'Andreas', 'Felix', 'Tobias'];
const MODERN_F = ['Clara', 'Julia', 'Lena', 'Sabine', 'Petra', 'Anja', 'Nora', 'Miriam'];

// Four lines, each at home in its own region, plus an in-law line.
const LINES = {
  Hartwell: {places: ['Ashby,Kent,England', 'Wye,Kent,England', 'Dover,Kent,England'], surnames: ['Hartwell', 'Cobb', 'Finch', 'Pryor', 'Marsh']},
  Brenner: {places: ['Lindenau,Hessen,Germany', 'Steinbach,Hessen,Germany', 'Mühlheim,Hessen,Germany'], surnames: ['Brenner', 'Kessler', 'Falk', 'Brandt', 'Hahn']},
  Lindqvist: {places: ['Mora,Dalarna,Sweden', 'Rättvik,Dalarna,Sweden', 'Falun,Dalarna,Sweden'], surnames: ['Lindqvist', 'Berg', 'Holm', 'Strand', 'Ek']},
  Moreau: {places: ['Saint-Aubin,Normandie,France', 'Vire,Normandie,France', 'Caen,Normandie,France'], surnames: ['Moreau', 'Leclerc', 'Fournier', 'Garnier', 'Roux']},
  Sommer: {places: ['Rosenheim,Bayern,Germany', 'Prien,Bayern,Germany'], surnames: ['Sommer', 'Huber', 'Maier']},
};
const CITY = 'Hamburg,Hamburg,Germany';

const REGISTER = {BIRT: 'Births', CHR: 'Baptisms', MARR: 'Marriages', DEAT: 'Deaths', BURI: 'Burials', RESI: 'Residents'};

const SOURCES = [
  {id: 'S_PARISH', title: 'Parish registers (invented)', quay: 3, page: (year, kind) => `${REGISTER[kind] ?? 'Register'} ${year}, fol. ${between(10, 240)}`},
  {id: 'S_CIVIL', title: 'Civil registry (invented)', quay: 3, page: (year, kind) => `${REGISTER[kind] ?? 'Register'} ${year}, no. ${between(1, 400)}`},
  {id: 'S_GRAVE', title: 'Gravestone photographs (invented)', quay: 2, page: () => `Grave ${between(1, 900)}`},
  {id: 'S_FAMILY', title: 'Family memory', quay: 0, page: () => 'As told by the family'},
  {id: 'S_ONLINE', title: 'A compiled online tree (invented)', quay: 1, page: () => `Entry ${between(1000, 9999)}`},
  // Cited without a page on purpose: a "pending" reference.
  {id: 'S_LOCAL', title: 'Village family book (invented)', quay: 3, page: () => undefined},
];

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

// --- people --------------------------------------------------------------------

const people = [];
const families = [];
let nextI = 1;
let nextF = 1;

function person(sex, surname, born, line, opts = {}) {
  const p = {
    id: `I${nextI++}`,
    sex,
    given: opts.given ?? (born > 1950 ? pick(sex === 'M' ? MODERN_M : MODERN_F) : pick(sex === 'M' ? MALE : FEMALE)),
    surname,
    born,
    died: opts.died,
    line,
    fams: [],
    famc: undefined,
    undated: opts.undated ?? false,
    events: [],
    notes: [],
  };
  people.push(p);
  return p;
}

function family(husb, wife, married) {
  const f = {id: `F${nextF++}`, husb, wife, married, children: []};
  families.push(f);
  if (husb) husb.fams.push(f);
  if (wife) wife.fams.push(f);
  return f;
}

function child(f, p) {
  f.children.push(p);
  p.famc = f;
}

function lifespan(born) {
  if (born > 1935) return chance(0.15) ? born + between(55, 85) : undefined;
  const age = chance(0.15) ? between(0, 12) : between(35, 92);
  const died = born + age;
  return died > 2024 ? undefined : died;
}

/** Ancestors of `p` back to `until`, in `line`; returns nothing. */
function ancestry(p, line, until, depth = 0) {
  if (p.born < until) return;
  // The frontier: further back, parents are known less often.
  // (Each generation has twice the ancestors, so beyond the first few the
  // chance has to fall near one half, or the tree explodes.)
  const known = depth < 3 ? 1 : depth < 5 ? 0.62 : 0.47;
  if (!chance(known)) return;
  const home = LINES[line];
  const fatherBorn = p.born - between(24, 40);
  const motherBorn = p.born - between(19, 34);
  const father = person('M', p.surname, fatherBorn, line, {died: lifespan(fatherBorn)});
  const mother = person('F', pick(home.surnames), motherBorn, line, {died: lifespan(motherBorn)});
  const f = family(father, mother, Math.max(fatherBorn, motherBorn) + between(19, 28));
  child(f, p);
  siblings(f, p, line);
  ancestry(father, line, until, depth + 1);
  ancestry(mother, line, until, depth + 1);
}

/** Brothers and sisters of `p`, some of whom have children of their own. */
function siblings(f, p, line) {
  const n = chance(0.45) ? 0 : between(1, p.born < 1900 ? 3 : 2);
  for (let i = 0; i < n; i++) {
    const born = f.married + between(1, 18);
    if (born > 2015) continue;
    const s = person(chance(0.5) ? 'M' : 'F', p.surname, born, line, {died: lifespan(born)});
    child(f, s);
    if (s.died && s.died - born < 20) continue;
    if (chance(0.2) && born < 1990) {
      const sp = person(s.sex === 'M' ? 'F' : 'M', pick(LINES[line].surnames), born + between(-4, 4), line, {died: lifespan(born)});
      const sf = s.sex === 'M' ? family(s, sp, born + between(20, 30)) : family(sp, s, born + between(20, 30));
      for (let k = between(1, 3); k > 0; k--) {
        const cb = sf.married + between(1, 12);
        if (cb < 2020) child(sf, person(chance(0.5) ? 'M' : 'F', (sf.husb ?? s).surname, cb, line, {died: lifespan(cb)}));
      }
    }
  }
}

// The root and the four grandparents.
const root = person('F', 'Hartwell', 1994, null, {given: 'Clara'});
const father = person('M', 'Hartwell', 1962, null, {given: 'Daniel'});
const mother = person('F', 'Lindqvist', 1965, null, {given: 'Ingrid'});
const parents = family(father, mother, 1990);
child(parents, root);
child(parents, person('M', 'Hartwell', 1997, null, {given: 'Tobias'}));

const gpH = person('M', 'Hartwell', 1931, 'Hartwell', {given: 'Thomas', died: 2009});
const gmB = person('F', 'Brenner', 1934, 'Brenner', {given: 'Helene', died: 2016});
child(family(gpH, gmB, 1958), father);
const gpL = person('M', 'Lindqvist', 1936, 'Lindqvist', {given: 'Anders', died: 2011});
const gmM = person('F', 'Moreau', 1939, 'Moreau', {given: 'Louise'});
child(family(gpL, gmM, 1961), mother);

for (const [gp, line] of [[gpH, 'Hartwell'], [gmB, 'Brenner'], [gpL, 'Lindqvist'], [gmM, 'Moreau']]) {
  ancestry(gp, line, 1650);
}

// The in-law line: Clara's husband and a short ancestry of his own.
const husband = person('M', 'Sommer', 1991, 'Sommer', {given: 'Jonas'});
family(husband, root, 2020);
ancestry(husband, 'Sommer', 1800);

// A pedigree collapse: two women at the top of the Hartwell and the Brenner
// line turn out to be sisters, so their parents are ancestors twice over.
function topWoman(line, nth) {
  const inLine = people.filter((p) => p.line === line && p.sex === 'F' && !p.famc && p.born > 1690 && p.born < 1760);
  return inLine.sort((a, b) => a.born - b.born)[nth % Math.max(1, inLine.length)];
}
const a = topWoman('Hartwell', 1);
const b = topWoman('Brenner', 2);
if (a && b) {
  const first = Math.min(a.born, b.born);
  const cf = person('M', 'Falk', first - 31, 'Brenner', {given: 'Matthias', died: first + 20});
  const cm = person('F', 'Finch', first - 27, 'Hartwell', {given: 'Magdalena', died: first + 31});
  cf.note = 'Ancestor twice over: through the Hartwell and through the Brenner line.';
  const cfam = family(cf, cm, first - 3);
  for (const s of [a, b]) {
    s.surname = 'Falk';
    child(cfam, s);
  }
}

// People nothing dates: a couple with a child, none of them with a date, and
// unconnected to anyone dated.
const u1 = person('M', 'Ostermann', 0, null, {given: 'Kaspar', undated: true});
const u2 = person('F', 'Ostermann', 0, null, {given: 'Gertrud', undated: true});
const uf = family(u1, u2, undefined);
child(uf, person('F', 'Ostermann', 0, null, {given: 'Rosa', undated: true}));

// A detached family: dated, but not connected to the main tree yet.
const d1 = person('M', 'Hartwell', 1802, null, {given: 'Samuel', died: 1866});
const d2 = person('F', 'Pryor', 1806, null, {given: 'Sarah', died: 1870});
const df = family(d1, d2, 1828);
child(df, person('M', 'Hartwell', 1830, null, {given: 'William', died: 1899}));
d1.note = 'Probably related to the Hartwells of Ashby; no record links him yet.';

// --- events, places, citations -----------------------------------------------------

function dateText(year, exactness) {
  if (exactness === 'exact') return `${between(1, 28)} ${pick(MONTHS)} ${year}`;
  if (exactness === 'month') return `${pick(MONTHS)} ${year}`;
  if (exactness === 'abt') return `ABT ${year}`;
  if (exactness === 'est') return `EST ${year}`;
  if (exactness === 'bef') return `BEF ${year}`;
  if (exactness === 'aft') return `AFT ${year}`;
  if (exactness === 'bet') return `BET ${year - 2} AND ${year + 2}`;
  return String(year);
}

function exactnessFor(year) {
  if (year > 1850) return chance(0.9) ? 'exact' : 'month';
  if (year > 1750) return pick(['exact', 'exact', 'exact', 'month', 'year', 'abt']);
  return pick(['exact', 'year', 'abt', 'abt', 'est', 'bef', 'aft', 'bet']);
}

function cite(year, kind) {
  const c = (s) => [{s, year, kind}];
  if (year > 1990) return c(SOURCES[3]);
  if (kind === 'DEAT' && year > 1900 && chance(0.5)) return c(SOURCES[2]);
  if (year > 1876) return chance(0.85) ? c(SOURCES[1]) : c(SOURCES[4]);
  if (year > 1700) {
    const r = rand();
    if (r < 0.7) return c(SOURCES[0]);
    if (r < 0.8) return c(SOURCES[5]);
    if (r < 0.95) return c(SOURCES[4]);
    return [];
  }
  return chance(0.6) ? c(SOURCES[4]) : chance(0.5) ? c(SOURCES[0]) : [];
}

function placeFor(p) {
  if (!p.line) return CITY;
  return p.born > 1950 && chance(0.6) ? CITY : pick(LINES[p.line].places);
}

for (const p of people) {
  if (p.undated) continue;
  const place = placeFor(p);
  // Some early people have only a baptism, a few nothing but relatives.
  if (p.born < 1720 && chance(0.12)) {
    p.events.push({tag: 'DEAT', date: p.died ? dateText(p.died, exactnessFor(p.died)) : undefined, place, cites: cite(p.died ?? p.born, 'DEAT')});
    continue;
  }
  const birthTag = p.born < 1876 && chance(0.6) ? 'CHR' : 'BIRT';
  p.events.push({tag: birthTag, date: dateText(p.born, exactnessFor(p.born)), place, cites: cite(p.born, birthTag)});
  if (p.born < 1880 && p.born > 1650 && chance(0.25)) {
    p.events.push({tag: 'OCCU', value: pick(['Farmer', 'Weaver', 'Miller', 'Carpenter', 'Teacher', 'Innkeeper', 'Blacksmith', 'Shoemaker']), cites: []});
  }
  if (p.born > 1820 && p.born < 1960 && chance(0.12)) {
    p.events.push({tag: 'RESI', date: String(p.born + between(20, 50)), place: chance(0.5) ? CITY : place, cites: cite(p.born + 30, 'RESI')});
  }
  if (p.died) {
    p.events.push({tag: 'DEAT', date: dateText(p.died, exactnessFor(p.died)), place, cites: cite(p.died, 'DEAT')});
    if (p.died > 1880 && chance(0.4)) p.events.push({tag: 'BURI', date: dateText(p.died, 'exact'), place, cites: [{s: SOURCES[2], year: p.died, kind: 'BURI'}]});
  }
}
// One emigration and one event of a kind of its own.
const emigrant = people.find((p) => p.line === 'Lindqvist' && p.born > 1840 && p.born < 1870 && !p.fams.length);
if (emigrant) emigrant.events.push({tag: 'EMIG', date: String(emigrant.born + 22), place: 'Göteborg,Västra Götaland,Sweden', cites: [{s: SOURCES[4], year: emigrant.born + 22, kind: 'EMIG'}]});
gpH.events.push({tag: 'EVEN', type: 'Military service', date: 'FROM 1951 TO 1953', cites: [{s: SOURCES[3], year: 1951, kind: 'EVEN'}]});
root.notes.push('The person this demo tree is centred on. Everyone in it is invented.');

// Facts resting only on a hint get a note saying so, mostly.
for (const p of people) {
  if (p.events.some((e) => e.cites.length && e.cites.every((c) => c.s.id === 'S_ONLINE')) && chance(0.7)) {
    p.notes.push('Taken from a compiled tree; a record would settle it.');
  }
}

// --- writing -----------------------------------------------------------------------

function lines() {
  const out = [
    '0 HEAD',
    '1 SOUR gedcom-3d',
    '2 NAME gedcom-3d demo generator',
    '1 GEDC',
    '2 VERS 5.5.1',
    '2 FORM LINEAGE-LINKED',
    '1 CHAR UTF-8',
    '1 NOTE A demo tree for gedcom-3d. Every person, place assignment and source',
    '2 CONT in it is invented, generated by scripts/make-demo.mjs.',
  ];
  for (const p of people) {
    out.push(`0 @${p.id}@ INDI`, `1 NAME ${p.given} /${p.surname}/`, `2 GIVN ${p.given}`, `2 SURN ${p.surname}`, `1 SEX ${p.sex}`);
    if (p.id === root.id) out.push('1 NAME Clara /Sommer/', '2 TYPE married', '2 SURN Sommer');
    for (const e of p.events) {
      out.push(e.value ? `1 ${e.tag} ${e.value}` : `1 ${e.tag}`);
      if (e.type) out.push(`2 TYPE ${e.type}`);
      if (e.date) out.push(`2 DATE ${e.date}`);
      if (e.place) out.push(`2 PLAC ${e.place}`);
      for (const c of e.cites) {
        out.push(`2 SOUR @${c.s.id}@`);
        const page = c.s.page(c.year, c.kind);
        if (page) out.push(`3 PAGE ${page}`);
        out.push(`3 QUAY ${c.s.quay}`);
      }
    }
    if (p.famc) out.push(`1 FAMC @${p.famc.id}@`, '2 PEDI birth');
    for (const f of p.fams) out.push(`1 FAMS @${f.id}@`);
    for (const n of [...p.notes, ...(p.note ? [p.note] : [])]) out.push(`1 NOTE ${n}`);
    if (p.id === root.id) out.push('1 OBJE @M_PORTRAIT@', '1 OBJE @M_REMOTE@');
  }
  for (const f of families) {
    out.push(`0 @${f.id}@ FAM`);
    if (f.husb) out.push(`1 HUSB @${f.husb.id}@`);
    if (f.wife) out.push(`1 WIFE @${f.wife.id}@`);
    for (const c of f.children) out.push(`1 CHIL @${c.id}@`);
    if (f.married && f.married < 2025) {
      const place = placeFor(f.husb ?? f.wife);
      out.push('1 MARR', `2 DATE ${dateText(f.married, exactnessFor(f.married))}`, `2 PLAC ${place}`);
      for (const c of cite(f.married, 'MARR')) {
        out.push(`2 SOUR @${c.s.id}@`);
        const page = c.s.page(c.year, c.kind);
        if (page) out.push(`3 PAGE ${page}`);
        out.push(`3 QUAY ${c.s.quay}`);
      }
    }
  }
  for (const s of SOURCES) out.push(`0 @${s.id}@ SOUR`, `1 TITL ${s.title}`);
  out.push(
    '0 @M_PORTRAIT@ OBJE',
    '1 FILE media/portrait.png',
    '2 FORM png',
    '2 TITL Clara Hartwell, portrait (drawn)',
    // A link to another host: the viewer must never request it.
    '0 @M_REMOTE@ OBJE',
    '1 FILE https://example.com/photos/clara.jpg',
    '2 FORM jpg',
    '2 TITL A photo hosted elsewhere',
    '0 TRLR',
  );
  return out;
}

// A small portrait: a soft disc with a face-ish shape, as a PNG.
function portraitPng(size = 96) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const i = y * (size * 4 + 1) + 1 + x * 4;
      const dx = (x - size / 2) / size;
      const dy = (y - size / 2) / size;
      const head = Math.hypot(dx, (dy + 0.12) * 1.15) < 0.2;
      const body = Math.hypot(dx * 0.8, dy - 0.42) < 0.3;
      const [r, g, b] = head ? [236, 200, 170] : body ? [70, 110, 170] : [40 + y, 52 + y / 2, 90 + x / 2];
      raw[i] = r; raw[i + 1] = g; raw[i + 2] = b; raw[i + 3] = 255;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function write(path, data) {
  const file = resolve(ROOT, path);
  mkdirSync(dirname(file), {recursive: true});
  writeFileSync(file, data);
  console.log(`  ${path}`);
}

write('public/demo/demo.ged', lines().join('\n') + '\n');
write('public/demo/media/portrait.png', portraitPng());

// Format fixtures: tiny trees, one quirk each.
const tiny = (name, birth) => [
  '0 HEAD', '1 CHAR UTF-8', '1 GEDC', '2 VERS 5.5.1',
  '0 @I1@ INDI', `1 NAME ${name}`, '1 SEX F', '1 BIRT', `2 DATE ${birth}`, '1 FAMC @F1@',
  '0 @I2@ INDI', '1 NAME Paul /Brenner/', '1 SEX M', '1 BIRT', '2 DATE 03.1961', '1 FAMS @F1@',
  '0 @F1@ FAM', '1 HUSB @I2@', '1 CHIL @I1@',
  '0 TRLR',
];
write('test/fixtures/cr-dotted.ged', tiny('Jürgen /Brenner/', '14.03.1989').join('\r') + '\r');
const ansi = tiny('Jürgen /Brenner/', '14 MAR 1989').map((l) => l.replace('1 CHAR UTF-8', '1 CHAR ANSI')).join('\r\n') + '\r\n';
write('test/fixtures/ansi.ged', Buffer.from(ansi, 'latin1'));
const ansel = tiny('Jurgen /Brenner/', '14 MAR 1989').map((l) => l.replace('1 CHAR UTF-8', '1 CHAR ANSEL')).join('\n') + '\n';
write('test/fixtures/ansel.ged', Buffer.from(ansel, 'latin1'));

console.log(`demo: ${people.length} people, ${families.length} families`);
