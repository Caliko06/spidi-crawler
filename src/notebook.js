// The notebook's page: sources go on a shelf, the server relates them, and what
// comes back is laid out as a web in which the ideas several sources share
// gather between those sources and what only one says stays by its own.

import { createWeb } from './notebook-web.js';

const SVG = 'http://www.w3.org/2000/svg';
const LETTERS = 'ABCDEFGHIJKL';
const RELATION = { supports: 'supports', contradicts: 'contradicts', extends: 'extends', causes: 'causes' };

const $ = (id) => document.getElementById(id);
const make = (tag, attributes = {}, parent) => {
  const node = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  parent?.append(node);
  return node;
};
const html = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};
const clip = (text, most) => (text.length > most ? `${text.slice(0, most - 1)}…` : text);

const shelf = []; // { key, name, id, title, words, error }
let result = null;
let filter = 'all';
let bondZ = 1.5; // how far above the mean of all pairs a measured bond stands to be drawn
// What the reader has put aside or kept in view of a notebook, by the name of the idea; it is kept in this browser.
const aside = { hidden: new Set(), pinned: new Set(), key: '' };
const asideKey = () => `notebook:${ready().map(({ id }) => id).sort().join(',')}:${$('focus').value.trim()}`;
function loadAside() {
  aside.key = asideKey();
  try {
    const kept = JSON.parse(localStorage.getItem(aside.key) ?? '{}');
    aside.hidden = new Set(kept.hidden ?? []);
    aside.pinned = new Set(kept.pinned ?? []);
  } catch {
    aside.hidden = new Set();
    aside.pinned = new Set();
  }
}
function saveAside() {
  try { localStorage.setItem(aside.key, JSON.stringify({ hidden: [...aside.hidden], pinned: [...aside.pinned] })); } catch { /* the browser keeps nothing: the session still works */ }
  const hidden = result.nodes.filter(({ label }) => aside.hidden.has(label)).length;
  $('restore').hidden = hidden === 0;
  $('restore').textContent = `Show ${hidden} hidden`;
}

let preview = null; // what the web shows while the sources are still being read

// ---------- The shelf ----------

const ready = () => shelf.filter(({ id }) => id);

const wordsRead = (source) => (source.outline ?? []).reduce((sum, section) => sum + (source.skip.has(section.at) ? 0 : section.words), 0);

function drawShelf() {
  const list = $('sources');
  list.replaceChildren(...shelf.map((source) => {
    const at = ready().indexOf(source);
    const remove = html('button', { type: 'button', title: 'Remove', textContent: '×' });
    remove.addEventListener('click', () => {
      shelf.splice(shelf.indexOf(source), 1);
      drawShelf();
    });
    const state = source.error ? 'is-failed' : source.id ? '' : 'is-pending';
    const title = html('span', { className: 'title', textContent: source.error ?? source.title ?? source.name, title: source.id ? 'Choose which sections are read' : source.name });
    if (source.id) title.addEventListener('click', () => { source.open = !source.open; drawShelf(); });
    const item = html('li', { className: state },
      html('span', { className: 'letter', textContent: source.id ? LETTERS[at] : '–' }),
      title,
      html('span', { className: 'meta' }, source.words ? `${wordsRead(source).toLocaleString('en')} w` : '', remove));
    if (source.open && source.outline) {
      item.append(html('div', { className: 'outline' }, ...source.outline.map((section) => {
        const box = html('input', { type: 'checkbox', checked: !source.skip.has(section.at) });
        const row = html('label', { className: `section${source.skip.has(section.at) ? ' is-left' : ''}` }, box, html('span', { textContent: section.title, title: section.title }), html('small', { textContent: section.words.toLocaleString('en') }));
        box.addEventListener('change', () => {
          box.checked ? source.skip.delete(section.at) : source.skip.add(section.at);
          drawShelf();
        });
        return row;
      }), html('p', { className: 'reading', textContent: `Reading ${wordsRead(source).toLocaleString('en')} of ${source.words.toLocaleString('en')} words` })));
    }
    return item;
  }));
  $('run').disabled = ready().length < 2 || shelf.some(({ id, error }) => !id && !error) || ready().some((source) => wordsRead(source) === 0);
}

