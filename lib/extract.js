// Content extraction: turns an HTML page, as fetched, into the document the
// crawler reads: its title and the blocks of its running text, in reading
// order. Readability finds the article in the page; what it keeps is flattened
// here into plain-text blocks, so nothing of the page's own markup, styling or
// scripts ever reaches the reader.
//
// The text of a block is what Jev reads, and nothing else is. What the reader
// is shown besides it is kept beside it: the words of a block that are a
// link, emphasis or code as ranges of its text (`marks`), whether an item is
// in a numbered list and how deep, the figures and tables of data of the
// article with where in the text they stand, and what the page says of
// itself (`meta`). None of it changes a block's text.

import { Readability } from '@mozilla/readability';
import { JSDOM, VirtualConsole } from 'jsdom';
import { detect } from 'tinyld';

const BLOCKS = 'h1, h2, h3, h4, h5, h6, p, li, blockquote, pre';
const KIND = { H1: 'h2', H2: 'h2', H3: 'h3', H4: 'h3', H5: 'h3', H6: 'h3', P: 'p', LI: 'li', BLOCKQUOTE: 'quote', PRE: 'pre' };
const NOT_RUNNING_TEXT = 'figure, figcaption, nav, aside, form';
// A table of data says so with a caption or headers; one without them only lays out the page, as a forum's thread is laid out.
const DATA = ':scope > caption, :scope > thead, :scope > tbody > tr > th, :scope > tr > th';
// What a word of the text can be besides text, by the element that makes it so.
const MARK = { A: 'link', EM: 'em', I: 'em', CITE: 'em', STRONG: 'strong', B: 'strong', CODE: 'code', KBD: 'code', SAMP: 'code' };
const SMALL = 48; // px below which an image the page sizes is an icon or a spacer, not a figure

const quiet = new VirtualConsole(); // pages come with stylesheets jsdom cannot parse; that is not our concern

