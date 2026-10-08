// Triage: what of a document the crawler keeps. Every decision here is Jev's.
// It surveys the document's sections and rules out those that are the page's
// apparatus. It reads the rest a passage at a time, a passage being a
// paragraph and the list it opens: it rates every sentence on what a sparing
// reader does with it, and says of every sentence which earlier one it needs
// to be understood, if any.
//
// What is kept is what Jev rates as key or more, and what that needs, but for
// what Jev says a reader passes over. No
// number here says how much is kept: a document that says much in few words
// keeps more of its sentences than one that says little at length, because
// Jev rates them so. Of what is kept across the document Jev says which
// sentences repeat one another, and which few a reader would remember it by.
//
// Jev only answers typed questions with probabilities, each question on its
// own. A rating is read as its mean over the levels, and a sentence is key
// when that reaches `KEY`.

import { askAll } from './jev.js';
import { boolean, choice, fit, keyed, quote, score } from './questions.js';
import { LINES } from './lines.js';
import { where } from './segment.js';

const OPENING_WORDS = 60; // of a section, what Jev is shown of it to tell what it is
const GIST_WORDS = 120; // of the document's text, what Jev is shown with every passage to tell what the document is about
const ASKING = 16; // sections put to Jev at once, under the 80 requests a second jev-1.13 allows
const OPTIONS = 255; // the most a choice can be between
const WHOLE = 20_000; // tokens of what is kept that a question about the whole document is shown at most
export const PASSED = LINES.passed.at; // Jev's rating below which a sentence is one the reader passes over
export const KEY = LINES.keep.at; // its rating from which a sentence is key

// What a section of a page can be, each told from the other.
const PART = {
  text: {
    what: 'Text of the document: its exposition, argument, findings, rules, instructions, story or examples.',
    not_for: 'Lists of references, links, notices or contact details around the text.',
  },
  apparatus: {
    what: 'Apparatus around the text: references, citations, footnotes, a bibliography, lists of links to other pages, a table of contents, navigation, legal, licence or copyright notices, contact details, or promotion of other content.',
    not_for: 'Exposition, argument, findings, rules, instructions, story or examples, however short.',
  },
};

const partQuestion = (section) => choice({ question: 'What is `section` of this document?', section }, PART);

// What a sparing reader does with a sentence, from least to most. Jev judges
// each level on its own, without the others (docs.typesafe.ai/primitives/score),
// so each says the whole situation.
const STANDING = [
  'The reader passes over it: a transition, setup, aside, example, minor detail, citation or boilerplate.',
  'Only a reader who highlights everything marks it: a supporting fact or explanation that a skimmer could do without.',
  'The reader highlights it: it states the fact, claim, rule or result that its section is there to tell.',
  'The reader highlights it and would keep it in a summary of the whole document: it states one of the main things the document is about, as the document opens by saying.',
];

// A question about a sentence quotes it: Jev reads a sentence pointed at by
// a path of two steps (\`section.passages[2][4]\`) far worse (measured
// 2026-10-07 on 2,019 sentences: AUC .81 against .91 quoted).
const standingQuestion = ({ text }) => score({ question: 'A careful reader is highlighting this document sparingly. What does the reader do with `sentence`?', sentence: text }, STANDING);

const needsQuestion = ({ text }, earlier) => choice(
  { question: '`sentence` may point back at something it does not name itself, with a pronoun or a demonstrative ("it", "this", "they", "such", "these"), or be an item of a list that an earlier sentence opens. Which of these earlier sentences does a reader need quoted with it to tell what it is talking about?', sentence: text },
  { ...keyed('s', earlier.map(({ text }) => quote(text))), none: 'None: it names what it is talking about itself.' },
);

// The earlier sentences of a passage that a sentence can lean on: those of
// the paragraph, and for an item of the list the paragraph opens, the item
// before it too; an item does not lean on the items before that.
const leanable = (own, place, isItem) => [...Array(place).keys()].filter((j) => !isItem(own[j]) || j === place - 1);

