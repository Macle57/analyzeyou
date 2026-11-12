// Entry point for `node --test tests/` (Node 22 resolves the directory via tests/package.json "main").
// Imports every *.test.mjs in this folder; `node --test` with no arguments finds them directly too.
import { readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
for (const f of readdirSync(here).filter((n) => n.endsWith('.test.mjs')).sort()) {
  await import(pathToFileURL(`${here}/${f}`).href);
}
