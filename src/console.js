// The console: while Jev makes its plan, where the web will be, an
// instrument that reads out what Jev is doing. Jev answers typed questions,
// many at once in one request, with a probability for every answer it could
// give: every decision of the plan is an if on a yes or no, a pick between
// options, or a rating on a scale, and the console shows each as such.
//
// Over it, what Jev has made of the text so far, the words it keeps and the
// sentences it calls essential, passes over and rules out, then how long it
// has been at it, how many questions it has answered, and whether it answers
// now (live) or gives again answers it gave before (replay), at the pace it
// first gave them. Under that, a light strip of one line: the subjects Jev
// weighs, three at a time, each read, then taken or struck, and carried along
// by the next. Under the strip, two columns. On the left the stages of the
// plan, each a track along the time the plan has taken: a line under it for as
// long as the stage has gone on, and a line for every request Jev has out,
// each in a lane of its own, ending in a tick where it came back, so that
// how thick the ticks fall is how fast Jev answers.
//
// On the right, which takes the room, the verdicts, by stage. Each stage has
// a head that stays at the top as its rows go by: what it came to, how many
// questions it took, and its spread, how sure Jev was of each verdict from
// unsure to sure, so the close calls (the bright half) are seen at once. The
// rows are every verdict: a yes or no drawn from the line at one half to the
// side it fell, how far being how sure; the options of a pick as shares of
// one bar; the levels of a rating as the probability of each. Each leads with
// what it came to (Key, Detail, Alone, Essential), then what it asked and
// about what. What a passage came to is ruled off under the verdicts it is
// the sum of; pointing at it marks the passage on the text, and a click takes
// the reader to it. What Jev was unsure of is bright; what it was sure of
// falls back and is folded into one row.
//
// The reader sets how much of Jev they see, from the bar: hidden, with its
// marks on the text; docked, where the web will be, giving way to the web
// when the reader lets the crawler go, which they may do once the plan is
// made, and until then Jev holds the stage and its verdicts can be read; or open over the window but for a strip of the
// text, with every verdict of every request, which the reader can narrow to
// the close calls. Once the plan is made the console is still there to be
// opened, to go back over what Jev decided. J goes from one to the next.
//
// It reads the events of the plan as the server streams them; it decides
// nothing.

import { figure, make, number } from './dom.js';
import { clamp, two } from './util.js';

const STAGES = [
  { name: 'Survey', asks: ['part'], done: ['survey'] },
  { name: 'Read', asks: ['standing'], done: ['sifted'] },
  { name: 'Name', asks: ['name'], done: ['named'] },
  { name: 'Subjects', asks: ['section', 'subject', 'alias', 'heading'], done: ['merged', 'filed'] },
  { name: 'File', asks: ['file', 'belongs', 'whole'], done: ['filed'] },
  { name: 'Repeats', asks: ['same'], done: ['distinct'] },
  { name: 'Worth', asks: ['handful', 'prize', 'lead'], done: ['worth'] },
  { name: 'Remarks', asks: ['pick'], done: ['remarks'] },
  { name: 'Relations', asks: ['closest', 'bond'], done: ['links'] },
  { name: 'Themes', asks: ['theme', 'parent', 'fall', 'host'], done: [] },
  { name: 'Pulls', asks: ['nearest', 'pull'], done: ['pulls'] },
];
const CLOSE = 0.5; // how unsure Jev has to be of a verdict for it to be a close call
const PASSAGE = ['standing']; // what is asked of a passage: the line for the passage says what it came to
// Stages whose work the reader does not see on the page as such: their head says what they came to, and their rows open on a click.
const QUIET = ['Repeats', 'Pulls'];
// Questions that only find candidates for the next one to decide on (which pair to bond, which to pull): counted, never a row of their own.
const CANDIDATES = ['nearest', 'closest'];
const NAME = 40; // characters up to which what a verdict is about is a name, not a sentence
const FEW = 2; // questions a request has at most for all of them to be read out
const MODES = ['hide', 'dock', 'open'];
const BOTTOM = 40; // px from the foot of the verdicts within which the reader is following the newest
const LANES = 8; // requests a stage's track has room for side by side, one above the other up the height of the row
const FADE_MS = 420; // how long the console takes to give way to the web

const REEL = { slots: 3, total: 6000, gap: [60, 300], read: 3, landed: 900 }; // subjects in the strip at once; ms the whole run of a plan's subjects takes, and the least and most between one and the next; gaps a subject is read for before it is told; ms it flares for once it has landed
const BINS = 20; // how many places along a stage's spread a verdict can fall, from unsure to sure
const TICKS = 32; // the most ticks a folded group of sure verdicts shows

