import { say } from './decode.js';
import { createCrawler, SIZE } from './crawler.js';
import { offsetIn } from './dom.js';
import { createFlight, gripping } from './flight.js';
import { createOverlay } from './overlay.js';
import { createPage, showDocument } from './page.js';
import { approach, carry, retreat } from './route.js';
import { between, clamp } from './util.js';
import { voiceOf } from './voice.js';
import { watchPlan } from './watch.js';
import { createWeb } from './web.js';

const GUTTER = 80; // px beside the text where the crawler runs down the page, clear of the words
const LOAD = 60; // words it eats before it carries what it has over to the web
const LAY_S = 0.02; // seconds a word takes to come out onto the web
const MAX_FRAME_S = 0.05;
const TORN = 70; // px from a blow within which the next word it has to eat is torn off by it
const HITSTOP = { least: 0.7, s: 0.02, power: 0.03, slow: 0.25 }; // a heavy blow (of at least this power) checks the crawler and its letters for an instant, in their own time so it scales with the speed: seconds, more for a blow of power 1, and how slowly they go meanwhile; a peck or a thrash goes on unchecked
const FOLLOW = { at: 0.42, rate: 5, slack: 2 }; // the page keeps the crawler this far down the window, catching up at this rate, 1/s; moved by more than this many px, it has been taken over
const SHOW_AT = 0.3; // where in the window a sentence picked in the web is brought to
const TIDY = { chance: 0.3, weigh: [0.6, 1.2] }; // how likely, once it has laid all it carried, it tidies its web; seconds it weighs the subject it came for against the other
const POUNCE = { surprise: 14 * SIZE, figure: 6 * SIZE }; // px it hops as it comes to a surprising sentence, and to a figure worth remembering
const NAME_DROP = 26; // px under a subject's node that its name hangs
const SAVOR = { chance: 0.35, s: [0.7, 1.4], rest: 8 }; // how likely it stops to savour an essential sentence it has just finished; for how long; and seconds before it does again

const status = document.querySelector('.web-status'); // what is going on, said where the web will be
const article = document.querySelector('#page');
const cameraSwitch = document.querySelector('#camera');
const skipButton = document.querySelector('#skip');

// The page asked for, by its place in the corpus or by its address: the first of the corpus when none is.
const corpus = await (await fetch('/api/corpus')).json();
const asked = new URLSearchParams(location.search);
if (!asked.has('id') && !asked.has('url')) asked.set('id', corpus[0].id);
const shelf = document.querySelector('#shelf select');
for (const group of new Set(corpus.map((one) => one.group))) {
  const own = shelf.appendChild(document.createElement('optgroup'));
  own.label = group;
  own.append(...corpus.filter((one) => one.group === group).map(({ id, title }) => new Option(title, id, false, id === asked.get('id'))));
}
if (!asked.has('id')) shelf.selectedIndex = 0; // a page from elsewhere: the shelf shows its own name
shelf.addEventListener('change', () => shelf.form.submit());

// The page is shown as soon as it has been fetched, and the crawler waits beside it.
say(status, '> fetching the page');
const response = await fetch(`/api/document?${asked}`);
const doc = await response.json();
if (!response.ok) {
  say(status, `> this page could not be read: ${doc.error}. try another address`);
  throw new Error(doc.error);
}
document.title = `${doc.title} · Semantic Crawler`;
document.querySelector('#address input').value = doc.url;
const els = showDocument(article, doc);
await document.fonts.ready;

