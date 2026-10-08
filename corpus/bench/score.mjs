// How close what Jev decided in a run of the bench (run.mjs) comes to what
// the references decided, decision by decision, and how close the reference
// comes to itself: the teacher's second blind pass against its first, and
// the teacher against the writer where the writer judged. What two passes of
// the teacher share is as near as Jev can be asked to come to it, so each
// decision is read as Jev's score against that ceiling, on the pages that set
// its line (tune) and on those that never did (test, authored).
//
// Lines: for each decision Jev answers with odds, how well the odds tell yes
// from no whatever the line (AUC), the line in force (lib/lines.js) and the
// line that would agree best on the tuning pages, tried on the others. A
// line is a number in lib/ only when it comes from here.
//
// With `--against <run>`, each score is set against the other run's on the
// pages both made real, with the 90% interval of the difference over pages
// drawn again and again (paired bootstrap): a difference whose interval
// holds 0 is not one.
//
//   node corpus/bench/score.mjs <run> [--against <run>] [--pages] [--save]

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { references, ROOT, SPLITS } from './pages.mjs';
import { real } from './stages.mjs';

const { positionals: [name], values: args } = parseArgs({ allowPositionals: true, options: { against: { type: 'string' }, pages: { type: 'boolean' }, save: { type: 'boolean' } } });
if (!name) throw new Error('name the run: node corpus/bench/score.mjs <run>');

const key = ({ block, start }) => `${block}:${start}`;
const flat = (text) => text.replace(/\s+/g, ' ').trim();
const index = (id) => Number(id.slice(1));
// Whether a name of Jev's and one of the teacher's name the same thing: half the words of the shorter, by their first five letters.
const words = (name) => name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2).map((w) => w.replace(/(ies|es|s)$/, '').slice(0, 5));
const alike = (a, b) => {
  const [x, y] = [words(a), words(b)];
  return x.length > 0 && y.length > 0 && x.filter((w) => y.includes(w)).length / Math.min(x.length, y.length) >= 0.5;
};

// The adjusted Rand index of two groupings of the same things: 1 the same, 0 chance.
function ari(a, b) {
  const pairs = (n) => (n * (n - 1)) / 2;
  const count = (keys) => [...Map.groupBy(keys, (k) => k).values()].reduce((sum, own) => sum + pairs(own.length), 0);
  const both = count(a.map((x, i) => `${x}\u0000${b[i]}`));
  const [sa, sb, all] = [count(a), count(b), pairs(a.length)];
  const expected = (sa * sb) / all;
  const most = (sa + sb) / 2;
  return most === expected ? 1 : (both - expected) / (most - expected);
}

// What a reference decided of a page, read once.
function reading(teacher, sentences) {
  if (!teacher) return null;
  const sections = [...new Set(sentences.map(({ section }) => section))];
  const parent = new Map(teacher.subjects.map(({ name, theme }) => [name, theme]));
  const top = (name) => {
    for (let seen = 0; parent.get(name) && parent.get(parent.get(name)) && seen < 9; seen++) name = parent.get(name);
    return name;
  };
  return {
    apparatus: new Set(teacher.apparatus.map((s) => sections[index(s)])),
    level: new Map(teacher.sentences.map(({ id, level }) => [index(id), level])),
    alone: new Map(teacher.sentences.map(({ id, leans }) => [index(id), leans === null])),
    essentials: new Set(teacher.essentials.map(index)),
    lead: index(teacher.lead),
    names: teacher.subjects.map(({ name }) => name),
    filed: new Map(teacher.filing.map(({ id, subject }) => [index(id), subject])),
    top,
    repeats: new Set(teacher.repeats.flatMap(({ ids }) => ids.flatMap((a) => ids.map((b) => `${index(a)}|${index(b)}`)))),
  };
}
// The writer's verdicts, as a reading: levels, essentials and lead, by sentence.
function written(writer, sentences) {
  if (!writer) return null;
  const byText = new Map(writer.verdicts.map((one) => [flat(one.text), one]));
  const own = sentences.flatMap((sentence, i) => (byText.has(flat(sentence.text)) ? [[i, byText.get(flat(sentence.text))]] : []));
  return { level: new Map(own.map(([i, one]) => [i, one.level])), essentials: new Set(own.filter(([, one]) => one.prize).map(([i]) => i)), lead: own.find(([, one]) => one.lead)?.[0] ?? null };
}