async function put(name, query, body) {
  const source = { name };
  shelf.push(source);
  drawShelf();
  try {
    const response = await fetch(`/api/notebook/source?${query}`, { method: 'POST', body });
    const reply = await response.json();
    if (!response.ok) throw new Error(reply.error);
    if (shelf.some((other) => other.id === reply.id)) {
      shelf.splice(shelf.indexOf(source), 1); // the same source twice is one
    } else {
      Object.assign(source, reply, { skip: new Set(reply.outline.filter(({ left }) => left).map(({ at }) => at)) }); // what a document keeps for apparatus is left out to begin with
    }
  } catch (error) {
    source.error = error.message;
  }
  drawShelf();
}

const addFiles = (files) => [...files].forEach((file) => put(file.name, `name=${encodeURIComponent(file.name)}`, file));

const drop = $('drop');
$('file').addEventListener('change', (event) => {
  addFiles(event.target.files);
  event.target.value = '';
});
drop.addEventListener('keydown', (event) => (event.key === 'Enter' || event.key === ' ') && (event.preventDefault(), $('file').click()));
drop.addEventListener('dragover', (event) => (event.preventDefault(), drop.classList.add('is-over')));
drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
drop.addEventListener('drop', (event) => {
  event.preventDefault();
  drop.classList.remove('is-over');
  addFiles(event.dataTransfer.files);
});
window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => event.preventDefault());

$('address').addEventListener('submit', (event) => {
  event.preventDefault();
  const { url } = event.target;
  if (!url.value.trim()) return;
  put(url.value.trim(), `url=${encodeURIComponent(url.value.trim())}`);
  url.value = '';
});

const corpus = $('corpus');
fetch('/api/corpus').then((response) => response.json()).then((pages) => {
  for (const { id, title } of pages) corpus.append(html('option', { value: id, textContent: title }));
});
corpus.addEventListener('change', () => {
  put(corpus.selectedOptions[0].textContent, `id=${encodeURIComponent(corpus.value)}`);
  corpus.selectedIndex = 0;
});

// ---------- Relating them ----------

// What the run is doing, a row for each step with its clock, and the web filling as each source is read.
const seconds = (ms) => `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`;

function track(sources) {
  const rows = new Map();
  const list = $('stages');
  const row = (key, label) => {
    const at = html('span', { className: 'what' });
    const time = html('span', { className: 'time' });
    const item = html('li', {}, html('span', { className: 'glyph' }), at, time);
    const state = { item, at, time, label, since: null };
    rows.set(key, state);
    list.append(item);
    return state;
  };
  // `text` is what the step is, `note` how it stands; the clock takes the place of the note while it works, and its duration when it is done.
  const set = (key, mode, text, note = '', ms) => {
    const state = rows.get(key);
    state.item.className = `is-${mode}`;
    state.at.replaceChildren(html('b', { textContent: state.label }), text);
    state.note = note;
    if (mode === 'working') state.since ??= performance.now();
    else {
      state.since = null;
      state.time.textContent = [note, ms === undefined ? '' : ms === 0 ? 'kept' : seconds(ms)].filter(Boolean).join(' · ');
    }
  };
  list.replaceChildren();
  list.hidden = false;
  sources.forEach(({ letter, title }) => { row(letter, letter); set(letter, 'waiting', clip(title, 22)); });
  row('relate', '→');
  set('relate', 'waiting', 'Relate the ideas');
  const clock = setInterval(() => rows.forEach((state) => state.since && (state.time.textContent = `${state.note} ${seconds(performance.now() - state.since)}`.trim())), 200);
  return { set, stop: () => clearInterval(clock), rows };
}