const ground = () => ({ left: article.offsetLeft - GUTTER, right: article.offsetLeft + article.offsetWidth + GUTTER });
const middle = () => article.offsetLeft + article.offsetWidth / 2; // what the crawler swings out away from
// What it hooks a thread onto in a swing: the corners of the text blocks, just
// outside their left edge, the nearest to where the swing would hang.
const POST = 18; // px outside the edge of a block
const post = (near, within) => {
  let [best, least] = [null, within];
  for (const el of els) {
    const box = el.getBoundingClientRect();
    if (!box.width) continue;
    for (const y of [box.top, box.bottom]) {
      const point = { x: box.left + scrollX - POST, y: y + scrollY };
      const gap = Math.hypot(point.x - near.x, point.y - near.y);
      if (gap < least) [best, least] = [point, gap];
    }
  }
  return best;
};
const overlay = await createOverlay(document.querySelector('#overlay'));
const flight = createFlight(document.querySelector('#flight'));
const crawler = createCrawler({ clips: await (await fetch('assets/clips.json')).json() });
crawler.hook(post);
if (asked.has('probe')) window.probe = { crawler }; // for driving it from a script: `?probe`
crawler.watch(() => ({ left: scrollX, top: scrollY + 70, right: scrollX + innerWidth, bottom: scrollY + innerHeight }));

// The reader's pointer is the one thing on the page the crawler did not put there: it watches it, and a click near it startles it.
// What the pointer is over that is the reader's own to use (the bar, the web and its tools) is not for the crawler to mind.
let pointer = null; // where it is in the window
const mine = (el) => el.closest('#bar, #web, button, input, select, textarea, a');
addEventListener('pointermove', (event) => {
  pointer = event.pointerType === 'touch' || mine(event.target) ? null : { x: event.clientX, y: event.clientY };
});
document.documentElement.addEventListener('pointerleave', () => (pointer = null));
addEventListener('pointerdown', (event) => {
  if (event.pointerType === 'touch' || mine(event.target) || paused) return;
  crawler.poke({ x: event.clientX + scrollX, y: event.clientY + scrollY });
});
crawler.place({ x: ground().left, y: article.offsetTop }, { x: ground().left, y: article.offsetTop + 1 });

let reading = null; // what a frame does with the page, once there is a plan for it
let paused = false; // whether the reader has stopped the crawler to read the web
let last = 0;
let speed = 1; // how fast everything goes, as the reader sets it in the bar
let handScroll = scrollY; // where the page was scrolled to a step ago, to feel the reader's hand on it
let stopped = 0; // seconds the crawler is still checked by the heavy blow it landed last
// Quicker, a frame is worked out in as many steps as it is times quicker, so nothing takes too long a step.
function frame(now) {
  const steps = Math.max(1, Math.round(speed));
  const dt = (Math.min((now - last) / 1000, MAX_FRAME_S) * speed) / steps;
  last = now;
  for (let i = 0; i < steps; i++) {
    // A heavy blow that lands checks the crawler and what it eats for an instant: the hit is felt.
    const held = stopped > 0 ? HITSTOP.slow : 1;
    stopped = Math.max(stopped - dt, 0);
    crawler.heed(pointer && !paused ? { x: pointer.x + scrollX, y: pointer.y + scrollY, cx: pointer.x, cy: pointer.y } : null);
    crawler.hold(paused);
    crawler.step(dt * held);
    reading?.(dt);
    flight.step(dt * held, crawler.spine[0], gripping(crawler.moves));
  }
  overlay.render(crawler, dt);
  requestAnimationFrame(frame);
}
const speeds = document.querySelector('#speed');
for (const button of speeds.querySelectorAll('button')) {
  button.addEventListener('click', () => {
    speed = Number(button.value);
    for (const other of speeds.querySelectorAll('button')) other.setAttribute('aria-pressed', String(other === button));
  });
}
// The ground the page is read on, dark until the reader clears it; the choice is kept.
const grounds = document.querySelector('#theme');
const showGround = () => {
  for (const button of grounds.querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.value === document.documentElement.dataset.theme));
};
for (const button of grounds.querySelectorAll('button')) {
  button.addEventListener('click', () => {
    document.documentElement.dataset.theme = button.value;
    try {
      localStorage.setItem('theme', button.value);
    } catch {} // a window that keeps nothing still changes ground
    showGround();
  });
}
showGround();
requestAnimationFrame((now) => {
  last = now;
  requestAnimationFrame(frame);
});