// Counts of a yes-or-no decision against a reference over `among`.
const counts = (among, said, truth) => {
  const c = { tp: 0, fp: 0, fn: 0 };
  for (const i of among) {
    const [s, t] = [said(i), truth(i)];
    if (s && t) c.tp++;
    else if (s) c.fp++;
    else if (t) c.fn++;
  }
  return c;
};

// Every decision, what it reads of Jev's answers (`kinds`), what it is set
// against (`ref`), and for a page: `rows`, Jev's odds and the reference's
// yes or no, to tell how well the odds rank (`line` the decision in force);
// `jev` and `ceiling`, counts of a yes-or-no decision (F1) or a value (ARI,
// or 1 when the two pick the same one).
function decisions({ LINES, KEY, PASSED }) {
  const rated = (d) => d.events.filter(({ type }) => type === 'rated').flatMap(({ sentences }) => sentences).map((one) => ({ ...one, i: d.at.get(key(one)) }));
  const prizes = (d) => {
    const worth = d.events.find(({ type }) => type === 'worth');
    return worth && { odds: worth.odds.map((one) => ({ ...one, i: d.at.get(key(one)) })), prizes: new Set(worth.prizes.map((one) => d.at.get(key(one)))), lead: d.at.get(key(worth.lead)) };
  };
  const level = (ref, at) => (d) => {
    const r = d[ref];
    const among = rated(d).filter(({ i }) => r.level.has(i));
    const yes = (i) => at(r.level.get(i));
    const other = ref === 'teacher' ? d.teacher2 : d.teacher;
    const both = among.filter(({ i }) => other?.level.has(i));
    return {
      rows: among.map(({ i, score }) => ({ p: score, yes: yes(i) })),
      jev: counts(among, ({ score }) => at === kept ? score >= KEY : score < PASSED, ({ i }) => yes(i)),
      ceiling: other && counts(both, ({ i }) => at(other.level.get(i)), ({ i }) => yes(i)),
    };
  };
  const kept = (l) => l >= 2;
  const passed = (l) => l === 0;
  const essential = (ref) => (d) => {
    const r = d[ref];
    const w = prizes(d);
    if (!w) return null;
    const among = [...r.level.keys()];
    const other = ref === 'teacher' ? d.teacher2 : d.teacher;
    return {
      rows: w.odds.filter(({ i }) => r.level.has(i)).map(({ i, p }) => ({ p, yes: r.essentials.has(i) })),
      jev: counts(among, (i) => w.prizes.has(i), (i) => r.essentials.has(i)),
      ceiling: other && counts(among, (i) => other.essentials.has(i), (i) => r.essentials.has(i)),
    };
  };
  const lead = (ref) => (d) => {
    const w = prizes(d);
    const other = ref === 'teacher' ? d.teacher2 : d.teacher;
    if (!w || d[ref].lead === null) return null;
    return { jev: { value: w.lead === d[ref].lead ? 1 : 0 }, ceiling: other && { value: other.lead === d[ref].lead ? 1 : 0 } };
  };
  // Jev's names against the teacher's subjects: does the teacher have a subject of that name.
  const named = (type, list) => (d) => {
    const event = d.events.find((one) => one.type === type);
    if (!event) return null;
    const items = event[list];
    return {
      rows: items.map(({ label, p }) => ({ p, yes: d.teacher.names.some((one) => alike(label, one)) })),
      jev: counts(items, ({ p }) => p >= LINES[type === 'headings' ? 'section' : 'subject'].at, ({ label }) => d.teacher.names.some((one) => alike(label, one))),
      ceiling: d.teacher2 && counts(items, ({ label }) => d.teacher2.names.some((one) => alike(label, one)), ({ label }) => d.teacher.names.some((one) => alike(label, one))),
    };
  };
  // The teacher's second pass against its first, as groupings of what both filed.
  const ceilingAri = (d, group) => {
    if (!d.teacher2) return null;
    const both = [...d.teacher.filed.keys()].filter((i) => d.teacher2.filed.has(i));
    return { value: ari(both.map((i) => group(d.teacher, d.teacher.filed.get(i))), both.map((i) => group(d.teacher2, d.teacher2.filed.get(i)))) };
  };
  const own = (_, name) => name;
  const topOf = (r, name) => r.top(name);
  return [
    { name: 'apparatus', ref: 'teacher', kinds: ['part'], page: (d) => {
      const survey = d.events.find(({ type }) => type === 'survey');
      const sections = [...new Set(d.sentences.map(({ section }) => section))].filter((s) => d.blocks[s].kind !== 'h1');
      return { jev: counts(sections, (s) => survey.apparatus.includes(s), (s) => d.teacher.apparatus.has(s)), ceiling: d.teacher2 && counts(sections, (s) => d.teacher2.apparatus.has(s), (s) => d.teacher.apparatus.has(s)) };
    } },
    { name: 'keep', ref: 'teacher', kinds: ['standing', 'needs'], line: KEY, page: level('teacher', kept) },
    { name: 'keep', ref: 'writer', kinds: ['standing', 'needs'], line: KEY, page: level('writer', kept) },
    { name: 'passed', ref: 'teacher', kinds: ['standing', 'needs'], line: -PASSED, sign: -1, page: (d) => ({ ...level('teacher', passed)(d), rows: level('teacher', passed)(d).rows.map(({ p, yes }) => ({ p: -p, yes })) }) },
    { name: 'passed', ref: 'writer', kinds: ['standing', 'needs'], line: -PASSED, sign: -1, page: (d) => ({ ...level('writer', passed)(d), rows: level('writer', passed)(d).rows.map(({ p, yes }) => ({ p: -p, yes })) }) },
    { name: 'alone', ref: 'teacher', kinds: ['standing', 'needs'], line: LINES.alone.at, page: (d) => {
      const among = rated(d).filter(({ i, leans }) => leans.p !== null && d.teacher.alone.has(i));
      const yes = ({ i }) => d.teacher.alone.get(i);
      return { rows: among.map((one) => ({ p: one.leans.alone, yes: yes(one) })), jev: counts(among, ({ leans }) => leans.alone >= LINES.alone.at, yes), ceiling: d.teacher2 && counts(among.filter(({ i }) => d.teacher2.alone.has(i)), ({ i }) => d.teacher2.alone.get(i), yes) };
    } },
    { name: 'heading', ref: 'teacher', kinds: ['section'], line: LINES.section.at, page: named('headings', 'headings') },
    { name: 'term', ref: 'teacher', kinds: ['subject'], line: LINES.subject.at, page: named('taken', 'terms') },
    { name: 'filing', ref: 'teacher', kinds: ['file', 'belongs', 'whole'], page: (d) => {
      const filed = d.events.find(({ type }) => type === 'filed');
      const both = filed.sentences.map((one) => ({ ...one, i: d.at.get(key(one)) })).filter(({ i }) => d.teacher.filed.has(i));
      return { jev: { value: ari(both.map(({ topic }) => topic), both.map(({ i }) => d.teacher.filed.get(i))) }, ceiling: ceilingAri(d, own) };
    } },
    { name: 'repeat', ref: 'teacher', kinds: ['same'], line: LINES.repeat.at, page: (d) => {
      const filed = d.events.find(({ type }) => type === 'filed');
      const alikeEvent = d.events.find(({ type }) => type === 'alike');
      if (!alikeEvent) return null;
      const picked = filed.sentences.map((one) => d.at.get(key(one)));
      const pairs = picked.flatMap((a, k) => picked.slice(k + 1).map((b) => `${a}|${b}`));
      const said = new Map(alikeEvent.pairs.map(({ a, b, p }) => [`${d.at.get(key(a))}|${d.at.get(key(b))}`, p]));
      return { rows: alikeEvent.pairs.map(({ a, b, p }) => ({ p, yes: d.teacher.repeats.has(`${d.at.get(key(a))}|${d.at.get(key(b))}`) })), jev: counts(pairs, (pair) => (said.get(pair) ?? 0) >= LINES.repeat.at, (pair) => d.teacher.repeats.has(pair)), ceiling: d.teacher2 && counts(pairs, (pair) => d.teacher2.repeats.has(pair), (pair) => d.teacher.repeats.has(pair)) };
    } },
    { name: 'essential', ref: 'teacher', kinds: ['prize'], line: LINES.essential.at, page: essential('teacher') },
    { name: 'essential', ref: 'writer', kinds: ['prize'], line: LINES.essential.at, page: essential('writer') },
    { name: 'lead', ref: 'teacher', kinds: ['prize', 'lead'], page: lead('teacher') },
    { name: 'lead', ref: 'writer', kinds: ['prize', 'lead'], page: lead('writer') },
    { name: 'themes', ref: 'teacher', kinds: ['theme', 'parent', 'closest', 'bond'], page: (d) => {
      const both = d.made.kept.filter((one) => d.teacher.filed.has(d.at.get(key(one))));
      return { jev: { value: ari(both.map(({ topic }) => d.made.parents[topic] ?? topic), both.map((one) => d.teacher.top(d.teacher.filed.get(d.at.get(key(one)))))) }, ceiling: ceilingAri(d, topOf) };
    } },
    { name: 'fall', ref: 'folds', kinds: ['fall', 'host'], line: LINES.fall.at, page: (d) => {
      const events = d.events.find(({ type }) => type === 'folds');
      if (!events) return null;
      // The teacher was shown the subjects of the plan as it stood: a subject it did not see is not scored.
      const said = new Map(d.folds.map(({ subject, into }) => [subject, into]));
      const among = events.subjects.filter(({ label }) => said.has(label)).map((one) => ({ ...one, yes: said.get(one.label) !== null }));
      return { rows: among.map(({ likely, p, size, yes }) => ({ p: likely, odds: p, size, yes })), jev: counts(among, ({ falls }) => falls, ({ yes }) => yes), ceiling: null };
    } },
    { name: 'subjects', ref: 'teacher', kinds: ['fall', 'host', 'theme', 'parent', 'closest', 'bond'], page: (d) => {
      const fold = (topic) => d.made.folds?.[topic] ?? topic;
      const both = d.made.kept.filter((one) => d.teacher.filed.has(d.at.get(key(one))));
      return { jev: { value: ari(both.map(({ topic }) => fold(topic)), both.map((one) => d.teacher.filed.get(d.at.get(key(one))))) }, ceiling: ceilingAri(d, own) };
    } },
  ];
}

