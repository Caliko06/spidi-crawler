// Has Jev judge every page of the corpus, and of the trials, and keeps its
// answers in each set's judgements, where the reader finds them for the
// corpus, and what it made of each page in the set's plans: the share kept,
// the themes with the subjects under them, the subjects with their sentences,
// how the subjects are joined and which sentences pull on one another. A
// plan that changes shows in `git diff corpus/plans corpus/trials/plans`.
// The corpus is what the reader offers; the trials are pages of every other
// kind, kept to see how Jev does with what it has not met. To be run when
// what is asked of Jev changes, or when a page is added. Only what it has not
// been asked before is asked, question by question; answers to what is no
// longer asked are kept, so going back to it costs nothing. Last, it says of
// every page what breaks the rules of a plan.
//
//   node corpus/judge.mjs

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { read } from '../lib/crawl.js';
import { createJev, readKey } from '../lib/jev.js';
import { countWords } from '../lib/segment.js';

const ROOT = join(import.meta.dirname, '..');
const SETS = ['corpus', 'corpus/trials', 'corpus/heldout'];
const THEMES = { least: 3, most: 8 }; // themes a plan opens the web on, the title among them

const key = await readKey(ROOT);
const flagged = [];
const spent = { requests: 0, dollars: 0 };

for (const set of SETS) {
  const dir = join(ROOT, set, 'judgements');
  const plans = join(ROOT, set, 'plans');
  const ask = createJev({ key, dir, limit: 0.25 });
  await mkdir(plans, { recursive: true });

  for (const { id, url } of JSON.parse(await readFile(join(ROOT, set, 'index.json'), 'utf8'))) {
    let plan;
    try {
      const { title, words, topics, parents, links, kept, pulls } = await read(await readFile(join(ROOT, set, 'pages', `${id}.html`), 'utf8'), url, ask);
      const keptWords = kept.reduce((sum, { text }) => sum + countWords(text), 0);
      const filed = (i) => kept.filter((sentence) => sentence.topic === i).length;
      const heads = topics.flatMap((_, i) => (parents[i] === null ? [i] : []));
      plan = {
        title,
        kept: `${keptWords} of ${words} words (${Math.round((100 * keptWords) / words)}%), ${kept.length} sentences`,
        themes: Object.fromEntries(heads.map((i) => [`${topics[i]} (${filed(i)})`, topics.flatMap((_, j) => (parents[j] === i ? [`${topics[j]} (${filed(j)})`] : []))])),
        subjects: Object.fromEntries(topics.map((topic, i) => [topic, kept.filter((sentence) => sentence.topic === i).map(({ text, worth, lead }) => `${lead ? 'LEAD ' : worth === 'prize' ? 'PRIZE ' : ''}${text}`)])),
        links: links.map(({ a, b, weight }) => `${topics[a]} — ${topics[b]} ${weight.toFixed(2)}`),
        pulls: pulls.map(({ a, b, weight }) => `${weight.toFixed(2)} ${kept[a].text.slice(0, 60)} — ${kept[b].text.slice(0, 60)}`),
      };
      // What breaks the rules of a plan.
      const rules = [];
      if (topics.length > THEMES.least && (heads.length < THEMES.least || heads.length > THEMES.most)) rules.push(`${heads.length} themes`);
      if (!topics.includes(title)) rules.push('the title is no subject');
      else if (parents[topics.indexOf(title)] !== null) rules.push('the title is under a theme');
      for (const [j, parent] of parents.entries()) if (parent !== null && parents[parent] !== null) rules.push(`"${topics[j]}" is under "${topics[parent]}", no theme`);
      for (const i of heads) if (filed(i) === 0 && !parents.includes(i)) rules.push(`theme "${topics[i]}" holds nothing`);
      if (rules.length) flagged.push(`${set}/${id}: ${rules.join('; ')}`);
      console.log(`${set}/${id}: ${plan.kept}, ${heads.length} themes over ${topics.length} subjects, ${links.length} links, ${pulls.length} pulls`);
    } catch (error) {
      plan = { error: error.message };
      flagged.push(`${set}/${id}: ${error.message}`);
      console.log(`${set}/${id}: ${error.message}`);
    }
    await writeFile(join(plans, `${id}.json`), `${JSON.stringify(plan, null, 1)}\n`);
  }

  spent.requests += ask.live.requests;
  spent.dollars += ask.live.dollars;
}

console.log(`\nJev was asked ${spent.requests} requests now, $${spent.dollars.toFixed(2)}; what was kept cost nothing.`);
console.log(flagged.length ? `\n${flagged.length} pages break a rule:\n${flagged.join('\n')}` : '\nEvery plan keeps the rules.');