const sameQuestion = (a, b) => boolean({ question: `Do \`sentences[${a}]\` and \`sentences[${b}]\` tell the reader the same thing, so that a reader who has read one learns nothing new from the other?` });

const prizeQuestion = ({ text }) => boolean({ question: 'Is `sentence` one of the sentences that say what the document in `kept` is chiefly about, so that a reader who remembers it remembers one of its main points?', sentence: text });

const leadQuestion = (sentences) => choice({ question: 'Which of these sentences comes closest to saying, alone, what the whole document says?' }, keyed('s', sentences.map(({ text }) => quote(text))));

const outlineOf = (blocks) => blocks.filter(({ kind }) => kind === 'h2' || kind === 'h3').map(({ text }) => text);

// The survey: the sections Jev takes for apparatus, as a set of the indexes of
// their headings. Their sentences are not put to it, and nothing of them is
// kept. What comes under the title alone has no heading to be told by, and is
// always read.
export async function survey({ title, blocks }, sentences, ask) {
  const questions = {};
  for (const [section, own] of Map.groupBy(sentences, ({ section }) => section)) {
    if (blocks[section].kind === 'h1') continue;
    const opens = own.map(({ text }) => text).join(' ').split(/\s+/).slice(0, OPENING_WORDS).join(' ');
    questions[`part${section}`] = partQuestion({ heading: blocks[section].text, opens });
  }
  const names = Object.keys(questions);
  if (names.length === 0) return new Set();
  const answers = await askAll(ask, { document: title, sections: outlineOf(blocks) }, questions);
  return new Set(names.filter((name) => answers[name].probabilities.apparatus >= LINES.apparatus.at).map((name) => Number(name.slice('part'.length))));
}

// The passages of the text, as runs of consecutive sentence indexes: a
// paragraph each, with the list it opens.
function passages(sentences, blocks) {
  const runs = [];
  sentences.forEach((sentence, i) => {
    const before = sentences[i - 1];
    const listed = before && blocks[sentence.block].kind === 'li' && sentence.section === before.section;
    if (i === 0 || (sentence.block !== before.block && !listed)) runs.push([]);
    runs.at(-1).push(i);
  });
  return runs;
}

// The questions about one passage, `own` its sentences, the `r`th of its
// section: what a reader does with each sentence, and what each leans on.
// Questions are named by the passage's place in its section and the
// sentence's in the passage, so a section is put to Jev the same way
// whatever comes before it in the document, and the answer kept for it
// stays good when another part of the document changes.
function passageQuestions(own, r, isItem) {
  const questions = {};
  own.forEach((sentence, place) => {
    questions[`standing${r}_${place}`] = standingQuestion(sentence);
    const earlier = leanable(own, place, isItem);
    if (place > 0) questions[`needs${r}_${place}`] = needsQuestion(sentence, earlier.map((j) => own[j]));
  });
  return questions;
}

