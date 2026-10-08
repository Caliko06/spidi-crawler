// Serves the reader and crawls pages for it.
//
//   node server.mjs
//
// A page is either one of the corpus, kept in corpus/pages as it was fetched,
// or any address, fetched when asked for. The reader asks for the document
// first, to show it, and then for Jev's plan for it: what the crawler is to
// eat and what subject each sentence is filed under, decided before it sets
// off. Jev is reached through Vercel's AI Gateway with AI_GATEWAY_API_KEY, read from the
// environment or from .env.local. Its answers are kept on disk, so a page
// that has been judged once needs neither the key nor the network again.
//
// The reader watches the plan being made, from /api/watch: a stream of
// events, every request put to Jev as it goes out (`ask`) and comes back
// (`answer`, `recalled` when it was kept, with Jev's `verdicts` on each of
// its questions), and every decision as plan()
// tells it, last the whole `plan`. A kept answer is given at the pace Jev
// first gave it, so a page judged before is judged again before the reader's
// eyes as it was the first time.

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import { fetchPage, open, plan } from './lib/crawl.js';
import { createJev, readKey } from './lib/jev.js';
import { isClose, LINES } from './lib/lines.js';
import { notebook, outline } from './lib/notebook.js';
import { embed } from './lib/similar.js';

const PORT = Number(process.env.PORT ?? 4317);
const ROOT = import.meta.dirname;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.glb': 'model/gltf-binary',
  '.json': 'application/json; charset=utf-8',
};
// The reader's own files, the model of the crawler and the clips it acts out, of three.js what draws it, and d3-force, which lays out the subjects of the web; nothing else.
const PUBLIC = /^\/(index\.html|styles\.css|notebook\.(html|css)|src\/[\w-]+\.js|fonts\/[\w-]+\.woff2|assets\/[\w-]+\.(glb|json)|node_modules\/three\/(build\/three\.(module|core)|examples\/jsm\/(loaders\/GLTFLoader|libs\/meshopt_decoder\.module|utils\/(BufferGeometryUtils|SkeletonUtils)))\.js|node_modules\/d3-(force|quadtree|dispatch|timer)\/src\/[\w-]+\.js)$/;

const key = await readKey(ROOT);
// The pages Jev has judged and the reader offers: the corpus, then the trials, each with its answers kept beside it. They are only ever replayed, with no key: a page of the corpus never bills Jev, and one whose answers do not fit says so. Only an address typed in the bar is asked live.
const SETS = [{ dir: 'corpus', group: 'Corpus' }, { dir: 'corpus/trials', group: 'Trials' }, { dir: 'corpus/heldout', group: 'Held out' }];
const corpus = (await Promise.all(SETS.map(async (set) => JSON.parse(await readFile(join(ROOT, set.dir, 'index.json'), 'utf8')).map((entry) => ({ ...entry, ...set }))))).flat();
const askOfSet = Object.fromEntries(SETS.map(({ dir }) => [dir, createJev({ dir: join(ROOT, dir, 'judgements') })]));
const askOfTheWeb = createJev({ key, dir: join(ROOT, '.cache/judgements'), limit: 0.5 });

// A page of the web is fetched once and kept, so that Jev's answers for it,
// which are kept too, stay good however the page changes; to read it anew,
// delete its file in .cache/pages.
async function pageOfTheWeb(address) {
  const file = join(ROOT, '.cache/pages', `${createHash('sha256').update(address).digest('hex').slice(0, 16)}.page`);
  const kept = await readFile(file).catch(() => null);
  if (kept) return kept;
  const bytes = await fetchPage(address);
  await mkdir(join(ROOT, '.cache/pages'), { recursive: true });
  await writeFile(file, bytes);
  return bytes;
}

// What was typed, as an address the server will fetch: http or https, nothing else.
function addressOf(text) {
  const url = URL.canParse(text) ? new URL(text) : null;
  if (!url || !/^https?:$/.test(url.protocol)) throw new Error('that is not the address of a web page or a PDF (it has to start with http:// or https://)');
  return url.href;
}

