#!/usr/bin/env node
/**
 * Fails if the built page could call out: an http(s) URL in the HTML or the
 * stylesheets, or a webfont, analytics or CDN host anywhere in the bundle.
 * The viewer reads private family trees; it must not fetch anything from a
 * host other than the one serving it.
 */

import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';

const DIST = process.argv[2] ?? 'dist';
const BANNED = /googleapis|gstatic|googletagmanager|google-analytics|unpkg\.com|jsdelivr|cdnjs|typekit|fonts\./;
const problems = [];

function walk(dir) {
  for (const entry of readdirSync(dir, {withFileTypes: true})) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (/\.(html|css)$/.test(entry.name) && /https?:\/\//.test(readFileSync(path, 'utf-8'))) problems.push(`${path}: external URL`);
    else if (/\.(html|css|js)$/.test(entry.name) && BANNED.test(readFileSync(path, 'utf-8'))) problems.push(`${path}: ${BANNED.exec(readFileSync(path, 'utf-8'))[0]}`);
  }
}

walk(DIST);
if (problems.length) {
  console.error('The bundle could call out:\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log(`${DIST}: no external hosts`);
