// Content extraction for PDF: turns the bytes of a PDF into the same document
// extract.js makes of an HTML page, `{ title, blocks, figures, meta }`, so
// that nothing after it knows which of the two it was given.
//
// A PDF has no paragraphs, headings or columns, only glyph runs at places on
// a page. They are rebuilt from geometry alone (no model, no OCR): runs are
// joined into lines, a page of two columns is read down one and then the
// other, what repeats from page to page in the margins is dropped, and the
// size and font of a line say whether it is a heading, an item or running
// text. A PDF with no text layer (a scan) is refused, not guessed at.

import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { detect } from 'tinyld';

const MAX_PAGES = 500;
const MIN_CHARS_PER_PAGE = 100; // below this a PDF is pictures of text
const MARGIN = 0.08; // the share of the page's height, top and bottom, where a running header or footer lives
const REPEATED = 0.4; // the share of pages a margin line must stand on to be a running header or footer
const GUTTER_ROWS = 0.9; // the share of a page's rows a gap must be free in to be the gutter between columns

const BULLET = /^([•▪◦●■‣∙·–—*-]|\(?\d{1,3}[.)]|\(?[a-z][.)]|\([ivx]+\))\s+(?=\S)/;
const NUMBERED = /^(\d+(\.\d+){0,3}\.?|[A-Z]\.|[IVX]+\.|(Chapter|Section|Part|Appendix|Capítulo|Sección|Parte|Apéndice|Anexo)\s+[\dA-Z]+\.?)\s+\S/i;
const CAPTION = /^(Figure|Fig\.|Table|Tab\.|Figura|Tabla|Chart|Source|Fuente)\s*[\dA-Z]+[.:]/;
const END_OF_TEXT = /^(references|bibliography|works cited|literature cited|referencias|bibliografía|bibliographie|literatur)$/i;
const BACK_TO_TEXT = /^(appendix|appendices|annex|apéndice|anexo)\b/i;
const SMALL = 0.93; // lines set smaller than this share of the body's size are footnotes, captions and labels
const LEADERS = /(\.\s?){4,}\s*[\divxlc]*$/i; // a table of contents' dotted line to a page number
const SENTENCE_END = /[.!?:;]["”')\]]*$/;

// `{ title, blocks, figures, meta }` of the PDF in `bytes` (see extract.js).
export async function extractPdf(bytes) {
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: false, verbosity: 0 });
  const pdf = await task.promise;
  try {
    if (pdf.numPages > MAX_PAGES) throw new Error(`the PDF has ${pdf.numPages} pages, more than the ${MAX_PAGES} that are read`);
    const { info } = await pdf.getMetadata();
    const pages = [];
    for (let number = 1; number <= pdf.numPages; number += 1) pages.push(await pageOf(await pdf.getPage(number)));
    const chars = pages.reduce((sum, { runs }) => sum + runs.reduce((n, run) => n + run.text.length, 0), 0);
    if (chars < MIN_CHARS_PER_PAGE * pdf.numPages) throw new Error('the PDF has no text layer (it is a scan), and Spidi does not read images');

    const body = withoutRunning(pages.map(columns), pages.length);
    const { size, font } = typical(body);
    const prose = body.filter((line) => line.size >= size * SMALL && !LEADERS.test(line.text));
    const { title, rest } = titleOf(prose, size, info);
    const blocks = blocksOf(rest, { size, font });
    const text = blocks.map(({ text: own }) => own).join(' ');
    return {
      title,
      blocks: [{ kind: 'h1', text: title }, ...blocks],
      figures: [],
      meta: { byline: /\p{Ll}/u.test(info?.Author ?? '') && /\s/.test(clean(info.Author)) ? clean(info.Author) : null, published: dateOf(info?.CreationDate), description: null, lang: text.length > 200 ? detect(text.slice(0, 2000)) || null : null },
    };
  } finally {
    await task.destroy();
  }
}

// The runs of text of a page, upright, with where they stand (`y` from the top).
async function pageOf(page) {
  const [, , width, height] = page.view;
  const { items } = await page.getTextContent();
  const runs = items
    .filter(({ str, transform }) => str.trim() && Math.abs(transform[1]) < 0.01 * Math.abs(transform[0]))
    .map(({ str, transform, width: w, fontName }) => ({ text: str.normalize('NFKC'), x0: transform[4], x1: transform[4] + w, y: height - transform[5], size: Math.abs(transform[3]) || Math.abs(transform[0]), font: fontName }));
  return { runs, width, height, number: page.pageNumber };
}