// Every page is opened once, and planned once when its plan is asked for; what the reader asks for again is already there.
const pages = new Map();
function pageFor(query) {
  // A page of the corpus is asked for by its id, or by its address: pasting the address of one Jev has judged gives its kept answers, not a new bill.
  const typed = query.get('url');
  const entry = corpus.find(({ id, url }) => id === query.get('id') || (typed && url === typed));
  const address = entry ? entry.id : typed;
  if (!address) throw new Error('no page was asked for');
  if (!pages.has(address)) {
    const document = entry
      ? readFile(join(ROOT, entry.dir, 'pages', `${entry.id}.html`), 'utf8').then(async (html) => ({ ...(await open(html, entry.url)), credit: entry.credit ?? null }))
      : pageOfTheWeb(addressOf(address)).then((bytes) => open(bytes, address));
    const ask = entry ? askOfSet[entry.dir] : askOfTheWeb;
    const page = {
      document,
      ask,
      get plan() {
        const made = (this.made ??= document.then((doc) => plan(doc, ask)));
        made.catch(() => pages.delete(address)); // a page that could not be read is tried again
        return made;
      },
    };
    pages.set(address, page);
    document.catch(() => pages.delete(address));
  }
  return pages.get(address);
}


// The notebook: sources are put on the shelf (an upload, an address or a page of the corpus), each kept by what it holds, and the notebook is made of the ones asked for.
const SHELF = join(ROOT, '.cache/notebook/sources');
const MAX_UPLOAD = 45_000_000;
const shelved = new Map(); // id -> { bytes, address, title, words }

async function shelve(bytes, address) {
  const id = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  if (!shelved.has(id)) {
    const doc = await open(bytes, address);
    await mkdir(SHELF, { recursive: true });
    await writeFile(join(SHELF, id), bytes);
    shelved.set(id, { bytes, address, doc, title: doc.title, words: doc.words });
  }
  const { title, words } = shelved.get(id);
  return { id, title, words, outline: outline(shelved.get(id).doc) };
}

async function onTheShelf(id) {
  if (!/^[0-9a-f]{16}$/.test(id)) throw new Error('that is not a source of the shelf');
  if (!shelved.has(id)) {
    const bytes = await readFile(join(SHELF, id)).catch(() => null);
    if (!bytes) throw new Error('that source is not on the shelf; add it again');
    const address = `shelf:${id}`;
    const doc = await open(bytes, address);
    shelved.set(id, { bytes, address, doc, title: doc.title, words: doc.words });
  }
  return shelved.get(id);
}

async function bodyOf(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_UPLOAD) throw new Error('the file is too large to read');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function addSource(query, request) {
  const typed = query.get('url');
  const entry = corpus.find(({ id }) => id === query.get('id'));
  if (entry) return shelve(await readFile(join(ROOT, entry.dir, 'pages', `${entry.id}.html`)), entry.url);
  if (typed) { const address = addressOf(typed); return shelve(await pageOfTheWeb(address), address); }
  const bytes = await bodyOf(request);
  if (bytes.length === 0) throw new Error('the file is empty');
  return shelve(bytes, `file:${(query.get('name') ?? 'upload').slice(0, 120)}`);
}

// Makes the notebook of the sources asked for and streams each step of it.
async function runNotebook(query, request, response) {
  response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store' });
  let gone = false;
  request.on('close', () => (gone = true));
  const send = (event) => gone || response.write(`data: ${JSON.stringify(event)}\n\n`);
  try {
    // `skip` is each source's left-out sections, `id:3.7.9;id:2`; `focus` what the reader is after.
    const skips = Object.fromEntries((query.get('skip') ?? '').split(';').filter(Boolean).map((part) => { const [id, list] = part.split(':'); return [id, list.split('.').map(Number).filter(Number.isInteger)]; }));
    const sources = await Promise.all((query.get('ids') ?? '').split(',').filter(Boolean).map(async (id) => ({ ...(await onTheShelf(id)), skip: skips[id] ?? [] })));
    const focus = (query.get('focus') ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
    const started = performance.now();
    send({ type: 'result', result: await notebook(sources, { dir: join(ROOT, '.cache/notebook/llm'), tell: send, focus }) });
    console.log(`notebook of ${sources.length} sources in ${Math.round((performance.now() - started) / 1000)} s`);
  } catch (error) {
    send({ type: 'error', error: error.message });
  }
  response.end();
}

const json = (response, status, body) => response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(body));

