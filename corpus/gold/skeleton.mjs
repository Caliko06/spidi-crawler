// Writes `src/<id>.txt` for a page of the corpus or of the trials: its text in
// the format compare.mjs reads, with `{?}` before every sentence for a reader
// to replace with a verdict.
//
//   node corpus/gold/skeleton.mjs <id>

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { open } from '../../lib/crawl.js';
import { segment } from '../../lib/segment.js';

const ROOT = join(import.meta.dirname, '../..');
const id = process.argv[2];
let found;
for (const set of ['corpus', 'corpus/trials']) {
  const entry = JSON.parse(await readFile(join(ROOT, set, 'index.json'), 'utf8')).find((one) => one.id === id);
  if (entry) found = { set, entry };
}
if (!found) throw new Error(`no page called ${id}`);
const doc = await open(await readFile(join(ROOT, found.set, 'pages', `${id}.html`), 'utf8'), found.entry.url);
const sentences = segment(doc.blocks);
const lines = [`# ${doc.title}`, ''];
doc.blocks.forEach((block, index) => {
  if (block.kind === 'h1') return;
  if (block.kind === 'h2' || block.kind === 'h3') return lines.push(`## ${block.text}`, '');
  let text = '';
  let at = 0;
  for (const { start, end } of sentences.filter((sentence) => sentence.block === index)) {
    text += `${block.text.slice(at, start)}{?}${block.text.slice(start, end)}`;
    at = end;
  }
  lines.push(`${block.kind === 'li' ? '- ' : ''}${(text + block.text.slice(at)).replace(/\n+/g, ' ')}`, '');
});
await writeFile(join(import.meta.dirname, 'src', `${id}.txt`), lines.join('\n'));
console.log(`${id}: ${doc.words} words, ${sentences.length} sentences`);