// Jev's reading of one passage, `own` its sentences, the `r`th of its
// section, from its `answers`: for each sentence, its `score` and the place
// in the passage of the sentence it `needs`, or null, and whether it is
// `kept`: it is rated key or more, or a kept sentence needs it. `tell` is
// told the ratings (`rated`) and then what of the passage is kept (`read`),
// with its `first` sentence, how many it has, `of`, and how `doubt`ful Jev
// is of where it cut: 0 when every sentence is far from the line between key
// and not, 1 when one is on it.
function readPassage(own, r, answers, tell, isItem) {
  const standing = (place) => answers[`standing${r}_${place}`];
  const score = own.map((_, place) => standing(place).score);
  // A sentence needs another unless Jev says it names what it is talking
  // about itself, by the line `alone`: the earlier sentence it needs is
  // the likeliest of the others.
  const leans = own.map((_, place) => {
    const answer = answers[`needs${r}_${place}`];
    if (!answer) return { alone: 1, at: null, p: null };
    const [name, p] = Object.entries(answer.probabilities).filter(([option]) => option !== 'none').sort(([, a], [, b]) => b - a)[0] ?? [null, 0];
    return { alone: answer.probabilities.none, at: name && leanable(own, place, isItem)[Number(name.slice(1))], p };
  });
  const needs = leans.map(({ alone, at }) => (alone >= LINES.alone.at ? null : at));
  // What Jev worked out of every sentence is told: its rating, as the probability of each level and their mean, and what it leans on.
  tell({
    type: 'rated',
    sentences: own.map((sentence, place) => ({
      ...where(sentence),
      score: score[place],
      levels: [0, 1, 2, 3].map((level) => standing(place).probabilities[level] ?? 0),
      leans: { alone: leans[place].alone, p: leans[place].p, at: leans[place].at === null ? null : where(own[leans[place].at]) },
    })),
  });
  // The kept come with what they need, and so on back, short of a sentence
  // that Jev says a reader passes over.
  const kept = new Set();
  own.forEach((_, place) => {
    if (score[place] < KEY) return;
    for (let at = place; at !== null && !kept.has(at) && (at === place || score[at] >= PASSED); at = needs[at]) kept.add(at);
  });
  const doubt = Math.max(...score.map((one) => Math.max(0, 1 - Math.abs(one - KEY) / KEY)));
  tell({ type: 'read', first: where(own[0]), sentences: own.map(where), of: own.length, kept: own.flatMap((sentence, place) => (kept.has(place) ? [where(sentence)] : [])), doubt });
  return { score, needs, kept };
}

// Jev's reading of every sentence: `[{ score, needs, kept }]`, `needs` the
// index of the sentence it cannot be understood without, or null. Jev reads
// a section at a time, its passages side by side, with what the document is
// called, its sections and how it opens. `ask` puts one `{ state, questions }`
// to Jev and resolves to its answers. `tell` is told how many `passages`
// there are, and of each when it is `reading` it, with what readPassage tells.
export async function sift({ title, blocks }, sentences, ask, tell) {
  const outline = outlineOf(blocks);
  const gist = sentences.map(({ text }) => text).join(' ').split(/\s+/).slice(0, GIST_WORDS).join(' ');
  const runs = passages(sentences, blocks);
  tell({ type: 'passages', count: runs.length });
  const isItem = ({ block }) => blocks[block].kind === 'li';
  const sections = [...Map.groupBy(runs, (run) => sentences[run[0]].section).entries()];
  const readings = [];
  let next = 0;
  const worker = async () => {
    while (next < sections.length) {
      const [section, own] = sections[next++];
      const state = {
        document: { title, sections: outline, opens: gist },
        section: { heading: blocks[section].kind === 'h1' ? null : blocks[section].text, passages: own.map((run) => run.map((i) => sentences[i].text)) },
      };
      for (const run of own) tell({ type: 'reading', sentences: run.map((i) => sentences[i]).map(({ block, start, end }) => ({ block, start, end })) });
      const answers = await askAll(ask, state, Object.assign({}, ...own.map((run, r) => passageQuestions(run.map((i) => sentences[i]), r, isItem))));
      own.forEach((run, r) => {
        const { score, needs, kept } = readPassage(run.map((i) => sentences[i]), r, answers, tell, isItem);
        run.forEach((i, place) => (readings[i] = { score: score[place], needs: needs[place] === null ? null : run[needs[place]], kept: kept.has(place) }));
      });
    }
  };
  await Promise.all(Array.from({ length: ASKING }, worker));
  return readings;
}

