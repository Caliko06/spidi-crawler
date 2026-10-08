// The texts written for the project (`corpus/gold/src`), each with its
// writer's verdict on every sentence, as a set the teacher can annotate like
// any other (`corpus/gold/authored`): its pages, and the writer's verdicts.
// What the teacher decides of them is set against the writer's in
// corpus/bench/score.mjs, as the ceiling of what is set against the writer.
//
//   node corpus/gold/page/authored.mjs

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from '../compare.mjs';

const GOLD = join(import.meta.dirname, '..');
const SET = join(GOLD, 'authored');
mkdirSync(join(SET, 'pages'), { recursive: true });
mkdirSync(join(SET, 'verdicts'), { recursive: true });
const index = [];
for (const name of readdirSync(join(GOLD, 'src')).filter((n) => n.endsWith('.txt')).sort()) {
  const id = `authored-${name.slice(0, -4)}`;
  const { page, verdicts, apparatus } = build(readFileSync(join(GOLD, 'src', name), 'utf8'));
  writeFileSync(join(SET, 'pages', `${id}.html`), page);
  writeFileSync(join(SET, 'verdicts', `${id}.json`), `${JSON.stringify({ apparatus, verdicts }, null, 1)}\n`);
  index.push({ id, title: page.match(/<title>(.*?)<\/title>/)[1], url: `https://example.org/${name.slice(0, -4)}`, credit: 'Written for this project, with its writer\'s verdicts.' });
}
writeFileSync(join(SET, 'index.json'), `${JSON.stringify(index, null, 1)}\n`);
console.log(index.map(({ id }) => id).join(' '));
