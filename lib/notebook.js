// The notebook: two or more sources in, and how they hold together out. Each
// source is read for the ideas it carries, each idea tied to the sentences that
// say it; then all the ideas of all the sources are laid side by side and a
// model says which are the same idea, where the sources part on it, and how
// the ideas bear on one another. Here the model decides everything and Jev is
// not asked: this is a mode of its own, beside the crawler.
//
// The model is the one the Codex CLI is logged in with (see viaCodex in
// llm.js). Its answers are kept on disk by what was asked, so a set of sources
// that was read once is not read, or paid for, again.

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { open } from './crawl.js';
import { firstObject, viaCodex } from './llm.js';
import { cosine, embed } from './similar.js';
import { segment } from './segment.js';
import { detect } from 'tinyld';

const MODEL = process.env.NOTEBOOK_MODEL ?? 'gpt-6-luna';
const EFFORT = { read: process.env.NOTEBOOK_EFFORT ?? 'low', relate: process.env.NOTEBOOK_EFFORT ?? 'medium' }; // what the model is asked at: reading a source is easy, weighing sources against each other is not
const CHUNK_CHARS = 30_000; // what one reading takes of a source: a longer one is read in parts, all at once // what one reading takes of a source; a longer one is read in parts
const IDEAS = [6, 14]; // the fewest and the most ideas asked of one reading of a source in one part; of one in several parts, half of that
const QUOTES = 4;
const HINT_Z = 1.5; // how far above the mean of the pairs a pair is for the model to be told it is close
const BOND_Z = 1; // how far above the mean a bond is kept at all; the page lets the reader raise the line from there
const MAX_BONDS = 400;
const MAX_HINTS = 40; // the most sentences an idea is tied to
const TIMEOUT_MS = 300_000;
const ATTEMPTS = 3; // times a reply that is not JSON is asked for again
const RELATIONS = ['supports', 'contradicts', 'extends', 'causes'];
const STANCES = ['agree', 'partial', 'conflict'];
const LETTERS = 'ABCDEFGHIJKL';
const SOURCES = { least: 2, most: 12 };

const READ = [
  'You read one source for a notebook that compares several. Reply with one JSON object and nothing else.',
  `Find the ideas this source carries, between ${IDEAS[0]} and ${IDEAS[1]} of them, the substantive ones and not its apparatus.`,
  'Each idea is {"name": a short noun phrase of at most six words, in the words of the source, "claim": what the source says of it in one sentence of your own, "sentences": the numbers of the one to four sentences that say it best (only numbers that appear below), "weight": 1 to 5, how much of the source it is}.',
  'Reply {"ideas": [...]}.',
].join('\n');

const RELATE = [
  'You compare the ideas of several sources for a notebook. Reply with one JSON object and nothing else.',
  'Every idea has an id (a source letter and a number) with its name and claim. Group them into nodes, and every id below must be in exactly one node, none left out: ideas that are the same idea in different sources go in one node; an idea no other source has goes alone in its own. A node holds at most one idea of each source: two ideas of one source are never put together, however alike. Go through the ideas of each source and look for those of the others that say the same, or that answer or limit it; where the sources overlap, many nodes are shared.',
  'Each node is {"label": a short noun phrase of at most five words, "ideas": the ids, each in exactly one node, "stance": for a node of two or more sources, "agree" when they say the same, "partial" when they say it with a difference that matters, "conflict" when they contradict; leave it out for a node of one source, "agree": one sentence on what the sources share (only for two or more sources; never cite an idea id, say \"source A\" for a source), "differ": one sentence on where they part, or null when they do not (only for two or more sources)}.',
  `Then the edges, the ways the nodes bear on one another: {"from": a node number, "to": a node number, "relation": one of ${RELATIONS.join(', ')}, "note": at most twelve words}. Every node has at least one tie, and there are about two ties per node, between sources and within one source alike (an idea that leads to another, limits it, or rests on it); a node is numbered by its place in "nodes", from 0.`,
  'Last, "overview": {"converge": two sentences on what the sources agree on, "diverge": two sentences on where and why they part}.',
  'Reply {"nodes": [...], "edges": [...], "overview": {...}}.',
].join('\n');