// Jev decides what is eaten, and what it is filed under, before the crawler
// sets off; without that there is nothing to go for. The reader watches it
// decide. The crawler sets off as soon as it knows what to eat; the web is
// spun once Jev has said how the subjects bear on one another.
status.textContent = '';
const margin = document.querySelector('#margin');
const voice = voiceOf(doc.meta.lang); // Jev speaks the language of the text
const plans = watchPlan(asked, { els, blocks: doc.blocks, title: doc.title, voice, margin, panel: document.querySelector('.web-jev'), toggle: document.querySelector('#jev-mode'), status });
let web = null; // the web, once Jev has the whole plan
let due = 0; // frames until a skip asked for before the web was spun is carried out
// Before the web there is only the plan to have whole; with it, the end is a jump away.
skipButton.addEventListener('click', () => {
  skipButton.disabled = true;
  if (web) skipToEnd();
  else plans.skip();
});
const judged = await plans.early;
const { kept, topics } = judged;

const page = createPage(els, margin, doc.blocks, judged, voice);
const { words, stretches } = page;
plans.whole.then((whole) => {
  web = createWeb(document.querySelector('#web'), { title: doc.title, topics, parents: whole.parents, folds: whole.folds, links: whole.links, pulls: whole.pulls, kept, words: whole.words, skipped: whole.apparatus.length }, (sentence) => {
    release();
    scrollTo({ top: words.find((word) => word.sentence === sentence).top - innerHeight * SHOW_AT, behavior: 'smooth' });
  }, (reading) => (paused = reading));
  if (window.probe) Object.assign(window.probe, { web, teleport, last: kept.length - 1 });
  if (skipButton.disabled) due = 2; // the reader asked before it was spun: once it has stepped, its layout is there to be laid on
});

let eaten = 0; // how many of the words it has swallowed
let feeding = null; // what it is heading for or feeding along: `{ stretch, from, back }`, with `from` the first word of the stretch it had yet to swallow, and `back` whether it runs the stretch from its right end
const belly = []; // the sentences it has eaten whole and not yet laid, by their index
let carried = 0; // how many words it has in it
let hauling = false; // whether it is out on the web with them
let laying = null; // the sentence coming out of it: `{ sentence, left, wait }`, with `left` the words still in and `wait` the seconds to the next
let following = true; // whether the page keeps the crawler in the window
let camera = scrollY; // where the page was last scrolled to
let anchor = article.offsetTop; // the height of the page that is kept in the window: where it is feeding
let tidying = null; // the crawler tidying its web: `{ job, stage }`, going to `reach` the subject, to `weigh` it, or to `tow` it
let savoured = -Infinity; // when it last stopped to savour a sentence
let clock = 0;

const fullness = () => Math.min(carried / LOAD, 1);

// What it does next: over to the web once it has a load, or everything; otherwise on with the text.
// Until the web is spun it eats on, and with everything eaten it waits for it.
function next() {
  if (belly.length && (carried >= LOAD || eaten === words.length)) {
    if (web) haul();
    else if (eaten < words.length) plan();
  } else plan();
}

// Sends the crawler on to the next stretch it has not swallowed, or to rest when it has them all.
function plan() {
  const head = crawler.spine[0];
  const stretch = stretches.find((stretch) => stretch.to >= eaten);
  if (!stretch) {
    if (web?.crowded && tidy()) return; // what the plan folds is folded before it rests
    feeding = null;
    web?.rest();
    document.body.classList.add('is-done'); // the one thing left to do is read what it spun
    skipButton.hidden = true;
    return crawler.follow(retreat(head, ground()), middle());
  }
  // A stretch a change of layout left begun is gone on with from where it was left.
  const route = approach(head, { ...stretch, left: words[eaten].left }, ground(), eaten === stretch.from);
  feeding = { stretch, from: eaten, back: route.at(-1).x < route.at(-2).x };
  // What it comes to at the start of the stretch: the opening of a sentence, how much it is worth, and whether it surprises.
  const { sentence, first } = words[eaten];
  Object.assign(route.at(-1), { opens: first && eaten === stretch.from, worth: kept[sentence].worth, surprise: kept[sentence].surprise });
  crawler.follow(route, middle());
}