// A run, page by page: each decision's measures where Jev made it.
async function load(run) {
  const dir = join(ROOT, '.cache/bench', run);
  const info = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8'));
  const { LINES } = await import(join(info.root, 'lib/lines.js'));
  const { KEY, PASSED } = await import(join(info.root, 'lib/triage.js'));
  const all = decisions({ LINES, KEY, PASSED });
  const pages = [];
  for (const file of readdirSync(dir).filter((one) => one.endsWith('.json') && one !== 'run.json')) {
    const d = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    const refs = references(d.id);
    d.at = new Map(d.sentences.map((sentence, i) => [key(sentence), i]));
    // A teacher who read the page cut otherwise is not set against it.
    const sections = [...new Set(d.sentences.map(({ section }) => section))];
    const stale = refs.seen !== null && (refs.seen.length !== d.sentences.length || refs.seen.some(({ text, section }, i) => text !== d.sentences[i].text || section !== sections.indexOf(d.sentences[i].section)));
    d.teacher = stale ? null : reading(refs.teacher, d.sentences);
    d.teacher2 = stale ? null : reading(refs.teacher2, d.sentences);
    d.writer = written(refs.writer, d.sentences);
    d.folds = refs.folds;
    const madeUp = d.requests.flatMap(({ madeUp = [] }) => madeUp);
    const measures = {};
    for (const decision of all) {
      const id = `${decision.name}/${decision.ref}`;
      if (!d[decision.ref] || !real(decision.kinds, madeUp)) continue;
      if (!d.made && decision.kinds.some((kind) => ['theme', 'fall'].includes(kind))) continue;
      try {
        const measure = decision.page(d);
        if (measure) measures[id] = measure;
      } catch (error) {
        if (d.error) continue; // a plan that stopped tells less
        throw error;
      }
    }
    pages.push({ id: d.id, split: d.split, measures, madeUp: madeUp.length, error: d.error, stale });
  }
  return { info, all, pages };
}