// What Jev is shown to judge what is kept as a whole: the document's title
// and sections, and what is kept of it, its best rated sentences when all of
// it would be too much to read with a question. `place` is where each kept
// sentence shown stands in the state's `kept`, by its index in `kept`.
export function summaryOf({ title, blocks }, kept) {
  const shown = new Set(fit(kept, WHOLE, ({ score }) => score ?? 0));
  const order = kept.flatMap((sentence, i) => (shown.has(sentence) ? [i] : []));
  return { state: { document: { title, sections: outlineOf(blocks) }, kept: order.map((i) => kept[i].text) }, place: new Map(order.map((i, k) => [i, k])) };
}

// Of the `kept` sentences, each `{ text, score, topic, needs }` with `needs`
// the kept sentence it cannot be understood without, those that do not repeat
// another. Two sentences can only repeat each other under one subject; of two
// that do, the better rated stays, the earlier of two rated alike, and so does
// one that another needs.
export async function distinct(doc, kept, ask, tell = () => {}) {
  const pairs = [...Map.groupBy(kept, ({ topic }) => topic).values()].flatMap((own) => own.flatMap((a, i) => own.slice(i + 1).map((b) => [a, b])));
  if (pairs.length === 0) return kept;
  // Two sentences are set side by side with the others of their subject, and nothing else.
  const answers = {};
  for (const own of Map.groupBy(pairs.map((pair, i) => [pair, i]), ([[a]]) => a.topic).values()) {
    const sentences = [...new Set(own.flatMap(([pair]) => pair))];
    const state = { document: doc.title, sentences: sentences.map(({ text }) => text) };
    Object.assign(answers, await askAll(ask, state, Object.fromEntries(own.map(([[a, b], i]) => [`same${i}`, sameQuestion(sentences.indexOf(a), sentences.indexOf(b))]))));
  }
  // Every pair Jev found alike at all, and how alike.
  tell({ type: 'alike', pairs: pairs.flatMap(([a, b], i) => (answers[`same${i}`].probability >= 0.2 ? [{ a: where(a), b: where(b), p: answers[`same${i}`].probability }] : [])) });
  const needed = new Set(kept.map(({ needs }) => needs));
  const dropped = new Set();
  pairs
    .map(([a, b], i) => ({ a, b, same: answers[`same${i}`].probability }))
    .filter(({ same }) => same >= LINES.repeat.at)
    .sort((x, y) => y.same - x.same)
    .forEach(({ a, b }) => {
      if (dropped.has(a) || dropped.has(b)) return;
      const lesser = [a, b].filter((sentence) => !needed.has(sentence)).sort((x, y) => x.score - y.score || y.at - x.at)[0];
      if (lesser) dropped.add(lesser);
    });
  return kept.filter((sentence) => !dropped.has(sentence));
}

// The worth of each of the `kept` sentences: 'prize' for those Jev says are
// among the few a reader would remember the document by, by the line
// `essential`; 'catch' for the rest; and which one is the `lead`, the
// document in one sentence, Jev's pick among the prizes. Returns `[{ worth, lead, odds, rank }]`, `odds` how likely a
// sentence is to be a prize and `rank` its place by that.
export async function crown(doc, kept, ask) {
  const { state } = summaryOf(doc, kept);
  const answers = await askAll(ask, state, Object.fromEntries(kept.map((sentence, i) => [`prize${i}`, prizeQuestion(sentence)])));
  const odds = kept.map((_, i) => answers[`prize${i}`].probability);
  const order = kept.map((_, i) => i).sort((a, b) => odds[b] - odds[a]);
  const prizes = order.filter((i) => odds[i] >= LINES.essential.at).slice(0, OPTIONS);
  // Of a document Jev finds no main point in, the lead is the sentence likeliest to be one.
  const lead = prizes.length > 1 ? prizes[Number((await askAll(ask, state, { lead: leadQuestion(prizes.map((i) => kept[i])) })).lead.choice.slice(1))] : prizes[0] ?? order[0];
  return kept.map((_, i) => ({ worth: prizes.includes(i) ? 'prize' : 'catch', lead: i === lead, odds: odds[i], rank: order.indexOf(i) + 1 }));
}
