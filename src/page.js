// The page: the document as the reader shows it, with Jev's triage of it in
// plain sight, where on it the words the crawler eats are, and what is left of
// them once it has. The layout is never touched: a block is one run of plain
// text, the words are found in it by measuring, and what Jev passes over and
// what the crawler has eaten are highlights over ranges of it, which change
// its colour and nothing else.
//
// The triage reads in four steps of ink: a section that is not part of the
// text is all but gone; a sentence a sparing reader passes over is dim; the
// rest is plain; and a sentence to be eaten has a tick beside it in the
// margin, faint until the crawler has it. What the crawler points out as it
// eats, a surprising sentence or a figure worth remembering, it underlines.

import { make, number, rangeIn } from './dom.js';

const TAG = { h1: 'h1', h2: 'h2', h3: 'h3', p: 'p', li: 'li', quote: 'blockquote', pre: 'pre' };
const MARK = { link: 'a', em: 'em', strong: 'strong', code: 'code' };
const LANE_DROP = 0.78; // where the crawler runs under a line: below its middle, in font sizes
const PACE = 230; // words a minute, read
const CLICK_MS = 260; // a link opens once it is clear the click is not the first of a double click, which moves the crawler
// A paragraph that is one word over a block of code is the code's language, as documentation labels it.
const LANGUAGE = /^[A-Za-z][\w#+.-]{0,15}$/;

// Shows the document `doc` in `article`, as the page it was: what the page
// says of itself over the title, the blocks of its text with their links and
// emphasis, its lists as lists, its figures and tables where they stood, and
// where it came from at the foot. Returns the element of each block.
export function showDocument(article, { title, url, words, blocks, figures = [], meta = {}, credit = null }) {
  const host = new URL(url).hostname.replace(/^www\./, '');
  const masthead = make('header', article, 'masthead');
  make('a', make('p', masthead, 'masthead-source'), '', host).href = url;

  const after = Map.groupBy(figures, (one) => slotOf(blocks, one.after));
  const lists = []; // the lists an item goes into, outermost first
  const els = blocks.map((block, index) => {
    const el = document.createElement(TAG[block.kind]);
    fill(el, block.text, block.marks ?? []);
    if (block.kind === 'p' && blocks[index + 1]?.kind === 'pre' && LANGUAGE.test(block.text)) el.className = 'is-language';
    if (block.kind === 'h1') {
      masthead.append(el);
      standing(masthead, { title, words, meta, figures });
    } else if (block.kind === 'li') listed(article, lists, block).append(el);
    else {
      lists.length = 0;
      article.append(el);
    }
    // The figures that stood together stand in one row; a table stands alone.
    let row = null;
    for (const one of after.get(index) ?? []) {
      lists.length = 0;
      if (one.kind === 'table') {
        row = null;
        article.append(table(one));
        continue;
      }
      row ??= make('div', article, 'figure-row');
      row.append(image(one));
    }
    return el;
  });

  const colophon = make('footer', article, 'colophon');
  const source = make('p', colophon);
  make('span', source, '', 'Source');
  make('a', source, '', url.replace(/^https?:\/\/(www\.)?/, '')).href = url;
  if (credit) make('p', colophon, '', credit);

  // A link opens the page it points to beside this one, unless the click is the first of two.
  let opening = null;
  article.addEventListener('click', (event) => {
    const link = event.target.closest('a');
    if (!link) return;
    event.preventDefault();
    clearTimeout(opening);
    if (event.detail === 1) opening = setTimeout(() => open(link.href, '_blank', 'noopener'), CLICK_MS);
  });
  return els;
}

// Where a figure that followed the block at `after` is shown: never between
// a heading and its text, nor inside a list, so after the paragraph that
// opens the section, or after the list it fell in.
function slotOf(blocks, after) {
  let at = after;
  while (/^h\d$/.test(blocks[at].kind) && at + 1 < blocks.length) at += 1;
  while (blocks[at].kind === 'li' && blocks[at + 1]?.kind === 'li') at += 1;
  return at;
}

// What the page says of itself, under its title: its standfirst, who wrote it and when, and how long it is.
function standing(masthead, { words, meta, figures }) {
  if (meta.description) make('p', masthead, 'masthead-standfirst', meta.description);
  const line = make('p', masthead, 'masthead-line');
  if (meta.byline) make('span', line, 'masthead-byline', meta.byline);
  const date = meta.published && new Date(meta.published);
  if (date && !Number.isNaN(date.getTime())) {
    const time = make('time', line, '', new Intl.DateTimeFormat(meta.lang ?? 'en', { day: 'numeric', month: 'short', year: 'numeric' }).format(date));
    time.dateTime = meta.published;
  }
  const pictures = figures.filter(({ kind }) => kind === 'image').length;
  const tables = figures.length - pictures;
  const measure = [`${number.format(words)} words`, `${Math.max(1, Math.round(words / PACE))} min`];
  if (pictures) measure.push(`${pictures} ${pictures === 1 ? 'figure' : 'figures'}`);
  if (tables) measure.push(`${tables} ${tables === 1 ? 'table' : 'tables'}`);
  if (meta.lang) measure.push(meta.lang.split('-')[0]);
  make('span', line, 'masthead-measure', measure.join(' · '));
}

// `text` into `el`, with the words its `marks` hold in their elements; a
// mark held in another is made inside it.
function fill(el, text, marks, from = 0, to = text.length, queue = [...marks]) {
  let at = from;
  while (queue.length && queue[0].start < to) {
    const mark = queue.shift();
    if (mark.start < at) continue;
    if (mark.start > at) el.append(text.slice(at, mark.start));
    const own = document.createElement(MARK[mark.kind]);
    if (mark.href) own.href = mark.href;
    const end = Math.min(mark.end, to);
    fill(own, text, marks, mark.start, end, queue);
    el.append(own);
    at = end;
  }
  if (to > at) el.append(text.slice(at, to));
}

// The list an item goes into: lists follow its depth, one inside the last item of the other.
function listed(article, lists, { list, depth = 0 }) {
  lists.length = Math.min(lists.length, depth + 1);
  if (lists[depth] && lists[depth].localName !== list) lists.length = depth;
  while (lists.length <= depth) {
    const outer = lists.at(-1);
    lists.push((outer ? (outer.lastElementChild ?? outer) : article).appendChild(document.createElement(list ?? 'ul')));
  }
  return lists[depth];
}

// A picture of the article: Jev does not read it, so it stands back in grey until it is pointed at.
function image({ src, alt, caption, width, height }) {
  const figure = document.createElement('figure');
  const img = make('img', figure);
  Object.assign(img, { src, alt, loading: 'lazy', decoding: 'async', referrerPolicy: 'no-referrer' });
  // Its size is known before it loads, so nothing under it moves when it does.
  if (width && height) Object.assign(img, { width, height });
  img.addEventListener('error', () => figure.remove());
  if (caption) make('figcaption', figure, '', caption);
  return figure;
}

// A table of data of the article, as figures are: beside the text, not read by Jev.
function table({ caption, rows }) {
  const figure = document.createElement('figure');
  figure.className = 'is-table';
  const scroll = make('div', figure, 'figure-scroll');
  const grid = make('table', scroll);
  for (const cells of rows) {
    const tr = make('tr', grid);
    for (const { text, head } of cells) make(head ? 'th' : 'td', tr, '', text);
  }
  if (caption) make('figcaption', figure, '', caption);
  return figure;
}

// Shows the sections of `blocks` whose headings are at the indexes in
// `apparatus` as ruled out, saying so in the margin with `said`: a section runs from its heading to the next one.
export function ruleOut(els, blocks, apparatus, said) {
  for (const section of apparatus) {
    const next = blocks.findIndex(({ kind }, index) => index > section && (kind === 'h2' || kind === 'h3'));
    for (const el of els.slice(section, next < 0 ? undefined : next)) el.classList.add('is-skipped');
    els[section].dataset.triage = said;
  }
}

// The page of a document shown as `els`, the elements of its `blocks`, with
// its ticks in `margin`. Of Jev's plan: `kept` are the sentences the crawler
// eats, `[{ block, start, end, text, worth, surprise, figures }]`, `passed` those passed over,
// and `apparatus` the indexes of the headings of the sections ruled out; Jev's `voice` says so.
export function createPage(els, margin, blocks, { kept, passed, apparatus }, voice) {
  const rangeOf = (block, start, end) => rangeIn(els[block], start, end);

  ruleOut(els, blocks, apparatus, voice.ruled);
  CSS.highlights.set('passed', new Highlight(...passed.map(({ block, start, end }) => rangeOf(block, start, end))));

  // Every word it eats, in reading order: `{ sentence, text, el, range,
  // first, last, marked, left, right, top, bottom }`, with `sentence`
  // indexing `kept`, `el` the block it is in, `first` and `last` whether it
  // opens or closes its sentence, `marked` whether it is underlined as it is
  // eaten: every word of a surprise, the figures of a sentence pointed out
  // for them; and the rest its place on the page, in document coordinates,
  // once measured.
  const words = kept.flatMap(({ text, start, block, surprise, figures }, sentence) => {
    const found = [...text.matchAll(/\S+/g)];
    return found.map((match, i) => ({ sentence, text: match[0], el: els[block], range: rangeOf(block, start + match.index, start + match.index + match[0].length), first: i === 0, last: i === found.length - 1, marked: surprise || (figures && /\d/.test(match[0])) }));
  });

  // The stretches of a line the crawler feeds along, in reading order: the
  // words of one sentence that share a line. `{ from, to, left, right, y }`:
  // `from` and `to` index `words`, and `y` is the lane under the line.
  const stretches = [];

  // The ghosts: one highlight for each kind of sentence, styled in the stylesheet.
  const ghosts = { catch: new Highlight(), prize: new Highlight() };
  for (const [worth, ghost] of Object.entries(ghosts)) CSS.highlights.set(`eaten-${worth}`, ghost);
  const marked = new Highlight();
  CSS.highlights.set('marked', marked);

  // The tick beside each kept sentence.
  const ticks = kept.map(({ worth }) => {
    const tick = margin.appendChild(document.createElement('i'));
    tick.className = `is-${worth}`;
    return tick;
  });

  // Reads where the words are from layout, and sets the ticks beside their sentences.
  function measure() {
    const fontSize = new Map();
    stretches.length = 0;
    words.forEach((word, index) => {
      const box = word.range.getClientRects()[0]; // a word broken over two lines counts where it begins
      Object.assign(word, { left: box.left + scrollX, right: box.right + scrollX, top: box.top + scrollY, bottom: box.bottom + scrollY });
      if (word.first) ticks[word.sentence].style.top = `${word.top}px`;
      if (word.last) ticks[word.sentence].style.height = `${word.bottom - parseFloat(ticks[word.sentence].style.top)}px`;

      const before = words[index - 1];
      const stretch = stretches.at(-1);
      if (stretch && before.sentence === word.sentence && Math.abs(before.top - word.top) < (word.bottom - word.top) / 2) {
        stretch.to = index;
        stretch.right = word.right;
        return;
      }
      if (!fontSize.has(word.el)) fontSize.set(word.el, parseFloat(getComputedStyle(word.el).fontSize));
      stretches.push({ from: index, to: index, left: word.left, right: word.right, y: (word.top + word.bottom) / 2 + fontSize.get(word.el) * LANE_DROP });
    });
  }

  // The word at `index` has been eaten: what is left of it on the page is
  // its ghost, underlined if the crawler points it out.
  function take(index) {
    const word = words[index];
    ghosts[kept[word.sentence].worth].add(word.range);
    if (word.marked) marked.add(word.range);
  }

  // The crawler has the whole of the sentence at `index`.
  function finish(index) {
    ticks[index].classList.add('is-eaten');
  }

  return { words, stretches, measure, take, finish };
}
