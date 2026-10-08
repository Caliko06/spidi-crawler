// Plans every page of the bench with the code at `--root` and keeps all of
// it for `score.mjs`: every request and Jev's answer to it, every decision
// the plan told, and the plan, in `.cache/bench/<name>/<id>.json`.
//
// By default nothing is asked of Jev. An answer kept from an earlier run,
// whole or question by question (lib/jev.js), is given; a question none
// answered is given a made-up answer, so the plan still runs end to end, and
// counted: the run ends with what asking them would cost, by kind of
// question, from what kept answers cost. A page with made-up answers is
// scored only in what was decided before the first of them (score.mjs).
// With `--live`, the questions of those kinds (`section,subject`, or `all`)
// that none answered are asked of Jev, up to `JEV_LIMIT` dollars (0.10 if
// unset), and kept like any answer: a question is paid for once.
//
//   node corpus/bench/run.mjs <name> [--root <checkout>] [--pages all|tune|test|authored|<id>,...] [--live <kinds>|all]

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { pages, ROOT, select } from './pages.mjs';
import { kindOf } from './stages.mjs';

const { positionals: [name], values: args } = parseArgs({ allowPositionals: true, options: { root: { type: 'string', default: ROOT }, pages: { type: 'string', default: 'all' }, live: { type: 'string', default: '' } } });
if (!name) throw new Error('name the run: node corpus/bench/run.mjs <name>');
const root = resolve(args.root);
const live = args.live.split(',').filter(Boolean);
const out = join(ROOT, '.cache/bench', name);
mkdirSync(out, { recursive: true });

