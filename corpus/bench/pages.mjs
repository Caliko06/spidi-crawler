// The pages Jev is measured on, and what it is measured against. Every page
// of the corpus that the blind teacher annotated (corpus/gold/page), in three
// splits: `tune`, the pages lines are set on; `test`, pages that never set a
// line; `authored`, the texts written for the project, judged sentence by
// sentence by their writer before any model saw them. Each page has its
// references: `teacher` (gpt-6-luna, blind), `teacher2` (a second blind pass
// of it, which says how far the teacher agrees with itself: the ceiling) and,
// for the authored, `writer`.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const ROOT = join(import.meta.dirname, '../..');
const GOLD = join(ROOT, 'corpus/gold/page');
const SETS = [
  { set: 'corpus', split: 'tune' },
  { set: 'corpus/trials', split: 'tune' },
  { set: 'corpus/heldout', split: 'test' },
  { set: 'corpus/regression', split: 'test' },
  { set: 'corpus/gold/authored', split: 'authored', judgements: 'corpus/gold/judgements' },
];
export const SPLITS = ['tune', 'test', 'authored'];

const read = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null);

// `[{ id, url, split, html, judgements }]`, the files relative to `root` (a
// checkout of the project: this one, or a worktree being measured).
export function pages(root = ROOT) {
  return SETS.flatMap(({ set, split, judgements = `${set}/judgements` }) => JSON.parse(readFileSync(join(root, set, 'index.json'), 'utf8'))
    .filter(({ id }) => existsSync(join(GOLD, 'teacher', `${id}.json`)))
    .map(({ id, url }) => ({ id, url, split, html: join(root, set, 'pages', `${id}.html`), judgements: join(root, judgements) })));
}

// What each reference decided of page `id`, or null where it did not judge it.
// The teacher's decisions name sentences by their place (S12), in the page as
// it was cut when the teacher read it (`seen`, each sentence's text and the
// place of its section, from `teacher/<id>.in.txt`): against a page cut
// otherwise since, they name other sentences and sections.
export function references(id) {
  const writer = read(join(ROOT, 'corpus/gold/authored/verdicts', `${id}.json`));
  const input = join(GOLD, 'teacher', `${id}.in.txt`);
  let section = -1;
  const seen = existsSync(input) ? readFileSync(input, 'utf8').split('\n').flatMap((line) => {
    if (/^§\d+ /.test(line)) section += 1;
    const text = line.match(/^S\d+ (.*)$/)?.[1];
    return text === undefined ? [] : [{ text, section }];
  }) : null;
  const folds = read(join(ROOT, 'corpus/gold/merges/teacher', `${id}.json`))?.folds ?? null;
  return { folds, teacher: read(join(GOLD, 'teacher', `${id}.json`)), teacher2: read(join(GOLD, 'teacher2', `${id}.json`)), writer, seen };
}

// Which pages `which` names: `all`, a split, or ids, comma-separated.
export function select(all, which = 'all') {
  if (which === 'all') return all;
  const named = which.split(',');
  return all.filter(({ id, split }) => named.includes(id) || named.includes(split));
}