// The lines of a page in reading order. Where the runs leave a gutter free
// in nearly every row, the page has two columns: rows that cross the gutter
// (a title, an abstract) are read whole, and the rows between them left
// column first, then right.
function columns({ runs, width, height, number }) {
  const rows = rowsOf(runs);
  const gutter = gutterOf(rows, width);
  const lines = [];
  let band = [];
  const flush = () => {
    if (!band.length) return;
    for (const side of [(run) => run.x1 <= gutter, (run) => run.x0 > gutter]) lines.push(...rowsOf(band.flatMap((row) => row.filter(side))).map((row) => lineOf(row, number, height)));
    band = [];
  };
  for (const row of rows) {
    if (gutter === null || row.some((run) => run.x0 < gutter && run.x1 > gutter)) {
      flush();
      lines.push(lineOf(row, number, height));
    } else band.push(row);
  }
  flush();
  return lines.filter(Boolean);
}

// Runs grouped into rows by baseline, top to bottom, each left to right.
// A superscript or subscript, smaller and off the baseline, joins its row.
function rowsOf(runs) {
  const rows = [];
  for (const run of [...runs].sort((a, b) => a.y - b.y || a.x0 - b.x0)) {
    const row = rows.find((own) => Math.abs(own.y - run.y) < 0.5 * Math.max(own.size, run.size) && (own.size >= run.size || run.size - own.size < 1) && own.some((at) => at.size >= run.size * 0.75 || at.size === run.size));
    if (row) {
      row.push(run);
      if (run.size > row.size) row.size = run.size;
    } else Object.assign(rows[rows.push([run]) - 1], { y: run.y, size: run.size });
  }
  return rows.map((row) => Object.assign(row.sort((a, b) => a.x0 - b.x0), { y: row.y, size: row.size })).sort((a, b) => a.y - b.y);
}

// The x of the gutter between two columns, or null for a page of one.
function gutterOf(rows, width) {
  const body = rows.filter((row) => row.length && row.reduce((n, run) => n + run.text.length, 0) > 20);
  if (body.length < 8) return null;
  let best = null;
  for (let x = width * 0.35; x <= width * 0.65; x += 2) {
    const free = body.filter((row) => !row.some((run) => run.x0 < x && run.x1 > x)).length / body.length;
    const sides = body.filter((row) => row.some((run) => run.x1 <= x) && row.some((run) => run.x0 >= x)).length / body.length;
    if (free >= GUTTER_ROWS && sides >= 0.4 && (!best || free > best.free || (free === best.free && sides > best.sides))) best = { x, free, sides };
  }
  return best?.x ?? null;
}

// A row as a line: its runs joined by a space where they have a gap between them.
function lineOf(row, page, height) {
  if (!row.length) return null;
  let text = '';
  let last = null;
  for (const run of row) {
    if (last && run.x0 - last.x1 > 0.12 * Math.max(run.size, last.size) && !/\s$/.test(text)) text += ' ';
    text += run.text;
    last = run;
  }
  text = clean(text);
  if (!text) return null;
  const main = row.reduce((best, run) => (run.text.length > best.text.length ? run : best));
  return { text, x0: row[0].x0, x1: row.at(-1).x1, y: row.y, size: main.size, font: main.font, page, top: row.y / height };
}

// The lines of all pages without the running headers and footers: those in
// a page's top or bottom margin that stand on a good part of the pages with
// only their numbers changed, and every bare page number there.
function withoutRunning(pages, count) {
  const inMargin = (line) => line.top < MARGIN || line.top > 1 - MARGIN;
  const seen = new Map();
  for (const lines of pages) for (const key of new Set(lines.filter(inMargin).map(shape))) seen.set(key, (seen.get(key) ?? 0) + 1);
  const running = (line) => inMargin(line) && ((count >= 3 && seen.get(shape(line)) >= REPEATED * count) || /^(page\s+)?\d{1,4}(\s+of\s+\d+)?$/i.test(line.text));
  return pages.flat().filter((line) => !running(line));
}
const shape = ({ text }) => text.replace(/\d+/g, '#').toLowerCase();

// The size and font most of the text is set in, by the characters in it.
function typical(lines) {
  const by = (key) => {
    const weight = new Map();
    for (const line of lines) weight.set(line[key], (weight.get(line[key]) ?? 0) + line.text.length);
    return [...weight].sort((a, b) => b[1] - a[1])[0]?.[0];
  };
  const size = by('size');
  return { size, font: by('font') };
}