// How unsure Jev is of a verdict, from 0 for sure to 1 for a toss-up. A
// verdict the plan decides by a line is as sure as it is far from that line,
// out of how far it could be on its side of it (a rating runs to 3); any
// other, by how split Jev was.
function doubt(verdict) {
  if (verdict.line) {
    const { value, line: { at, name } } = verdict;
    const top = name === 'keep' ? 3 : 1;
    return 1 - Math.min(1, Math.abs(value - at) / (value >= at ? top - at : at));
  }
  return verdict.type === 'boolean' ? 1 - 2 * Math.abs(verdict.p - 0.5) : 1 - verdict.confidence;
}

// The gauge of a verdict: a yes or no as a bar against the line at one half;
// a pick as the shares of its likeliest options along one bar; a rating as
// the probability of each of its levels.
function gauge(parent, verdict) {
  const el = make('span', parent, `jev-gauge is-${verdict.type}`);
  if (verdict.type === 'boolean') make('i', el).style.width = `${verdict.p * 100}%`;
  else if (verdict.type === 'choice') for (const [, p] of verdict.options) make('i', el).style.width = `${p * 100}%`;
  else for (const p of verdict.levels) make('i', el).style.height = `${Math.max(p * 100, 4)}%`;
  return el;
}

// The console in `el`, for the document called `title` whose `blocks` Jev
// is planning, in Jev's `voice` for its language, its mode set from the buttons of `toggle`; `status` says Jev
// is at work while it is hidden; `probe(wheres, go)` marks the passage a line
// is about on the text, and takes the reader to it when `go`; `onSkip` is called when the reader would
// rather not wait, `onGo` when the plan is made and the reader lets the crawler go.
// What went wrong, as the server tells it, in two lines: what happened, and what it means for the reader.
const REASONS = [
  [/no AI_GATEWAY_API_KEY/, 'Jev has not judged this page before', 'This server has no key to ask Jev with, so it can only replay pages Jev has already judged. Pick one from the shelf, or start the server with a key.'],
  [/spent \$.*its limit/, 'This run has used up its budget for Jev', 'The server stops asking Jev past its spending limit. Restart it with JEV_LIMIT=<dollars> to go on.'],
  [/Jev gave no answer/, 'Jev did not answer', 'Its service answered with an error. What it has answered is kept, so trying again picks up where this stopped.'],
  [/fetch failed|timed out|aborted|TimeoutError/, 'Jev could not be reached', 'The network dropped on the way to Jev. What it has answered is kept, so trying again picks up where this stopped.'],
  [/stream of the plan broke off/, 'The connection to the server was lost', 'Check that the server is still running, then try again.'],
  [/no running text/, 'There is nothing here to read', 'The page is made of links and menus, or draws itself with scripts, so there is no running text to crawl.', false],
  [/nothing in the page worth keeping/, 'Jev found nothing worth keeping', 'It read the page and rated no sentence high enough to keep. Pages of headlines and short captions do this.', false],
  [/all apparatus/, 'There is nothing here to read', 'Everything on the page is navigation, notes or references; none of it is text of its own.', false],
];
// The last of each is whether trying again could change it: a page with nothing to keep will have nothing the next time.
const explain = (message) => REASONS.find(([pattern]) => pattern.test(message))?.slice(1) ?? ['Jev made no plan', message, true];