// `{ title, blocks, figures, meta }`. Each block is `{ kind, text }`, with
// `kind` one of 'h1' (the title, always first), 'h2', 'h3', 'p', 'li',
// 'quote', 'pre'; a block of prose may have `marks`, `[{ kind, start, end,
// href }]` with `kind` one of 'link', 'em', 'strong', 'code', outermost
// first; an item has `list`, 'ol' or 'ul', and its `depth` from 0. `figures`
// are `{ after, kind: 'image', src, alt, caption }` or `{ after, kind:
// 'table', caption, rows: [[{ text, head }]] }`, `after` the index of the
// block they follow. `meta` is `{ byline, published, description, lang }`,
// each null when the page does not say.
export function extract(html, url) {
  const { document } = new JSDOM(html, { url, virtualConsole: quiet }).window;

  // Marks that point out of the text are not part of it: footnote references,
  // and links that are only a symbol, such as a paragraph's permalink.
  for (const mark of document.querySelectorAll('sup')) if (mark.querySelector('a')) mark.remove();
  for (const link of document.querySelectorAll('a')) if (link.textContent && !/[\p{L}\p{N}]/u.test(link.textContent)) link.remove();
  // A heading is often wrapped together with its permalink or edit links; on
  // its own that wrapper reads as a block of links, and would be thrown away.
  // A wrapper is one when nothing in it but the heading and links has words.
  for (const heading of document.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
    const wrapper = heading.parentElement;
    if (wrapper.tagName !== 'DIV') continue;
    const rest = wrapper.cloneNode(true);
    for (const own of rest.querySelectorAll('h1, h2, h3, h4, h5, h6, a')) own.remove();
    if (!/[\p{L}\p{N}]/u.test(rest.textContent)) wrapper.replaceWith(heading);
  }

  // Readability throws away a heading whose id or class reads as clutter
  // ("sidebar", "related", "comment"), as anchors and styles of real headings
  // often do ("hds-sidebar-nav-4"): what a heading is called in the markup
  // says nothing of whether it is the text's, so headings are read without it.
  for (const heading of document.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
    heading.removeAttribute('id');
    heading.removeAttribute('class');
  }

  // The page's own heading is its name, without the site's that its <title>
  // adds: "HTTP caching - HTTP | MDN" is headed "HTTP caching". Without such
  // a heading, the title loses the parts that are the site's name.
  const headings = [...document.querySelectorAll('h1')].map(({ textContent }) => clean(textContent));
  const named = headings.length === 1 && headings[0] && clean(document.title).includes(headings[0]) ? headings[0] : null;
  const said = (selector) => clean(document.querySelector(selector)?.getAttribute('content') ?? '') || null;
  const description = said('meta[name="description"]') ?? said('meta[property="og:description"]');
  const lang = document.documentElement.lang || null;

  const article = new Readability(document).parse();
  if (!article) throw new Error('no article was found in the page');

  const title = named ?? unsited(clean(article.title), document.querySelector('meta[property="og:site_name"]')?.content);
  const body = new JSDOM(article.content, { virtualConsole: quiet }).window.document.body;
  const blocks = [{ kind: 'h1', text: title }];
  const figures = [];
  const shown = new Set(); // the figures already given a caption
  for (const el of body.querySelectorAll(`${BLOCKS}, img, table`)) {
    if (el.tagName === 'IMG') {
      const image = imageOf(el, blocks.length - 1, shown);
      if (image) figures.push(image);
      continue;
    }
    if (el.tagName === 'TABLE') {
      if (isData(el) && !inData(el.parentElement)) figures.push(tableOf(el, blocks.length - 1));
      continue;
    }
    if (el.querySelector(BLOCKS) || el.closest(NOT_RUNNING_TEXT) || inData(el)) continue;
    const kind = el.tagName === 'P' && el.closest('li') ? 'li' : el.tagName === 'P' && standsAlone(el) ? 'h3' : KIND[el.tagName];
    const block = kind === 'pre' ? { kind, text: el.textContent.replace(/\s+$/, '') } : { kind, ...inline(el, kind === 'p' || kind === 'li' || kind === 'quote') };
    // Text with nothing to read in it, and the title repeated inside the article, are left out.
    if (!/\p{L}/u.test(block.text) || block.text === title) continue;
    if (kind === 'li') Object.assign(block, { list: el.closest('ol, ul')?.tagName === 'OL' ? 'ol' : 'ul', depth: Math.max(0, ancestors(el, 'ol, ul') - 1) });
    blocks.push(block);
  }

  // What the page says of itself; a description that is only the opening of the text says nothing more.
  const opening = blocks.find(({ kind }) => kind === 'p')?.text ?? '';
  const meta = {
    byline: clean(article.byline ?? '') || null,
    published: article.publishedTime ?? null,
    description: description && !opening.startsWith(description.slice(0, 40).replace(/…$/, '')) && description !== title ? description : null,
    lang: lang ?? article.lang ?? (detect(blocks.map(({ text }) => text).join(' ')) || null), // what it says it is written in, or what it reads as
  };
  return { title, blocks, figures, meta };
}

const clean = (text) => text.replace(/\s+/g, ' ').trim();

