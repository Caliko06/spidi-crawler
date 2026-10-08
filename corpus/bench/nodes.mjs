// How many nodes the web has, page by page, from a bench run: themes, subjects
// and how many of those fold into another, subjects holding one or two
// sentences, and the sentences left as beads (the essentials). Beside it, what
// the blind teacher made of the same page: its subjects (it folds none, it
// has no web) and its essentials. Free: it reads what a run kept.
//
//   node corpus/bench/nodes.mjs <run> [--pages all|tune|test|authored|<id>,...]

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { pages, references, ROOT, select } from './pages.mjs';

const { positionals: [name], values: args } = parseArgs({ allowPositionals: true, options: { pages: { type: 'string', default: 'all' } } });
if (!name) throw new Error('name the run: node corpus/bench/nodes.mjs <run>');
const dir = join(ROOT, '.cache/bench', name);
const median = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];

const rows = [];
for (const { id, split } of select(pages(), args.pages)) {
  const { made } = JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8'));
  const { topics, parents, folds, kept } = made;
  const themes = parents.filter((parent) => parent === null).length;
  const subjects = topics.length - themes;
  const fallen = folds.filter((host) => host !== null).length;
  const held = topics.map((_, i) => kept.filter(({ topic }) => topic === i).length);
  const thin = topics.filter((_, i) => parents[i] !== null && folds[i] === null && held[i] <= 2).length;
  const beads = kept.filter(({ worth }) => worth === 'prize').length;
  const { teacher } = references(id);
  const row = { id, split, themes, subjects, fallen, shown: themes + subjects - fallen, thin, beads, sentences: kept.length };
  if (teacher) {
    row.teacherThemes = teacher.subjects.filter(({ theme }) => theme === null).length;
    row.teacherSubjects = teacher.subjects.length - row.teacherThemes;
    row.teacherBeads = teacher.essentials.length;
  }
  rows.push(row);
}

console.log('page'.padEnd(26), 'split  sent  themes subj fall shown thin beads | teacher: themes subj beads');
for (const r of rows) {
  console.log(r.id.padEnd(26), r.split.padEnd(8), String(r.sentences).padStart(4), String(r.themes).padStart(6), String(r.subjects).padStart(5), String(r.fallen).padStart(4), String(r.shown).padStart(5), String(r.thin).padStart(4), String(r.beads).padStart(5), '|', String(r.teacherThemes ?? '-').padStart(15), String(r.teacherSubjects ?? '-').padStart(4), String(r.teacherBeads ?? '-').padStart(5));
}
for (const key of ['sentences', 'themes', 'subjects', 'fallen', 'shown', 'thin', 'beads', 'teacherThemes', 'teacherSubjects', 'teacherBeads']) {
  const values = rows.map((r) => r[key]).filter((v) => v !== undefined);
  console.log(`${key.padEnd(16)} median ${median(values)}  mean ${(values.reduce((a, b) => a + b, 0) / values.length).toFixed(1)}  max ${Math.max(...values)}`);
}