const f1 = ({ tp, fp, fn }) => (tp + fp + fn ? (2 * tp) / (2 * tp + fp + fn) : NaN);
const pool = (list) => list.reduce((sum, c) => ({ tp: sum.tp + c.tp, fp: sum.fp + c.fp, fn: sum.fn + c.fn }), { tp: 0, fp: 0, fn: 0 });
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
// A score over pages: F1 of their counts pooled, or the mean of their values.
const scoreOf = (list) => (list.length === 0 ? NaN : 'value' in list[0] ? mean(list.map(({ value }) => value)) : f1(pool(list)));

function auc(rows) {
  const yes = rows.filter((r) => r.yes).map((r) => r.p).sort((a, b) => a - b);
  const no = rows.filter((r) => !r.yes).map((r) => r.p).sort((a, b) => a - b);
  if (!yes.length || !no.length) return NaN;
  let wins = 0, below = 0, upto = 0;
  for (const y of yes) {
    while (below < no.length && no[below] < y) below++;
    upto = below;
    while (upto < no.length && no[upto] === y) upto++;
    wins += below + (upto - below) / 2;
  }
  return wins / (yes.length * no.length);
}
const f1At = (rows, line) => f1(counts(rows, (r) => r.p >= line, (r) => r.yes));
const bestLine = (rows) => [...new Set(rows.map((r) => r.p))].map((line) => ({ line, f1: f1At(rows, line) })).sort((a, b) => b.f1 - a.f1)[0];