export function createConsole(el, { title, blocks, toggle, status, probe, voice }, onSkip, onGo) {
  el.replaceChildren();
  const header = make('header', el);
  const readout = make('p', header, 'web-readout');
  const reading = (label) => {
    const span = make('span', readout);
    const b = make('b', span);
    make('i', span, '', label);
    return b;
  };
  const kept = reading('Words kept');
  // What is kept of the text stands as a block beside it, filled as high as the share kept.
  const volume = make('div', kept.parentElement, 'jev-gauge is-volume');
  const filled = make('i', volume);
  const keeping = (words) => {
    kept.textContent = `${number.format(words)} / ${number.format(total)}`;
    filled.style.height = `${total ? Math.min(words / total, 1) * 100 : 0}%`;
  };
  const essential = reading('Essential');
  const passed = reading('Passed over');
  const ruled = reading('Ruled out');
  const elapsed = reading('Seconds');
  const answered = reading('Questions');
  const source = reading('Jev');
  for (const b of [kept, essential, passed, ruled, source]) b.textContent = '—';
  const controls = make('span', header, 'jev-controls');
  const closeOnly = make('button', controls, 'web-read jev-close-only', 'Close calls');
  closeOnly.type = 'button';
  closeOnly.setAttribute('aria-pressed', 'false');
  closeOnly.addEventListener('click', () => {
    const on = closeOnly.getAttribute('aria-pressed') !== 'true';
    closeOnly.setAttribute('aria-pressed', String(on));
    feed.classList.toggle('is-close-only', on);
    follow(true);
  });
  const skip = make('button', controls, 'web-read', 'Skip');
  skip.type = 'button';
  skip.addEventListener('click', onSkip);
  // The same button again at the foot, for when the reader is down in the sections; it stays faint.
  const foot = make('footer', el, 'jev-foot');
  const skipLow = make('button', foot, 'web-read', 'Skip');
  skipLow.type = 'button';
  skipLow.addEventListener('click', onSkip);

  // The subjects are a light strip over everything: three at a time, running along as Jev takes or strikes each.
  const strip = make('section', el, 'jev-strip');
  make('b', strip, '', 'Subjects');
  const reel = make('ul', strip, 'jev-board jev-reel');
  const tally = make('span', strip, 'jev-tally');

  // The rest is two columns: what Jev is doing, and what it has decided, which takes the room.
  const sections = make('div', el, 'jev-sections');
  const [left, right] = [make('div', sections, 'jev-col'), make('div', sections, 'jev-col')];
  const section = (column, title, name) => {
    const el = make('section', column, `jev-section is-${name}`);
    const head = make('header', el);
    make('b', head, '', title);
    const line = make('span', head);
    return { body: make('div', el, 'jev-section-body'), say: (text) => (line.textContent = text) };
  };
  const steps = section(left, 'Steps', 'steps');
  const verdictsSection = section(right, 'Verdicts', 'verdicts');
  // Under the steps, what the whole run is for: the sentences Jev holds essential, as it finds them. Pointing at one marks it on the text; a click goes there.
  const gist = section(left, 'What Jev keeps', 'gist');
  const gistList = make('ol', gist.body, 'jev-gist');
  let landed = false; // whether the reader has gone to a sentence: its mark then stays until another is pointed at
  const gistLine = (where, p, rank, kept) => {
    const li = make('li', gistList, kept ? '' : 'is-next');
    make('b', li, '', kept ? two(rank) : 'next');
    make('span', li, '', textOf(where));
    make('i', make('em', li, 'jev-gist-p'), '').style.width = `${p * 100}%`;
    make('u', li, '', figure(p));
    li.title = kept ? 'Click: go to this sentence in the text' : 'The likeliest of those Jev left out: where the line fell';
    li.addEventListener('mouseenter', () => probe([where], false));
    li.addEventListener('mouseleave', () => !landed && probe(null, false));
    li.addEventListener('click', () => {
      landed = true;
      if (mode === 'open') show('dock');
      probe([where], true);
    });
  };

  const list = make('ol', steps.body, 'jev-stages');
  const stages = STAGES.map((stage, i) => {
    const li = make('li', list);
    make('b', li, '', two(i + 1));
    make('span', li, '', voice.stages[stage.name]);
    const track = make('span', li, 'jev-track');
    return { ...stage, li, track, span: make('i', track, 'jev-span'), time: make('time', li), start: null, end: null, lanes: [] };
  });
  const speed = make('p', steps.body, 'jev-speed');
  const columns = make('div', verdictsSection.body, 'jev-verdict jev-columns');
  for (const label of ['No.', 'Says', 'About', 'Gauge', 'P']) make('span', columns, '', label);
  const feed = make('div', verdictsSection.body, 'jev-feed');

  // How much of Jev the reader sees.
  let mode = 'dock';
  let pinned = true; // whether the verdicts follow the newest
  let made = false; // whether the plan is made
  let held = false; // whether the plan is made and the crawler not yet let go
  let go = null; // the button that lets it
  const letGo = () => {
    if (!held) return;
    held = false;
    onGo();
  };
  const buttons = [...toggle.querySelectorAll('button')];
  function show(next) {
    mode = next;
    el.classList.remove('is-done');
    el.hidden = mode === 'hide';
    document.body.classList.toggle('jev-hidden', mode === 'hide');
    document.body.classList.toggle('jev-open', mode === 'open');
    for (const button of buttons) button.setAttribute('aria-pressed', String(button.value === mode));
    status.textContent = mode === 'hide' && !made ? 'Jev is making its plan' : '';
    follow(true);
  }
  for (const button of buttons) button.addEventListener('click', () => show(button.value));
  addEventListener('keydown', (event) => {
    if (event.key !== 'j' && event.key !== 'J') return;
    if (event.metaKey || event.ctrlKey || event.altKey || event.target.closest?.('input, select, textarea')) return;
    show(MODES[(MODES.indexOf(mode) + 1) % MODES.length]);
  });
  addEventListener('keydown', (event) => {
    if (event.key !== ' ' || event.metaKey || event.ctrlKey || event.altKey || event.target.closest?.('input, select, textarea, button, a')) return;
    if (!held) return;
    event.preventDefault();
    letGo();
  });
  toggle.hidden = false;
  show(mode);

  const textOf = ({ block, start, end }) => blocks[block].text.slice(start, end);
  const clock = { start: performance.now() };
  const counts = { answered: 0, live: false };
  const passages = { count: 0, read: 0, kept: 0, words: 0 };
  let keptWords = 0; // words of what Jev keeps once it has read all of it; the repeats it drops come off after
  const words = (wheres) => wheres.reduce((sum, where) => sum + textOf(where).split(/\s+/).filter(Boolean).length, 0);
  let total = 0; // words of the text a summary is made from
  const requests = new Map(); // id → `{ stage, lane, start, end, bar }`
  const ledger = { requests: 0, questions: 0, out: 0, peak: 0, took: [], tokens: 0, dollars: 0 }; // what Jev has been asked, and how it was answered
  const inReel = []; // the subjects in the strip, oldest first
  const count = { of: 0, told: 0, taken: 0 }; // the names weighed, and how many of them have been told, taken
  const themes = [];
  const folded = new Map(); // stage and verdict → the row the sure ones of it are folded into
  let frame = requestAnimationFrame(tick);

  // How long Jev has been at it, and each stage: a track along the whole time so far, a line for how long it went on, and for every request out a line from when it went out, until the tick where it came back.
  function tick(now) {
    const long = now - clock.start;
    elapsed.textContent = (long / 1000).toFixed(1).padStart(4, '0');
    const at = (moment) => `${((moment - clock.start) / long) * 100}%`;
    for (const stage of stages) {
      if (stage.start === null) continue;
      stage.time.textContent = `${(((stage.end ?? now) - stage.start) / 1000).toFixed(1)} s`;
      stage.span.style.left = at(stage.start);
      stage.span.style.width = `${(((stage.end ?? now) - stage.start) / long) * 100}%`;
    }
    for (const { start, end, bar } of requests.values()) {
      bar.style.left = at(end ?? start);
      if (end === null) bar.style.width = `${((now - start) / long) * 100}%`;
    }
    steps.say(`${stages.filter(({ end }) => end !== null).length} of ${stages.length} · ${(long / 1000).toFixed(1)} s`);
    frame = requestAnimationFrame(tick);
  }

  function begin(stage) {
    if (stage.start !== null) return;
    stage.start = performance.now();
    stage.li.classList.add('is-on');
  }
  function end(stage) {
    begin(stage);
    if (stage.end !== null) return;
    stage.end = performance.now();
    stage.li.classList.replace('is-on', 'is-done');
  }
  const stageNamed = (name) => stages.find((one) => one.name === name);

  // The verdicts keep to the newest, until the reader scrolls back from them; reaching the foot again picks them up.
  feed.addEventListener('scroll', () => (pinned = feed.scrollHeight - feed.scrollTop - feed.clientHeight < BOTTOM));
  function follow(always = false) {
    if (always) pinned = true;
    if (pinned) feed.scrollTop = feed.scrollHeight;
  }

  // The verdicts are kept by stage, in the order the stages began, each under a head that stays at the top while its rows scroll by:
  // its number and name, what it came to once it is done, how many questions and requests it took, and its spread, a bar for every
  // place a verdict can fall from unsure to sure (the bright ones are the close calls, the line the one a verdict is close to).
  const chapters = new Map();
  function chapterOf(stage) {
    if (chapters.has(stage)) return chapters.get(stage);
    const el = make('section', feed, 'jev-chapter');
    const head = make('header', el);
    make('b', head, '', two(stages.indexOf(stage) + 1));
    make('span', head, 'jev-chapter-name', voice.stages[stage.name]);
    const chapter = { el, said: make('span', head, 'jev-chapter-said'), stat: make('span', head, 'jev-chapter-stat'), spread: make('span', head, 'jev-spread'), bins: [], heights: Array(BINS).fill(0), count: 0, questions: 0, took: [] };
    // Under its name, what the stage asks Jev, in a line: the rows under it are its answers.
    make('p', head, 'jev-chapter-does', voice.does[stage.name]);
    chapter.spread.title = 'How sure Jev was of each verdict in this stage, from unsure (left) to sure (right); the bright half is the close calls';
    if (QUIET.includes(stage.name)) {
      el.classList.add('is-quiet');
      head.title = voice.opens;
      head.addEventListener('click', () => el.classList.toggle('is-open'));
    }
    for (let i = 0; i < BINS; i++) chapter.bins.push(make('i', chapter.spread, i < BINS / 2 ? 'is-near' : ''));
    chapters.set(stage, chapter);
    return chapter;
  }

  // A row under the head of its stage: every one is kept, to be read again with the console open.
  function row(className, stage) {
    const el = make('div', chapterOf(stage).el, className);
    follow();
    return el;
  }

  // What a stage has come to, said once it is done, in its head; or, for what it comes to several times, a line of its own.
  function sum(name, text, line = false) {
    const stage = stageNamed(name);
    begin(stage);
    stage.li.title = text;
    const chapter = chapterOf(stage);
    if (!line) return void (chapter.said.textContent = text);
    make('span', make('div', chapter.el, 'jev-sum'), '', text);
    follow();
  }

  // One verdict of Jev's, with the request it came in: how many questions
  // that held and how long it took. The `lead` of its request, the one Jev
  // was least sure of, shows docked; the rest only with the console open.
  function verdict(one, stage, owner, info, lead) {
    const chapter = chapterOf(owner);
    chapter.heights[Math.min(Math.floor((1 - doubt(one)) * BINS), BINS - 1)] += 1;
    const tallest = Math.max(...chapter.heights);
    chapter.bins.forEach((bin, i) => (bin.style.height = `${(chapter.heights[i] / tallest) * 100}%`));
    // A verdict the plan decides by a line is a close call when it falls in the line's band (lib/lines.js); any other, by how split Jev was.
    const close = one.close ?? doubt(one) >= CLOSE;
    const el = row(`jev-verdict${close ? ' is-close' : ''}${lead ? ' is-lead' : ''}`, owner);
    el.title = info;
    make('span', el, 'jev-stamp', String((chapter.count += 1)).padStart(3, '0'));
    const says = make('b', el);
    // A row reads as what Jev decided, then what about: the option it picked, bright, before the sentence or subject it picked it for,
    // dim; the option it nearly picked only when the call was close. What it was asked is said once, under the stage's name.
    const about = make('span', el, 'jev-about');
    const outcome = make('em', about);
    const thing = make('span', about);
    const family = one.key.replace(/\d.*$/, '');
    // Of what a yes or no is about, a name (a subject, a heading) leads, bright, and the sentence follows: "Recruit  The need to do…".
    const [short, long] = one.about.length === 2 && Math.min(...one.about.map((x) => x.length)) <= NAME ? [...one.about].sort((a, b) => a.length - b.length) : [null, one.about.join(' · ')];
    if (one.type === 'boolean') {
      outcome.textContent = short ?? '';
      thing.textContent = long;
      says.textContent = (voice.says[stage] ?? voice.yes)[one.p >= (one.line?.at ?? 0.5) ? 1 : 0];
    } else if (one.type === 'choice') {
      // Picking none of the options is an answer of its own, said in words, not an option named "none".
      const none = voice.nones[family] ?? voice.nones.pick;
      const said = (option) => (option === 'none' ? none : voice.options[option] ?? option);
      const [[first], second] = one.options;
      outcome.textContent = said(first);
      if (close && second) make('i', about, 'jev-other', ` / ${said(second[0])} ${figure(second[1])}`).after(thing);
      thing.textContent = one.about[0] ? ` ${one.about[0]}` : '';
      el.title += ` · ${one.options.map(([name, share]) => `${said(name)} ${figure(share)}`).join(' · ')}`;
      // What the plan made of it: by its line, when it has one ("alone", "apparatus"), else the likeliest option.
      const made = !one.line ? first : one.value >= one.line.at ? { alone: 'none', apparatus: 'apparatus' }[one.line.name] : { alone: 'leans', apparatus: 'text' }[one.line.name];
      says.textContent = (voice.picked[family] ?? (() => voice.picks))(made);
    } else {
      thing.textContent = one.about.join(' · ');
      // A rating is named by the lines the plan keeps and passes over by, not by rounding.
      const level = one.line ? (one.score < one.line.passed ? 0 : one.score < one.line.at ? 1 : Math.round(one.score) >= 3 ? 3 : 2) : Math.round(one.score);
      says.textContent = (voice.levels[stage] ?? ['0', '1', '2', '3'])[level];
    }
    if (stage === 'prize' && one.p >= (one.line?.at ?? 0.5)) says.classList.add('is-essential');
    const dial = gauge(el, one);
    if (one.type === 'boolean') {
      // A yes or no is drawn from the line it is decided by, to the right if it cleared it, to the left if not: how far is how sure.
      const at = one.line?.at ?? 0.5;
      dial.style.setProperty('--line', at);
      const bar = dial.firstChild;
      bar.style.width = `${Math.abs(one.p - at) * 100}%`;
      bar.style.marginLeft = `${Math.min(one.p, at) * 100}%`;
    }
    make('span', el, 'jev-figure', figure(one.type === 'boolean' ? one.p : one.type === 'choice' ? one.options[0][1] : one.score / 3));
    if (!close && !lead) fold(el, `${stage}|${says.textContent}`, 1 - doubt(one), says.textContent.toLowerCase());
  }

  // The verdicts Jev was sure of that say the same are one row: how many, a
  // tick for each as tall as it was sure, and how sure it was at the least.
  // The ones it was unsure of keep a row each.
  function fold(el, key, certain, said) {
    let group = folded.get(key);
    if (!group) {
      const ticks = make('span', el, 'jev-ticks');
      el.querySelector('.jev-gauge').replaceWith(ticks);
      group = { el, said, ticks, n: 0, least: 1, total: 0, stamp: el.querySelector('.jev-stamp'), figure: el.querySelector('.jev-figure'), about: make('span', el.querySelector('.jev-about')) };
      el.querySelector('.jev-about').replaceChildren(group.about);
      el.classList.add('is-folded');
      folded.set(key, group);
    }
    group.n += 1;
    group.least = Math.min(group.least, certain);
    group.total += certain;
    make('i', group.ticks).style.height = `${3 + 9 * certain}px`;
    while (group.ticks.children.length > TICKS) group.ticks.firstChild.remove();
    group.stamp.textContent = `×${group.n}`;
    group.figure.textContent = figure(group.total / group.n);
    group.about.textContent = ` ${voice.sure(group.said, group.n, figure(group.least))}`;
    if (group.el !== el) el.remove();
  }

  // What Jev made of one passage: what it kept, and how sure it was where it
  // cut. The ones it was unsure of show docked, with the console shut.
  function passage(event) {
    const shaky = event.doubt >= CLOSE;
    const el = row(`jev-verdict jev-passage is-lead${shaky ? ' is-close' : ''}`, stageNamed('Read'));
    make('span', el, 'jev-stamp', `${two(passages.read)}/${two(passages.count)}`);
    make('b', el, '', event.kept.length ? voice.kept(event.kept.length, event.of) : voice.passes);
    const text = make('span', el, 'jev-about');
    make('span', text, '', textOf(event.first));
    make('i', make('span', el, 'jev-gauge is-share')).style.width = `${(event.kept.length / event.of) * 100}%`;
    make('span', el);
    el.addEventListener('mouseenter', () => probe(event.sentences, false));
    el.addEventListener('mouseleave', () => probe(null, false));
    el.addEventListener('click', () => probe(event.sentences, true));
  }

  // A subject comes into the strip from the right and is read: a bright run goes along its gauge. Told, it is taken (bright) or struck
  // (dim and crossed out), and each one after it carries it a place to the left, until it leaves.
  function weigh(label, p, told) {
    const li = make('li', reel, 'is-reading');
    li.style.setProperty('--phase', `${-Math.random()}s`);
    make('span', li, '', label);
    const bar = make('i', make('span', li, 'jev-gauge is-boolean'));
    const figureEl = make('i', li);
    const word = make('b', li);
    const place = (el, slot, opacity) => {
      el.style.transform = `translateX(${slot * 100}%)`;
      el.style.opacity = String(opacity);
    };
    li.style.transition = 'none';
    place(li, REEL.slots, 0);
    inReel.push(li);
    for (const gone of inReel.splice(0, Math.max(inReel.length - REEL.slots, 0))) {
      place(gone, -1, 0);
      setTimeout(() => gone.remove(), 400);
    }
    void li.offsetWidth;
    li.style.transition = '';
    inReel.forEach((each, k) => place(each, REEL.slots - inReel.length + k, 1));
    setTimeout(() => {
      bar.style.width = `${p * 100}%`;
      figureEl.textContent = figure(p);
      word.textContent = voice.verdict(p >= 0.5);
      count.told += 1;
      count.taken += p >= 0.5 ? 1 : 0;
      tally.textContent = voice.tally(count.told, count.of, count.taken, count.told - count.taken);
      strip.classList.toggle('is-working', count.told < count.of);
      li.classList.remove('is-reading');
      li.classList.add(p >= 0.5 ? 'is-in' : 'is-out', 'is-landed');
      setTimeout(() => li.classList.remove('is-landed'), REEL.landed);
    }, told);
  }

  // An event of the plan, as the server streams it.
  function read(event) {
    switch (event.type) {
      case 'ask': {
        const own = stages.filter(({ asks }) => asks.includes(event.stage));
        const stage = own.find(({ end }) => end === null) ?? own.at(-1) ?? stages[0];
        begin(stage);
        // The request takes the first lane of its stage's track that is free.
        let lane = stage.lanes.findIndex((busy) => !busy);
        if (lane < 0) lane = Math.min(stage.lanes.length, LANES - 1);
        stage.lanes[lane] = true;
        const bar = make('i', stage.track);
        bar.style.bottom = `${(lane / LANES) * 100}%`;
        requests.set(event.id, { stage, lane, start: performance.now(), end: null, bar });
        ledger.out += 1;
        ledger.peak = Math.max(ledger.peak, ledger.out);
        break;
      }
      case 'answer': {
        const request = requests.get(event.id);
        request.end = performance.now();
        request.stage.lanes[request.lane] = false;
        request.bar.classList.add('is-back');
        request.bar.style.width = '';
        const ms = Math.round(request.end - request.start);
        // How Jev is being asked: many questions at a time, many requests at once.
        ledger.out -= 1;
        ledger.requests += 1;
        ledger.questions += event.questions;
        ledger.tokens += event.tokens ?? 0;
        ledger.dollars += event.dollars ?? 0;
        ledger.took.push(ms);
        ledger.took.sort((a, b) => a - b);
        const median = ledger.took[Math.floor(ledger.took.length / 2)];
        // In a line, what it took; how Jev was asked (many questions a request, many requests at once), on pointing at it.
        speed.textContent = `${number.format(ledger.questions)} questions in ${number.format(ledger.requests)} requests · $${ledger.dollars.toFixed(2)}`;
        speed.title = `${(ledger.questions / ledger.requests).toFixed(1)} questions a request · ${ledger.peak} out at once · ${median} ms median · ${number.format(Math.round((ledger.questions * median) / 1000))} s if asked one by one · ${number.format(ledger.tokens)} tokens`;
        verdictsSection.say(`${number.format(counts.answered + event.questions)} questions`);
        counts.answered += event.questions;
        counts.live ||= !event.recalled;
        source.textContent = counts.live ? 'Live' : 'Replay';
        const shown = event.verdicts.filter(({ key }) => !CANDIDATES.includes(key.replace(/\d.*$/, '')));
        const least = shown.reduce((a, b) => (doubt(b) > doubt(a) ? b : a), shown[0]);
        const chapter = chapterOf(request.stage);
        chapter.questions += event.questions;
        chapter.took.push(ms);
        chapter.took.sort((a, b) => a - b);
        chapter.stat.textContent = `${number.format(chapter.questions)} questions · ${chapter.took.length} requests · ${chapter.took[Math.floor(chapter.took.length / 2)]} ms`;
        for (const one of shown) verdict(one, event.stage, request.stage, `${event.questions} questions in one request, ${ms} ms`, (event.verdicts.length <= FEW && !PASSAGE.includes(event.stage)) || (one === least && !PASSAGE.includes(event.stage)));
        break;
      }
      case 'survey':
        ruled.textContent = String(event.apparatus.length);
        total = event.words;
        keeping(0);
        sum('Survey', voice.surveyed(event.sections, event.apparatus.length, event.apparatus.map((at) => blocks[at].text).join(', ')));
        break;
      case 'passages':
        passages.count = event.count;
        break;
      case 'read':
        passages.read += 1;
        passages.kept += event.kept.length;
        passages.words += words(event.kept);
        keeping(passages.words);
        passage(event);
        stageNamed('Read').li.title = `${passages.read}/${passages.count} passages · ${passages.kept} kept`;
        break;
      case 'sifted':
        passed.textContent = String(event.passed.length);
        keptWords = words(event.kept);
        keeping(keptWords);
        sum('Read', voice.sifted(event.kept.length, event.passed.length));
        break;
      case 'named':
        sum('Name', voice.named(event.names.filter(({ form }) => form).length));
        break;
      case 'candidates':
        count.of = event.terms.length;
        strip.classList.add('is-working');
        tally.textContent = voice.weighing(count.of);
        break;
      case 'taken': {
        // They run down the reel one after another, each read a moment before it is told.
        const gap = clamp(REEL.total / event.terms.length, ...REEL.gap);
        event.terms.forEach(({ label, p }, i) => setTimeout(() => weigh(label, p, gap * REEL.read), i * gap));
        const taken = event.terms.filter(({ p }) => p >= 0.5).length;
        sum('Subjects', voice.taken(event.terms.length, taken));
        break;
      }
      case 'merged':
        for (const { names } of event.groups) sum('Subjects', voice.merged(names.join(' = ')), true);
        break;
      case 'filed':
        sum('File', voice.filed(event.sentences.length, new Set(event.sentences.map(({ topic }) => topic)).size));
        break;
      case 'distinct':
        // The web is laid with what is left once the repeats are gone, so the words kept say the same here.
        keeping(keptWords - words(event.dropped));
        sum('Repeats', voice.dropped(event.dropped.length));
        break;
      case 'worth':
        essential.textContent = String(event.prizes.length);
        gist.say(`${event.prizes.length} sentences`);
        {
          const same = (a, b) => a.block === b.block && a.start === b.start;
          const odds = (where) => event.odds.find((one) => same(one, where)).p;
          const kept = event.prizes.map((where) => ({ where, p: odds(where) })).sort((a, b) => b.p - a.p);
          const next = event.odds.filter((one) => !event.prizes.some((where) => same(where, one))).sort((a, b) => b.p - a.p)[0];
          kept.forEach(({ where, p }, i) => setTimeout(() => gistLine(where, p, i + 1, true), i * 120));
          if (next) setTimeout(() => gistLine(next, next.p, 0, false), kept.length * 120);
        }
        sum('Worth', voice.worth(event.prizes.length, textOf(event.lead)));
        break;
      case 'remarks':
        sum('Remarks', voice.remarks(event.surprises.length, event.figures.length));
        break;
      case 'links':
        sum('Relations', voice.links(event.links.length));
        break;
      case 'theme':
        // What the document is called is always the first theme.
        if (!themes.length) themes.push(title);
        themes.push(event.label);
        sum('Themes', `${two(themes.length)} ${event.label}`, true);
        chapterOf(stageNamed('Themes')).said.textContent = voice.themes(themes.length);
        break;
      case 'pulls':
        sum('Pulls', voice.pulls(event.count));
        break;
    }
    for (const one of stages) if (one.done.includes(event.type)) end(one);
    answered.textContent = number.format(counts.answered);
  }

  // The plan is made: every stage is done. The console stays, its verdicts to be
  // read and scrolled through, until the reader lets the crawler go.
  function settle() {
    for (const one of stages) if (one.start !== null) end(one);
    cancelAnimationFrame(frame);
    tick(performance.now());
    cancelAnimationFrame(frame);
    made = true;
    held = true;
    skip.remove();
    foot.remove();
    status.textContent = mode === 'hide' ? 'Jev has made its plan · Space lets the crawler go' : '';
    go = make('button', controls, 'web-read jev-go', 'Let it go');
    go.type = 'button';
    go.title = 'Space';
    go.addEventListener('click', letGo);
  }

  // The reader lets the crawler go: docked, the console gives way to the web. It is kept, to be opened again.
  function give() {
    go.remove();
    status.textContent = '';
    if (mode !== 'dock') return;
    el.classList.add('is-done');
    setTimeout(() => mode === 'dock' && el.classList.contains('is-done') && show('hide'), FADE_MS);
  }

  // Jev gave no plan: the console stops where it was and says why, in words, with what to do.
  function fail(message) {
    cancelAnimationFrame(frame);
    tick(performance.now());
    cancelAnimationFrame(frame);
    skip.remove();
    foot.remove();
    const [said, why, retry = true] = explain(message);
    for (const b of [elapsed, answered, source]) b.parentElement.remove();
    const box = make('div', el, 'jev-failure');
    make('b', box, '', said);
    make('p', box, '', why);
    if (retry) {
      const again = make('button', box, 'jev-again', 'Try again');
      again.type = 'button';
      again.addEventListener('click', () => location.reload());
    } else make('p', box, 'jev-else', 'Pick another page from the shelf, or paste another address.');
    show('dock');
  }

  return { read, settle, give, fail };
}
