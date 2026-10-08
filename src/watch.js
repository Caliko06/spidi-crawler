// Watching Jev make its plan, on the page itself, while the console reads
// out the rest. The text starts out unread, faint but for its headings, the
// outline Jev surveys first. A section it rules out goes all but blank. A
// passage it is reading has a bracket beside it, and many are read at once
// all over the page; as Jev rates its sentences each takes its ink, from dim
// for one a sparing reader passes over to bright for one they would keep if
// they could keep only three, and those it keeps get their tick. Once the
// whole text is read it settles into the page's own four steps of ink. The
// term Jev names each kept sentence by is underlined in it, and loses its
// line if Jev says it is no subject; a sentence that repeats another loses
// its tick; and the ticks take the colour of their worth.
//
// So that none of it reads as mere motion, the page says what Jev is doing:
// a line over the text names the step it is at, in words, with how far it
// has got, and beside each passage, as a proofreader would, a note says
// it is being read and then what Jev kept of it.
//
// Jev holds the stage: the page is not handed over to page.js, nor the
// console to the web, until the plan is whole and the reader lets the
// crawler go. Then, `early`, the page is page.js's and the crawler sets off,
// and the web takes the console's place. The reader may skip
// the rest, and the plan is then fetched whole; `skip` does it from outside.

import { createConsole } from './console.js';
import { rangeIn } from './dom.js';
import { ruleOut } from './page.js';
import { two } from './util.js';

const INK = 4; // the steps of Jev's rating of a sentence
const number = new Intl.NumberFormat('en');

