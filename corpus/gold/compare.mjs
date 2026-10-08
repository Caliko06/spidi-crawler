// Jev against a reader: texts written for this project, each with the verdict
// of the person who wrote it on every sentence, given while writing it and
// before Jev saw it, in `src/<id>.txt`:
//
//   # Title            ## Heading            - list item        a paragraph
//   {n}Sentence.       n is what a sparing reader does with it:
//                      0 passes over it, 1 detail, 2 key to its section,
//                      3 one of the main things the document says.
//   {3*}Sentence.      * is one of the handful the document is remembered by,
//   {3*^}Sentence.     ^ the one that says it all.
//
// A section whose items carry no mark is apparatus: the reader rules it out.
// Jev plans each text as it plans any page (its answers are kept in
// `judgements`, so a text already judged costs nothing), and what it kept,
// ruled out and called essential is set against the reader's. Level 1 is
// detail, either way is fine; what is held against Jev is leaving out what
// the reader called key (2 or 3) and keeping what the reader would pass over.
//
// When `topics/<id>.json` exists (a second reader's subjects and themes for
// the sentences, made without seeing Jev's), how Jev files the sentences both
// have is set against it by the adjusted Rand index of the two groupings,
// which does not mind what the groups are called: 1 for the same grouping, 0
// for what chance would give.
//
//   node corpus/gold/compare.mjs [id]

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { open, plan } from '../../lib/crawl.js';
import { createJev, readKey } from '../../lib/jev.js';
import { countWords, segment } from '../../lib/segment.js';

const HERE = import.meta.dirname;
const MARK = /\{([0-3])([*^]*)\}/g;
const flat = (text) => text.replace(/\s+/g, ' ').trim();
const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;');

// The page and the reader's verdicts from the text of a source.
export function build(source) {
  const verdicts = [];
  const tags = (line) => {
    const parts = line.split(MARK);
    let text = '';
    for (let i = 1; i < parts.length; i += 3) {
      const sentence = parts[i + 2].trim();
      verdicts.push({ text: flat(sentence), level: Number(parts[i]), prize: parts[i + 1].includes('*'), lead: parts[i + 1].includes('^') });
      text += `${text ? ' ' : ''}${sentence}`;
    }
    return text || line;
  };
  const html = source.split('\n').filter(Boolean).map((line) => {
    if (line.startsWith('## ')) return `<h2>${escape(line.slice(3))}</h2>`;
    if (line.startsWith('# ')) return `<h1>${escape(line.slice(2))}</h1>`;
    if (line.startsWith('- ')) return `<ul><li>${escape(tags(line.slice(2)))}</li></ul>`;
    return `<p>${escape(tags(line))}</p>`;
  }).join('\n');
  const apparatus = [];
  let heading;
  for (const line of source.split('\n')) {
    if (line.startsWith('## ')) heading = line.slice(3);
    else if (line.startsWith('- ') && !MARK.test(line) && heading && !apparatus.includes(heading)) apparatus.push(heading);
    MARK.lastIndex = 0;
  }
  return { page: `<!doctype html><html><head><title>${escape(source.match(/^# (.+)$/m)[1])}</title></head><body><article>${html}</article></body></html>`, verdicts, apparatus };
}

// Spearman's rank correlation of two lists.
function spearman(a, b) {
  const rank = (xs) => xs.map((x) => xs.filter((y) => y < x).length + (xs.filter((y) => y === x).length + 1) / 2);
  const [ra, rb] = [rank(a), rank(b)];
  const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const [ma, mb] = [mean(ra), mean(rb)];
  const cov = ra.reduce((s, x, i) => s + (x - ma) * (rb[i] - mb), 0);
  return cov / Math.sqrt(ra.reduce((s, x) => s + (x - ma) ** 2, 0) * rb.reduce((s, x) => s + (x - mb) ** 2, 0));
}

// Adjusted Rand index of two labellings of the same items.
function rand(a, b) {
  const pairs = (n) => (n * (n - 1)) / 2;
  const count = (keys) => keys.reduce((map, key) => map.set(key, (map.get(key) ?? 0) + 1), new Map());
  const joint = count(a.map((x, i) => `${x}\u0000${b[i]}`));
  const sum = (map) => [...map.values()].reduce((total, n) => total + pairs(n), 0);
  const [both, left, right] = [sum(joint), sum(count(a)), sum(count(b))];
  const expected = (left * right) / pairs(a.length);
  return (both - expected) / ((left + right) / 2 - expected);
}