// Sends it to the hub the first sentence in its belly is filed under: out of the text, or on from the hub it is at.
function haul() {
  const spot = web.aim(kept[belly[0]].topic);
  crawler.follow(hauling ? [Object.assign(spot, { gait: 'haul' })] : carry(crawler.spine[0], spot, ground()), middle());
  feeding = null;
  hauling = true;
}

// One more word is in: it comes off the page, whichever end of its line the
// crawler takes the sentence from, and leaves its ghost there.
function swallow() {
  const { stretch, from, back } = feeding;
  const at = back ? stretch.to - (eaten - from) : eaten;
  const { sentence, first, last } = words[eaten];
  const { worth, surprise } = kept[sentence];
  // It pounces on what it points out: high on a surprise, as it comes to it, and a little on a figure.
  if (surprise ? first : words[at].marked) crawler.hop(surprise ? POUNCE.surprise : POUNCE.figure);
  page.take(at);
  flight.eat(words[at], worth, back);
  eaten += 1;
  carried += 1;
  if (first && worth === 'prize') crawler.halt();
  const opening = words.findIndex((word) => word.sentence === sentence);
  crawler.swallow(worth, fullness(), eaten - 1 - opening, kept[sentence].text.match(/\S+/g).length);
  if (last) {
    crawler.devour(worth);
    page.finish(sentence);
    belly.push(sentence);
    // An essential sentence it may stop and turn back to, feeling for where it was.
    if (worth === 'prize' && clock - savoured > SAVOR.rest && Math.random() < SAVOR.chance) {
      const opening = words.find((word) => word.sentence === sentence && word.first);
      crawler.regard({ x: (opening.left + opening.right) / 2, y: (opening.top + opening.bottom) / 2 }, between(SAVOR.s));
      savoured = clock;
    }
  }
}

// At a hub, what it carries comes out a word at a time and becomes a node of the web.
function lay(dt) {
  if (!laying) {
    if (!crawler.done) return;
    laying = { sentence: belly[0], left: kept[belly[0]].text.match(/\S+/g).length, wait: 0 };
    web.lay(laying.sentence);
  }
  laying.wait -= dt;
  for (; laying.wait <= 0 && laying.left > 0; laying.wait += LAY_S) {
    laying.left -= 1;
    carried -= 1;
    web.feed(laying.sentence);
    crawler.lay(fullness());
  }
  if (laying.left > 0) return;
  web.settle(belly.shift());
  crawler.surge();
  laying = null;
  if (belly.length) return haul();
  if ((web.crowded || Math.random() < TIDY.chance) && tidy()) return; // what the plan folds it always brings in
  hauling = false;
  plan();
}

// It goes over to a subject of its web that the plan folds into another, or that hangs far from one it has much to do with, if there is one.
function tidy() {
  const job = web.untidy();
  if (!job) return false;
  tidying = { job, stage: 'reach' };
  crawler.follow([Object.assign(job.grip, { gait: 'crawl' })], middle());
  return true;
}

// At the subject it weighs it against the other, takes it, and hauls it
// over; then back to the text. If the reader takes it, it leaves it.
function tow() {
  const { job } = tidying;
  if (!web.tidying) return untidied();
  if (!crawler.done || crawler.regarding) return;
  if (tidying.stage === 'reach') {
    crawler.regard(job.at, between(TIDY.weigh));
    tidying.stage = 'weigh';
  } else if (tidying.stage === 'weigh') {
    web.grab();
    crawler.follow([Object.assign(job.to, { gait: 'tow' })], middle());
    tidying.stage = 'tow';
  } else untidied();
}
function untidied() {
  web.drop();
  tidying = null;
  hauling = false;
  plan();
}

