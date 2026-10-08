// The numbers and the two charts of docs/bench.md, from what the bench kept:
//   what Jev cost and how long it took, page by page (a run of run.mjs: every request keeps the tokens
//   it read and the dollars the gateway billed), and how near Jev comes to a blind LLM teacher
//   (scorecard.json, from score.mjs --save).
// Nothing is asked of Jev: it reads files.
//
//   node corpus/bench/run.mjs stats --pages all     (free: every answer is kept)
//   node corpus/bench/report.mjs stats               -> docs/media/bench-cost.svg, docs/media/bench-ceiling.svg, and the table on stdout

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../..');
const run = process.argv[2];
if (!run) throw new Error('name the run: node corpus/bench/report.mjs <run>');
const dir = join(ROOT, '.cache/bench', run);
const pages = readdirSync(dir).filter((name) => name.endsWith('.json') && name !== 'run.json').map((name) => {
  const page = JSON.parse(readFileSync(join(dir, name), 'utf8'));
  const sum = (key) => page.requests.reduce((total, request) => total + (request[key] ?? 0), 0);
  return { id: page.id, split: page.split, requests: page.requests.length, questions: page.requests.reduce((n, request) => n + Object.keys(request.questions).length, 0), tokens: sum('tokens'), dollars: sum('dollars'), sentences: page.sentences.length, kept: page.made?.kept?.length ?? 0 };
}).sort((a, b) => a.dollars - b.dollars);

// How long Jev took over a request, from every answer kept.
const ms = [];
const walk = (path) => {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const full = join(path, entry.name);
    if (entry.isDirectory()) { if (entry.name !== 'pages') walk(full); } else if (path.endsWith('judgements') && entry.name.endsWith('.json')) {
      const { model, ms: took } = JSON.parse(readFileSync(full, 'utf8'));
      if (took && String(model).includes('jev')) ms.push(took);
    }
  }
};
walk(join(ROOT, 'corpus'));
ms.sort((a, b) => a - b);
const quantile = (list, q) => list[Math.min(list.length - 1, Math.floor(q * list.length))];
const total = (key) => pages.reduce((sum, page) => sum + page[key], 0);
const money = (x) => `$${x < 0.01 ? x.toFixed(4) : x.toFixed(x < 0.1 ? 3 : 2)}`;
const n = (x) => Math.round(x).toLocaleString('en-US');
const median = quantile(pages.map((page) => page.dollars), 0.5);

const summary = { pages: pages.length, requests: total('requests'), questions: total('questions'), tokens: total('tokens'), dollars: total('dollars'), medianDollars: median, medianMs: quantile(ms, 0.5), p90Ms: quantile(ms, 0.9), answers: ms.length };
console.log(JSON.stringify(summary, null, 1));
console.log(`\n| page | split | requests | questions | tokens read | cost |\n| --- | --- | ---: | ---: | ---: | ---: |`);
for (const page of [...pages].reverse()) console.log(`| ${page.id} | ${page.split} | ${page.requests} | ${n(page.questions)} | ${n(page.tokens)} | ${money(page.dollars)} |`);

// ---- the charts: a dark card, hairlines, one accent for what is measured
const FONT = `font-family="'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"`;
const INK = '#eef0f2', DIM = '#8a909c', LOW = '#555c68', RULE = 'rgba(255,255,255,0.14)', SIGNAL = '#f2e313';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const text = (x, y, s, { size = 12, fill = DIM, anchor = 'start', weight = 400, spacing = 0 } = {}) => `<text x="${x}" y="${y}" ${FONT} font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" letter-spacing="${spacing}">${esc(s)}</text>`;
const card = (w, h, body, title, sub) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}"><rect width="${w}" height="${h}" fill="#0a0b0f"/><rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" fill="none" stroke="${RULE}"/>${text(32, 44, title, { size: 20, fill: INK, weight: 600, spacing: -0.4 })}${text(32, 68, sub, { size: 12 })}${body}</svg>\n`;

