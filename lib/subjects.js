// Subjects: what the kept sentences are about, and how those subjects bear
// on one another. Every decision here is Jev's. It names what each sentence
// is about, in the words of the page; it says which of those names are
// subjects of the document and which two of them are one subject; it files
// every sentence under a subject and is then asked, the other way round,
// whether the sentence belongs there; and it says of every two subjects
// which other has the most to do with each, and how much.
//
// Jev writes nothing, so every name is a term of the page. No number here
// says how many subjects a document has: it has those Jev takes for subjects.

import { askAll } from './jev.js';
import { boolean, choice, keyed, listed, placeOf, quote, score, tokens } from './questions.js';
import { LINES } from './lines.js';
import { fold } from './topics.js';
import { summaryOf } from './triage.js';

const OPTIONS = 255; // the most a choice can be between
const SHORTLIST = 3; // subjects Jev is asked, one by one, whether a sentence belongs under: those it files it under most readily
const EXAMPLES = 2; // sentences Jev is shown of what a name stands for
const THEMES = { least: 2, first: 5, most: 7 }; // besides what the document is called: the fewest subjects it is built on, the most picked before the others are put under them, and the most of all
const CROWD = 4; // subjects gathered under one theme at which Jev is asked for a theme among them
const NOTES = 20_000; // tokens of the notes on the document that a question about how its subjects bear on one another is shown at most
const MUCH = 0.5; // the weight of a bond from which two subjects are said to have much to do with each other: what rounds to the third level of four
const STEM = 4; // letters a word has to have to tell, inside another, that the two names could be one

// A subject as Jev is shown it: its name and some of what is said under it.
const page = (name, holds, most = EXAMPLES) => ({ name, holds: holds.slice(0, most) });

const nameQuestion = ({ text }, forms) => choice({ question: 'A reader files `sentence` in their notes under the thing it tells them about. Which of these names that thing?', sentence: text }, keyed('t', forms.map(quote)));

const subjectQuestion = (candidate) => boolean({ question: 'Is `candidate.name` a subject this document explains, a thing, idea, rule or method a reader would look up by that name? A generic word, a quality, or something `candidate.holds` only mentions in passing is not.', candidate });

// A section's heading as the name of a subject: whether the section is about
// a thing a reader would look up by its heading, or only frames the text.
const sectionQuestion = (section) => boolean({ question: 'A reader keeps notes on this document, a page for each subject it explains. Should `section.name` be one of those pages, holding what `section.holds` say: is it a thing, idea, rule, method, event or finding of the document that a reader would look up by that name? A heading that only frames the text, as "Overview", "Introduction", "Background", "Details" or "Summary" do, is not, nor is one whose sentences only elaborate a subject named elsewhere.', section });

const headingQuestion = (labels) => choice({ question: 'These names all name one subject of the document. Which of them would a reader look it up by?' }, keyed('t', labels.map(quote)));

const aliasQuestion = (first, second) => boolean({ question: 'Do `first.name` and `second.name` name the same subject of this document: one is another name, an abbreviation, a longer or shorter form, or another form of the same words, as "recruit" and "recruiting users manually" are? A kind, a part or an aspect of the other is a subject of its own.', first, second });

// Each subject is named by its place in `subjects`, where it is shown with
// some of what it holds. Offering the subjects themselves as the options
// (name and sentences) picked better alone, but filed worse once the
// sentence's page is checked with `belongs` (measured 2026-10-07: ARI
// against the teacher .32 tuning, .24 held out, against .41 and .27).
const filingQuestion = ({ text }, count) => choice({ question: 'Which of these subjects of `subjects` is `sentence` mainly about?', sentence: text }, listed('subjects', [...Array(count).keys()]));

const wholeQuestion = ({ text }, label) => choice({ question: 'Is `sentence` about the document as a whole, or mainly about `subject`?', sentence: text, subject: label }, { whole: 'The document as a whole.', own: `Mainly ${quote(label)}.` });

const belongsQuestion = ({ text }, subject) => boolean({ question: 'Does `sentence` tell the reader about `subject.name` itself, so that it is one of the sentences a page of notes on it is there to hold, as `subject.holds` are, rather than only mention it on the way to something else?', sentence: text, subject });