// The text of `el`, cleaned, and when `marked` the ranges of it its links,
// emphasis and code hold. Its text is exactly what `clean(el.textContent)`
// is: the marks are found in the raw text and carried over to the clean one.
function inline(el, marked) {
  const raw = el.textContent;
  const text = clean(raw);
  if (!marked) return { text };
  // Where each place of the raw text falls in the clean text.
  const at = new Int32Array(raw.length + 1);
  let out = 0;
  let space = true; // a run of white space at the start is dropped, as trim() does
  for (let i = 0; i < raw.length; i++) {
    at[i] = out;
    const white = /\s/.test(raw[i]);
    if (!white) out += 1;
    else if (!space) out += 1;
    space = white;
  }
  at[raw.length] = Math.min(out, text.length);
  const marks = [];
  let offset = 0;
  const walk = (node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        offset += child.data.length;
        continue;
      }
      if (child.nodeType !== 1) continue;
      const begin = offset;
      const kind = MARK[child.tagName];
      const index = kind ? marks.push(null) - 1 : -1;
      walk(child);
      if (!kind) continue;
      let [start, end] = [Math.min(at[begin], text.length), Math.min(at[offset], text.length)];
      while (start < end && text[start] === ' ') start += 1;
      while (end > start && text[end - 1] === ' ') end -= 1;
      const href = kind === 'link' ? child.getAttribute('href') : null;
      if (end > start && (kind !== 'link' || /^https?:/.test(href ?? ''))) marks[index] = { kind, start, end, ...(href && { href }) };
    }
  };
  walk(el);
  const kept = marks.filter(Boolean);
  return kept.length ? { text, marks: kept } : { text };
}

// How many elements matching `selector` hold `el`.
function ancestors(el, selector) {
  let count = 0;
  for (let up = el.parentElement?.closest(selector); up; up = up.parentElement?.closest(selector)) count += 1;
  return count;
}

const isData = (table) => Boolean(table.querySelector(DATA));

// Whether `el` is in a table of data.
function inData(el) {
  for (let table = el?.closest('table'); table; table = table.parentElement?.closest('table')) if (isData(table)) return true;
  return false;
}

// An image of the article as a figure after the block at `after`, or null for
// an icon, a spacer, or one with no address; its caption is its figure's,
// given once for the figure.
function imageOf(img, after, shown) {
  const src = [img.getAttribute('src'), img.getAttribute('data-src')].find((one) => one && /^https?:/.test(one));
  const size = ['width', 'height'].map((side) => Number(img.getAttribute(side)) || Infinity);
  if (!src || Math.min(...size) < SMALL || inData(img)) return null;
  const figure = img.closest('figure');
  const caption = figure && !shown.has(figure) ? clean(figure.querySelector('figcaption')?.textContent ?? '') || null : null;
  if (figure) shown.add(figure);
  return { after, kind: 'image', src, alt: clean(img.getAttribute('alt') ?? ''), caption, ...(size.every(Number.isFinite) && { width: size[0], height: size[1] }) };
}

// A table of data as a figure after the block at `after`: its caption and its rows of cells.
function tableOf(table, after) {
  const rows = [...table.querySelectorAll(':scope > thead > tr, :scope > tbody > tr, :scope > tr, :scope > tfoot > tr')].map((tr) => [...tr.children].map((cell) => ({ text: clean(cell.textContent), head: cell.tagName === 'TH' })));
  // A row with nothing in it, or only the site's own link in brackets ("[edit]"), is not data.
  const data = rows.filter((cells) => cells.some(({ text }) => text && !/^\[[^\]]*\]$/.test(text)));
  return { after, kind: 'table', caption: clean(table.querySelector(':scope > caption')?.textContent ?? '') || null, rows: data };
}

// A title without the parts of it that are only the `site`'s name: "Fairphone
// Shop | Fairphone" is "Fairphone Shop" on the site called "Fairphone".
function unsited(title, site) {
  const parts = title.split(/\s+[|·—–-]\s+/);
  const own = parts.filter((part) => part.toLowerCase() !== clean(site ?? '').toLowerCase());
  return own.length && own.length < parts.length ? own.join(' – ') : title;
}

// A paragraph that is a bold line and nothing else, with no sentence in it,
// is a heading set in bold, as essays without markup for headings have them;
// one that is all a link to another page is a pointer to it, not a heading.
function standsAlone(paragraph) {
  const text = clean(paragraph.textContent);
  const bold = paragraph.querySelector('b, strong');
  const link = paragraph.querySelector('a[href]');
  const away = link && clean(link.textContent) === text && !link.getAttribute('href').startsWith('#');
  return Boolean(bold) && clean(bold.textContent) === text && !/[.!?:;,]$/.test(text) && !away;
}