const { open, plan } = await import(join(root, 'lib/crawl.js'));
const { createJev, readKey } = await import(join(root, 'lib/jev.js'));
const { segment } = await import(join(root, 'lib/segment.js'));
const { asked, tokens } = await import(join(root, 'lib/questions.js'));
// The key is in the main checkout's .env.local; a worktree has none of its own.
const main = dirname(execFileSync('git', ['-C', root, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim());
const key = live.length ? (await readKey(root)) ?? (await readKey(main)) : undefined;
if (live.length && !key) throw new Error('--live needs AI_GATEWAY_API_KEY');
const limit = Number(process.env.JEV_LIMIT ?? 0.1);

// A made-up answer: middling, and low where a yes would join or drop
// something (a section ruled out as apparatus, two names made one), so the
// plan made of it runs to the end the way a real one does.
const LOW = new Set(['alias', 'same', 'fall']);
const madeUp = (question, kind) => {
  if (question.type === 'boolean') return { probability: LOW.has(kind) ? 0.1 : 0.6 };
  const options = question.type === 'choice' ? Object.keys(question.criteria) : question.criteria.map((_, i) => String(i));
  const probabilities = Object.fromEntries(options.map((option) => [option, option === 'apparatus' ? 0.1 : option === 'text' ? 0.9 : 1 / options.length]));
  if (kind === 'part') return { choice: 'text', confidence: 0.9, probabilities };
  // A rating is key for about the share of sentences Jev rates key (.31 on the bench), the same each time a question is made up.
  if (question.type === 'score') {
    const key = createHash('sha256').update(JSON.stringify(question)).digest().readUInt32BE(0) / 2 ** 32 < 0.31;
    return { score: key ? 2.2 : 1, confidence: 0.5, probabilities: Object.fromEntries(options.map((option) => [option, Number(option) === (key ? 2 : 1) ? 1 : 0])) };
  }
  return question.type === 'choice' ? { choice: options[0], confidence: 1 / options.length, probabilities } : { score: (options.length - 1) / 2, confidence: 0.5, probabilities };
};

const kept = new Map(); // judgements directory → Jev without a key: only what is kept
const asking = new Map(); // judgements directory → Jev with the key
const jevOf = (map, dir, withKey) => map.get(dir) ?? map.set(dir, createJev({ key: withKey ? key : undefined, dir, limit })).get(dir);
const total = { requests: 0, recalled: 0, reused: 0, made: 0, counted: 0, dollars: 0, estimate: 0, missing: {} };
// The tokens of a request, or of some of its questions, as `tokens` counts them.
const counted = ({ state, questions }, names = Object.keys(questions)) => tokens(state) + names.reduce((sum, question) => sum + asked(questions[question]) + tokens(question), 0);
const report = [];
for (const page of select(pages(root), args.pages)) {
  const doc = await open(readFileSync(page.html, 'utf8'), page.url);
  const requests = [];
  const ask = async (request) => {
    const entry = { state: request.state, questions: request.questions };
    requests.push(entry);
    try {
      const { answers, reused, tokens: read, dollars } = await jevOf(kept, page.judgements, false).billed(request);
      Object.assign(entry, { answers, from: reused ? 'reused' : 'kept', tokens: read, dollars });
      return answers;
    } catch (error) {
      if (!error.missing) throw error;
      const kinds = new Set(error.missing.map(kindOf));
      if (live.includes('all') || [...kinds].every((kind) => live.includes(kind))) {
        const { answers, tokens: read, dollars } = await jevOf(asking, page.judgements, true).billed(request);
        Object.assign(entry, { answers, from: 'asked', tokens: read, dollars, asked: error.missing });
        return answers;
      }
      const answers = { ...error.answers, ...Object.fromEntries(error.missing.map((question) => [question, madeUp(request.questions[question], kindOf(question))])) };
      Object.assign(entry, { answers, from: 'made up', madeUp: error.missing, estimate: counted(request, error.missing) });
      return answers;
    }
  };
  const events = [];
  let made = null, error = null;
  try {
    made = await plan(doc, ask, (event) => events.push(event));
  } catch (failure) {
    error = failure.message;
  }
  const sentences = segment(doc.blocks).map(({ block, start, end, text, section }) => ({ block, start, end, text, section }));
  writeFileSync(join(out, `${page.id}.json`), JSON.stringify({ id: page.id, split: page.split, title: doc.title, blocks: doc.blocks.map(({ kind, text }) => ({ kind, text })), sentences, events, requests, made, error }));
  const count = (from) => requests.filter((entry) => entry.from === from).length;
  const missing = requests.flatMap((entry) => entry.madeUp ?? []);
  total.requests += requests.length;
  total.recalled += count('kept');
  total.reused += count('reused');
  total.made += missing.length;
  for (const entry of requests) {
    if (entry.from === 'kept' && entry.dollars) [total.counted, total.dollars] = [total.counted + counted(entry), total.dollars + entry.dollars];
    if (entry.from === 'made up') total.estimate += entry.estimate;
    for (const question of entry.madeUp ?? []) total.missing[kindOf(question)] = (total.missing[kindOf(question)] ?? 0) + 1;
  }
  report.push({ id: page.id, split: page.split, requests: requests.length, madeUp: missing.length, asked: count('asked'), error });
  console.log(`${page.split.padEnd(8)} ${page.id.padEnd(28)} ${String(requests.length).padStart(4)} requests${missing.length ? `, ${missing.length} questions made up` : ''}${count('asked') ? `, ${count('asked')} asked of Jev` : ''}${error ? `  ${error}` : ''}`);
}

// What the made-up questions would cost: their tokens as `tokens` counts
// them, at what Jev billed for each token so counted of the kept requests.
// A run with nothing kept to measure it by takes the rate the last run measured.
const RATE = join(ROOT, '.cache/bench/rate.json');
const rate = total.counted ? total.dollars / total.counted : JSON.parse(readFileSync(RATE, 'utf8').toString() || '{"rate":0}').rate;
if (total.counted > 1e6) writeFileSync(RATE, JSON.stringify({ rate, from: name }));
const spent = [...asking.values()].reduce((sum, jev) => sum + jev.live.dollars, 0);
const commit = execFileSync('git', ['-C', root, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
const dirty = execFileSync('git', ['-C', root, 'status', '--porcelain', 'lib'], { encoding: 'utf8' }).trim() !== '';
writeFileSync(join(out, 'run.json'), JSON.stringify({ name, root, commit, dirty, at: new Date().toISOString(), pages: report, live, spent, missing: total.missing }, null, 1));
console.log(`\n${total.requests} requests: ${total.recalled} kept, ${total.reused} put together from kept answers, ${total.made} questions made up; Jev asked now: $${spent.toFixed(4)}`);
if (total.made) console.log(`asking the made-up questions would cost about $${(total.estimate * rate).toFixed(3)} (${total.estimate} tokens counted, at $${(rate * 1e6).toFixed(3)} a million counted)  by kind: ${Object.entries(total.missing).map(([kind, n]) => `${kind} ${n}`).join(', ')}`);
console.log(`kept in .cache/bench/${name}  (code at ${root}, ${commit}${dirty ? ' with changes to lib' : ''})`);