// Options are quoted, never named by their place in a list: so named, in
// lists of more than a few, Jev answers nearly at random (measured
// 2026-10-07: the likeliest option's share fell from .67 to .43 for
// `closest`, from .50 to .12 for `nearest`).
const themeQuestion = (offered, picked, enough) => choice(
  { question: 'The notes in `pages` are to be kept as a few main pages, each gathering the smaller subjects that belong to it. Which of these subjects should be the next main page: one of the pillars the document is built on, which other subjects are parts, kinds, means or details of?', main_pages_so_far: picked },
  { ...keyed('t', offered.map(quote)), ...(enough ? { none: 'None: the rest are parts or details of the main pages already chosen.' } : {}) },
);

// What the document is called is offered for what is part of none of the other main pages.
const parentQuestion = (label, heads, title) => choice(
  { question: '`subject` is a smaller subject of the notes in `pages`, kept under one of their main pages. Which main page does it belong under: which is it most a part, a kind, a means, a detail or a consequence of?', subject: label },
  keyed('t', heads.map((head) => (head === title ? `${quote(title)} as a whole: it is part of none of the other main pages in particular.` : quote(head)))),
);

// How much two subjects of a document have to do with each other, from least to most.
const BOND = [
  'Nothing: the document says nothing that joins them.',
  'Little: they come up together, but learning about one tells the reader little about the other.',
  'Much: one is a part, a kind, a cause, a means or a consequence of the other, and learning about one helps the reader with the other.',
  'Everything: a reader cannot understand one without the other.',
];

const closestQuestion = (label, others) => choice({ question: 'Which of these subjects of the notes in `pages` has the most to do with `subject`: is a part, a kind, a cause, a means or a consequence of it, so that a reader who learns about one is helped most by the other?', subject: label }, { ...keyed('t', others.map(quote)), none: 'None of them has anything to do with it.' });

const bondQuestion = (first, second) => score({ question: 'In this document, how much do `first.name` and `second.name` have to do with each other?', first, second }, BOND);

// How much what two sentences say has to do with each other, from least to most.
const PULL = [
  'Nothing: neither tells the reader anything about what the other says.',
  'Little: they touch the same thing, but one adds little to the other.',
  'Much: one explains, causes, illustrates, qualifies, answers or follows from the other.',
  'Everything: a reader cannot understand one without the other.',
];

const nearestQuestion = ({ text }, others) => choice({ question: 'Which of these sentences, filed under other subjects of the document, has the most to do with `sentence`: explains, causes, illustrates, qualifies, answers or follows from what it says?', sentence: text }, { ...keyed('s', others.map(({ text }) => quote(text))), none: 'None of them has anything to do with it.' });

const pullQuestion = (first, second) => score({ question: 'How much does what `first` says have to do with what `second` says?', first, second }, PULL);

// The kept sentences of each section, as Jev is shown them to tell of one of
// them what it is about: the document, the section's heading and its
// sentences in order, so the one asked about is read with its neighbours.
// Calls `each(state, own)` for every section, `own` the indexes into `kept`.
const bySection = (doc, kept, each) => Promise.all([...Map.groupBy(kept.map((_, i) => i), (i) => kept[i].section).values()].map((own) => {
  const { kind, text } = doc.blocks[kept[own[0]].section];
  return each({ document: doc.title, ...(kind === 'h1' ? {} : { section: text }), sentences: own.map((i) => kept[i].text) }, own);
}));