$('run').addEventListener('click', () => {
  const log = $('log');
  const letters = ready().map((source, at) => ({ letter: LETTERS[at], title: source.title }));
  const tracker = track(letters);
  log.className = '';
  log.textContent = '';
  $('run').disabled = true;
  $('readout').hidden = true;
  result = null;
  closeDrawer();
  // The web while it is read: the letters and, as each source is read, its ideas.
  preview = { sources: letters, nodes: [], edges: [] };
  $('graph').classList.add('has-result', 'is-working');
  redraw(preview);
  const finish = () => { tracker.stop(); $('graph').classList.remove('is-working'); $('run').disabled = false; };
  const failed = (message) => {
    for (const [key, state] of tracker.rows) if (state.item.className === 'is-working') tracker.set(key, 'failed', message);
    log.className = 'is-error';
    log.textContent = message;
    finish();
  };
  letters.forEach(({ letter, title }) => tracker.set(letter, 'working', clip(title, 22), 'opening'));
  const skip = ready().filter(({ skip: left }) => left.size).map(({ id, skip: left }) => `${id}:${[...left].join('.')}`).join(';');
  const stream = new EventSource(`/api/notebook/run?ids=${ready().map(({ id }) => id).join(',')}&skip=${encodeURIComponent(skip)}&focus=${encodeURIComponent($('focus').value)}`);
  stream.onmessage = ({ data }) => {
    const event = JSON.parse(data);
    const title = (letter) => clip(letters.find((l) => l.letter === letter).title, 22);
    if (event.type === 'opened') tracker.set(event.letter, 'working', title(event.letter), `${event.sentences} sentences, reading`);
    else if (event.type === 'reading') tracker.set(event.letter, 'working', title(event.letter), 'reading');
    else if (event.type === 'read') {
      tracker.set(event.letter, 'done', title(event.letter), `${event.ideas.length} ideas`, event.recalled ? 0 : event.ms);
      const source = letters.findIndex((l) => l.letter === event.letter);
      event.ideas.forEach(({ name, weight }, at) => preview.nodes.push({ id: `${event.letter}${at}`, label: name, shared: false, stance: null, weight, members: [{ source }] }));
      redraw(preview);
    } else if (event.type === 'relating') tracker.set('relate', 'working', 'Relate the ideas', `${event.ideas} ideas`);
    else if (event.type === 'related') tracker.set('relate', 'done', 'Related', '', event.recalled ? 0 : event.ms);
    else if (event.type === 'result') {
      stream.close();
      log.textContent = `${event.result.nodes.length} ideas, ${event.result.nodes.filter(({ shared }) => shared).length} shared · ${event.result.model}`;
      finish();
      show(event.result);
    } else if (event.type === 'error') {
      stream.close();
      failed(event.error);
    }
  };
  stream.onerror = () => {
    stream.close();
    if ($('run').disabled) failed('The connection to the server was lost.');
  };
});

// ---------- The result: the web, its readout, and the drawer ----------

const web = createWeb($('canvas'), $('tip'), {
  idea: (id) => openDrawer('idea', id),
  source: (at) => openDrawer('source', at),
  centre: () => openDrawer('summary'),
  clear: () => closeDrawer(),
});
let showBonds = true;
let drawer = null; // what the drawer shows: { kind: 'summary' | 'idea' | 'source', id }

// An idea is numbered by its place in what the model made, so that its number is the same in the web, the drawer and the notes.
const numbered = (next) => next.nodes.forEach((node, at) => (node.number = at + 1));
const aside_ = (node) => aside.hidden.has(node.label) || (filter === 'shared' && !node.shared); // an idea put aside, or one that is not shared when only those are asked for

function redraw(data = result ?? preview) {
  if (!data) return;
  const own = data === result;
  const drawn = web.draw(data, { bonds: showBonds, bondZ, picked: own && drawer?.kind === 'idea' ? drawer.id : null, pinned: aside.pinned, off: own ? aside_ : undefined });
  if (own) readout(drawn);
}

const figure = (value, of) => {
  const node = html('b', { textContent: value });
  node.dataset.of = of;
  return node;
};