// The reader has moved the page: it stays where they put it until they ask for the crawler again.
function release() {
  setCamera(false);
}

// The camera switch shows whether the page follows the crawler; scrolling by hand sets it free, and Follow takes the page back.
function setCamera(on) {
  following = on;
  for (const button of cameraSwitch.querySelectorAll('button')) button.setAttribute('aria-pressed', String((button.value === 'follow') === on));
  if (on) camera = scrollY;
}
for (const button of cameraSwitch.querySelectorAll('button')) button.addEventListener('click', () => setCamera(button.value === 'follow'));

function follow(dt) {
  if (Math.abs(scrollY - camera) > FOLLOW.slack) return release();
  const furthest = document.documentElement.scrollHeight - innerHeight;
  const want = clamp(anchor - innerHeight * FOLLOW.at, 0, furthest);
  camera += (want - camera) * (1 - Math.exp(-FOLLOW.rate * dt));
  scrollTo(0, camera);
  camera = scrollY; // the page scrolls by whole device pixels
}

// Where the crawler has taken off and landed, the web feels; where its blows have landed, a merge the reader made is bitten through and a sentence of the summary is touched.
// Gives the blows.
function meet() {
  for (const hit of crawler.knocks()) web?.knock(hit, hit.power);
  const impacts = crawler.impacts();
  for (const hit of impacts) {
    web?.bite(hit);
    web?.touch(hit);
  }
  return impacts;
}

reading = (dt) => {
  if (due && !--due) return skipToEnd();
  const head = crawler.spine[0];
  // It feels the reader's hand on the page, not the camera that follows it.
  crawler.jostle(following || paused ? 0 : (scrollY - handScroll) / Math.max(dt, 1e-3));
  handScroll = scrollY;
  // What the reader does on the web, the crawler sees: the hand on a subject, a merge, the summary.
  if (web) {
    const told = web.told();
    // A name the crawler bites off the web comes apart in its jaws.
    for (const event of told) if (event.kind === 'fused' && event.bitten) flight.scatter(event.label, { x: event.from.x, y: event.from.y + NAME_DROP }, getComputedStyle(document.querySelector('.web-hub')).font);
    crawler.web({ hand: web.hand, told, drawer: web.drawer(), hover: web.hover, calm: paused || document.body.classList.contains('is-done') });
  }
  // Stopped for the reader, the crawler stays where it is, alive; the web goes on moving.
  if (paused) {
    web.step(dt, head);
    meet();
    return;
  }
  if (feeding) {
    // A word is swallowed as the head comes to its middle, on the way along its stretch.
    const { stretch, from, back } = feeding;
    const along = !crawler.detouring && (crawler.done || crawler.waypoint.gait === 'feed');
    const reached = ({ left, right }) => crawler.done || (back ? head.x <= (left + right) / 2 : head.x >= (left + right) / 2);
    while (along && eaten <= stretch.to && reached(words[back ? stretch.to - (eaten - from) : eaten])) swallow();
    if (eaten > stretch.to) next();
  }
  clock += dt;
  if (tidying) tow();
  else if (hauling) lay(dt);
  else if (!crawler.attending) anchor = head.y; // out on the web the page stays where it was feeding

  if (following) follow(dt);
  web?.step(dt, head);
  const impacts = meet();
  for (const hit of impacts) {
    if (hit.power >= HITSTOP.least) stopped = Math.max(stopped, HITSTOP.s + HITSTOP.power * hit.power);
    // A blow that lands on the next word it has to eat tears it off the page there and then.
    const { stretch, from, back } = feeding ?? {};
    const word = feeding && eaten <= stretch.to ? words[back ? stretch.to - (eaten - from) : eaten] : null;
    if (word && Math.hypot((word.left + word.right) / 2 - hit.x, (word.top + word.bottom) / 2 - hit.y) < TORN) swallow();
    flight.strike(hit);
  }
  if (web?.shaken) crawler.sense(web.shaken);
};