// What each of the `kept` sentences is about, in its own words: the term
// Jev picks, `{ key, form }`, among those of the sentence and of the heading
// it comes under, or null for a sentence with no term to be called by.
export async function name(doc, kept, termsOf, ask) {
  const { blocks } = doc;
  // A term of the sentence and the same term in its heading are one.
  const terms = kept.map(({ text, section }) => [...new Map(termsOf(blocks[section].kind === 'h1' ? text : `${text}. ${blocks[section].text}`).map((term) => [term.key, term])).values()].slice(0, OPTIONS));
  // A choice is between two things at least.
  const answers = {};
  await bySection(doc, kept, async (state, own) => Object.assign(answers, await askAll(ask, state, Object.fromEntries(own.flatMap((i) => (terms[i].length > 1 ? [[`name${i}`, nameQuestion(kept[i], terms[i].map(({ form }) => form))]] : []))))));
  // Each sentence's term, with the likeliest names Jev weighed for it.
  return kept.map((_, i) => {
    const answer = answers[`name${i}`];
    const term = answer ? terms[i][Number(answer.choice.slice(1))] : terms[i][0] ?? null;
    const options = answer ? Object.entries(answer.probabilities).sort(([, a], [, b]) => b - a).slice(0, 3).map(([key, p]) => ({ form: terms[i][Number(key.slice(1))].form, p })) : [];
    return term && { ...term, options };
  });
}