const fmt = (x, width = 5) => (Number.isFinite(x) ? x.toFixed(2) : '  -').padStart(width);
const splitsOf = (pages, id) => Object.fromEntries(SPLITS.map((split) => [split, pages.filter((p) => p.split === split && p.measures[id])]));

const run = await load(name);
const real_ = run.pages.filter((p) => p.madeUp === 0).length;
const stale = run.pages.filter((p) => p.stale).map((p) => p.id);
if (stale.length) console.log(`the teacher read ${stale.join(', ')} cut otherwise: not set against it until it reads them again (PASS=teacher2 too; corpus/gold/page/run.sh)`);
console.log(`run ${name}: code ${run.info.commit}${run.info.dirty ? ' with changes' : ''}, ${run.pages.length} pages (${SPLITS.map((s) => `${run.pages.filter((p) => p.split === s).length} ${s}`).join(', ')}), ${real_} all Jev's${real_ < run.pages.length ? `, ${run.pages.length - real_} with made-up answers, scored only before them` : ''}`);

// Jev against the reference, and the reference against itself.
console.log('\nJev against the reference, and the reference against itself (F1, or ARI for groupings, or the share of the same lead)');
console.log(`${'decision'.padEnd(20)} ${SPLITS.map((s) => s.padStart(8)).join('')}  | ceiling ${SPLITS.map((s) => s.padStart(8)).join('')}  | of ceiling, unseen`);
const card = {};
for (const { name: decision, ref } of run.all) {
  const id = `${decision}/${ref}`;
  const by = splitsOf(run.pages, id);
  const jev = SPLITS.map((s) => scoreOf(by[s].map((p) => p.measures[id].jev)));
  const ceiling = SPLITS.map((s) => scoreOf(by[s].map((p) => p.measures[id].ceiling).filter(Boolean)));
  const unseen = [...by.test, ...by.authored];
  const share = scoreOf(unseen.map((p) => p.measures[id].jev)) / scoreOf(unseen.map((p) => p.measures[id].ceiling).filter(Boolean));
  card[id] = { pages: SPLITS.map((s) => by[s].length), jev, ceiling, share };
  if (by.tune.length + unseen.length === 0) continue;
  console.log(`${id.padEnd(20)} ${jev.map((x) => fmt(x, 8)).join('')}  |         ${ceiling.map((x) => fmt(x, 8)).join('')}  | ${Number.isFinite(share) ? `${Math.round(100 * share)}%`.padStart(5) : '    -'}`);
}

