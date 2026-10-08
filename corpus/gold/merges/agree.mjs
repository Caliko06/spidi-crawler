// Jev's folds against the teacher's, on every page that has the teacher's
// annotation (`teacher/<id>.json`, made blind to Jev, see build.mjs): of the
// subjects that are not themes, which fall into another; the adjusted Rand
// index of the pages' sentences by the node each ends up in; the teacher
// against itself where it was asked twice (`teacher/<id>.B.json`). Run it
// when what is asked of Jev for folds changes: it costs nothing while the
// questions are the same. Pages of `corpus/heldout` were never used to set
// `FALL`: they are the test, the rest is what it was fitted on.
//
//   node corpus/gold/merges/agree.mjs [id…]

import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { read } from '../../../lib/crawl.js';
import { createJev, readKey } from '../../../lib/jev.js';

const ROOT = join(import.meta.dirname, '../../..');
const SETS = ['corpus', 'corpus/trials', 'corpus/heldout'];
const choose2 = (n) => (n * (n - 1)) / 2;

// Adjusted Rand index of two labellings of the same things.
function rand(a, b) {
  const cells = new Map(), rows = new Map(), cols = new Map();
  a.forEach((x, i) => {
    const key = `${x}\0${b[i]}`;
    cells.set(key, (cells.get(key) ?? 0) + 1);
    rows.set(x, (rows.get(x) ?? 0) + 1);
    cols.set(b[i], (cols.get(b[i]) ?? 0) + 1);
  });
  const sum = (map) => [...map.values()].reduce((total, n) => total + choose2(n), 0);
  const [both, ra, cb] = [sum(cells), sum(rows), sum(cols)];
  const chance = (ra * cb) / choose2(a.length);
  const middle = (ra + cb) / 2;
  return middle === chance ? 1 : (both - chance) / (middle - chance);
}

// The subjects that are not themes and the subject each sentence is filed under, from what the teacher was shown.
function shown(id) {
  const subjects = [], filed = [];
  let current = null;
  for (const line of readFileSync(join(import.meta.dirname, 'teacher', `${id}.in.txt`), 'utf8').split('\n')) {
    const head = line.match(/^(THEME|SUBJECT) "(.*?)"/);
    if (head) {
      current = head[2];
      if (head[1] === 'SUBJECT') subjects.push(current);
    } else if (/^ {2}s\d+ /.test(line)) filed.push(current);
  }
  return { subjects, filed };
}

// Where the teacher would keep each subject: its own name, or the one it falls into.
function hostOf(id, run = '') {
  const into = new Map(JSON.parse(readFileSync(join(import.meta.dirname, 'teacher', `${id}${run}.json`), 'utf8')).folds.map(({ subject, into }) => [subject, into]));
  return (name) => {
    let host = into.get(name) ?? null;
    if (host !== null && into.get(host)) host = into.get(host);
    return host ?? name;
  };
}

const key = await readKey(ROOT);
const want = process.argv.slice(2);
const total = { subjects: 0, jev: 0, teacher: 0, both: 0, same: 0 };
for (const set of SETS) {
  const ask = createJev({ key, dir: join(ROOT, set, 'judgements'), limit: 0.1 });
  for (const { id, url } of JSON.parse(await readFile(join(ROOT, set, 'index.json'), 'utf8'))) {
    if ((want.length && !want.includes(id)) || !existsSync(join(import.meta.dirname, 'teacher', `${id}.json`))) continue;
    const { topics, folds } = await read(await readFile(join(ROOT, set, 'pages', `${id}.html`), 'utf8'), url, ask);
    const jev = (name) => (topics.includes(name) && folds[topics.indexOf(name)] !== null ? topics[folds[topics.indexOf(name)]] : name);
    const teacher = hostOf(id);
    const { subjects, filed } = shown(id);
    const row = { jev: 0, teacher: 0, both: 0, same: 0 };
    for (const name of subjects) {
      const [a, b] = [jev(name) !== name, teacher(name) !== name];
      row.jev += a;
      row.teacher += b;
      if (a && b) {
        row.both++;
        row.same += jev(name) === teacher(name);
      }
    }
    for (const key of Object.keys(row)) total[key] += row[key];
    total.subjects += subjects.length;
    const twice = existsSync(join(import.meta.dirname, 'teacher', `${id}.B.json`)) ? `, teacher against itself ${rand(filed.map(teacher), filed.map(hostOf(id, '.B'))).toFixed(2)}` : '';
    console.log(`${set === 'corpus/heldout' ? 'TEST ' : '     '}${id.padEnd(20)} falls: Jev ${row.jev}, teacher ${row.teacher}, both ${row.both} (same host ${row.same}); Rand ${rand(filed.map(jev), filed.map(teacher)).toFixed(2)}, none folded ${rand(filed, filed.map(teacher)).toFixed(2)}${twice}`);
  }
}
const [precision, recall] = [total.both / total.jev, total.both / total.teacher];
console.log(`\n${total.subjects} subjects: Jev folds ${total.jev}, teacher ${total.teacher}, both ${total.both}, same host ${total.same}; precision ${precision.toFixed(2)}, recall ${recall.toFixed(2)}, F1 ${((2 * precision * recall) / (precision + recall)).toFixed(2)}`);