// The figures over the web: what the notebook holds, in the crawler's own band.
function readout(drawn) {
  const shown = result.nodes.filter((node) => !aside_(node));
  const figures = [
    ['sources', result.sources.length, ''],
    ['ideas', shown.length, `/${result.nodes.length}`],
    ['shared', shown.filter(({ shared }) => shared).length, `/${shown.length}`],
    ['tensions', result.nodes.filter(({ stance }) => stance === 'conflict').length + result.edges.filter(({ relation }) => relation === 'contradicts').length, ''],
    ['bonds', drawn.bonds, ''],
  ];
  $('figures').replaceChildren(...figures.map(([name, value, of]) => html('span', {}, figure(value, of), html('i', { textContent: name }))));
}

function show(next) {
  result = next;
  numbered(result);
  $('readout').hidden = false;
  loadAside();
  saveAside();
  $('graph').classList.add('has-result');
  drawer = null;
  $('drawer').hidden = true;
  openDrawer('summary');
}

$('restore').addEventListener('click', () => {
  aside.hidden.clear();
  saveAside();
  redraw();
  if (drawer?.kind === 'summary') openDrawer('summary');
});

$('only-shared').addEventListener('click', ({ currentTarget }) => {
  filter = filter === 'all' ? 'shared' : 'all';
  currentTarget.setAttribute('aria-pressed', String(filter === 'shared'));
  redraw();
});

$('bonds').addEventListener('click', ({ currentTarget }) => {
  showBonds = !showBonds;
  currentTarget.setAttribute('aria-pressed', String(showBonds));
  $('bondline').hidden = !showBonds;
  redraw();
});

$('bondrange').addEventListener('input', (event) => {
  bondZ = Number(event.target.value);
  $('bondz').textContent = bondZ.toFixed(1);
  if (result) requestAnimationFrame(() => redraw());
});

$('summary').addEventListener('click', () => (drawer?.kind === 'summary' ? closeDrawer() : openDrawer('summary')));

// ---------- The drawer: the summary, a source, an idea ----------

const STANCE = { agree: 'The sources agree', partial: 'Same idea, said with a difference', conflict: 'The sources contradict' };
const letterOf = (at) => result.sources[at].letter;
const sourcesOf = (node) => [...new Set(node.members.map(({ source }) => source))];

// A row that opens an idea: its number as the web shows it, its name, the sources that say it.
function row(node, note) {
  const button = html('button', { className: 'idea-row', type: 'button' }, html('i', { textContent: String(node.number).padStart(2, '0') }), html('span', { textContent: node.label }), html('small', { textContent: note ?? sourcesOf(node).map(letterOf).join(' ') }));
  button.addEventListener('click', () => openDrawer('idea', node.id));
  return button;
}