// What a question is about: the things its question points at by a path in
// backticks, read from its own instructions or from the state it was asked
// with, or else the first things it quotes.
const QUOTED = /"([^"]{1,600})"/g;
const PATH = /`([A-Za-z_]\w*(?:\.\w+|\[\d+\])*)`/g;
const clip = (text, most) => (text.length > most ? `${text.slice(0, most - 1)}…` : text);
const at = (root, path) => path.match(/\w+|\d+/g).reduce((value, step) => value?.[step], root);
const plain = (value) => (typeof value === 'string' ? value : value?.name ?? null);
function about({ instructions }, state) {
  if (typeof instructions === 'string') return [...instructions.matchAll(QUOTED)].map(([, quoted]) => quoted);
  const root = { ...(typeof state === 'object' ? state : {}), ...instructions };
  return [...instructions.question.matchAll(PATH)].map(([, path]) => plain(at(root, path))).filter(Boolean);
}
// An option as the reader is shown it: its name, unless it is only a number
// (`t3`, `s12`), then what it quotes or names, or the words its description opens with.
const option = (described) => {
  const text = plain(described)?.replaceAll('"', '') ?? '';
  // What the document is called, offered as a page "as a whole": its title.
  return clip(text.match(/^(.+?) as a whole\b/)?.[1] ?? text.match(/^([^:]{1,40}): /)?.[1] ?? text, 60);
};
// An option named by its place in a list it was shown (`subjects[3]`), as what that place holds.
const named = (name, question, state) => {
  const root = { ...(typeof state === 'object' ? state : {}), ...(typeof question.instructions === 'object' ? question.instructions : {}) };
  if (/\[\d+\]$/.test(name)) return option(at(root, name));
  if (/^[st]\d+$/.test(name)) return option(question.criteria[name]);
  // A named option with a short description is shown by what it says ("The document as a whole.", not "whole"); the subject the question names, by its name.
  if (name === 'own' && typeof question.instructions?.subject === 'string') return question.instructions.subject;
  if (name === 'whole') return name; // said in the reader's language by the console
  const said = question.criteria?.[name];
  return name !== 'none' && typeof said === 'string' && said.length <= 60 ? said.replace(/\.$/, '').replaceAll('"', '') : name;
};

// Jev's answers to the `questions` of a request about `state`, as the
// console reads them out: each question's `key`, `type` and what it is
// `about`; a yes or no's `p`; a choice's `options`, the likeliest first with
// their probabilities, how many there were (`of`) and Jev's `confidence`; a
// score's `score`, the probability of each of its `levels`, and its
// `confidence`.
// Each verdict that the plan decides by a line carries it (lib/lines.js):
// the `line`, the `value` it reads, and whether it is a `close` call, so the
// console says what the plan decided and not a guess of its own.
const DECIDED = {
  standing: ['keep', (answer) => answer.score],
  needs: ['alone', (answer) => answer.probabilities.none],
  part: ['apparatus', (answer) => answer.probabilities.apparatus],
  same: ['repeat', (answer) => answer.probability],
  prize: ['essential', (answer) => answer.probability],
  subject: ['subject', (answer) => answer.probability],
  alias: ['alias', (answer) => answer.probability],
  belongs: ['belongs', (answer) => answer.probability],
  section: ['section', (answer) => answer.probability],
};
function decided(key, answer) {
  const [name, read] = DECIDED[key.replace(/\d.*$/, '')] ?? [];
  if (!name) return {};
  const value = read(answer) ?? 0;
  return { line: { name, at: LINES[name].at, passed: name === 'keep' ? LINES.passed.at : undefined }, value, close: isClose(value, LINES[name]) };
}

function verdicts(questions, answers, state) {
  return Object.entries(questions).map(([key, question]) => {
    const answer = answers[key];
    const verdict = { key, type: question.type, about: [...new Set(about(question, state))].slice(0, 2).map((text) => clip(text, 90)), ...decided(key, answer) };
    if (question.type === 'boolean') return { ...verdict, p: answer.probability };
    const ranked = Object.entries(answer.probabilities).sort(([, a], [, b]) => b - a);
    if (question.type === 'choice') return { ...verdict, confidence: answer.confidence, of: ranked.length, options: ranked.slice(0, 4).map(([name, p]) => [named(name, question, state), p]) };
    return { ...verdict, confidence: answer.confidence, score: answer.score, levels: question.criteria.map((_, level) => answer.probabilities[level] ?? 0) };
  });
}

