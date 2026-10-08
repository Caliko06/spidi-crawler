// The notebook's web, drawn in the crawler's own language: a node at the
// centre that is the notebook, a big framed node for each source on a ring
// round it, and the ideas as nodes with their names under them, as heavy as
// the sentences that carry them. An idea only one source says is held to that
// source by a hairline and stays out by it; an idea several share is held to
// every one of them, so it hangs between them as a bridge, where they meet. An
// idea's own sentences are beads on it, a square where the idea is shared,
// their words read by pointing at them. Bonds measured between ideas are
// dashed hairlines; the ties the model argues show when an idea is pointed at.

import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3-force';

const SVG = 'http://www.w3.org/2000/svg';
const LABEL = { size: 11, gap: 6, width: 7.4, row: 14 }; // px a name is set at, from its node, a letter's width and a line's height
const NODE = { size: 3, grow: 2.1, hub: 8, hubGrow: 1.5, frame: 4, dial: 8, ticks: 40 };
const BEAD = { r: 2.2, side: 4.6, away: 11, step: 7 };

const make = (tag, attributes = {}, parent, cls) => {
  const node = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  if (cls) node.setAttribute('class', cls);
  parent?.append(node);
  return node;
};
const two = (n) => String(n).padStart(2, '0');
const clip = (text, most) => (text.length > most ? `${text.slice(0, most - 1)}…` : text);