// Chart 1: Jev against the teacher, as a share of the ceiling (the teacher against itself).
const LABELS = { apparatus: 'sections that are apparatus', heading: 'headings that are subjects', alone: 'sentences that stand alone', repeat: 'sentences that repeat another', filing: 'the subject a sentence is filed under', subjects: "the page's subjects", lead: 'the sentence that leads', keep: 'sentences kept', passed: 'sentences passed over', term: 'the term that names a sentence', themes: 'themes', essential: 'sentences that are essential' };
const card1 = JSON.parse(readFileSync(join(import.meta.dirname, 'scorecard.json'), 'utf8'));
const rows = Object.entries(card1.decisions).flatMap(([id, d]) => (id.endsWith('/teacher') && d.ofCeiling != null && LABELS[id.split('/')[0]] ? [{ label: LABELS[id.split('/')[0]], share: d.ofCeiling }] : [])).sort((a, b) => b.share - a.share);
{
  const w = 960, top = 104, step = 30, x0 = 380, x1 = 880, max = 1.1, at = (s) => x0 + ((x1 - x0) * s) / max;
  const h = top + rows.length * step + 64;
  let body = `<line x1="${at(1)}" y1="${top - 14}" x2="${at(1)}" y2="${top + rows.length * step - 8}" stroke="${LOW}" stroke-dasharray="3 4"/>${text(at(1), top - 22, 'the teacher against itself, 100%', { size: 11, anchor: 'middle', fill: DIM })}`;
  rows.forEach((row, i) => {
    const y = top + i * step + 12;
    body += text(32, y + 4, row.label, { size: 13, fill: INK });
    body += `<line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" stroke="${RULE}"/><line x1="${x0}" y1="${y}" x2="${at(row.share)}" y2="${y}" stroke="${DIM}" stroke-width="2"/><circle cx="${at(row.share)}" cy="${y}" r="5" fill="${SIGNAL}"/>`;
    body += text(Math.min(at(row.share) + 14, x1 + 16), y + 4, `${Math.round(100 * row.share)}%`, { size: 13, fill: INK });
  });
  body += text(32, h - 22, `Pages that never set a threshold (test, authored) · run ${card1.run} · corpus/bench/scorecard.json · over 100% is the teacher's own noise`, { size: 11, fill: LOW });
  writeFileSync(join(ROOT, 'docs/media/bench-ceiling.svg'), card(w, h, body, 'Jev against a blind LLM teacher', "How near Jev comes to what an LLM that read the whole page decided, as a share of how near that LLM comes to itself."));
}

// Chart 2: what each page cost.
{
  const w = 960, h = 420, left = 72, right = 928, base = 340, topY = 112, maxD = Math.ceil((pages.at(-1).dollars * 100) / 2) / 50 || 0.1;
  const bw = (right - left) / pages.length, y = (d) => base - ((base - topY) * d) / maxD;
  let body = '';
  for (let t = 0; t <= maxD + 1e-9; t += maxD / 5) body += `<line x1="${left}" y1="${y(t)}" x2="${right}" y2="${y(t)}" stroke="${RULE}"/>${text(left - 10, y(t) + 4, `$${t.toFixed(2)}`, { size: 11, anchor: 'end' })}`;
  pages.forEach((page, i) => { body += `<rect x="${left + i * bw + 1.5}" y="${y(page.dollars)}" width="${bw - 3}" height="${base - y(page.dollars)}" fill="${page.dollars === median ? SIGNAL : DIM}"/>`; });
  body += `<line x1="${left}" y1="${y(median)}" x2="${right}" y2="${y(median)}" stroke="${SIGNAL}" stroke-dasharray="3 4"/>${text(left + 8, y(median) - 8, `median ${money(median)}`, { size: 12, fill: SIGNAL })}`;
  const first = pages[0], last = pages.at(-1);
  body += text(left, base + 22, `${first.id} ${money(first.dollars)}`, { size: 11 }) + text(right, base + 22, `${last.id} ${money(last.dollars)}`, { size: 11, anchor: 'end' });
  body += text(32, h - 24, `${pages.length} pages · ${n(total('questions'))} questions · ${(total('tokens') / 1e6).toFixed(1)} M tokens read · ${money(total('dollars'))} in all · a request answered in ${quantile(ms, 0.5)} ms (median), ${quantile(ms, 0.9)} ms (p90)`, { size: 11, fill: LOW });
  writeFileSync(join(ROOT, 'docs/media/bench-cost.svg'), card(w, h, body, 'What a page costs Jev', 'The dollars the gateway billed for the questions of each page of the bench, cheapest to dearest.'));
}
console.log('\ndocs/media/bench-ceiling.svg, docs/media/bench-cost.svg');