function openDrawer(kind, id) {
  if (!result) return;
  const el = $('drawer');
  const opening = el.hidden;
  drawer = { kind, id };
  const parts = [];
  const close = html('button', { className: 'close', type: 'button', title: 'Close', textContent: '×' });
  close.addEventListener('click', () => closeDrawer());
  const back = () => {
    const button = html('button', { className: 'back', type: 'button', textContent: '← Summary' });
    button.addEventListener('click', () => openDrawer('summary'));
    return button;
  };
  const alive = result.nodes.filter((node) => !aside.hidden.has(node.label));

  if (kind === 'summary') {
    parts.push(html('header', {}, html('h1', { textContent: 'What the sources say together' }), close));
    if (result.focus) parts.push(html('p', { className: 'stance', textContent: `After: ${result.focus}` }));
    parts.push(html('p', { className: 'verdict' }, html('b', { textContent: 'Where they converge' }), result.overview.converge));
    parts.push(html('p', { className: 'verdict' }, html('b', { textContent: 'Where they part' }), result.overview.diverge));
    const group = (title, nodes, note) => nodes.length && parts.push(html('section', { className: 'ties' }, html('h2', { textContent: `${title} · ${nodes.length}` }), ...nodes.map((node) => row(node, note?.(node)))));
    group('Shared', alive.filter(({ stance }) => stance === 'agree' || stance === 'partial').sort((x, y) => y.overlap - x.overlap), (node) => `${sourcesOf(node).map(letterOf).join(' ')}${node.stance === 'partial' ? ' ~' : ''}`);
    group('Contradicted', alive.filter(({ stance }) => stance === 'conflict'));
    parts.push(html('section', { className: 'key' }, html('h2', { textContent: 'How to read the web' }),
      html('p', {}, 'The ', html('b', { textContent: 'notebook' }), ' is at the middle; each ', html('b', { textContent: 'source' }), ' is a big node round it. An idea held to one source stays out by it; one held to several hangs between them: ', html('b', { textContent: 'that is where they converge' }), '.'),
      html('p', {}, 'A node is as big as the sentences under it (the count after its name). Its sentences are the beads over it, read by pointing at them: a ', html('b', { className: 'sq', textContent: '■' }), ' where the idea is shared, a ', html('b', { textContent: '•' }), ' where one source says it. Dashed hairlines are bonds measured between ideas.')));
    result.sources.forEach((source, at) => group(`Only ${source.letter}`, alive.filter((node) => !node.shared && node.members[0].source === at), () => ''));
  } else if (kind === 'source') {
    const source = result.sources[id];
    const mine = alive.filter((node) => node.members.some(({ source: s }) => s === id));
    parts.push(html('header', {}, html('h1', { textContent: source.title }), close));
    parts.push(html('p', { className: 'stance', textContent: `Source ${source.letter} · ${source.words.toLocaleString('en')} words · ${mine.length} ideas` }));
    if (/^https?:/.test(source.address)) parts.push(html('p', { className: 'gauge' }, source.address));
    parts.push(html('section', { className: 'ties' }, html('h2', { textContent: 'Its ideas' }), ...mine.map((node) => row(node, node.shared ? sourcesOf(node).map(letterOf).join(' ') : ''))));
    parts.push(back());
  } else {
    const node = result.nodes[id];
    parts.push(html('header', {}, html('h1', { textContent: node.label }), close));
    parts.push(html('p', { className: `stance ${node.stance ?? ''}`, textContent: `${String(node.number).padStart(2, '0')} · ${node.shared ? STANCE[node.stance] : `Only ${letterOf(node.members[0].source)} says it`}` }));
    if (node.shared && node.overlap !== null) {
      const strength = node.overlap >= 2.5 ? 'strong' : node.overlap >= bondZ ? 'fair' : 'weak';
      parts.push(html('p', { className: `gauge${strength === 'weak' ? ' is-weak' : ''}` }, 'The sources\' own sentences are ', html('b', { textContent: `${node.overlap.toFixed(1)} σ` }), ` above the mean pair: ${strength} textual overlap`));
    }
    if (result.focus && node.relevance !== null) parts.push(html('p', { className: `gauge${node.relevance < 0.5 ? ' is-weak' : ''}` }, 'What you are after, ', html('b', { textContent: `${node.relevance.toFixed(1)} σ` }), node.relevance >= 1.5 ? ' above the mean idea: it bears on it' : node.relevance >= 0.5 ? ' above the mean idea: it touches it' : ': little to do with it'));
    const pin = html('button', { type: 'button', textContent: aside.pinned.has(node.label) ? 'Unpin' : 'Pin in view' });
    pin.addEventListener('click', () => {
      aside.pinned.has(node.label) ? aside.pinned.delete(node.label) : aside.pinned.add(node.label);
      saveAside();
      redraw();
      openDrawer('idea', id);
    });
    const hide = html('button', { type: 'button', textContent: 'Put aside' });
    hide.addEventListener('click', () => {
      aside.hidden.add(node.label);
      aside.pinned.delete(node.label);
      saveAside();
      openDrawer('summary');
      redraw();
    });
    parts.push(html('div', { className: 'acts' }, pin, hide));
    if (node.agree) parts.push(html('p', { className: 'verdict' }, html('b', { textContent: 'In common' }), node.agree));
    if (node.differ) parts.push(html('p', { className: 'verdict' }, html('b', { textContent: 'Where they part' }), node.differ));
    for (const member of node.members) {
      const source = result.sources[member.source];
      parts.push(html('section', { className: 'member' },
        html('h3', {}, html('span', { textContent: source.letter }), clip(source.title, 48)),
        html('p', { className: 'claim', textContent: member.claim }),
        ...member.quotes.map(({ text }) => html('blockquote', { textContent: text }))));
    }
    const near = result.bonds.filter(({ from, to }) => (from === id || to === id) && !aside.hidden.has(result.nodes[from === id ? to : from].label)).slice(0, 6);
    if (near.length) parts.push(html('section', { className: 'ties' }, html('h2', { textContent: 'Closest by their sentences' }), ...near.map((bond) => row(result.nodes[bond.from === id ? bond.to : bond.from], `${bond.z.toFixed(1)} σ ${bond.kind === 'cross' ? '· between sources' : '· inside one'}`))));
    const ties = result.edges.filter(({ from, to }) => (from === id || to === id) && !aside.hidden.has(result.nodes[from === id ? to : from].label));
    if (ties.length) parts.push(html('section', { className: 'ties' }, html('h2', { textContent: 'Ties' }), ...ties.map((edge) => row(result.nodes[edge.from === id ? edge.to : edge.from], `${edge.from === id ? edge.relation : `${edge.relation} ←`}${edge.note ? ` · ${edge.note}` : ''}`))));
    parts.push(back());
  }
  el.replaceChildren(...parts);
  el.hidden = false;
  el.scrollTop = 0;
  $('summary').setAttribute('aria-pressed', String(kind === 'summary'));
  if (opening) requestAnimationFrame(() => redraw());
  else web.mark(kind === 'idea' ? id : undefined);
}