// `canvas` the svg, `tip` the element a sentence is read in, `on` what the reader's pointer does: `idea(id)`, `source(at)`, `centre()`, `clear()`.
export function createWeb(canvas, tip, on) {
  let simulation = null;
  let mark = () => {};

  // `data`: { sources, nodes, edges, bonds, focus } as the server makes it, or the sources and the ideas read so far. `view`: { bonds, bondZ, picked, pinned, off }.
  function draw(data, view = {}) {
    simulation?.stop();
    canvas.replaceChildren();
    tip.hidden = true;
    const { clientWidth: width, clientHeight: height } = canvas;
    canvas.setAttribute('viewBox', `0 0 ${width} ${height}`);
    canvas.classList.remove('is-focused');
    const cx = width / 2;
    const cy = height / 2 + 8;
    const many = data.sources.length;
    const ring = Math.min(width * (many === 2 ? 0.34 : 0.3), height * (many === 2 ? 0.33 : 0.27)); // the ideas that stay out by a source need room round it
    const start = many === 2 ? Math.PI : -Math.PI / 2;

    // The centre, the sources round it, and the ideas.
    const centre = { kind: 'centre', x: cx, y: cy, fx: cx, fy: cy, r: 7, total: data.nodes.length, label: data.focus ?? 'Notebook' };
    const hubs = data.sources.map((source, at) => {
      const angle = start + (at / many) * Math.PI * 2;
      const own = data.nodes.filter(({ members }) => members.some(({ source: s }) => s === at));
      const total = own.reduce((sum, { members }) => sum + members.filter(({ source: s }) => s === at).reduce((n, member) => n + (member.quotes?.length ?? 1), 0), 0);
      const x = cx + Math.cos(angle) * ring;
      const y = cy + Math.sin(angle) * ring;
      return { kind: 'source', at, angle, x, y, fx: x, fy: y, total, ideas: own.length, label: source.title, letter: source.letter, r: NODE.hub + NODE.hubGrow * Math.sqrt(total) };
    });
    const ideas = data.nodes.filter((node) => !view.off?.(node)).map((node, at) => {
      const sources = [...new Set(node.members.map(({ source }) => source))];
      const total = node.members.reduce((sum, member) => sum + (member.quotes?.length ?? 1), 0);
      // Where an idea settles: shared, between its sources; alone, a little out past its source.
      const toward = sources.length > 1
        ? { x: sources.reduce((sum, s) => sum + hubs[s].x, 0) / sources.length, y: sources.reduce((sum, s) => sum + hubs[s].y, 0) / sources.length }
        : { x: hubs[sources[0]].x + Math.cos(hubs[sources[0]].angle) * ring * 0.55, y: hubs[sources[0]].y + Math.sin(hubs[sources[0]].angle) * ring * 0.55 };
      const pinned = view.pinned?.has(node.label);
      return { ...node, kind: 'idea', sources, total, toward, index: node.number ?? at + 1, pinned, r: (NODE.size + NODE.grow * Math.sqrt(total)) * (pinned ? 1.25 : 1), x: toward.x + Math.cos(at * 2.4) * 46, y: toward.y + Math.sin(at * 2.4) * 46 };
    });
    // Ideas the sources share hang round the notebook at the middle, an ellipse of them between the sources, each at its own place on it.
    const shared = ideas.filter((idea) => idea.shared);
    const room = { x: ring * 0.55, y: Math.min(ring * 1.05, height / 2 - 78) };
    shared.forEach((idea, k) => {
      const angle = -Math.PI / 2 + ((k + 0.5) / shared.length) * Math.PI * 2;
      idea.slot = { x: idea.toward.x + Math.cos(angle) * room.x, y: idea.toward.y + Math.sin(angle) * room.y };
      idea.x = idea.slot.x;
      idea.y = idea.slot.y;
    });
    const byId = new Map(ideas.map((idea) => [idea.id, idea]));
    const everything = [centre, ...hubs, ...ideas];

    // Layers, under to over.
    const layer = (cls) => make('g', {}, canvas, cls);
    const stemLayer = layer('web-stems');
    const bondLayer = layer('web-bonds');
    const edgeLayer = layer('web-ties');
    const beadLayer = layer('web-beads');
    const nodeLayer = layer('web-nodes');

    // Hairlines: the centre to each source, each idea to its sources.
    const stems = [
      ...hubs.map((hub) => ({ a: centre, b: hub, el: make('line', {}, stemLayer, 'stem is-source') })),
      ...ideas.flatMap((idea) => idea.sources.map((s) => ({ a: hubs[s], b: idea, el: make('line', {}, stemLayer, `stem${idea.shared ? ' is-bridge' : ''}`) }))),
    ];
    const bonds = view.bonds === false ? [] : (data.bonds ?? []).filter(({ from, to, z }) => z >= (view.bondZ ?? 1.5) && byId.has(from) && byId.has(to)).map((bond) => {
      const line = make('line', { 'stroke-opacity': Math.min(0.75, 0.2 + (bond.z - 1) * 0.2) }, bondLayer, `bond ${bond.kind}`);
      return { a: byId.get(bond.from), b: byId.get(bond.to), el: line, bond };
    });
    const ties = (data.edges ?? []).filter(({ from, to }) => byId.has(from) && byId.has(to)).map((edge) => ({
      a: byId.get(edge.from), b: byId.get(edge.to), edge,
      el: make('line', {}, edgeLayer, `tie ${edge.relation}`),
      say: make('text', {}, edgeLayer, 'tie-say'),
    }));
    ties.forEach(({ say, edge }) => (say.textContent = edge.relation));
    const bondCount = bonds.length;

    // The beads: an idea's sentences, up and away from its name.
    for (const idea of ideas) {
      const quotes = idea.members.flatMap((member) => (member.quotes ?? []).map((quote) => ({ ...quote, letter: data.sources[member.source].letter })));
      idea.beads = quotes.map((quote, n) => {
        const thread = make('line', {}, beadLayer, 'thread');
        const square = idea.shared;
        const el = square ? make('rect', { width: BEAD.side, height: BEAD.side }, beadLayer, `bead is-square ${idea.stance ?? ''}`) : make('circle', { r: BEAD.r }, beadLayer, 'bead');
        el.addEventListener('pointerenter', (event) => {
          tip.replaceChildren();
          const letter = document.createElement('b');
          letter.textContent = quote.letter;
          tip.append(letter, quote.text);
          tip.hidden = false;
          place(event);
          light(idea);
        });
        el.addEventListener('pointermove', place);
        el.addEventListener('pointerleave', () => { tip.hidden = true; light(null); });
        // Fan upward from the node: the name is underneath.
        const spread = Math.PI * 0.7;
        const angle = -Math.PI / 2 + (quotes.length === 1 ? 0 : (n / (quotes.length - 1) - 0.5) * spread);
        return { thread, el, angle, away: BEAD.away + Math.floor(n / 4) * BEAD.step, square };
      });
    }
    function place(event) {
      const box = canvas.getBoundingClientRect();
      const x = Math.min(event.clientX - box.left + 16, box.width - 400);
      const y = Math.min(event.clientY - box.top + 16, box.height - 140);
      tip.style.transform = `translate(${Math.max(8, x)}px, ${Math.max(8, y)}px)`;
    }

    // The nodes, each with its name under it.
    for (const item of everything) {
      const group = make('g', {}, nodeLayer, `web-item is-${item.kind}${item.pinned ? ' is-pinned' : ''}${item.id === view.picked ? ' is-open' : ''}${item.shared ? ` is-shared ${item.stance}` : ''}${item.kind === 'idea' && data.focus && item.relevance < 0.5 && !item.pinned ? ' is-off' : ''}`);
      item.group = group;
      item.reach = item.kind === 'idea' ? null : make('circle', {}, group, 'web-reach');
      item.dot = make('circle', { r: item.r }, group, 'web-node');
      const text = make('text', {}, group, 'web-hub');
      if (item.kind === 'idea') {
        make('tspan', {}, text, 'web-hub-index').textContent = `${two(item.index)} `;
        make('tspan', {}, text, '').textContent = clip(item.label.toUpperCase(), item.shared ? 26 : 22);
        make('tspan', {}, text, 'web-hub-count').textContent = ` ·${item.total}`;
        if (item.shared) make('tspan', {}, text, 'web-hub-folded').textContent = `  ${item.sources.map((s) => hubs[s].letter).join('')}`;
        item.reach_w = (clip(item.label, item.shared ? 26 : 22).length + 7 + (item.shared ? 3 : 0)) * LABEL.width * (item.shared ? 1.05 : 1);
      } else if (item.kind === 'source') {
        make('tspan', {}, text, 'web-hub-index').textContent = `${item.letter} `;
        make('tspan', {}, text, '').textContent = clip(item.label.toUpperCase(), 34);
        make('tspan', {}, text, 'web-hub-count').textContent = ` ·${item.total}`;
        item.reach_w = (clip(item.label, 34).length + 6) * LABEL.width;
      } else {
        make('tspan', {}, text, '').textContent = clip(String(item.label).toUpperCase(), 40);
        make('tspan', {}, text, 'web-hub-count').textContent = ` ·${item.total}`;
        item.reach_w = (Math.min(String(item.label).length, 40) + 5) * LABEL.width;
      }
      item.text = text;
      group.addEventListener('pointerenter', () => light(item));
      group.addEventListener('pointerleave', () => light(null));
      group.addEventListener('click', (event) => {
        event.stopPropagation();
        if (item.kind === 'idea') on.idea(item.id);
        else if (item.kind === 'source') on.source(item.at);
        else on.centre();
      });
      if (item.kind === 'idea') group.addEventListener('pointerdown', (event) => grab(event, item));
    }
    canvas.onclick = () => on.clear();

    // Pointing at something: what it is held to stays, the rest falls back.
    function near(item) {
      const set = new Set([item]);
      if (item.kind === 'centre') hubs.forEach((hub) => set.add(hub));
      for (const { a, b } of [...stems, ...bonds, ...ties]) {
        if (a === item) set.add(b);
        if (b === item) set.add(a);
      }
      if (item.kind === 'source') ideas.filter((idea) => idea.sources.includes(item.at)).forEach((idea) => set.add(idea));
      return set;
    }
    function light(item) {
      canvas.classList.toggle('is-focused', item !== null);
      if (item === null) {
        everything.forEach(({ group }) => group.classList.remove('is-near'));
        for (const { el, say } of [...stems, ...bonds, ...ties]) { el.classList.remove('is-lit'); say?.classList.remove('is-lit'); }
        ideas.forEach((idea) => idea.beads.forEach(({ el, thread }) => { el.classList.remove('is-near'); thread.classList.remove('is-near'); }));
        return;
      }
      const set = near(item);
      everything.forEach((other) => other.group.classList.toggle('is-near', set.has(other)));
      for (const link of [...stems, ...bonds, ...ties]) {
        const on = link.a === item || link.b === item || (item.kind === 'source' && set.has(link.a) && set.has(link.b) && link.el.classList.contains('stem') && (link.a === item || link.b === item));
        link.el.classList.toggle('is-lit', on);
        link.say?.classList.toggle('is-lit', on);
      }
      ideas.forEach((idea) => idea.beads.forEach(({ el, thread }) => { const on = idea === item; el.classList.toggle('is-near', on); thread.classList.toggle('is-near', on); }));
    }

    function paint() {
      for (const item of everything) {
        item.dot.setAttribute('cx', item.x);
        item.dot.setAttribute('cy', item.y);
        if (item.reach) {
          const frame = item.kind === 'centre' ? item.r + NODE.dial : item.r + NODE.frame;
          item.reach.setAttribute('cx', item.x);
          item.reach.setAttribute('cy', item.y);
          item.reach.setAttribute('r', frame);
          if (item.kind === 'centre') item.reach.style.strokeDasharray = `1.2 ${((2 * Math.PI * frame) / NODE.ticks - 1.2).toFixed(2)}`;
        }
        const edge = item.kind === 'idea' ? item.r : item.r + (item.kind === 'centre' ? NODE.dial : NODE.frame);
        item.text.setAttribute('x', item.x);
        item.text.setAttribute('y', item.y + edge + LABEL.gap + LABEL.size / 2);
      }
      for (const { a, b, el } of [...stems, ...bonds, ...ties]) {
        el.setAttribute('x1', a.x);
        el.setAttribute('y1', a.y);
        el.setAttribute('x2', b.x);
        el.setAttribute('y2', b.y);
      }
      for (const { a, b, say } of ties) {
        say.setAttribute('x', (a.x + b.x) / 2);
        say.setAttribute('y', (a.y + b.y) / 2);
      }
      for (const idea of ideas) {
        for (const { thread, el, angle, away, square } of idea.beads) {
          const x = idea.x + Math.cos(angle) * (idea.r + away);
          const y = idea.y + Math.sin(angle) * (idea.r + away);
          thread.setAttribute('x1', idea.x + Math.cos(angle) * idea.r);
          thread.setAttribute('y1', idea.y + Math.sin(angle) * idea.r);
          thread.setAttribute('x2', x);
          thread.setAttribute('y2', y);
          if (square) { el.setAttribute('x', x - BEAD.side / 2); el.setAttribute('y', y - BEAD.side / 2); } else { el.setAttribute('cx', x); el.setAttribute('cy', y); }
        }
      }
    }

    // Boxes: a name under its node, and the beads over it, kept from lying on another's.
    const box = (item) => {
      const half = (item.reach_w ?? 80) / 2;
      const room = item.kind === 'idea' ? item.r + BEAD.away + 6 : item.r + 12;
      return { left: item.x - Math.max(half, room), right: item.x + Math.max(half, room), top: item.y - room, bottom: item.y + item.r + LABEL.gap + LABEL.row };
    };
    const fixed = (item) => item.fx !== undefined && item.fx !== null;
    const apart = (alpha) => {
      for (let i = 0; i < everything.length; i++) {
        for (let j = i + 1; j < everything.length; j++) {
          const a = everything[i];
          const b = everything[j];
          if (fixed(a) && fixed(b)) continue;
          const one = box(a);
          const other = box(b);
          const across = Math.min(one.right, other.right) - Math.max(one.left, other.left);
          const down = Math.min(one.bottom, other.bottom) - Math.max(one.top, other.top);
          if (across <= 0 || down <= 0) continue;
          const push = 1;
          const shareA = fixed(a) ? 0 : fixed(b) ? 1 : 0.5;
          const shareB = fixed(b) ? 0 : fixed(a) ? 1 : 0.5;
          if (down < across) {
            const way = a.y < b.y ? -1 : 1;
            a.y += way * down * push * shareA;
            b.y -= way * down * push * shareB;
          } else {
            const way = a.x < b.x ? -1 : 1;
            a.x += way * across * push * shareA;
            b.x -= way * across * push * shareB;
          }
        }
      }
    };

    const springs = [
      ...stems.filter(({ a }) => a.kind === 'source').map(({ a, b }) => ({ source: a, target: b, strength: b.shared ? 0.015 : 0.16, length: b.shared ? 70 : 54 })),
      ...bonds.map(({ a, b, bond }) => ({ source: a, target: b, strength: Math.min(0.06, 0.008 * bond.z), length: 130 })),
      ...ties.map(({ a, b }) => ({ source: a, target: b, strength: 0.012, length: 120 })),
    ];
    simulation = forceSimulation(everything)
      .force('charge', forceManyBody().strength((item) => (item.kind === 'idea' ? -110 : -300)).distanceMax(240))
      .force('collide', forceCollide((item) => item.r + (item.kind === 'idea' ? 10 : 18)).strength(1))
      .force('boxes', apart)
      .force('slotx', forceX((item) => item.slot?.x ?? item.x).strength((item) => (item.slot ? 0.14 : 0)))
      .force('sloty', forceY((item) => item.slot?.y ?? item.y).strength((item) => (item.slot ? 0.14 : 0)))
      .force('springs', forceLink(springs).distance((link) => link.length).strength((link) => link.strength))
      .on('tick', () => {
        for (const idea of ideas) {
          idea.x = Math.min(width - idea.r - 20 - (idea.reach_w ?? 0) / 2, Math.max(idea.r + 20 + (idea.reach_w ?? 0) / 2, idea.x));
          idea.y = Math.min(height - 40, Math.max(36, idea.y));
        }
        paint();
      });
    simulation.tick(600);
    paint();
    simulation.alpha(0.04).restart();

    function grab(event, item) {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      let moved = false;
      const move = (e) => {
        moved = true;
        item.fx = e.clientX - rect.left;
        item.fy = e.clientY - rect.top;
        simulation.alphaTarget(0.2).restart();
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        item.fx = item.fy = undefined;
        simulation.alphaTarget(0);
        if (moved) canvas.addEventListener('click', (e) => e.stopPropagation(), { capture: true, once: true });
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    }

    mark = (id) => everything.forEach((item) => item.group.classList.toggle('is-open', item.id === id && id !== undefined));
    return { bonds: bondCount, ideas: ideas.length };
  }

  return { draw, mark: (id) => mark(id) };
}