// The subjects of what is `kept`, `{ labels, holds, home, outline }`: their
// labels, the one more sentences are named by first, and the sentences named
// by each. A document with headings has filed its sentences already: the
// structure its writer gave it agrees with a careful editor's notes far more
// than names found sentence by sentence (measured 2026-10-07 against the
// blind teacher: ARI .72 tuning, .66 held out, where those names gave .41
// and .23, and two passes of the teacher agree at .75 and .66). So each
// heading the kept sentences come under is a subject when Jev takes it for
// one, and it is their `home`: `home` maps a section to the subject its
// sentences are filed under, that of its own heading or, for a heading Jev
// does not take, of the heading above it. `outline[i]` is the subject the
// heading of `labels[i]` comes under, null for one that comes under no
// other, undefined for a subject that is not a heading. What can be a
// subject besides is what the sentences were given for
// `names`; one of those is a subject when Jev takes it for one. Two of them
// are one subject when Jev says so, the way records are resolved into
// entities: only names that share a word are put to it, two at a time, and
// every name with what the document is called, which may be spelled another
// way ("Ciberpunk", "cyberpunk"); what is the same as the same is one; Jev picks the heading of each such
// subject among its names. What the document is
// called is a subject of it whatever Jev says: it is where what is said of the
// whole of it belongs. `tell` is told the `candidates`, which of them are
// `taken`, which headings are, `headings`, and which are one, `merged`.
export async function subjects(doc, kept, names, ask, tell) {
  const { title, blocks } = doc;
  const state = { document: { title, sections: blocks.filter(({ kind }) => kind === 'h2' || kind === 'h3').map(({ text }) => text) } };
  const texts = ({ sentences }) => sentences.map(({ text }) => text);
  const wordsOf = (label) => label.split(/\s+/).map(fold);

  const headed = [...Map.groupBy(kept.filter(({ section }) => blocks[section].kind !== 'h1'), ({ section }) => section)];
  // A heading that holds nothing kept of its own but the headings under it is asked about too, shown what they hold.
  const over = [...Map.groupBy(headed.filter(([section]) => above(blocks, section) !== undefined && !headed.some(([other]) => other === above(blocks, section))), ([section]) => above(blocks, section))].map(([section, under]) => [section, under.flatMap(([, own]) => own), true]);
  const asked = [...headed, ...over];
  const titled = await askAll(ask, state, Object.fromEntries(asked.map(([section, own]) => [`section${section}`, sectionQuestion(page(blocks[section].text, own.map(({ text }) => text)))])));
  tell({ type: 'headings', headings: asked.map(([section]) => ({ label: blocks[section].text, p: titled[`section${section}`].probability })) });
  const headings = asked.filter(([section]) => titled[`section${section}`].probability >= LINES.section.at).map(([section, own, bare]) => ({ label: blocks[section].text, words: wordsOf(blocks[section].text), sentences: bare ? [] : own, sections: [section] }));
  const byName = new Map(headings.map((heading) => [heading.label.toLowerCase(), heading]));

  // A name that is a heading's is that heading's subject, with no question.
  const named = new Map();
  names.forEach((term, i) => {
    if (!term || term.form.toLowerCase() === title.toLowerCase()) return;
    const heading = byName.get(term.form.toLowerCase());
    if (heading) return heading.sentences.includes(kept[i]) || heading.sentences.push(kept[i]);
    if (!named.has(term.key)) named.set(term.key, { label: term.form, words: term.words, sentences: [] });
    named.get(term.key).sentences.push(kept[i]);
  });
  const terms = [...named.values()].sort((a, b) => b.sentences.length - a.sentences.length).slice(0, OPTIONS - 1);
  tell({ type: 'candidates', terms: terms.map(({ label, sentences }) => ({ label, count: sentences.length })) });

  const taken = await askAll(ask, state, Object.fromEntries(terms.map((term, i) => [`subject${i}`, subjectQuestion(page(term.label, texts(term)))])));
  tell({ type: 'taken', terms: terms.map(({ label }, i) => ({ label, p: taken[`subject${i}`].probability })) });
  const found = [{ label: title, words: wordsOf(title), sentences: [], sections: [] }, ...headings, ...terms.filter((_, i) => taken[`subject${i}`].probability >= LINES.subject.at).map((term) => ({ ...term, sections: [] }))];
  if (found.length === 1) return { labels: [title], holds: [[]], home: new Map(), outline: [undefined] };

  const pairs = found.flatMap((a, i) => found.slice(i + 1).flatMap((b, j) => (i === 0 || shareAWord(a.words, b.words) ? [[i, i + 1 + j]] : [])));
  const same = await askAll(ask, state, Object.fromEntries(pairs.map(([a, b], k) => [`alias${k}`, aliasQuestion(page(found[a].label, texts(found[a])), page(found[b].label, texts(found[b])))])));
  const root = found.map((_, i) => i);
  const rootOf = (i) => (root[i] === i ? i : (root[i] = rootOf(root[i])));
  pairs.forEach(([a, b], k) => {
    if (same[`alias${k}`].probability >= LINES.alias.at) root[rootOf(b)] = rootOf(a);
  });
  // Of names that are one subject, Jev says which heads its page; what the document is called heads whatever is the same as it.
  const groups = [...Map.groupBy(found.map((_, i) => i), rootOf).values()];
  const several = groups.filter((own) => own.length > 1 && !own.includes(0));
  const heading = await askAll(ask, state, Object.fromEntries(several.map((own, k) => [`heading${k}`, headingQuestion(own.map((i) => found[i].label))])));
  const label = (own) => (own.includes(0) ? title : own.length === 1 ? found[own[0]].label : found[own[Number(heading[`heading${several.indexOf(own)}`].choice.slice(1))]].label);
  tell({ type: 'merged', groups: groups.filter((own) => own.length > 1).map((own) => ({ names: own.map((i) => found[i].label), heading: label(own) })) });
  const made = groups
    .map((own) => ({ label: label(own), holds: [...new Set(own.flatMap((i) => texts(found[i])))], sections: own.includes(0) ? [] : own.flatMap((i) => found[i].sections).sort((a, b) => a - b) }))
    .sort((a, b) => b.holds.length - a.holds.length);
  const subjectOf = new Map(made.flatMap(({ sections }, k) => sections.map((section) => [section, k])));
  const home = new Map(headed.flatMap(([section]) => {
    const at = subjectOf.get(section) ?? subjectOf.get(above(blocks, section));
    return at === undefined ? [] : [[section, at]];
  }));
  const outline = made.map(({ sections }, k) => (sections.length ? (subjectOf.get(above(blocks, sections[0])) ?? k) : undefined)).map((parent, k) => (parent === k ? null : parent));
  return { labels: made.map(({ label }) => label), holds: made.map(({ holds }) => holds), home, outline };
}

// The heading an h3 section comes under, or undefined.
function above(blocks, section) {
  if (blocks[section].kind !== 'h3') return undefined;
  for (let at = section - 1; at > 0; at--) if (blocks[at].kind === 'h2') return at;
  return undefined;
}

// Whether two names, as their folded words, could be one: a word of one is, or
// holds, a word of the other, as "recruit" is held by "recruiting" and
// "juego" by "videojuego".
const shareAWord = (a, b) => a.some((x) => b.some((y) => Math.min(x.length, y.length) >= STEM && (x.includes(y) || y.includes(x))));