// The lines.
console.log('\nlines: how well Jev\'s odds rank (AUC), the line in force, and the line best on the tuning pages, on the others');
console.log(`${'decision'.padEnd(20)}  AUC tune  unseen   line  F1 tune unseen   best   F1 tune unseen`);
for (const { name: decision, ref, line, sign = 1 } of run.all.filter(({ line }) => line !== undefined)) {
  const id = `${decision}/${ref}`;
  const rowsOf = (split) => run.pages.filter((p) => (split === 'tune' ? p.split === 'tune' : p.split !== 'tune') && p.measures[id]?.rows).flatMap((p) => p.measures[id].rows);
  const [tune, unseen] = [rowsOf('tune'), rowsOf('unseen')];
  const show = (x) => fmt(sign * x, 6);
  if (!tune.length && !unseen.length) continue;
  let best = '';
  if (tune.length) {
    const fit = bestLine(tune);
    best = `${show(fit.line)} ${fmt(fit.f1, 8)} ${fmt(f1At(unseen, fit.line), 6)}`;
  } else {
    // The writer judged only the authored texts: each one's line is set on the others, and the lines it took are said.
    const by = Map.groupBy(run.pages.filter((p) => p.measures[id]?.rows), (p) => p.id);
    const lines = [...by.keys()].map((page) => bestLine(run.pages.filter((p) => p.id !== page && p.measures[id]?.rows).flatMap((p) => p.measures[id].rows)).line);
    const held = [...by.keys()].flatMap((page, k) => by.get(page)[0].measures[id].rows.map((r) => ({ p: r.p >= lines[k] ? 1 : 0, yes: r.yes })));
    best = `${show(Math.min(...lines.map((x) => sign * x)) * sign)}–${fmt(Math.max(...lines.map((x) => sign * x)), 4).trim()} each held out ${fmt(f1At(held, 1), 4)}`;
  }
  console.log(`${id.padEnd(20)} ${fmt(auc(tune), 8)} ${fmt(auc(unseen), 7)} ${show(line)} ${fmt(f1At(tune, line), 8)} ${fmt(f1At(unseen, line), 6)} ${best}`);
  card[id].auc = [auc(tune), auc(unseen)];
  // A line made of Jev's odds and of how much a subject holds (`fall` in lib/lines.js) is fitted again on the tuning pages.
  if (decision === 'fall' && tune.length) {
    const x = ({ odds, size }) => [1, Math.log(Math.min(Math.max(odds, 1e-4), 1 - 1e-4) / (1 - Math.min(Math.max(odds, 1e-4), 1 - 1e-4))), Math.log(size)];
    const sigmoid = (w, v) => 1 / (1 + Math.exp(-v.reduce((sum, a, k) => sum + a * w[k], 0)));
    let w = [0, 0, 0];
    for (let step = 0; step < 4000; step++) {
      const g = [0, 0, 0];
      for (const r of tune) { const v = x(r); const e = sigmoid(w, v) - (r.yes ? 1 : 0); v.forEach((a, k) => (g[k] += e * a)); }
      w = w.map((a, k) => a - 0.05 * (g[k] / tune.length + (k ? (0.1 * a) / tune.length : 0)));
    }
    const refit = (rows) => rows.map((r) => ({ p: sigmoid(w, x(r)), yes: r.yes }));
    const at = bestLine(refit(tune)).line;
    console.log(`${''.padEnd(20)} fitted again: { bias: ${w[0].toFixed(2)}, jev: ${w[1].toFixed(2)}, size: ${w[2].toFixed(2)}, at: ${at.toFixed(2)} }, F1 tune ${fmt(f1At(refit(tune), at), 4)}, unseen ${fmt(f1At(refit(unseen), at), 4)}; AUC of Jev's odds alone ${fmt(auc(tune.map(({ odds, yes }) => ({ p: odds, yes }))), 4)}, ${fmt(auc(unseen.map(({ odds, yes }) => ({ p: odds, yes }))), 4)}`);
  }
}