const kept = (dir) => async (prompt, effort) => {
  const file = join(dir, `${createHash('sha256').update(`${MODEL}\n${effort}\n${prompt}`).digest('hex').slice(0, 20)}.json`);
  const known = await readFile(file, 'utf8').catch(() => null);
  if (known) return { answer: JSON.parse(known), recalled: true };
  // A reply that is not JSON (an unescaped quote in a long answer will do it) is asked for again, and never kept.
  let answer;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const said = await viaCodex(attempt === 0 ? prompt : `${prompt}\n\nYour last reply was not valid JSON (${answer}). Reply again with one valid JSON object: escape every double quote inside a string with a backslash.`, MODEL, effort, TIMEOUT_MS);
    try {
      answer = firstObject(said);
      break;
    } catch (error) {
      answer = error.message.slice(0, 120);
      if (attempt === ATTEMPTS - 1) throw new Error(`the model's reply could not be read as JSON after ${ATTEMPTS} tries (${answer})`);
    }
  }
  await mkdir(dir, { recursive: true });
  await writeFile(file, JSON.stringify(answer));
  return { answer, recalled: false };
};

// The sentences of a document, in parts a reading can take.
function chunks(sentences) {
  const parts = [[]];
  let size = 0;
  sentences.forEach((sentence, id) => {
    if (size + sentence.text.length > CHUNK_CHARS && parts.at(-1).length) {
      parts.push([]);
      size = 0;
    }
    parts.at(-1).push({ id, text: sentence.text });
    size += sentence.text.length + 8;
  });
  return parts;
}

// What the reader is after, told to the model that reads: it picks and weighs by it.
const aim = (focus) => (focus ? `\nThe reader is after: ${focus}. Prefer the ideas that bear on it and give them more weight; keep the others only if the source is mostly about them.` : '');

// The instruction to write in the language of `text`.
const writeIn = (text) => `Write every name, claim and sentence of your reply in ${new Intl.DisplayNames('en', { type: 'language' }).of(detect(text) || 'en')}.`;

// The sections of a document a reader may leave out: each opening heading (h1, h2) with the words of all that is under it, h3 included.
const APPARATUS = /^(references|bibliography|works cited|see also|notes|external links|further reading|footnotes|sources|citations|referencias|bibliograf[íi]a|v[ée]ase tambi[ée]n|notas|enlaces externos|v[íi]nculos externos)$/i;
export function outline(doc) {
  const sentences = segment(doc.blocks);
  const parent = new Map();
  let top = 0;
  doc.blocks.forEach(({ kind }, at) => {
    if (kind === 'h1' || kind === 'h2') top = at;
    if (/^h/.test(kind)) parent.set(at, top);
  });
  const words = new Map();
  for (const { section, text } of sentences) words.set(parent.get(section) ?? 0, (words.get(parent.get(section) ?? 0) ?? 0) + text.split(/\s+/).length);
  return doc.blocks.flatMap(({ kind, text }, at) => (kind === 'h1' || kind === 'h2') && words.get(at) ? [{ at, title: kind === 'h1' ? 'Opening' : text, words: words.get(at), left: kind === 'h2' && APPARATUS.test(text.trim()) }] : []);
}

const clean = (text, most) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, most);

// What one source carries: `[{ name, claim, weight, sentences: [ids] }]`.
async function readSource(doc, sentences, ask, letter, focus) {
  const ideas = [];
  let recalled = true;
  const parts = chunks(sentences);
  const readings = await Promise.all(parts.map(async (part) => {
    const [fewest, most] = parts.length === 1 ? IDEAS : IDEAS.map((n) => Math.ceil(n / 2));
    const { answer, recalled: kept } = await ask(`${READ.replace(`${IDEAS[0]} and ${IDEAS[1]}`, `${fewest} and ${most}`)}${aim(focus)}\n${writeIn(part.map(({ text }) => text).join(' ').slice(0, 4000))}\n\nSource ${letter}: ${doc.title}\n\n${part.map(({ id, text }) => `[${id}] ${text}`).join('\n')}`, EFFORT.read);
    recalled &&= kept;
    const valid = new Set(part.map(({ id }) => id));
    for (const idea of Array.isArray(answer.ideas) ? answer.ideas : []) {
      const cited = [...new Set((idea.sentences ?? []).map(Number).filter((id) => valid.has(id)))].slice(0, QUOTES);
      if (cited.length === 0 || !clean(idea.name, 80)) continue; // an idea tied to no sentence of the source is not one of its own
      ideas.push({ name: clean(idea.name, 80), claim: clean(idea.claim, 300), weight: Math.min(5, Math.max(1, Math.round(Number(idea.weight)) || 1)), sentences: cited, at: Math.min(...cited) });
    }
  }));
  await readings;
  ideas.sort((a, b) => a.at - b.at); // in the order the source says them
  if (ideas.length === 0) throw new Error(`the model found no ideas in ${doc.title}`);
  return { ideas, recalled };
}

