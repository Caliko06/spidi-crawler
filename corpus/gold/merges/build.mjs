// What the teacher is shown of a page Jev has planned: its themes and
// subjects with the sentences filed under each, numbered, essential ones
// marked, and nothing of what Jev decided about folds. Written to
// `teacher/<id>.in.txt`, which is what its ids refer to. The teacher is
// `codex exec` with `task.txt` and `schema.json`, run blind to Jev:
//
//   node corpus/gold/merges/build.mjs <set> <id>
//   cat task.txt <(printf '\n\n=== THE SUMMARY ===\n\n') teacher/<id>.in.txt | codex exec -m gpt-6-luna -s read-only --skip-git-repo-check --ephemeral --output-schema schema.json -o teacher/<id>.json -

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [set, id] = process.argv.slice(2);
const ROOT = join(import.meta.dirname, '../../..');
const plan = JSON.parse(readFileSync(join(ROOT, set, 'plans', `${id}.json`), 'utf8'));
const named = /^(.*) \((\d+)\)$/;
let n = 0;
const sentences = (name) => (plan.subjects[name] ?? []).map((text) => `  s${n++} ${text.startsWith('PRIZE ') ? `[ESSENTIAL] ${text.slice(6)}` : text.startsWith('LEAD ') ? `[LEAD] ${text.slice(5)}` : text}`).join('\n');
const out = [`DOCUMENT: ${plan.title}\n`];
for (const [theme, subjects] of Object.entries(plan.themes)) {
  const head = theme.match(named)[1];
  out.push(`THEME "${head}"\n${sentences(head)}`);
  for (const subject of subjects) {
    const name = subject.match(named)[1];
    out.push(`SUBJECT "${name}" (under theme "${head}")\n${sentences(name)}`);
  }
}
writeFileSync(join(import.meta.dirname, 'teacher', `${id}.in.txt`), out.join('\n\n'));