// Lines as blocks. A line starts a new one when it is a heading, an item, or
// after a gap taller than the lines are set apart, or indented, with the
// previous one ended; otherwise it continues the block, hyphenated words
// made whole again. What is not prose (a table's numbers, a reference list)
// is left out.
function blocksOf(lines, { size, font }) {
  const pitch = median(lines.slice(1).map((line, i) => line.y - lines[i].y).filter((gap) => gap > 0 && gap < 2.5 * size)) || 1.2 * size;
  const left = median(lines.map((line) => line.x0));
  const heading = (line) => {
    const bigger = line.size >= size * 1.12;
    const other = line.font !== font && line.size >= size * 0.97;
    return line.text.length <= 110 && !/[.,;]$/.test(line.text) && /\p{L}{3}/u.test(line.text) && (bigger || (other && (NUMBERED.test(line.text) || (line.text === line.text.toUpperCase() && line.text.split(' ').length > 1))) || (NUMBERED.test(line.text) && bigger));
  };
  const blocks = [];
  let open = null;
  let dropping = false;
  let before = null;
  for (const line of lines) {
    const head = heading(line);
    const item = !head && BULLET.exec(line.text);
    const gap = before && before.page === line.page && line.y > before.y ? line.y - before.y : null;
    const sameColumn = before && Math.abs(line.x0 - before.x0) < 2.5 * size;
    const text = open && /^(p|li)$/.test(open.kind);
    const wrapped = open && !head && !item && ((text && /^[\p{Ll}\d]/u.test(line.text) && !SENTENCE_END.test(before.text)) || (gap === null ? !SENTENCE_END.test(before.text) && /^[\p{Ll}\d(]/u.test(line.text) : gap < pitch * 1.35 && sameColumn && !(line.x0 - before.x0 > 0.8 * size && line.x0 - left > 0.8 * size && SENTENCE_END.test(before.text))));
    if (wrapped) open.text = join(open.text, line.text);
    else {
      if (head) {
        // A heading of several lines of the same size is one heading.
        if (open?.kind === 'h2' || open?.kind === 'h3') {
          if (Math.abs(before.size - line.size) < 0.5 && gap !== null && gap < 1.6 * line.size) { open.text = join(open.text, line.text); before = line; continue; }
        }
        open = { kind: 'h2', text: line.text, size: line.size };
        dropping = END_OF_TEXT.test(line.text.replace(/^[\d.\s]+/, '')) || (dropping && !BACK_TO_TEXT.test(line.text));
      } else if (item) open = { kind: 'li', text: line.text.slice(item[0].length), list: /^\(?\d|^\(?[a-z][.)]|^\([ivx]/.test(item[0]) ? 'ol' : 'ul', depth: 0 };
      else open = { kind: CAPTION.test(line.text) ? 'caption' : 'p', text: line.text };
      open.dropped = dropping;
      blocks.push(open);
    }
    before = line;
  }
  const sizes = [...new Set(blocks.filter(({ kind }) => kind === 'h2').map(({ size: own }) => own))].sort((a, b) => b - a);
  return blocks
    .filter((block) => !block.dropped && block.kind !== 'caption' && (/^h/.test(block.kind) || prose(block.text)))
    .map(({ kind, text, list, depth, size: own }) => ({ kind: kind === 'h2' && own < sizes[0] * 0.92 && sizes.length > 1 ? 'h3' : kind, text: clean(text), ...(list && { list, depth }) }))
    // A "heading" of several lines is a paragraph set larger than the rest.
    .map((block) => (/^h/.test(block.kind) && block.text.length > 140 ? { kind: 'p', text: block.text } : block))
    .filter(({ text }) => text);
}

// Text that is a sentence or more, not a table's cells or a run of numbers.
function prose(text) {
  // A label of a figure or a byline has no end to its sentence; an address says it is a masthead.
  if (!SENTENCE_END.test(text) && text.length < 200) return false;
  if (/\S+@\S+\.\S+/.test(text) && text.length < 500) return false;
  const letters = (text.match(/\p{L}/gu) ?? []).length;
  const words = text.split(/\s+/).filter((word) => /\p{L}{2}/u.test(word)).length;
  return letters >= 0.55 * text.replace(/\s/g, '').length && words >= 4;
}

const join = (text, more) => (/\p{L}-$/u.test(text) && /^\p{Ll}/u.test(more) ? text.slice(0, -1) + more : `${text} ${more}`);
const median = (numbers) => [...numbers].sort((a, b) => a - b)[Math.floor(numbers.length / 2)];
const clean = (text) => text.replace(/[\u0000-\u001f\u00ad\u200b]/g, ' ').replace(/\s+/g, ' ').trim();

// The name of the document and the lines left once it is taken out: the
// lines of the first page set larger than any other, which a title is, else
// what the file says of itself (not a file name), else the first heading.
function titleOf(lines, size, info) {
  const first = lines.filter(({ page }) => page === lines[0]?.page);
  const top = Math.max(...first.map((line) => line.size));
  const own = top >= size * 1.35 ? first.filter((line) => line.size > top * 0.97 && line.top < 0.5) : [];
  const said = clean(info?.Title ?? '');
  const usable = said.length > 3 && !/\.(pdf|docx?|tex)$/i.test(said) && !/^(untitled|microsoft word)/i.test(said);
  const found = own.map(({ text }) => text).reduce((text, more) => (text ? join(text, more) : more), '');
  return { title: (usable ? said : null) || found || lines.find((line) => line.size >= size * 1.12)?.text || 'Untitled PDF', rest: lines.filter((line) => !own.includes(line)) };
}

function dateOf(raw) {
  const [, y, m = '01', d = '01'] = /^D:(\d{4})(\d{2})?(\d{2})?/.exec(raw ?? '') ?? [];
  return y ? `${y}-${m}-${d}` : null;
}