// Files each of the `kept` sentences under one of the subjects `labels`,
// `holds[i]` the sentences named by `labels[i]`: returns `[{ topic, ties }]`,
// indexes into `labels`, `ties` being the other subjects it belongs under
// too. Jev, shown the sentence among the others of its section and each
// subject with some of what it holds, says which subject the sentence is
// mainly about, and of the likeliest of those, each on its own, whether the
// sentence belongs there: it is filed under the likeliest it belongs under.
// What the document is called is not among them, since every sentence is
// about it in some way. A sentence that belongs under none Jev puts either
// under the likeliest or under what the document is called, as said of the
// whole. A sentence whose section has a `home` (see subjects) is filed
// there, and the others it belongs under are its ties.
export async function file(doc, kept, labels, holds, ask, home) {
  const whole = labels.indexOf(doc.title);
  const own = labels.flatMap((_, i) => (i === whole ? [] : [i])).slice(0, OPTIONS);
  if (own.length === 0) return kept.map(() => ({ topic: whole, ties: [], options: [] }));
  const subjects = own.map((i) => page(labels[i], holds[i]));
  const about = {};
  const belongs = {};
  const said = {};
  const shortlist = [];
  await bySection(doc, kept, async (section, members) => {
    const state = { ...section, subjects };
    Object.assign(about, await askAll(ask, state, Object.fromEntries(members.map((i) => [`file${i}`, filingQuestion(kept[i], subjects.length)]))));
    for (const i of members) shortlist[i] = Object.entries(about[`file${i}`].probabilities).sort(([, a], [, b]) => b - a).slice(0, SHORTLIST).map(([option]) => placeOf(option));
    Object.assign(belongs, await askAll(ask, state, Object.fromEntries(members.flatMap((i) => shortlist[i].map((at) => [`belongs${i}_${at}`, belongsQuestion(kept[i], subjects[at])])))));
    const homeless = members.flatMap((i) => (!home.has(kept[i].section) && shortlist[i].every((at) => belongs[`belongs${i}_${at}`].probability < LINES.belongs.at) ? [[`whole${i}`, wholeQuestion(kept[i], labels[own[shortlist[i][0]]])]] : []));
    Object.assign(said, await askAll(ask, state, Object.fromEntries(homeless)));
  });
  const under = kept.map((_, i) => shortlist[i].filter((at) => belongs[`belongs${i}_${at}`].probability >= LINES.belongs.at).map((at) => own[at]));
  // Each sentence's subject and ties, with the subjects Jev weighed for it, how likely it was that it was about each and that it belongs on its page.
  return kept.map((_, i) => {
    const options = shortlist[i].map((at) => ({ topic: own[at], p: about[`file${i}`].probabilities[`subjects[${at}]`], belongs: belongs[`belongs${i}_${at}`].probability }));
    if (home.has(kept[i].section)) return { topic: home.get(kept[i].section), ties: under[i].filter((topic) => topic !== home.get(kept[i].section)), options };
    if (under[i].length > 0) return { topic: under[i][0], ties: under[i].slice(1), options };
    return { topic: said[`whole${i}`].choice === 'whole' ? whole : own[shortlist[i][0]], ties: [], options, whole: said[`whole${i}`].probabilities.whole };
  });
}

// How the `subjects` bear on one another, `sentences[i]` being those filed
// under `subjects[i]`: `[{ a, b, weight }]`. Jev says of each subject which
// other has the most to do with it, and the two are joined; of every two
// joined it says how much they have to do with each other, `weight`, from 0
// for nothing to 1 for everything. What the
// document is called is left out: every subject of a document is part of
// what it is about, which says nothing of any of them.
export async function relate({ title }, subjects, sentences, ask) {
  const state = pages(title, subjects, sentences);
  const own = subjects.flatMap((label, i) => (label === title ? [] : [i]));
  if (own.length < 2) return [];
  const others = (a) => own.filter((b) => b !== a);
  const closest = await askAll(ask, state, Object.fromEntries(own.map((a) => [`closest${a}`, closestQuestion(subjects[a], others(a).slice(0, OPTIONS - 1).map((b) => subjects[b]))])));
  const joined = new Map();
  for (const a of own) {
    const { choice } = closest[`closest${a}`];
    if (choice === 'none') continue;
    const b = others(a)[Number(choice.slice(1))];
    joined.set(`${Math.min(a, b)} ${Math.max(a, b)}`, [Math.min(a, b), Math.max(a, b)]);
  }
  const pairs = [...joined.values()];
  const said = (i) => page(subjects[i], sentences[i].map(({ text }) => text));
  const bond = await askAll(ask, { document: title }, Object.fromEntries(pairs.map(([a, b], i) => [`bond${i}`, bondQuestion(said(a), said(b))])));
  return pairs.map(([a, b], i) => ({ a, b, weight: bond[`bond${i}`].score / (BOND.length - 1) }));
}

