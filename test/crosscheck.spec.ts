/**
 * Hold the evidence counts to an external classifier.
 *
 * Skipped unless GEDCOM_PATH and EXPECTED_JSON are set. EXPECTED_JSON is that
 * classifier's output for the same file: the fact count, the four buckets
 * under the keys `urkunde`, `zweitzeuge`, `hinweis`, `ohne`, and a `queues`
 * object with any of `ohne`, `hinweis`, `unexplained`, `pending`, `frontier`,
 * `detached`. ROOT names the seed person for "detached", PENDING_SOURCE the
 * source whose page-less citations are "pending".
 */
import {existsSync, readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {computeEvidence} from '../src/evidence';
import {decodeGedcom} from '../src/gedcom/decode';
import {buildTree} from '../src/model';

const {GEDCOM_PATH, EXPECTED_JSON, ROOT, PENDING_SOURCE} = process.env;
const ready = !!GEDCOM_PATH && !!EXPECTED_JSON && existsSync(GEDCOM_PATH) && existsSync(EXPECTED_JSON);

describe.skipIf(!ready)('evidence matches the external classifier', () => {
  const want = ready ? JSON.parse(readFileSync(EXPECTED_JSON as string, 'utf-8')) : {};
  const tree = ready
    ? buildTree(decodeGedcom(new Uint8Array(readFileSync(GEDCOM_PATH as string)).buffer).text, 'http://127.0.0.1/x.ged')
    : undefined;
  const got = tree ? computeEvidence(tree, {seed: ROOT, pendingSource: PENDING_SOURCE}) : undefined;

  it('summary', () => {
    const map = {
      individuals: 'individuals',
      families: 'families',
      facts: 'facts',
      record: 'urkunde',
      secondary: 'zweitzeuge',
      hint: 'hinweis',
      unsourced: 'ohne',
    } as const;
    for (const [ours, theirs] of Object.entries(map)) {
      if (theirs in want) expect([ours, got?.summary[ours as keyof typeof map]]).toEqual([ours, want[theirs]]);
    }
  });

  it('queues', () => {
    const map = {unsourced: 'ohne', hint: 'hinweis', unexplained: 'unexplained', pending: 'pending', frontier: 'frontier', detached: 'detached'} as const;
    for (const [ours, theirs] of Object.entries(map)) {
      if (want.queues && theirs in want.queues) {
        expect([ours, got?.queues[ours as keyof typeof map]]).toEqual([ours, want.queues[theirs]]);
      }
    }
  });
});