function closeDrawer() {
  drawer = null;
  $('summary').setAttribute('aria-pressed', 'false');
  if ($('drawer').hidden) return;
  $('drawer').hidden = true;
  requestAnimationFrame(() => redraw());
}

let resizing;
window.addEventListener('resize', () => {
  clearTimeout(resizing);
  resizing = setTimeout(() => redraw(), 120);
});

// ---------- Export: the notebook as notes for an Obsidian vault ----------

// A file name Obsidian takes, one for each idea and source, told apart when two are called alike.
const NAMES = /[\\/:*?"<>|#^[\]]/g;
function namer() {
  const used = new Set();
  return (text) => {
    const base = text.replace(NAMES, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Untitled';
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base} ${n}`;
    used.add(name.toLowerCase());
    return name;
  };
}
const quoted = (text) => text.split('\n').map((line) => `> ${line}`).join('\n');
const yamlText = (text) => JSON.stringify(text);

function vault() {
  const name = namer();
  const shown = result.nodes.filter((node) => !aside.hidden.has(node.label));
  const ideaName = new Map(shown.map((node) => [node.id, name(node.label)]));
  const sourceName = result.sources.map((source) => name(source.title));
  const link = (id) => `[[${ideaName.get(id)}]]`;
  const files = [];
  const today = new Date().toISOString().slice(0, 10);

  files.push({ path: 'Notebook.md', text: [
    '---', 'tags: [notebook]', `created: ${today}`, ...(result.focus ? [`focus: ${yamlText(result.focus)}`] : []), '---', '',
    '# Notebook', '', ...(result.focus ? [`**What I am after:** ${result.focus}`, ''] : []),
    '## Where they converge', '', result.overview.converge, '', '## Where they part', '', result.overview.diverge, '',
    '## Sources', '', ...result.sources.map((source, at) => `- [[Sources/${sourceName[at]}|${source.title}]] (${source.letter}, ${source.words.toLocaleString('en')} words)`), '',
    '## Shared ideas', '', ...shown.filter(({ shared }) => shared).map((node) => `- ${link(node.id)} (${node.stance})`), '',
    '## Ideas of one source', '', ...shown.filter(({ shared }) => !shared).map((node) => `- ${link(node.id)} (${result.sources[node.members[0].source].letter})`), '',
  ].join('\n') });

  result.sources.forEach((source, at) => {
    const mine = shown.filter((node) => node.members.some(({ source: s }) => s === at));
    files.push({ path: `Sources/${sourceName[at]}.md`, text: [
      '---', 'tags: [source]', `title: ${yamlText(source.title)}`, ...(/^https?:/.test(source.address) ? [`url: ${source.address}`] : []), '---', '',
      `# ${source.title}`, '', ...mine.flatMap((node) => {
        const member = node.members.find(({ source: s }) => s === at);
        return [`## ${link(node.id)}`, '', member.claim, '', ...member.quotes.map(({ text }) => quoted(text)), ''];
      }),
    ].join('\n') });
  });

  for (const node of shown) {
    const edges = result.edges.filter(({ from, to }) => (from === node.id || to === node.id) && ideaName.has(from) && ideaName.has(to));
    const near = result.bonds.filter(({ from, to }) => (from === node.id || to === node.id) && ideaName.has(from) && ideaName.has(to)).slice(0, 8);
    files.push({ path: `Ideas/${ideaName.get(node.id)}.md`, text: [
      '---', `tags: [idea, ${node.shared ? `shared, ${node.stance}` : 'single-source'}]`, `sources: [${[...new Set(node.members.map(({ source }) => result.sources[source].letter))].join(', ')}]`,
      ...(node.relevance !== null ? [`relevance: ${node.relevance}`] : []), ...(node.overlap !== null ? [`overlap: ${node.overlap}`] : []), ...(aside.pinned.has(node.label) ? ['pinned: true'] : []), '---', '',
      `# ${node.label}`, '',
      ...(node.agree ? [`**In common:** ${node.agree}`, ''] : []), ...(node.differ ? [`**Where they part:** ${node.differ}`, ''] : []),
      ...node.members.flatMap((member) => [`## ${result.sources[member.source].letter} · [[Sources/${sourceName[member.source]}|${result.sources[member.source].title}]]`, '', member.claim, '', ...member.quotes.map(({ text }) => quoted(text)), '']),
      ...(edges.length ? ['## Ties', '', ...edges.map((edge) => `- ${edge.relation}${edge.from === node.id ? '' : ' (from)'} ${link(edge.from === node.id ? edge.to : edge.from)}${edge.note ? ` — ${edge.note}` : ''}`), ''] : []),
      ...(near.length ? ['## Close by their sentences', '', ...near.map((bond) => `- ${link(bond.from === node.id ? bond.to : bond.from)} (${bond.z.toFixed(1)} σ, ${bond.kind === 'cross' ? 'between sources' : 'inside one source'})`), ''] : []),
    ].join('\n') });
  }
  return files;
}

