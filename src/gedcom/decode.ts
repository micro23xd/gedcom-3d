/**
 * Bytes to text, honouring the header's `1 CHAR`. Most files are UTF-8; older
 * Windows exports are ANSI (windows-1252), and GEDCOM 5.5's ANSEL has no
 * decoder in any browser, so it is read as windows-1252 with a warning — the
 * ASCII is right and only the combining diacritics come out wrong.
 */

import {t} from '../i18n';

export interface Decoded {
  text: string;
  warning?: string;
}

function charsetOf(bytes: Uint8Array): string | undefined {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 4096));
  return /^\s*1\s+CHAR\s+(\S+)/im.exec(head)?.[1]?.toUpperCase();
}

export function decodeGedcom(buf: ArrayBuffer): Decoded {
  const bytes = new Uint8Array(buf);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return {text: new TextDecoder('utf-16le').decode(bytes)};
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return {text: new TextDecoder('utf-16be').decode(bytes)};

  const charset = charsetOf(bytes);
  const cp1252 = () => new TextDecoder('windows-1252').decode(bytes);
  if (charset === 'ANSI' || charset === 'IBMPC' || charset === 'ASCII') return {text: cp1252()};
  if (charset === 'ANSEL') {
    return {text: cp1252(), warning: t('decode.ansel')};
  }
  try {
    return {text: new TextDecoder('utf-8', {fatal: true}).decode(bytes)};
  } catch {
    return {
      text: cp1252(),
      warning: t('decode.notUtf8', {declared: charset ? t('decode.declared', {charset}) : ''}),
    };
  }
}
