// Rewrites the generated blocks in docs/wiki/*.md from the code. Usage: npm run wiki. Prose stays as written.
// src/wiki/wiki.test.ts fails when a page differs from what this writes.
import { readFileSync, writeFileSync } from 'node:fs';
import { fillPage, PAGES, WIKI_ROOTS, WIKI_TABLES } from '../src/wiki/wiki.ts';

const written = [];
for (const name of PAGES) {
  const file = `docs/wiki/${name}`;
  const text = readFileSync(file, 'utf8');
  const filled = fillPage(name, text, WIKI_TABLES, WIKI_ROOTS);
  if (filled === text) continue;
  writeFileSync(file, filled);
  written.push(name);
}
console.log(written.length ? `Wrote ${written.join(', ')}` : 'Wiki pages are up to date');
