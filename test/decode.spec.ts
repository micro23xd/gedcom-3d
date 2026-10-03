import {describe, expect, it} from 'vitest';
import {decodeGedcom} from '../src/gedcom/decode';
import './fixture';

const head = (charset: string) => `0 HEAD\r\n1 CHAR ${charset}\r\n0 @I1@ INDI\r\n1 NAME `;
const bytes = (...parts: (string | number[])[]) => {
  const out: number[] = [];
  for (const p of parts) out.push(...(typeof p === 'string' ? new TextEncoder().encode(p) : p));
  return new Uint8Array(out).buffer;
};

describe('decodeGedcom', () => {
  it('reads UTF-8', () => {
    expect(decodeGedcom(bytes(head('UTF-8'), 'Jürgen /Brenner/'))).toEqual({text: head('UTF-8') + 'Jürgen /Brenner/'});
  });

  it('reads a UTF-16 file by its BOM', () => {
    const text = '0 HEAD\n1 NAME Jürgen';
    const u16 = new Uint8Array([0xff, 0xfe, ...[...text].flatMap((c) => [c.charCodeAt(0), 0])]);
    expect(decodeGedcom(u16.buffer).text).toBe(text);
  });

  it('reads ANSI as Windows-1252', () => {
    expect(decodeGedcom(bytes(head('ANSI'), 'J', [0xfc], 'rgen')).text).toContain('Jürgen');
  });

  it('falls back to Windows-1252 when UTF-8 is a lie, and says so', () => {
    const d = decodeGedcom(bytes(head('UTF-8'), 'J', [0xfc], 'rgen'));
    expect(d.text).toContain('Jürgen');
    expect(d.warning).toMatch(/UTF-8/);
  });

  it('warns about ANSEL', () => {
    expect(decodeGedcom(bytes(head('ANSEL'), 'Brenner')).warning).toMatch(/ANSEL/);
  });
});