// Streams Jev's plan for the page `asked` for, its document shown as `els`,
// in Jev's `voice` for its language, with `margin` for its brackets and ticks, `panel` for the console, the
// buttons of `toggle` for how much of it shows and `status` for what is said
// while it is hidden.
// Returns `{ early, whole, skip }`: what the crawler needs to set off, the
// whole plan, and how to have it whole now.
export function watchPlan(asked, { els, blocks, title, voice, margin, panel, toggle, status }) {
  const stream = new EventSource(`/api/watch?${asked}`);
  let go;
  const released = new Promise((resolve) => (go = resolve)); // the reader lets the crawler go
  const view = createConsole(panel, { title, blocks, toggle, status, probe, voice }, skip, go);
  let early;
  let whole;
  let settled = false; // whether the plan has arrived or failed
  const plans = { early: new Promise((resolve, reject) => (early = { resolve, reject })), whole: new Promise((resolve, reject) => (whole = { resolve, reject })) };
  plans.whole.catch(() => {}); // a plan that fails says so through `early`

  const rangeOf = ({ block, start, end }) => rangeIn(els[block], start, end);
  const keyOf = ({ block, start }) => `${block}:${start}`;
  // The console points at a passage: it is marked on the text, and the reader is taken to it on a click.
  const pointed = new Highlight();
  CSS.highlights.set('pointed', pointed);
  function probe(wheres, go) {
    pointed.clear();
    if (!wheres) return;
    for (const where of wheres) pointed.add(rangeOf(where));
    if (go) els[wheres[0].block].scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  const article = els[0].closest('article');
  const inks = Array.from({ length: INK }, (_, step) => {
    const highlight = new Highlight();
    CSS.highlights.set(`rated-${step}`, highlight);
    return highlight;
  });
  const named = new Highlight();
  CSS.highlights.set('named', named);
  const names = new Map(); // a name, folded → the ranges it is underlined at
  const brackets = new Map(); // the first sentence of a passage being read → its bracket
  const ticks = new Map(); // a kept sentence → its tick
  article.classList.add('is-unread');
  // What Jev is doing, in words, over the text.
  const caption = document.body.appendChild(document.createElement('p'));
  caption.id = 'jev-caption';
  caption.setAttribute('role', 'status');
  const say = (text) => (caption.textContent = text);
  const notes = new Map(); // the first sentence of a passage → the note beside it
  const reading = { count: 0, done: 0 };
  const readingLine = () => {
    say(voice.reading(two(reading.done), two(reading.count)));
    caption.style.setProperty('--read', String(reading.count ? reading.done / reading.count : 0));
  };

  // A mark in the margin beside the sentences at `wheres`, from the top of the first to the foot of the last.
  function mark(wheres, className) {
    const first = rangeOf(wheres[0]).getClientRects()[0];
    const rects = rangeOf(wheres.at(-1)).getClientRects();
    const last = rects[rects.length - 1];
    const el = margin.appendChild(document.createElement('i'));
    el.className = className;
    el.style.top = `${first.top + scrollY}px`;
    el.style.height = `${last.bottom - first.top}px`;
    return el;
  }

  function tick(where) {
    if (!ticks.has(keyOf(where))) ticks.set(keyOf(where), mark([where], 'jev-tick'));
    return ticks.get(keyOf(where));
  }

  // A note beside a passage, level with its first sentence.
  function note(where, text) {
    const el = margin.appendChild(document.createElement('span'));
    el.className = 'jev-note';
    el.style.top = `${rangeOf(where).getClientRects()[0].top + scrollY}px`;
    el.textContent = text;
    return el;
  }

  // What the page shows of an event of the plan.
  function show(event) {
    switch (event.type) {
      case 'ask':
        if (event.stage === 'part' && !caption.textContent) say(voice.surveys);
        break;
      case 'survey':
        ruleOut(els, blocks, event.apparatus, voice.ruled);
        say(voice.reads(number.format(event.words)));
        break;
      case 'passages':
        reading.count = event.count;
        readingLine();
        break;
      case 'reading':
        brackets.set(keyOf(event.sentences[0]), mark(event.sentences, 'jev-reading'));
        notes.set(keyOf(event.sentences[0]), note(event.sentences[0], voice.note));
        break;
      case 'rated':
        brackets.get(keyOf(event.sentences[0]))?.remove();
        for (const { score, ...where } of event.sentences) inks[Math.min(INK - 1, Math.max(0, Math.round(score)))].add(rangeOf(where));
        break;
      case 'read': {
        event.kept.forEach(tick);
        reading.done += 1;
        readingLine();
        const el = notes.get(keyOf(event.first));
        if (el) {
          el.textContent = event.kept.length ? voice.kept(event.kept.length, event.of) : voice.passes;
          el.classList.add(event.kept.length ? 'is-kept' : 'is-passed');
        }
        break;
      }
      case 'sifted': {
        // The whole text is read: it settles into the page's own ink, and only what is kept keeps its tick.
        for (const ink of inks) ink.clear();
        CSS.highlights.set('passed', new Highlight(...event.passed.map(rangeOf)));
        article.classList.remove('is-unread');
        const kept = new Set(event.kept.map(keyOf));
        for (const [key, el] of ticks) if (!kept.has(key)) (el.remove(), ticks.delete(key));
        event.kept.forEach(tick);
        say(voice.keeps(event.kept.length));
        break;
      }
      case 'named':
        for (const { form, ...where } of event.names) {
          if (!form) continue;
          const at = els[where.block].textContent.slice(where.start, where.end).toLowerCase().indexOf(form.toLowerCase());
          if (at < 0) continue;
          const range = rangeOf({ block: where.block, start: where.start + at, end: where.start + at + form.length });
          named.add(range);
          const key = form.toLowerCase();
          names.set(key, [...(names.get(key) ?? []), range]);
        }
        break;
      case 'candidates':
        say(voice.weighs(event.terms.length));
        break;
      case 'taken':
        for (const { label, p } of event.terms) if (p < 0.5) for (const range of names.get(label.toLowerCase()) ?? []) named.delete(range);
        say(voice.takes(event.terms.filter(({ p }) => p >= 0.5).length));
        break;
      case 'filed':
        say(voice.sorts);
        break;
      case 'distinct':
        for (const where of event.dropped) {
          ticks.get(keyOf(where))?.remove();
          ticks.delete(keyOf(where));
        }
        break;
      case 'worth': {
        const prizes = new Set(event.prizes.map(keyOf));
        for (const [key, el] of ticks) el.classList.add(prizes.has(key) ? 'is-prize' : 'is-catch');
        break;
      }
      case 'early':
        break; // the crawler could set off, but it waits for the reader
      case 'plan':
        finish(event.plan);
        break;
      case 'error':
        fail(event.error);
        break;
    }
  }

  // The page is page.js's from here: what watching drew on it goes.
  function handOver() {
    pointed.clear();
    for (const ink of inks) ink.clear();
    named.clear();
    for (const el of [...brackets.values(), ...ticks.values(), ...notes.values()]) el.remove();
    brackets.clear();
    ticks.clear();
    notes.clear();
    caption.remove();
    article.classList.remove('is-unread');
  }

  function finish(plan) {
    settled = true;
    stream.close();
    view.settle();
    released.then(() => {
      handOver();
      early.resolve(plan);
      whole.resolve(plan);
      view.give();
    });
  }

  function fail(message) {
    settled = true;
    stream.close();
    handOver();
    view.fail(message);
    early.reject(new Error(message));
    whole.reject(new Error(message));
  }

  // The reader would rather not wait: the plan is fetched whole.
  async function skip() {
    if (settled) return;
    stream.close();
    const response = await fetch(`/api/plan?${asked}`);
    const body = await response.json();
    if (response.ok) finish(body);
    else fail(body.error);
  }

  stream.addEventListener('message', ({ data }) => {
    const event = JSON.parse(data);
    view.read(event);
    show(event);
  });
  // The stream is closed when the plan arrives or fails, so an error here is a break before that: a plan not made. The browser would
  // reconnect by itself and have the whole plan told again, events twice over.
  stream.addEventListener('error', () => fail('the stream of the plan broke off'));

  return Object.assign(plans, { skip });
}