// The reader's notes on the document called `title`: a page for each of the
// `subjects`, with the `sentences` filed under it; when all of them would be
// too much to read with a question, as many of each page's first sentences
// as fit.
function pages(title, subjects, sentences) {
  const notes = (most) => ({ document: title, pages: subjects.map((label, i) => page(label, sentences[i].map(({ text }) => text), most)) });
  let most = Math.max(...sentences.map((own) => own.length));
  while (most > 1 && tokens(notes(most)) > NOTES) most -= 1;
  return notes(most);
}

// Which of the `subjects` the document is built on, its themes, and which
// theme each of the others belongs under: for each subject, null for a theme
// or the index of the theme it belongs under. What the document is called is
// always a theme. Jev picks the others one at a time from what is left, the
// fullest offered first, and once it has the fewest a document is built on
// it may say none is left; then it puts each other subject under the theme it
// is most a part of, what the document is called being offered for what is
// part of none. While a theme gathers many, the most crowded first, and
// there is room for a theme, Jev picks which of those it gathers is a theme
// of its own, and the rest of them are put again: the themes come to
// cover the subjects, and what the document is called does not gather all
// that is part of no other. A subject that is a heading has its place
// already, by `outline` (see subjects): a heading under no other is a
// theme, and one under another comes under that one's theme; Jev picks and
// places only the others. `sentences[i]` are those filed under `subjects[i]`.
// `tell` is told of each `theme` as it is picked.
export async function gather({ title }, subjects, sentences, ask, tell, outline) {
  const state = pages(title, subjects, sentences);
  const whole = subjects.indexOf(title);
  // A heading's subject comes under the heading it comes under: what that
  // heading's subject comes under, if it is not a theme itself.
  const topOf = (i) => { for (let seen = 0; outline[i] !== null && seen < subjects.length; seen++) i = outline[i]; return i; };
  const tops = subjects.flatMap((_, i) => (i !== whole && outline[i] === null ? [i] : []));
  const free = subjects.flatMap((_, i) => (i === whole || outline[i] !== undefined ? [] : [i]));
  // The outline's top headings are the themes when they are few enough;
  // when they are more, Jev picks the themes among them as among the rest.
  const fixed = tops.length <= THEMES.most;
  const themes = fixed ? [...tops] : [];
  for (const i of themes) tell({ type: 'theme', label: subjects[i] });
  let left = (fixed ? free : [...tops, ...free]).sort((a, b) => a - b);
  const outlined = (parentOf) => subjects.map((_, i) => {
    if (i === whole || themes.includes(i)) return null;
    if (outline[i] === undefined || outline[i] === null) return parentOf.get(i);
    const top = topOf(i);
    return themes.includes(top) ? top : parentOf.get(top);
  });
  if (!themes.length && left.length <= THEMES.least) return subjects.map(() => null);
  if (!left.length) return outlined(new Map());
  while (themes.length < THEMES.first && left.length) {
    const offered = left.slice(0, OPTIONS - 1);
    const { choice } = (await askAll(ask, state, { theme: themeQuestion(offered.map((i) => subjects[i]), themes.map((i) => subjects[i]), themes.length >= THEMES.least) })).theme;
    if (choice === 'none') break;
    const at = offered[Number(choice.slice(1))];
    tell({ type: 'theme', label: subjects[at] });
    themes.push(at);
    left = left.filter((i) => i !== at);
  }
  const heads = whole < 0 ? themes : [whole, ...themes];
  const parentOf = new Map();
  for (let open = left; open.length; ) {
    const under = await askAll(ask, state, Object.fromEntries(open.map((i) => [`parent${i}`, parentQuestion(subjects[i], heads.map((head) => subjects[head]), title)])));
    for (const i of open) parentOf.set(i, heads[Number(under[`parent${i}`].choice.slice(1))]);
    if (themes.length >= THEMES.most) break;
    const [crowd = []] = heads.map((head) => left.filter((i) => parentOf.get(i) === head)).filter((own) => own.length >= CROWD).sort((a, b) => b.length - a.length);
    if (!crowd.length) break;
    const { choice } = (await askAll(ask, state, { theme: themeQuestion(crowd.map((i) => subjects[i]), themes.map((i) => subjects[i]), false) })).theme;
    const at = crowd[Number(choice.slice(1))];
    tell({ type: 'theme', label: subjects[at] });
    themes.push(at);
    heads.push(at);
    parentOf.delete(at);
    open = crowd.filter((i) => i !== at);
  }
  for (const head of heads) parentOf.set(head, null);
  return outlined(parentOf);
}