// Homogeneity and completeness of grouping `a` against `b` (V-measure): 1 when
// every group of `a` holds one group of `b`; and when every group of `b` is
// whole in one group of `a`. A grouping that only splits another finer is
// complete but not homogeneous, and the other way round.
function purity(a, b) {
  const n = a.length;
  const count = (keys) => keys.reduce((map, key) => map.set(key, (map.get(key) ?? 0) + 1), new Map());
  const entropy = (map) => -[...map.values()].reduce((sum, c) => sum + (c / n) * Math.log(c / n), 0);
  const joint = count(a.map((x, i) => `${x}\u0000${b[i]}`));
  const [ha, hb, hab] = [entropy(count(a)), entropy(count(b)), entropy(joint)];
  return { homogeneity: hb === 0 ? 1 : 1 - (hab - ha) / hb, completeness: ha === 0 ? 1 : 1 - (hab - hb) / ha };
}

const pct = (n, of) => (of === 0 ? '—' : `${Math.round((100 * n) / of)}%`);
const clip = (text) => (text.length > 110 ? `${text.slice(0, 109)}…` : text);

if (import.meta.main) {
const ask = createJev({ key: await readKey(join(HERE, '../..')), dir: join(HERE, 'judgements'), limit: 0.25 });
const only = process.argv[2];
const ids = (await readdir(join(HERE, 'src'))).filter((name) => name.endsWith('.txt')).map((name) => name.slice(0, -4)).filter((id) => !only || id === only);
const total = { recall: [0, 0], strict: [0, 0], falseKeep: [0, 0], prizeHit: [0, 0], prizeKept: 0, prizeGold: 0 };
// Per page, how Jev's groupings agree with each reader, the readers with each other, and what the plan took.
const tally = [];
const mean = (key) => { const xs = tally.map((one) => one[key]).filter((x) => x !== undefined); return xs.length ? (xs.reduce((s, x) => s + x, 0) / xs.length).toFixed(2) : '—'; };

for (const id of ids) {
  const { page, verdicts, apparatus: ruledOutByReader } = build(await readFile(join(HERE, 'src', `${id}.txt`), 'utf8'));
  const doc = await open(page, `https://example.org/${id}`);
  const scores = new Map();
  const repeated = new Set(); // sentences Jev dropped for repeating another it kept
  // Kept answers are given at the pace Jev first gave them, so the time a plan takes is the time it would take live.
  let requests = 0, dollars = 0, sifted, early;
  const paced = (request) => ask.paced(request).then((one) => (requests++, (dollars += one.dollars), one.answers));
  const started = performance.now();
  const made = await plan(doc, paced, (event) => {
    if (event.type === 'sifted') sifted = (performance.now() - started) / 1000;
    if (event.type === 'early') early = (performance.now() - started) / 1000;
    if (event.type === 'distinct') for (const { block, start } of event.dropped) repeated.add(`${block}:${start}`);
    if (event.type === 'rated') for (const { block, start, score } of event.sentences) scores.set(`${block}:${start}`, score);
  });
  const took = { requests, dollars, sifted, early, whole: (performance.now() - started) / 1000 };
  const sentences = segment(doc.blocks);
  const byText = new Map(verdicts.map((one) => [one.text, one]));
  const heading = (section) => doc.blocks[section].text;
  const ruledOut = new Set(made.apparatus.map(heading));
  const keptKeys = new Map(made.kept.map((one) => [`${one.block}:${one.start}`, one]));

  // Every sentence of the text with the reader's verdict: marked ones by their words, those of a section the reader rules out as level 0.
  const rows = [];
  const unmatched = [];
  for (const sentence of sentences) {
    const gold = byText.get(flat(sentence.text)) ?? (ruledOutByReader.includes(heading(sentence.section)) ? { level: 0, prize: false, lead: false, apparatus: true } : null);
    if (!gold) { unmatched.push(sentence.text); continue; }
    const kept = keptKeys.get(`${sentence.block}:${sentence.start}`);
    rows.push({ ...sentence, gold, kept, repeated: repeated.has(`${sentence.block}:${sentence.start}`), prize: kept?.worth === 'prize', lead: kept?.lead, score: scores.get(`${sentence.block}:${sentence.start}`) });
  }
  const text = rows.filter(({ gold }) => !gold.apparatus);
  const key = text.filter(({ gold }) => gold.level >= 2);
  const central = text.filter(({ gold }) => gold.level === 3);
  const passed = text.filter(({ gold }) => gold.level === 0);
  const keptRows = rows.filter(({ kept }) => kept);
  const goldPrizes = rows.filter(({ gold }) => gold.prize);
  const prizes = rows.filter(({ prize }) => prize);
  const rated = text.filter(({ score }) => score !== undefined);

  console.log(`\n${id}: ${doc.title}`);
  if (unmatched.length) console.log(`  ${unmatched.length} sentences the reader did not mark (the splitter differs): ${unmatched.slice(0, 3).map(clip).join(' | ')}`);
  console.log(`  ruled out   Jev [${[...ruledOut].join(', ') || 'none'}]   reader [${ruledOutByReader.join(', ')}]`);
  console.log(`  kept        ${made.kept.length} sentences, ${pct(made.kept.reduce((s, { text }) => s + countWords(text), 0), made.kept.length ? doc.words : 1)} of the words; the reader's key (2, 3) are ${pct(key.reduce((s, { text }) => s + countWords(text), 0), doc.words)}`);
  const told = ({ kept, repeated }) => kept || repeated; // what a summary tells, itself or by what repeats it
  console.log(`  recall      key ${key.filter(told).length}/${key.length}   central ${central.filter(told).length}/${central.length}   (${key.filter(({ repeated }) => repeated).length} of the key told by a repeat)`);
  console.log(`  false keeps ${keptRows.filter(({ gold }) => gold.level === 0).length}/${keptRows.length} kept sentences are ones the reader passes over (${passed.length} such in the text, ${passed.filter(({ kept }) => kept).length} kept)`);
  console.log(`  essential   Jev ${prizes.length}, reader ${goldPrizes.length}, both ${prizes.filter(({ gold }) => gold.prize).length}; Jev's essential that the reader calls key ${prizes.filter(({ gold }) => gold.level >= 2).length}/${prizes.length}`);
  const lead = rows.find(({ lead }) => lead);
  console.log(`  lead        ${lead ? (lead.gold.lead ? 'the reader\'s' : `not the reader's (they called it ${lead.gold.level}): ${clip(lead.text)}`) : 'none'}`);
  if (rated.length > 2) console.log(`  rating      Spearman of Jev's rating with the reader's level ${spearman(rated.map(({ score }) => score), rated.map(({ gold }) => gold.level)).toFixed(2)}`);

  console.log(`  took        ${took.requests} requests, $${took.dollars.toFixed(3)}, ${took.sifted.toFixed(1)} s to read, ${took.early.toFixed(1)} s to set off, ${took.whole.toFixed(1)} s in all; subjects ${(took.whole - took.sifted).toFixed(1)} s`);
  const row = { subjects: took.whole - took.sifted, early: took.early, whole: took.whole, requests: took.requests, dollars: took.dollars };
  const readers = await Promise.all(['topics', 'third'].map((dir) => readFile(join(HERE, dir, `${id}.json`), 'utf8').then(JSON.parse, () => null)));
  readers.forEach((reader, r) => {
    if (!reader) return;
    const theme = (label) => reader.subjects[label]?.parent ?? label;
    const mine = new Map(reader.sentences.map(({ text, subject }) => [flat(text), subject]));
    const shared = made.kept.filter(({ text }) => mine.has(flat(text)));
    const jevSubject = (one) => made.topics[one.topic];
    const jevTheme = (one) => (made.parents[one.topic] === null ? made.topics[one.topic] : made.topics[made.parents[one.topic]]);
    const fallen = (one) => made.topics[made.folds[one.topic] ?? one.topic];
    const theirs = shared.map(({ text }) => mine.get(flat(text)));
    const name = r === 0 ? 'second' : 'third';
    console.log(`  ${name.padEnd(11)} ${shared.length} sentences both file; Jev ${new Set(made.kept.map(jevSubject)).size} subjects (${new Set(made.kept.map(fallen)).size} folded) in ${new Set(made.kept.map(jevTheme)).size} themes, the reader ${Object.keys(reader.subjects).length} in ${new Set(Object.keys(reader.subjects).map(theme)).size}`);
    const { homogeneity, completeness } = purity(shared.map(jevSubject), theirs);
    Object.assign(row, { [`${name}Subjects`]: rand(shared.map(jevSubject), theirs), [`${name}Folded`]: rand(shared.map(fallen), theirs), [`${name}Themes`]: rand(shared.map(jevTheme), theirs.map(theme)) });
    console.log(`              hold ${homogeneity.toFixed(2)}, keep whole ${completeness.toFixed(2)}; adjusted Rand subjects ${row[`${name}Subjects`].toFixed(2)}, folded ${row[`${name}Folded`].toFixed(2)}, themes ${row[`${name}Themes`].toFixed(2)}`);
    if (process.env.GROUPS) for (const one of shared) console.log(`    [${fallen(one)}] vs [${mine.get(flat(one.text))}]  ${clip(one.text).slice(0, 70)}`);
  });
  // How far two readers agree is as far as Jev can be asked to.
  if (readers[0] && readers[1]) {
    const [a, b] = readers.map((reader) => new Map(reader.sentences.map(({ text, subject }) => [flat(text), subject])));
    const both = [...a.keys()].filter((text) => b.has(text));
    const themeOf = (reader, label) => reader.subjects[label]?.parent ?? label;
    Object.assign(row, { readersSubjects: rand(both.map((t) => a.get(t)), both.map((t) => b.get(t))), readersThemes: rand(both.map((t) => themeOf(readers[0], a.get(t))), both.map((t) => themeOf(readers[1], b.get(t)))) });
    console.log(`  readers     with each other: adjusted Rand subjects ${row.readersSubjects.toFixed(2)}, themes ${row.readersThemes.toFixed(2)}`);
  }
  tally.push(row);

  const show = (label, list) => list.length && console.log(`  ${label}\n${list.map((row) => `    [${row.gold.level}${row.gold.prize ? '*' : ''}${row.score === undefined ? '' : ` j${row.score.toFixed(1)}`}] ${clip(row.text)}`).join('\n')}`);
  show('KEY LEFT OUT (the reader called it 2 or 3)', key.filter((row) => !told(row)));
  show('KEPT THOUGH THE READER PASSES OVER IT', keptRows.filter(({ gold }) => gold.level === 0));
  show('ESSENTIAL FOR JEV ONLY', prizes.filter(({ gold }) => !gold.prize));
  show('ESSENTIAL FOR THE READER ONLY', goldPrizes.filter(({ prize }) => !prize));

  total.recall[0] += key.filter(told).length; total.recall[1] += key.length;
  total.strict[0] += central.filter(told).length; total.strict[1] += central.length;
  total.falseKeep[0] += keptRows.filter(({ gold }) => gold.level === 0).length; total.falseKeep[1] += keptRows.length;
  total.prizeHit[0] += prizes.filter(({ gold }) => gold.prize).length; total.prizeHit[1] += prizes.length;
  total.prizeKept += prizes.length; total.prizeGold += goldPrizes.length;
}
console.log(`\nJev was asked ${ask.live.requests} requests now, $${ask.live.dollars.toFixed(2)}.`);
console.log(`Subjects, adjusted Rand: Jev–second ${mean('secondSubjects')} (folded ${mean('secondFolded')}), Jev–third ${mean('thirdSubjects')} (folded ${mean('thirdFolded')}), second–third ${mean('readersSubjects')}`);
console.log(`Themes, adjusted Rand: Jev–second ${mean('secondThemes')}, Jev–third ${mean('thirdThemes')}, second–third ${mean('readersThemes')}`);
console.log(`A plan: ${mean('requests')} requests, $${mean('dollars')}, ${mean('early')} s to set off, ${mean('whole')} s in all, ${mean('subjects')} s of them after the reading`);
console.log(`All: key recall ${pct(...total.recall)}, central recall ${pct(...total.strict)}, false keeps ${pct(...total.falseKeep)}, essential precision ${pct(...total.prizeHit)} (Jev ${total.prizeKept}, reader ${total.prizeGold})`);

}