// A zip of stored files, written by hand: the notes are small text and need no compression.
function zip(files) {
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (bytes) => { let c = 0xffffffff; for (const b of bytes) c = table[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const encoder = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const { path, text } of files) {
    const name = encoder.encode(path);
    const data = encoder.encode(text);
    const header = new DataView(new ArrayBuffer(30));
    [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [8, 0, 2], [10, 0, 2], [12, 0x21, 2], [14, crc(data), 4], [18, data.length, 4], [22, data.length, 4], [26, name.length, 2], [28, 0, 2]].forEach(([at, value, size]) => (size === 4 ? header.setUint32(at, value, true) : header.setUint16(at, value, true)));
    parts.push(header.buffer, name, data);
    const entry = new DataView(new ArrayBuffer(46));
    [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [10, 0, 2], [12, 0, 2], [14, 0x21, 2], [16, crc(data), 4], [20, data.length, 4], [24, data.length, 4], [28, name.length, 2], [30, 0, 2], [32, 0, 2], [34, 0, 2], [36, 0, 2], [38, 0, 4], [42, offset, 4]].forEach(([at, value, size]) => (size === 4 ? entry.setUint32(at, value, true) : entry.setUint16(at, value, true)));
    central.push(entry.buffer, name);
    offset += 30 + name.length + data.length;
  }
  const size = central.reduce((sum, part) => sum + part.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  [[0, 0x06054b50, 4], [8, files.length, 2], [10, files.length, 2], [12, size, 4], [16, offset, 4]].forEach(([at, value, width]) => (width === 4 ? end.setUint32(at, value, true) : end.setUint16(at, value, true)));
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}

$('export').addEventListener('click', () => {
  if (!result) return;
  const link = html('a', { href: URL.createObjectURL(zip(vault())), download: 'notebook.zip' });
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 4000);
});