// The `parents` of the subjects made to agree with how Jev joined them: a
// subject Jev put under what the document is called, "part of none in
// particular", but whose strongest bond, at least much, is with another,
// goes under that one's theme, or under it if it is a theme. Jev answered the
// two questions apart, and where they disagree the specific answer beats the
// general one.
export function attach(parents, links, whole) {
  if (whole < 0) return parents;
  return parents.map((parent, i) => {
    if (parent !== whole) return parent;
    const bonds = links.flatMap(({ a, b, weight }) => (a === i ? [{ other: b, weight }] : b === i ? [{ other: a, weight }] : [])).filter(({ weight }) => weight >= MUCH);
    if (!bonds.length) return parent;
    const { other } = bonds.reduce((best, bond) => (bond.weight > best.weight ? bond : best));
    const theme = parents[other] === null ? other : parents[other];
    return other === whole || theme === whole ? parent : theme;
  });
}

// What a page is worth by what it holds: of two, the one with more sentences,
// the earlier of two with as many.
const outranks = (counts, a, b) => counts[a] > counts[b] || (counts[a] === counts[b] && a < b);

// Whether a subject should stop being a page of its own, and if it did,
// which page it would be kept on: two questions, each of one thing.
const fallQuestion = (subject, hosts) => boolean({ question: 'Should `subject` stop being a page of its own in the notes on this document and be kept on one of `hosts`? It stays its own page when it is a distinct topic a reader would look up by itself: its own claim, method, result or distinction that no other page says. It moves when what it says is a part, kind, instance, alias, aspect or detail of one of `hosts`, or is too slight to be a topic: one or two sentences that only elaborate something else.', subject, hosts: hosts.map(({ name }) => name) });

const hostQuestion = (subject, hosts) => choice({ question: 'If `subject` were no longer a page of its own, on which of `hosts` would a reader look for what it says?', subject, hosts }, listed('hosts', [...hosts.keys()]));