// A double click on the text takes the crawler there: it stands at the
// sentence it would eat next from that point, with everything before it
// eaten and laid on the web as if it had come at its own pace, and goes on
// from there. Jev's plan is whole, so nothing has to be waited for.
function sentenceAt(x, y) {
  const point = document.caretPositionFromPoint(x, y);
  const block = point ? els.findIndex((el) => el.contains(point.offsetNode)) : -1;
  if (block < 0) return null;
  const offset = offsetIn(els[block], point.offsetNode, point.offset);
  const at = kept.findIndex((sentence) => sentence.block > block || (sentence.block === block && sentence.end > offset));
  return at < 0 ? kept.length - 1 : at;
}

// What it carries is laid on the web at once, the sentence it was laying finished first.
function flush() {
  if (!web) return;
  if (laying) {
    for (; laying.left > 0; laying.left--) {
      carried -= 1;
      web.feed(laying.sentence);
    }
    web.settle(belly.shift());
    laying = null;
  }
  for (const sentence of belly.splice(0)) {
    web.lay(sentence);
    for (let left = kept[sentence].text.match(/\S+/g).length; left > 0; left--) {
      carried -= 1;
      web.feed(sentence);
    }
    web.settle(sentence);
  }
}

// Everything before the word at `target` is eaten and laid on the web, with nothing to fly, and the crawler is left where it stood.
function eatTo(target) {
  if (tidying) {
    web.drop();
    tidying = null;
  }
  // The stretch it is on is eaten as it stands, then everything up to there.
  while (feeding && eaten > feeding.from && eaten <= feeding.stretch.to) swallow();
  for (; eaten < target; eaten++) {
    const word = words[eaten];
    page.take(eaten);
    carried += 1;
    if (word.last) {
      page.finish(word.sentence);
      belly.push(word.sentence);
    }
  }
  flush();
  flight.clear();
  feeding = null;
  hauling = false;
}

function teleport(sentence) {
  const target = words.findIndex((word) => word.sentence === sentence && word.first);
  eatTo(target);
  const lane = ground().left;
  crawler.place({ x: lane, y: words[target].top }, { x: lane, y: words[target].top + 1 });
  anchor = words[target].top;
  setCamera(true);
  plan();
}

// The reader skips to the end: Jev's plan is had whole, the rest of the text is eaten, what the plan folds falls in, and the crawler rests as if it had done it all.
function skipToEnd() {
  eatTo(words.length);
  web.foldAll();
  const last = words.at(-1);
  const lane = ground().left;
  crawler.place({ x: lane, y: last.top }, { x: lane, y: last.top + 1 });
  anchor = last.top;
  setCamera(true);
  plan();
}

article.addEventListener('dblclick', (event) => {
  getSelection().removeAllRanges();
  const sentence = sentenceAt(event.clientX, event.clientY);
  if (sentence !== null) teleport(sentence);
});

// Cmd+Z (Ctrl+Z) puts back the subject the last fusion took in.
addEventListener('keydown', (event) => {
  if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.key.toLowerCase() !== 'z') return;
  if (event.target.closest('input, select, textarea')) return;
  if (web?.unfuse()) event.preventDefault();
});

// The words are measured in the page's own typefaces, now and whenever its
// layout changes. The lines are then no longer what they were: the one the
// crawler was on is taken whole, and it goes on from where it is to the next.
new ResizeObserver(() => {
  while (feeding && eaten > feeding.from && eaten <= feeding.stretch.to) swallow();
  page.measure();
  if (!hauling) next();
}).observe(document.body);