// Makes the plan of the page asked for again, for this reader, at Jev's
// pace, and streams every question and decision of it as it comes.
async function watch(query, request, response) {
  response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store' });
  let gone = false;
  request.on('close', () => (gone = true));
  const send = (event) => gone || response.write(`data: ${JSON.stringify(event)}\n\n`);
  try {
    const page = pageFor(query);
    const doc = await page.document;
    let requests = 0;
    const spent = { questions: 0, live: 0, tokens: 0, dollars: 0 };
    const watched = async (asked) => {
      if (gone) throw new Error('the reader left'); // nothing more is asked of Jev for a page nobody is watching
      const id = requests++;
      const stage = Object.keys(asked.questions)[0].replace(/\d.*$/, '');
      const questions = Object.keys(asked.questions).length;
      send({ type: 'ask', id, stage, questions });
      const { answers, recalled, tokens, dollars } = await page.ask.paced(asked);
      spent.questions += questions;
      if (!recalled) spent.live += 1;
      spent.tokens += tokens;
      spent.dollars += dollars;
      send({ type: 'answer', id, stage, questions, recalled, tokens, dollars, verdicts: verdicts(asked.questions, answers, asked.state) });
      return answers;
    };
    send({ type: 'plan', plan: await plan(doc, watched, send) });
    console.log(`${query.get('id') ?? query.get('url')}: ${spent.questions} questions in ${requests} requests, ${spent.live} asked of Jev now, ${spent.tokens} tokens, $${spent.dollars.toFixed(4)} when first asked`);
  } catch (error) {
    send({ type: 'error', error: error.message });
  }
  response.end();
}

// Only this machine's own window may ask: a page on another site, or a name that points here by trickery, could otherwise spend Jev's credits.
const LOCAL_HOST = /^(127\.0\.0\.1|localhost)(:\d+)?$/;

const server = createServer(async (request, response) => {
  const { pathname, searchParams } = new URL(request.url, 'http://localhost');
  const adding = request.method === 'POST' && pathname === '/api/notebook/source';
  if (request.method !== 'GET' && !adding) return response.writeHead(405).end();
  if (!LOCAL_HOST.test(request.headers.host ?? '') || request.headers['sec-fetch-site'] === 'cross-site') return response.writeHead(403).end();
  try {
    if (pathname === '/api/corpus') return json(response, 200, corpus);
    if (adding) {
      try {
        return json(response, 200, await addSource(searchParams, request));
      } catch (error) {
        return json(response, 422, { error: error.message });
      }
    }
    if (pathname === '/api/notebook/run') return await runNotebook(searchParams, request, response);
    if (pathname === '/api/watch') return await watch(searchParams, request, response);
    if (pathname === '/api/document' || pathname === '/api/plan') {
      try {
        return json(response, 200, await pageFor(searchParams)[pathname.slice('/api/'.length)]);
      } catch (error) {
        return json(response, 422, { error: error.message });
      }
    }
    const path = pathname === '/' ? '/index.html' : pathname === '/notebook' ? '/notebook.html' : pathname;
    if (!PUBLIC.test(path)) return response.writeHead(404).end();
    const file = await readFile(join(ROOT, path));
    response.writeHead(200, { 'Content-Type': TYPES[extname(path)], 'Cache-Control': 'no-store' }).end(file);
  } catch (error) {
    response.writeHead(error.code === 'ENOENT' ? 404 : 500).end();
  }
});
server.on('error', (error) => {
  if (error.code !== 'EADDRINUSE') throw error;
  console.error(`port ${PORT} is taken by another server (see: lsof -i :${PORT}); stop it, or start this one elsewhere: PORT=${PORT + 1} npm start`);
  process.exit(1);
});
server.listen(PORT, '127.0.0.1', () => {
  embed(['warm up']).catch((error) => console.error(`the notebook's embedding model could not be loaded: ${error.message}`)); // the first load is the slow one: do it before a notebook asks
  console.log(`http://127.0.0.1:${PORT}/  serving ${ROOT}  (Jev: ${key ? 'key found' : 'no key, kept answers only'})`);
});