if (args.pages) {
  console.log('\npage by page');
  const ids = ['heading/teacher', 'filing/teacher', 'subjects/teacher', 'themes/teacher', 'essential/teacher', 'lead/teacher'];
  console.log(`${'page'.padEnd(30)}${ids.map((id) => id.split('/')[0].padStart(10)).join('')}`);
  console.log(`${''.padEnd(30)}${ids.map(() => ''.padStart(10)).join('')}  subjects ceiling`);
  for (const p of run.pages) console.log(`${`${p.split.padEnd(9)}${p.id}`.padEnd(30)}${ids.map((id) => (p.measures[id] ? fmt(scoreOf([p.measures[id].jev]), 10) : '         -')).join('')}${p.measures['subjects/teacher']?.ceiling ? fmt(p.measures['subjects/teacher'].ceiling.value, 10) : ''}${p.madeUp ? `  ${p.madeUp} made up` : ''}`);
}

// Against another run: the difference on the pages both made real, and its 90% interval.
if (args.against) {
  const other = await load(args.against);
  console.log(`\nagainst ${args.against} (code ${other.info.commit}${other.info.dirty ? ' with changes' : ''}): the difference, and its 90% interval over pages drawn again; * where it holds no 0; decisions that did not change are left out`);
  console.log(`${'decision'.padEnd(24)} ${SPLITS.map((s) => s.padStart(26)).join('')}   (pages compared)`);
  // A fixed draw, so the same two runs give the same intervals.
  let seed = 7;
  const draw = (n) => {
    // mulberry32: integer arithmetic only, so it never loses bits to floating point.
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) / 2 ** 32) * n | 0;
  };
  // A score of the decision in force, and for odds, how well they rank whatever the line (AUC): a
  // question asked another way is judged by how it ranks, since a line can be moved for nothing.
  const measures = [
    ...run.all.map(({ name: decision, ref }) => ({ id: `${decision}/${ref}`, label: `${decision}/${ref}`, of: (m) => m.jev, score: scoreOf })),
    ...run.all.filter(({ line }) => line !== undefined).map(({ name: decision, ref }) => ({ id: `${decision}/${ref}`, label: `${decision}/${ref} AUC`, of: (m) => m.rows, score: (list) => auc(list.flat()) })),
  ];
  for (const { id, label, of, score } of measures) {
    const cells = SPLITS.map((split) => {
      const theirs = new Map(other.pages.filter((p) => p.split === split && p.measures[id] && of(p.measures[id])).map((p) => [p.id, of(p.measures[id])]));
      const both = run.pages.filter((p) => p.split === split && p.measures[id] && of(p.measures[id]) && theirs.has(p.id)).map((p) => [of(p.measures[id]), theirs.get(p.id)]);
      if (!both.length) return ''.padStart(26);
      const diff = (list) => score(list.map(([a]) => a)) - score(list.map(([, b]) => b));
      const spread = Array.from({ length: 2000 }, () => diff(both.map(() => both[draw(both.length)]))).filter(Number.isFinite).sort((a, b) => a - b);
      const d = diff(both);
      if (!Number.isFinite(d) || !spread.length) return ''.padStart(26);
      const [lo, hi] = [spread[Math.floor(0.05 * spread.length)], spread[Math.floor(0.95 * spread.length)]];
      const sure = lo > 0 || hi < 0;
      return `${d >= 0 ? '+' : ''}${d.toFixed(2)} [${lo.toFixed(2)},${hi.toFixed(2)}]${sure ? '*' : ' '} ${String(both.length).padStart(2)}p`.padStart(26);
    });
    if (cells.some((cell) => cell.trim()) && cells.some((cell) => !/\+0\.00 \[0\.00,0\.00\]/.test(cell) && cell.trim())) console.log(`${label.padEnd(24)} ${cells.join('')}`);
  }
}

if (args.save) {
  const round = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null);
  const out = { run: name, code: run.info.commit, splits: SPLITS, decisions: Object.fromEntries(Object.entries(card).map(([id, c]) => [id, { pages: c.pages, jev: c.jev.map(round), ceiling: c.ceiling.map(round), ofCeiling: round(c.share), ...(c.auc ? { auc: c.auc.map(round) } : {}) }])) };
  writeFileSync(join(import.meta.dirname, 'scorecard.json'), `${JSON.stringify(out, null, 1)}\n`);
  console.log('\nsaved to corpus/bench/scorecard.json');
}
