// What the teacher is shown of a page: its sections and its sentences, cut as
// Jev's are (lib/segment.js), numbered, and nothing of what Jev decided.
// Written to `teacher/<id>.in.txt`, which is what its ids refer to. The
// teacher is `codex exec` with `task.txt` and `schema.json`, blind to Jev
// (`run.sh`); its answer is `teacher/<id>.json`.
//
//   node corpus/gold/page/build.mjs <set> <id>

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { open } from '../../../lib/crawl.js';
import { segment } from '../../../lib/segment.js';

const [set, id] = process.argv.slice(2);
const ROOT = join(import.meta.dirname, '../../..');
const url = JSON.parse(readFileSync(join(ROOT, set, 'index.json'), 'utf8')).find((page) => page.id === id).url;
const doc = await open(readFileSync(join(ROOT, set, 'pages', `${id}.html`), 'utf8'), url);
const sentences = segment(doc.blocks);
const sections = [...new Set(sentences.map(({ section }) => section))];
const out = [`DOCUMENT: ${doc.title}`];
for (const [k, section] of sections.entries()) {
  out.push(`\n§${k} ${doc.blocks[section].kind === 'h1' ? '(under the title)' : doc.blocks[section].text}`);
  sentences.forEach((sentence, i) => sentence.section === section && out.push(`S${i} ${sentence.text}`));
}
writeFileSync(join(import.meta.dirname, 'teacher', `${id}.in.txt`), `${out.join('\n')}\n`);
console.log(`${id}: ${sections.length} sections, ${sentences.length} sentences`);
