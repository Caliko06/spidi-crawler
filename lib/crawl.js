// The crawl: a page goes in, and what comes out is the document the reader
// shows and Jev's plan for it: the sentences of it the crawler keeps, the
// subjects they are filed under and how those bear on one another. Fetching,
// extraction, segmentation, triage and subjects each live in their own
// module; this is the line that runs through them.

import { extract } from './extract.js';
import { extractPdf } from './pdf.js';
import { countWords, segment, where } from './segment.js';
import { remark } from './remarks.js';
import { attach, cover, file, gather, name, pull, relate, subjects } from './subjects.js';
import { termsIn } from './topics.js';
import { crown, distinct, KEY, PASSED, sift, survey } from './triage.js';

const FETCH_MS = 20000;
const MAX_BYTES = 5_000_000;
const MAX_PDF_BYTES = 40_000_000;
const USER_AGENT = 'Mozilla/5.0 (compatible; SemanticCrawler/2)'; // many sites refuse a client that does not say what it is

// The bytes of the page at `url`: HTML, or a PDF.
export async function fetchPage(url) {
  const { host } = new URL(url);
  let response;
  try {
    response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html, application/pdf;q=0.9' }, signal: AbortSignal.timeout(FETCH_MS) });
  } catch (error) {
    throw new Error(error.name === 'TimeoutError' ? `${host} took more than ${FETCH_MS / 1000} s to answer` : `${host} could not be reached`);
  }
  if (!response.ok) throw new Error(`${host} answered ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  // What the bytes are, not what the server says they are: many serve a PDF as octet-stream.
  if (isPdf(bytes)) {
    if (bytes.length > MAX_PDF_BYTES) throw new Error('the PDF is too large to read');
    return bytes;
  }
  if (!/html/.test(response.headers.get('content-type') ?? '')) throw new Error('the address does not lead to an HTML page or a PDF');
  if (bytes.length > MAX_BYTES) throw new Error('the page is too large to read');
  return bytes;
}

const isPdf = (bytes) => typeof bytes !== 'string' && bytes.subarray(0, 1024).includes('%PDF-');

// The document in `page`, the bytes of the page at `url` (HTML as text, or a
// PDF): `{ title, url, words, blocks, figures, meta }` (see extract.js).
export async function open(page, url) {
  const { title, blocks, figures, meta } = isPdf(page) ? await extractPdf(page) : extract(page.toString(), url);
  const words = blocks.reduce((sum, { text }) => sum + countWords(text), 0);
  return { title, url, words, blocks, figures, meta };
}

// Jev's plan for `doc`, made before the crawler sets off: `{ apparatus,
// passed, topics, parents, links, kept, pulls }`. `apparatus` are the sections it rules out,
// by the index of their headings, `passed` the sentences of the rest a
// sparing reader passes over, `topics` the subjects Jev finds in what is
// kept, `links` which two of them have to do with each other and how much,
// `{ a, b, weight }`, `parents` for each subject null for a theme the
// document is built on, or the theme it belongs under, and `kept` the sentences the crawler keeps, in reading
// order, each with its `worth`, whether it is the `lead`, the `topic` it is
// filed under and the other subjects it `ties` to, and whether the crawler
// points it out as a `surprise` or for its `figures`; `pulls` which two kept
// sentences under different subjects have much to do with each other and
// how much, `{ a, b, weight }`, indexes into `kept`.
//
// `tell(event)` is told each of Jev's decisions as it is made, a sentence
// given by where it is, `{ block, start, end }`: `survey`, the
// passages `sift` reads, `sifted`, `named`, what `subjects` finds, `filed`,
// `distinct`, `worth`, `remarks`; then `early`, the plan but for `parents`,
// `links` and `pulls`, which is all the crawler needs to set off; then
// `links`, each `theme` as it is picked, `pulls`, and the `folds`.
export async function plan(doc, ask, tell = () => {}) {
  const sentences = segment(doc.blocks);
  if (sentences.length === 0) throw new Error('the page has no running text');
  const apparatus = await survey(doc, sentences, ask);
  const text = sentences.filter(({ section }) => !apparatus.has(section));
  const words = text.reduce((sum, { text }) => sum + countWords(text), 0); // of the text, not of the apparatus: what 'kept' is a share of
  tell({ type: 'survey', sections: new Set(sentences.map(({ section }) => section)).size, apparatus: [...apparatus], key: KEY, passed: PASSED, words });
  if (text.length === 0) throw new Error('the page is all apparatus, with no text of its own');
  const readings = await sift(doc, text, ask, tell);
  const picked = text.flatMap((sentence, at) => (readings[at].kept ? [{ ...sentence, at, score: readings[at].score }] : []));
  const passed = text.filter((_, at) => !readings[at].kept && readings[at].score < PASSED).map(where);
  tell({ type: 'sifted', kept: picked.map(where), passed });
  if (picked.length === 0) throw new Error('Jev finds nothing in the page worth keeping');

  const names = await name(doc, picked, termsIn(text), ask);
  tell({ type: 'named', names: picked.map((sentence, i) => ({ ...where(sentence), form: names[i]?.form ?? null, options: names[i]?.options ?? [] })) });
  const { labels, holds, home, outline } = await subjects(doc, picked, names, ask, tell);
  const filed = await file(doc, picked, labels, holds, ask, home);
  tell({ type: 'filed', sentences: picked.map((sentence, i) => ({ ...where(sentence), topic: labels[filed[i].topic], options: filed[i].options.map(({ topic, p, belongs }) => ({ label: labels[topic], p, belongs })), whole: filed[i].whole ?? null })) });
  const byPlace = new Map(picked.map((sentence) => [sentence.at, sentence]));
  picked.forEach((sentence, i) => Object.assign(sentence, filed[i], { needs: byPlace.get(readings[sentence.at].needs) ?? null }));

  const kept = await distinct(doc, picked, ask, tell);
  tell({ type: 'distinct', dropped: picked.filter((sentence) => !kept.includes(sentence)).map(where) });
  const [worth, remarks] = await Promise.all([
    crown(doc, kept, ask).then((worth) => (tell({ type: 'worth', prizes: kept.filter((_, i) => worth[i].worth === 'prize').map(where), lead: where(kept[worth.findIndex(({ lead }) => lead)]), odds: kept.map((sentence, i) => ({ ...where(sentence), p: worth[i].odds, rank: worth[i].rank })) }), worth)),
    remark(doc, kept, ask).then((remarks) => (tell({ type: 'remarks', surprises: kept.filter((_, i) => remarks[i].surprise).map(where), figures: kept.filter((_, i) => remarks[i].figures).map(where) }), remarks)),
  ]);
  // The sentence that says the whole document is filed under what the document is called.
  const lead = kept[worth.findIndex(({ lead }) => lead)];
  const whole = labels.indexOf(doc.title);
  if (lead.topic !== whole) Object.assign(lead, { ties: [lead.topic, ...lead.ties.filter((tie) => tie !== whole)], topic: whole });
  // The subjects something is left under, as the reader is given them.
  // A heading that holds nothing of its own is left with the headings under it that hold something.
  const holding = (i) => kept.some(({ topic }) => topic === i);
  const used = labels.flatMap((_, i) => (holding(i) || outline.some((parent, j) => parent === i && holding(j)) ? [i] : []));
  const topics = used.map((i) => labels[i]);
  const under = used.map((i) => kept.filter(({ topic }) => topic === i));
  const early = {
    apparatus: [...apparatus],
    words,
    passed,
    topics,
    kept: kept.map(({ block, start, end, text, topic, ties }, i) => ({
      block, start, end, text, ...worth[i], ...remarks[i],
      topic: used.indexOf(topic),
      ties: ties.flatMap((tie) => (used.includes(tie) ? [used.indexOf(tie)] : [])),
    })),
  };
  tell({ type: 'early', plan: early });

  const [links, parents, pulls] = await Promise.all([
    relate(doc, topics, under, ask).then((links) => (tell({ type: 'links', links: links.map(({ a, b, weight }) => ({ a: topics[a], b: topics[b], weight })) }), links)),
    gather(doc, topics, under, ask, tell, used.map((i) => (outline[i] === undefined ? undefined : used.includes(outline[i]) ? used.indexOf(outline[i]) : null))),
    pull(doc, kept, ask).then((pulls) => (tell({ type: 'pulls', count: pulls.length }), pulls)),
  ]);
  const attached = attach(parents, links, topics.indexOf(doc.title));
  return { ...early, parents: attached, folds: await cover(doc, topics, attached, under, ask, tell), links, pulls };
}

// Where a sentence is: its block and its offsets in it.

// Reads `html`, the page at `url`: the document and Jev's plan for it, in one.
export async function read(html, url, ask) {
  const doc = await open(html, url);
  return { ...doc, ...(await plan(doc, ask)) };
}