// `sources`: `[{ bytes, address }]`, each the bytes of a page or a PDF, or its text. `tell(event)` hears each step.
export async function notebook(sources, { dir, tell = () => {}, focus = '' }) {
  if (sources.length < SOURCES.least) throw new Error(`a notebook needs at least ${SOURCES.least} sources`);
  if (sources.length > SOURCES.most) throw new Error(`a notebook takes at most ${SOURCES.most} sources`);
  const ask = kept(dir);
  const docs = await Promise.all(sources.map(async ({ bytes, address, doc: opened, skip = [] }, at) => {
    const doc = opened ?? await open(bytes, address);
    // What the reader leaves out of a source is left out whole: the sentences under those headings are not read, nor measured, nor cited.
    const left = new Set(skip);
    const top = new Map();
    let at2 = 0;
    doc.blocks.forEach(({ kind }, index) => { if (kind === 'h1' || kind === 'h2') at2 = index; top.set(index, at2); });
    const sentences = segment(doc.blocks).filter(({ section }) => !left.has(top.get(section)));
    if (sentences.length === 0) throw new Error(`${doc.title || address} has no running text`);
    const letter = LETTERS[at];
    tell({ type: 'opened', letter, title: doc.title, words: doc.words, sentences: sentences.length });
    return { letter, doc, sentences };
  }));

  const read = await Promise.all(docs.map(async ({ letter, doc, sentences }) => {
    const started = performance.now();
    tell({ type: 'reading', letter });
    const { ideas, recalled } = await readSource(doc, sentences, ask, letter, focus);
    tell({ type: 'read', letter, recalled, ms: Math.round(performance.now() - started), ideas: ideas.map(({ name, weight }) => ({ name, weight })) });
    return ideas;
  }));

  // Every idea of every source, by id.
  const ideas = new Map();
  read.forEach((list, at) => list.forEach((idea, n) => ideas.set(`${LETTERS[at]}${n + 1}`, { ...idea, source: at, id: `${LETTERS[at]}${n + 1}` })));
  // How alike two ideas are is measured, on the sentences of the source that carry them (the model's own wording of an idea measures worse), and said in how far the pair stands above the others of its kind.
  const all = [...ideas.values()];
  const vectors = await embed(all.map(({ sentences, source }) => sentences.map((s) => docs[source].sentences[s].text).join(' ').slice(0, 800)));
  const pairs = { cross: [], within: [] };
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) pairs[all[i].source === all[j].source ? 'within' : 'cross'].push({ a: all[i].id, b: all[j].id, s: cosine(vectors[i], vectors[j]) });
  const scored = Object.entries(pairs).flatMap(([kind, list]) => {
    if (list.length < 2) return [];
    const mean = list.reduce((sum, { s }) => sum + s, 0) / list.length;
    const spread = Math.sqrt(list.reduce((sum, { s }) => sum + (s - mean) ** 2, 0) / list.length) || 1;
    return list.map(({ a, b, s }) => ({ a, b, kind, z: (s - mean) / spread }));
  });
  // What the reader is after, measured the same way: how far each idea's own sentences stand above the others in closeness to it.
  const relevance = new Map();
  if (focus) {
    const [aimed] = await embed([focus], 'query');
    const near = vectors.map((vector) => cosine(aimed, vector));
    const mean = near.reduce((sum, x) => sum + x, 0) / near.length;
    const spread = Math.sqrt(near.reduce((sum, x) => sum + (x - mean) ** 2, 0) / near.length) || 1;
    all.forEach(({ id }, at) => relevance.set(id, Math.round(((near[at] - mean) / spread) * 100) / 100));
  }
  const close = scored.filter(({ kind, z }) => kind === 'cross' && z >= HINT_Z).sort((x, y) => y.z - x.z).slice(0, MAX_HINTS);
  tell({ type: 'measured', pairs: scored.length, close: close.length });
  tell({ type: 'relating', ideas: ideas.size });
  const relatingSince = performance.now();
  const hints = (focus ? `\n\nThe reader is after: ${focus}. Name the nodes so that what bears on it is easy to find, and let the overview say how the sources stand on it.` : '') + (close.length ? `\n\nPairs of ideas whose own sentences are measured to be close, a hint and not an answer (they may be alike without being the same idea): ${close.map(({ a, b }) => `${a}~${b}`).join(', ')}` : '');
  const listing = docs.map(({ letter, doc }) => `Source ${letter}: ${doc.title}\n${[...ideas.values()].filter(({ source }) => LETTERS[source] === letter).map(({ id, name, claim }) => `${id} | ${name} | ${claim}`).join('\n')}`).join('\n\n');
  const { answer, recalled } = await ask(`${RELATE}\n${writeIn([...ideas.values()].map(({ claim }) => claim).join(' '))}\n\n${listing}${hints}`, EFFORT.relate);

  tell({ type: 'related', recalled, ms: Math.round(performance.now() - relatingSince) });

  // The model's grouping, held to what is true: an idea is in one node, a node holds ideas, and an idea left out is a node of its own.
  const placed = new Set();
  const nodes = [];
  const index = new Map();
  (Array.isArray(answer.nodes) ? answer.nodes : []).forEach((node, number) => {
    const sources = new Set();
    const members = [...new Set(node.ideas ?? [])].filter((id) => ideas.has(id) && !placed.has(id) && !sources.has(ideas.get(id).source) && sources.add(ideas.get(id).source)); // one idea of a source to a node: the others stand alone
    members.forEach((id) => placed.add(id));
    if (members.length === 0) return;
    index.set(number, nodes.length);
    nodes.push({ label: clean(node.label, 60), members, stance: node.stance, agree: node.agree, differ: node.differ });
  });
  for (const id of ideas.keys()) if (!placed.has(id)) nodes.push({ label: ideas.get(id).name, members: [id] });

  const out = nodes.map(({ label, members, stance, agree, differ }, id) => {
    const shared = new Set(members.map((member) => ideas.get(member).source)).size > 1;
    return {
      id,
      label: label || ideas.get(members[0]).name,
      shared,
      stance: shared ? (STANCES.includes(stance) ? stance : 'agree') : null,
      agree: shared ? clean(agree, 300) || null : null,
      differ: shared ? clean(differ, 300) || null : null,
      weight: members.reduce((sum, member) => sum + ideas.get(member).weight, 0),
      relevance: focus ? Math.max(...members.map((member) => relevance.get(member))) : null,
      members: members.map((member) => {
        const idea = ideas.get(member);
        const { sentences } = docs[idea.source];
        return { id: member, source: idea.source, name: idea.name, claim: idea.claim, quotes: idea.sentences.map((s) => ({ id: s, text: sentences[s].text })) };
      }),
    };
  });

  // The bonds between nodes, each as strong as the closest pair of ideas between them.
  const nodeOf = new Map(nodes.flatMap(({ members }, at) => members.map((member) => [member, at])));
  const strongest = new Map();
  for (const { a, b, kind, z } of scored) {
    const [from, to] = [nodeOf.get(a), nodeOf.get(b)].sort((x, y) => x - y);
    const key = `${from}-${to}`;
    if (from !== to && z >= BOND_Z && (!strongest.has(key) || strongest.get(key).z < z)) strongest.set(key, { from, to, z: Math.round(z * 100) / 100, kind });
  }
  const bonds = [...strongest.values()].sort((x, y) => y.z - x.z).slice(0, MAX_BONDS);
  for (const node of out) {
    const inside = scored.filter(({ a, b, kind }) => kind === 'cross' && nodeOf.get(a) === node.id && nodeOf.get(b) === node.id);
    node.overlap = node.shared ? Math.round(Math.max(...inside.map(({ z }) => z), -9) * 100) / 100 : null; // how close the sources' own sentences are for what the model calls one idea
  }

  const seen = new Set();
  const edges = (Array.isArray(answer.edges) ? answer.edges : []).flatMap((edge) => {
    const from = index.get(Number(edge.from));
    const to = index.get(Number(edge.to));
    const key = [from, to, edge.relation].join();
    if (from === undefined || to === undefined || from === to || !RELATIONS.includes(edge.relation) || seen.has(key)) return [];
    seen.add(key);
    return [{ from, to, relation: edge.relation, note: clean(edge.note, 100) }];
  });

  return {
    sources: docs.map(({ letter, doc, sentences }) => ({ letter, title: doc.title, address: doc.url, words: doc.words, sentences: sentences.length })),
    nodes: out,
    edges,
    bonds,
    overview: { converge: clean(answer.overview?.converge, 500), diverge: clean(answer.overview?.diverge, 500) },
    focus: focus || null,
    model: MODEL,
  };
}
