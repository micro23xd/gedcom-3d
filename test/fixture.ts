import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {setLang} from '../src/i18n';
import {decodeGedcom} from '../src/gedcom/decode';
import {Tree, buildTree} from '../src/model';

// Tests read German display strings unless they set a language themselves.
setLang('de');

export const REPO = fileURLToPath(new URL('../', import.meta.url));
export const BASE_URL = 'http://127.0.0.1:5173/demo/';

export function readFixture(path: string): string {
  return decodeGedcom(new Uint8Array(readFileSync(REPO + path)).buffer).text;
}

export function loadTree(path: string): Tree {
  return buildTree(readFixture(path), BASE_URL + path.split('/').pop());
}

export const DEMO = readFixture('public/demo/demo.ged');
export const tree = loadTree('public/demo/demo.ged');

/** The demo's root: Clara Hartwell, born 1994. */
export const ROOT = [...tree.persons.values()].find((p) => p.name === 'Clara Hartwell')?.id as string;

export function personNamed(name: string, born?: number) {
  return [...tree.persons.values()].find(
    (p) => p.name === name && (born === undefined || p.events.some((e) => e.date?.year === born)),
  );
}