// The subject each one falls into, or null for one that stands: a map of the
// web that shows every name Jev found is a heap, and a subject that is a
// detail of another says nothing the other does not. Of every subject that is
// not a theme, Jev says how likely it is that it should be kept on another
// page, the theme it belongs under or a subject under that theme that holds
// at least as much, and on which; whether it falls is how likely that is by
// the line `fall`, which sets Jev's odds against how much the subject holds. A page
// never falls into a lighter one, so no two fall into each other. Themes,
// and what the document is called, never fall. A subject that falls into one
// that falls goes to where that one comes to rest. `sentences[i]` are those
// filed under `subjects[i]`. `tell` is told of every subject that could
// fall, `folds`: Jev's odds that it should, how much it holds, how likely
// that makes it to fall, the host Jev would keep it on and whether it falls.
export async function cover({ title }, subjects, parents, sentences, ask, tell = () => {}) {
  const { hosts, fall, odds } = await coverOdds({ title }, subjects, parents, sentences, ask);
  const counts = sentences.map((own) => own.length);
  // A heading that holds nothing of its own, only the headings under it, is their frame and stays.
  const likely = hosts.map((own, i) => {
    if (!own.length || counts[i] === 0) return null;
    const sure = Math.min(Math.max(fall[i], 1e-4), 1 - 1e-4);
    return 1 / (1 + Math.exp(-(LINES.fall.bias + LINES.fall.jev * Math.log(sure / (1 - sure)) + LINES.fall.size * Math.log(counts[i]))));
  });
  const onto = hosts.map((own, i) => (likely[i] !== null ? own[placeOf(Object.entries(odds[i]).sort(([, a], [, b]) => b - a)[0][0])] : null));
  const host = onto.map((one, i) => (one === null || likely[i] < LINES.fall.at ? null : one));
  tell({ type: 'folds', subjects: onto.flatMap((one, i) => (one === null ? [] : [{ label: subjects[i], p: fall[i], size: counts[i], likely: likely[i], host: subjects[one], falls: host[i] !== null }])) });
  const rest = (i) => (host[i] === null ? i : rest(host[i]));
  return host.map((one, i) => (one === null ? null : rest(i)));
}

// Where each subject that is not a theme could be kept, `hosts[i]`, how
// likely Jev says it is that it should be kept on one of them, `fall[i]`,
// and how likely each is, `odds[i]` by `hosts[0]`… in that order.
export async function coverOdds({ title }, subjects, parents, sentences, ask) {
  const counts = sentences.map((own) => own.length);
  const texts = (i) => sentences[i].map(({ text }) => text);
  const hosts = parents.map((parent, i) => (parent === null ? [] : [parent, ...parents.flatMap((other, j) => (other === parent && j !== i && outranks(counts, j, i) ? [j] : []))]));
  const questions = {};
  hosts.forEach((own, i) => {
    if (!own.length) return;
    const subject = { name: subjects[i], holds: texts(i) };
    const offered = own.map((j) => page(subjects[j], texts(j)));
    questions[`fall${i}`] = fallQuestion(subject, offered);
    questions[`host${i}`] = hostQuestion(subject, offered.map((host) => (host.name === title ? { name: `${quote(title)} as a whole`, holds: [] } : host)));
  });
  const answers = await askAll(ask, { document: title }, questions);
  return { hosts, fall: hosts.map((own, i) => (own.length ? answers[`fall${i}`].probability : null)), odds: hosts.map((own, i) => (own.length ? answers[`host${i}`].probabilities : null)) };
}

// How the `kept` sentences, each filed under a `topic`, pull on one another
// across subjects: `[{ a, b, weight }]`, indexes into `kept`. Jev says of each
// sentence which sentence under another subject has the most to do with it,
// and the two are joined; of every two joined it says how much what they say
// has to do with each other, `weight`, from 0 for nothing to 1 for
// everything. Two that have nothing to do with each other do not pull.
export async function pull(doc, kept, ask) {
  const { state } = summaryOf(doc, kept);
  const others = (a) => kept.flatMap((b, i) => (b.topic === kept[a].topic ? [] : [i])).slice(0, OPTIONS - 1);
  const nearest = await askAll(ask, state, Object.fromEntries(kept.flatMap((sentence, a) => (others(a).length ? [[`nearest${a}`, nearestQuestion(sentence, others(a).map((b) => kept[b]))]] : []))));
  const joined = new Map();
  kept.forEach((_, a) => {
    const choice = nearest[`nearest${a}`]?.choice;
    if (!choice || choice === 'none') return;
    const b = others(a)[Number(choice.slice(1))];
    joined.set(`${Math.min(a, b)} ${Math.max(a, b)}`, [Math.min(a, b), Math.max(a, b)]);
  });
  const pairs = [...joined.values()];
  const answers = await askAll(ask, { document: doc.title }, Object.fromEntries(pairs.map(([a, b], k) => [`pull${k}`, pullQuestion(kept[a].text, kept[b].text)])));
  return pairs.flatMap(([a, b], k) => {
    const { score } = answers[`pull${k}`];
    return Math.round(score) > 0 ? [{ a, b, weight: score / (PULL.length - 1) }] : [];
  });
}
