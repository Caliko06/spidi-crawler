// The web: the other half of the window, a graph of what the crawler eats,
// as Obsidian draws one, laid out by d3-force.
//
// What the document is called is a node held at the centre, lit from the
// start; its count is all that has been laid. Every other subject is a node
// as big as what is filed under it (a theme counts the subjects that belong
// to it too), with its name under it. The web opens on the themes Jev says
// the document is built on; any other subject comes up beside its theme when
// the crawler first reaches it, its name written out. Each theme is drawn to
// a distance from the centre, the heavier the nearer; subjects push one
// another away and keep their names clear; a subject is held near its theme,
// and two Jev joins pull a little toward each other. Nothing goes round.
//
// A sentence is a small node held to its subject by a hairline. It comes out
// of the crawler as it is laid and its words are read by pointing at it. One
// that belongs under another subject too, or that Jev says has much to do
// with one under another, is held to that as well, unseen. A subject keeps as
// nodes its essential sentences and only its latest few others, the older the
// fainter; older ones sink into its node.
//
// A subject dragged is drawn toward the ones that share most with it, by what
// Jev says they have to do with each other and the sentences they share, not
// by how near they are: it leans toward a close bond as it passes, and what it
// carries comes along with it, a little behind. Let go on a close bond, it
// falls into it and the two are one; on anything else it stays where it is
// put.
//
// The centre may be dragged too, which pins it where it is left, and the
// themes then orbit it there. A subject that has taken others in says how
// many after its count.
//
// The crawler leans on the web as it walks over it, and now and then tidies
// it: it hauls a subject that hangs far from one it has much to do with
// nearer, or, once a theme has two subjects of its own on the web, brings the
// lighter into it, and the two are one. The reader can point at a node, which
// brings up what it is joined to; drag one, which pins it until it is
// double-clicked; pick a subject, which opens its page in a drawer; hide it;
// or open the summary, every subject's sentences in the order the document
// comes to them. Pausing to read stops the crawler and gives the graph the
// window but for a strip of the text, with the summary open beside it.

import { forceCollide, forceLink, forceManyBody, forceSimulation } from 'd3-force';
import { createThread } from './thread.js';
import { clamp, two } from './util.js';

const SVG = 'http://www.w3.org/2000/svg';
const PAD = { top: 36, side: 24, bottom: 64 }; // px of the web's edges the graph keeps clear of
const LABEL = { size: 11.5, gap: 6 }; // px a subject's name is set at, and from its node to its name
const LEAF_EDGE = 12; // px of the web's edges a sentence keeps clear of, so that no thread leaves it
const NODE = { frame: 4, dial: 7, ticks: 48, room: 560, least: 0.6 }; // the px of the web's short side at which nodes are at their full size, and the least they shrink to; px a theme's ring stands off the size it will reach, how far the centre's dial does, and how many ticks the dial has
const BEAD = { r: 2.2, side: 5, lit: 3.4 }; // a sentence's point, an essential one's square, the one being laid
const TIDY = { far: 0.6, near: 1.15 }; // how far past its length, against it and by its weight, a spring has to be for the crawler to tidy it; and how near, against its length, it hauls the subject
const TUG = 5; // px a tick a subject is sent off at, by the heaviest spring, toward one it is joined to that is fed
const SPRING = { long: 280, short: 120 }; // px between two subjects that have the least to do with each other, and the most
const LAYOUT = { near: 0.3, far: 0.85, radial: 1, charge: -900, collide: 0.9, stem: 0.5, link: 0.08, drag: 0.35, idle: 0.04, heat: 0.5 }; // of the way from the centre to the web's edge, where the heaviest and the lightest theme settle; how hard each is drawn to that distance, how hard subjects push one another away, how hard they keep out of one another's room, how hard a stem and a spring of Jev's at its fullest hold; the speed lost each tick; how much the layout keeps stirring, and how much it is stirred when the web changes (d3-force's alpha)
const GRAPH = { prizes: 8, leaf: 58, hold: 0.7, push: -40, tie: 90, tied: 0.06, pull: 60, pulled: 0.05, size: 2.5, grow: 2.2, recent: 4, sink: 0.7, fade: 0.2 }; // a sentence: how many essential ones a subject keeps as nodes, the latest, the older sinking in as the rest do; px from its subject and how hard it is held there, how hard sentences push one another away; px from another subject it belongs under and how hard that holds; px from a sentence it pulls on and how hard, at its fullest; the radius of a subject's node with nothing under it, and how it grows with the root of what is; how many of a subject's sentences that are not essential stay nodes, the latest; seconds an older one takes to sink into its subject; how much fainter and smaller each step older one is
const CLEAR = 16; // px kept between the names of two subjects
const STANDOFF = 26; // px from a subject's name at which the crawler stops to lay a sentence
const TREAD = { reach: 80, push: 1 }; // px round the crawler within which the web gives under it, and how hard
const KNOCK = { speed: 1100, band: 90, push: 9, decay: 2.4, reach: 900 }; // a knock goes out over the web at px/s as a ring that many px thick, shoving what it passes by up to px for a knock of power 1, dying away at 1/s, and goes no further than px
const STRAND = { slack: 0.06, tie: 0.04, spring: 0.12, gravity: 90, wind: 14, damping: 0.93, brush: 34, flick: 2.6 }; // a thread has this much more length than the gap it spans; a spring's, in the slack a weak bond takes; px/s^2 of gravity and of draught on it, and how much of its speed it keeps a step; px round the crawler within which it brushes aside what it walks over, and how much more a thread is shoved by a knock than a node
const TENSION = { settle: 3, taut: 0.3, snap: 0.9, recoil: 3, whip: 1.2, spin: 0.45 }; // seconds a strand takes to settle at a new length; how far past it a strand is drawn out once it has no slack left; how far past it, while the crawler hauls, it snaps; px a step its loose end is flung back; seconds it whips free; seconds it takes to be spun again from where it was let go
const WELL = { reach: 260, pull: 0.55, snap: 60, bond: 0.4, dock: 30, family: { leaf: 0.8, sub: 0.5, theme: 0.9 } }; // a dragged subject: px within which another pulls on it, how hard at a bond of 1, px within which a close bond takes hold of it, the bond that counts as close, px apart at which it falls in; how much of its move what hangs from it, the subjects under it and, for the centre, the themes around it follow
const SHAKE = 6; // px a held subject has to be moved in a frame for the web to be shaken
const DRAG = 4; // px a held subject has to be moved for that to be a drag and not a pick
const BUNDLE = { least: 2, grow: 1.6, most: 14, shown: 3, words: 24 }; // essential sentences of a subject that make one bead at rest, the px its square grows by each one it carries and the most it reaches, how many of them its note reads out, and how many words of each
const NOTE = { width: 320, gap: 14, linger: 2.4 }; // the text beside a sentence: its width, how far from the bead, and seconds it stays once laid
const DRAWER_GAP = 20; // px between the graph and the open drawer
const COPIED_MS = 1600;
const DRIFT = { arc: 0.22, breath: 46 }; // radians a theme swings out along its ring to either side of where it settles, at most, and seconds a breath takes: each theme has its own size and its own moment in it, so the web as a whole never turns
const STEM = { length: 140, weight: 0.45 }; // px a subject is held from its theme at, and the stem's weight, as a spring's
const BITE = { wait: 1, reach: 150 }; // seconds a merge the reader has made waits for the crawler's bite before it is made anyway; px from the subject or the one it falls into that a blow lands to be that bite
const FUSE = { reach: 30 }; // px from the subject it falls into that the crawler brings it to
const WRITE_S = 0.035; // seconds a letter of a subject's name takes to be written out

const number = new Intl.NumberFormat('en');
const plural = (count, one) => `${count} ${one}${count === 1 ? '' : 's'}`;
const draw = (name, parent, className) => {
  const el = parent.appendChild(document.createElementNS(SVG, name));
  el.setAttribute('class', className);
  return el;
};

// `title` is the document's, `topics` its subjects, `parents` for each the
// index of the theme it belongs under, or null for a theme, `links` how much two of
// them have to do with each other, `{ a, b, weight }`, `pulls` how much two
// sentences do, `{ a, b, weight }` by their index, `kept` the sentences,
// each `{ text, worth, topic, ties, lead }`, `wordCount` how many words the
// document has, and `skipped` how many of its sections Jev ruled out.
// `onPick(sentence)` is called with the index of a sentence that is picked,
// and `onRead(paused)` when the reader pauses to read or goes back.
export function createWeb(el, { title, topics, parents, folds, links, pulls, kept, words: wordCount, skipped }, onPick, onRead) {
  const sheet = el.querySelector('.web-sheet');
  const svg = sheet.querySelector('svg');
  const tetherEls = draw('g', svg, 'web-tethers');
  const springEls = draw('g', svg, 'web-springs');
  const threads = draw('g', svg, 'web-threads');
  const leaves = draw('g', svg, 'web-leaves');
  const hubEls = draw('g', svg, 'web-hubs');
  const note = el.querySelector('.web-note');
  const drawer = el.querySelector('.web-page');
  const copy = drawer.querySelector('.web-copy');
  const pause = el.querySelector('.web-pause');
  const hide = drawer.querySelector('.web-hide');
  const bondList = drawer.querySelector('.web-bonds');
  const gauge = el.querySelector('.web-gauge');
  const bondsToggle = el.querySelector('.web-bonds-toggle');
  el.querySelector('.web-status').textContent = '';
  el.querySelector('.web-triage').textContent = skipped;
  el.classList.add('is-spun');

  let width = sheet.clientWidth;
  let height = sheet.clientHeight;
  let origin = { x: 0, y: 0 }; // where the web is on the page, in document coordinates
  let head = { x: width / 2, y: height / 2 }; // where the crawler's head is, in the web's own
  let clock = 0;
  let spot = null; // where the crawler is headed: `{ hub, point }`
  let rested = false; // whether the crawler has eaten it all
  let noted = null; // the sentence whose text shows: `{ leaf, until }`
  let pointed = null; // the sentence the reader points at
  let dock = null; // the subject a dragged one would fall into if let go
  const fusions = []; // what each fusion changed, to put back, the latest last
  let held = null; // the subject the reader has hold of: `{ hub, from, at, moved }`
  let towed = null; // the subject the crawler is tidying: `{ hub, other, length, grip, to, at, offset }`, toward `other` to `length` apart; `grip` where it takes it by, `to` where its head goes to haul it, `at` where the other is, in document coordinates; `offset` from its head to the subject once it has hold of it
  let knocks = []; // the knocks going out over the web: `{ x, y, t, power }`, `t` seconds since
  let shaken = null; // where the reader is shaking the web this frame, in document coordinates
  let hovered = null; // the subject or sentence the reader points at
  let hand = null; // what the reader is doing with a subject they hold, for the crawler to watch: `{ at, dock, share, close }`, points in document coordinates
  let told = []; // what has happened on the web by the reader's hand since the crawler was last told: `{ kind, at, from? }`
  let pending = null; // a merge the reader has made, waiting for the crawler's bite: `{ sub, into, wait, pinned }`
  const onPage = (point) => ({ x: origin.x + point.x, y: origin.y + point.y });
  let open = null; // what the drawer shows: a hub, 'summary', or null when it is shut
  let laid = { sentences: 0, words: 0 };
  let centre = null; // the subject the others orbit

  // A subject has a box round it, the room its node and name take up:
  // `left`, `right`, `up` and `down` are how far that reaches from it. It is
  // `born` once it is on the web; `written` is how many letters of its name are out.
  const hubs = topics.map((label, index) => {
    const filed = kept.filter(({ topic }) => topic === index).length;
    const sub = parents[index] !== null;
    const minor = sub && filed === 1; // a theme always reads as one
    const hub = { index, label, total: filed, born: false, written: 0, words: 0, sentences: [], hanging: [], x: 0, y: 0, el: draw('text', hubEls, `web-hub is-unborn${minor ? ' is-minor' : ''}${sub ? ' is-sub' : ''}`) };
    draw('tspan', hub.el, 'web-hub-index').textContent = `${two(index + 1)} `;
    hub.name = draw('tspan', hub.el, '');
    hub.count = draw('tspan', hub.el, 'web-hub-count');
    hub.folded = draw('tspan', hub.el, 'web-hub-folded');
    hub.reach = draw('circle', hubEls, `web-reach is-unborn${sub ? ' is-sub' : ''}`);
    hub.dot = draw('circle', hubEls, `web-node is-unborn${sub ? ' is-sub' : ''}`);
    handle(hub);
    return hub;
  });
  hubs.forEach((hub, index) => {
    hub.parent = parents[index] === null ? null : hubs[parents[index]];
    hub.host = folds[index] === null ? null : hubs[folds[index]]; // the subject the plan has this one fall into, once it has all it will be given
  });
  // What a subject is on the web as: itself, or the theme it has been brought into.
  const home = (hub) => (hub.fused ? home(hub.fused) : hub);
  // A bond is as strong as Jev says: a slight one is drawn slack and almost
  // gone, a strong one short, stiff and plain.
  const springs = links.map(({ a, b, weight }) => {
    const line = draw('path', springEls, 'is-unborn');
    line.style.setProperty('--weight', weight);
    const figure = draw('text', springEls, 'web-spring-weight is-unborn');
    figure.textContent = weight.toFixed(2);
    return { a: hubs[a], b: hubs[b], weight, length: SPRING.long - (SPRING.long - SPRING.short) * weight, line, figure };
  });
  // A subject is held to its theme by a stem.
  for (const hub of hubs.filter(({ parent }) => parent)) {
    const line = draw('path', springEls, 'is-unborn is-stem');
    line.style.setProperty('--weight', STEM.weight);
    const figure = draw('text', springEls, 'web-spring-weight is-unborn');
    springs.push({ a: hub, b: hub.parent, weight: STEM.weight, length: STEM.length, line, figure, stem: true });
  }
  // A theme is tethered to the centre, the heavier the plainer: the distance it keeps is as its weight asks, and this is what holds it there.
  const tethers = hubs.filter(({ parent }) => !parent).map((hub) => ({ hub, el: draw('path', tetherEls, 'is-hidden') }));
  const beads = [];
  // A pull holds once both its sentences are on the web.
  const drawn = [];
  const made = new Map(); // sentence index → its bead

  // The room a subject takes up: its node, and its name under it.
  function room(hub) {
    const half = (hub.half = hub.el.getComputedTextLength() / 2);
    hub.left = hub.right = Math.max(half, radius(hub));
    hub.up = edge(hub);
    hub.down = edge(hub) + LABEL.gap + LABEL.size;
  }

  // The radius of a subject's node: as big as the root of what is under it; the centre's, of all that is laid.
  // Nodes shrink with the room the web has, down to NODE.least of their size: the same web on a short band is not the same web with the same mass.
  const mass = () => clamp(Math.min(area(), height) / NODE.room, NODE.least, 1);
  const radius = (hub) => mass() * (GRAPH.size + GRAPH.grow * Math.sqrt(hub === centre ? laid.sentences : filedIn(hub)));
  // The radius it will have once all that the plan files under it is laid: the ring the node grows inside.
  // How far from its centre a node reaches with its ring or dial: where its name starts under it.
  const edge = (hub) => reach(hub) + mass() * (hub === centre ? NODE.dial : !hub.parent ? NODE.frame : 0);
  const reach = (hub) => Math.max(radius(hub), mass() * (GRAPH.size + GRAPH.grow * Math.sqrt(hub.total + hubs.reduce((sum, other) => sum + (other.parent === hub ? other.total : 0), 0))));

  // The reader points at a subject, which shows what it is joined to; takes
  // hold of it and swings it about; or picks it, which opens its page.
  function handle(hub) {
    for (const el of [hub.el, hub.dot]) handleBy(hub, el);
  }
  function handleBy(hub, target) {
    const local = (event) => {
      const box = sheet.getBoundingClientRect();
      return { x: event.clientX - box.left, y: event.clientY - box.top };
    };
    target.addEventListener('pointerenter', () => held || light(hub));
    target.addEventListener('pointerleave', () => held || light(null));
    target.addEventListener('dblclick', () => (hub.pinned = false));
    target.addEventListener('pointerdown', (event) => {
      held = { hub, from: local(event), at: local(event), moved: false };
      target.setPointerCapture(event.pointerId);
    });
    target.addEventListener('pointermove', (event) => {
      if (held?.hub !== hub) return;
      held.at = local(event);
      held.moved ||= Math.hypot(held.at.x - held.from.x, held.at.y - held.from.y) >= DRAG;
    });
    target.addEventListener('pointerup', () => {
      if (held?.hub !== hub) return;
      const { moved } = held;
      held = null;
      docking(dock, false);
      if (moved && dock && hub !== centre) merge(hub, dock);
      else if (moved) {
        hub.pinned = true;
        told.push({ kind: 'pin', at: onPage(hub) });
      } else show(open === hub ? null : hub);
      dock = null;
    });
    target.addEventListener('pointercancel', () => {
      docking(dock, false);
      [held, dock] = [null, null];
    });
  }

  // Brings up what is pointed at, a subject or a sentence, with what it is
  // joined to: a subject's springs, with their weights, the threads of the
  // sentences it shares with other subjects, and the pulls of its sentences;
  // a sentence's pulls. The rest of the web falls back. With nothing, the
  // whole web is as it was.
  function light(what) {
    const hub = what?.from ? null : what;
    hovered = what ?? null;
    const lit = new Set(what ? [what] : []);
    for (const { a, b, line, figure } of springs) {
      const on = a === hub || b === hub;
      line.classList.toggle('is-lit', on);
      figure.classList.toggle('is-lit', on);
      if (on) lit.add(a).add(b);
    }
    for (const { hub: theme, el: tether } of tethers) tether.classList.toggle('is-lit', Boolean(hub) && (theme === hub || centre === hub));
    for (const leaf of beads) {
      leaf.tieThreads.forEach((thread, i) => thread.classList.toggle('is-lit', leaf.from === hub || leaf.ties[i] === hub));
      if (leaf.from === hub) lit.add(leaf);
    }
    for (const pull of drawn) {
      const on = [pull.a, pull.b].some((leaf) => leaf === what || leaf.from === hub);
      if (on) lit.add(pull.a).add(pull.b).add(pull.a.from).add(pull.b.from);
    }
    for (const node of hubs) node.reach.classList.toggle('is-hot', node === hub);
    svg.classList.toggle('is-focused', Boolean(what));
    for (const node of hubs) for (const part of [node.el, node.dot, node.reach]) part.classList.toggle('is-near', lit.has(node));
    for (const leaf of beads) for (const part of [leaf.el, leaf.thread]) part.classList.toggle('is-near', lit.has(leaf));
  }

  // The sentences filed under a subject and under the subjects that belong to it.
  const filedIn = (hub) => hub.sentences.length + hubs.reduce((sum, other) => sum + (other.parent === hub ? other.sentences.length : 0), 0);
  // What draws a subject: its theme once that is on the web, else the centre; nothing draws the centre.
  const primary = (hub) => (hub === centre ? null : hub.parent?.born && !hub.parent.hidden && hub.parent !== hub ? hub.parent : centre);

  // What the others orbit: what the document is called, or, hidden or without one, the heaviest subject.
  function weigh() {
    const shown = hubs.filter((hub) => hub.born && !hub.hidden);
    if (shown.includes(centre)) return;
    for (const part of centre ? [centre.el, centre.dot] : []) part.classList.remove('is-centre');
    centre = shown.find(({ label }) => label === title) ?? shown.reduce((a, b) => (filedIn(b) > filedIn(a) ? b : a), shown[0]) ?? null;
    for (const part of centre ? [centre.el, centre.dot] : []) part.classList.add('is-centre');
    if (centre) counted(centre);
  }

  // A force of d3's that acts on some of the nodes only: `subjects` or sentences.
  function among(force, subjects) {
    const initialize = force.initialize;
    force.initialize = (nodes, ...rest) => initialize(nodes.filter((node) => !node.from === subjects), ...rest);
    return force;
  }

  // The layout: d3-force, stepped by the web's own clock.
  // Subjects push subjects away hard, sentences push sentences away a little.
  const layout = forceSimulation().stop().alphaTarget(LAYOUT.idle).velocityDecay(LAYOUT.drag)
    .force('rings', rings())
    .force('charge', among(forceManyBody().strength(LAYOUT.charge), true))
    .force('spread', among(forceManyBody().strength(GRAPH.push).distanceMax(GRAPH.leaf * 4), false))
    .force('collide', forceCollide(roomRadius).strength(LAYOUT.collide))
    .force('boxes', boxes())
    .force('names', names())
    .force('links', forceLink().distance(({ length }) => length).strength(({ hold }) => hold));
  let laidOut = ''; // which subjects the layout has, to tell when that changes
  // What of a node keeps others off: a subject's name, a sentence's bead.
  function roomRadius(node) {
    return node.from ? BEAD.side : 0;
  }
  // A subject keeps others off by the box of its node and its name, not by a
  // circle as wide as its name, which would reserve room above and below it
  // that nothing needs: two names may sit one over the other, never on one
  // another. The smaller way out of the overlap is taken, and what is held in
  // place does not give way.
  function boxes() {
    let subjects = [];
    const force = () => {
      for (let i = 0; i < subjects.length; i++) {
        for (let j = i + 1; j < subjects.length; j++) {
          const [a, b] = [subjects[i], subjects[j]];
          const [dx, dy] = [b.x - a.x, b.y - a.y + (b.down - b.up) / 2 - (a.down - a.up) / 2];
          const over = { x: a.left + b.left + CLEAR - Math.abs(dx), y: (a.up + a.down + b.up + b.down) / 2 + LABEL.gap - Math.abs(dy) };
          if (over.x <= 0 || over.y <= 0) continue;
          // Out of the overlap by the smaller way, unless the edge of the web is in the way of both, and then by the other.
          const free = (axis) => {
            const away = Math.sign(axis === 'x' ? dx : dy) || 1;
            const movable = (node, way) => node.fx == null && (way > 0 ? node[axis] < limits(node)[axis][1] - 1 : node[axis] > limits(node)[axis][0] + 1);
            return { axis, away, moveA: movable(a, -away) ? 1 : 0, moveB: movable(b, away) ? 1 : 0 };
          };
          const [first, second] = over.x < over.y ? [free('x'), free('y')] : [free('y'), free('x')];
          const { axis, away, moveA, moveB } = first.moveA + first.moveB ? first : second;
          const share = moveA + moveB || 1;
          const push = over[axis] * LAYOUT.collide;
          a[`v${axis}`] -= (away * push * moveA) / share;
          b[`v${axis}`] += (away * push * moveB) / share;
        }
      }
    };
    force.initialize = (list) => (subjects = list.filter((node) => !node.from));
    return force;
  }

  // What the themes go round: the centre where the reader left it, else the middle of the web.
  const pivot = () => (centre?.pinned || held?.hub === centre ? centre : { x: area() / 2, y: (PAD.top + height - PAD.bottom) / 2 });
  // The web is wider than it is tall, or the other way about, so distances round
  // the pivot are measured along an ellipse that fits it: x is taken as much
  // narrower as the web is wider, and each ring a theme settles on is a circle there.
  const bounds = () => ({ x: Math.max(1, area() / 2 - PAD.side), y: Math.max(1, (height - PAD.top - PAD.bottom) / 2) });
  const squash = () => {
    const { x, y } = bounds();
    return y / x;
  };

  // Each theme is drawn to the ring its weight asks for, the heavier the nearer,
  // and along it breathes: out one way and back, slowly, by its own measure and
  // at its own moment, so the web as a whole turns nowhere.
  function rings() {
    let nodes = [];
    let was = clock;
    const force = (alpha) => {
      const [c, k] = [pivot(), squash()];
      const dt = clock - was;
      was = clock;
      for (const hub of nodes) {
        if (hub.from || primary(hub) !== centre) continue;
        const [dx, dy] = [(hub.x - c.x) * k, hub.y - c.y];
        const away = Math.hypot(dx, dy) || 1e-6;
        const pull = ((settled(hub) - away) * LAYOUT.radial * alpha) / away;
        hub.vx += (dx * pull) / k;
        hub.vy += dy * pull;
        // Its angle round the pivot goes as `arc * sin(2π t / breath)`, so it moves by the slope of that.
        const [size, moment] = [0.5 + 0.5 * ((hub.index * 0.618) % 1), hub.index * 2.4];
        const omega = (2 * Math.PI) / DRIFT.breath;
        const turn = DRIFT.arc * size * omega * Math.cos(omega * clock + moment) * dt;
        hub.x += (-dy * turn) / k;
        hub.y += dx * turn;
      }
    };
    force.initialize = (list) => (nodes = list);
    return force;
  }

  // A name is read, so no bead sits on it: a sentence inside the box of any
  // subject's name is pushed out by the smaller way, as a subject is by
  // another's box.
  function names() {
    let all = [];
    const force = () => {
      const subjects = all.filter((node) => !node.from && node.born && !node.hidden);
      for (const leaf of all) {
        if (!leaf.from || leaf.sunk !== null) continue;
        for (const hub of subjects) {
          const [dx, dy] = [leaf.x - hub.x, leaf.y - (hub.y + edge(hub) + LABEL.gap + LABEL.size / 2)];
          const over = { x: hub.half + BEAD.side - Math.abs(dx), y: LABEL.size / 2 + BEAD.side - Math.abs(dy) };
          if (over.x <= 0 || over.y <= 0) continue;
          const axis = over.y < over.x ? 'y' : 'x';
          leaf[`v${axis}`] += (axis === 'x' ? Math.sign(dx) || 1 : Math.sign(dy) || 1) * over[axis] * LAYOUT.collide;
        }
      }
    };
    force.initialize = (list) => (all = list);
    return force;
  }

  // How far from the centre a theme settles: of the way to the web's edge, the heavier among the themes the nearer.
  function settled(hub) {
    const themes = hubs.filter((other) => other.born && !other.hidden && other !== centre && primary(other) === centre);
    const heaviest = Math.max(1, ...themes.map(filedIn));
    const edge = bounds().y;
    return edge * (LAYOUT.near + (LAYOUT.far - LAYOUT.near) * (1 - Math.sqrt(filedIn(hub) / heaviest)));
  }

  // How far back a sentence that is not essential is among
  // its subject's: 0 for the latest; null for an essential one or one being
  // laid.
  function age(leaf) {
    if (leaf.worth === 'prize' || !leaf.whole) return null;
    const others = leaf.from.hanging.filter((other) => other.worth !== 'prize' && other.whole);
    return others.length - 1 - others.indexOf(leaf);
  }
  // How many essential sentences of its subject came after it.
  function prizeAge(leaf) {
    const prizes = leaf.from.hanging.filter((other) => other.worth === 'prize' && other.whole);
    return prizes.length - 1 - prizes.indexOf(leaf);
  }
  // Whether it has sunk into its subject's node, or is sinking: `sunk` is when it began to. Once the web rests only the essential ones are left out.
  function sinking(leaf) {
    const old = leaf.merged || (age(leaf) !== null ? rested || age(leaf) >= GRAPH.recent : leaf.whole && prizeAge(leaf) >= GRAPH.prizes);
    if (!old) leaf.sunk = null;
    else leaf.sunk ??= clock;
    return old;
  }
  const sunk = (leaf) => sinking(leaf) && clock - leaf.sunk >= GRAPH.sink;

  // A tick of the layout: the subjects and sentences on the web, the centre
  // held in the middle and what the reader or the crawler holds where it is;
  // stirred again when what is on it changes.
  function arrange() {
    const shown = hubs.filter((hub) => hub.born && !hub.hidden);
    const sentences = beads.filter((leaf) => !leaf.from.hidden && !sunk(leaf));
    const key = `${shown.map(({ index }) => index).join(' ')}|${sentences.map(({ index, sunk }) => `${index}${sunk === null ? '' : 's'}`).join(' ')}`;
    if (key !== laidOut) {
      laidOut = key;
      layout.nodes([...shown, ...sentences]);
      const joins = springs.filter(({ a, b }) => shown.includes(a) && shown.includes(b)).map((spring) => ({ source: spring.a, target: spring.b, length: spring.length, hold: spring.stem ? LAYOUT.stem : LAYOUT.link * spring.weight }));
      // One sinking into its subject is drawn to its middle and held by nothing else.
      const own = sentences.map((leaf) => ({ source: leaf.from, target: leaf, length: leaf.sunk === null ? GRAPH.leaf : 0, hold: leaf.sunk === null ? GRAPH.hold : 1 }));
      const ties = sentences.filter((leaf) => leaf.sunk === null).flatMap((leaf) => leaf.ties.filter((tie) => shown.includes(tie)).map((tie) => ({ source: tie, target: leaf, length: GRAPH.tie, hold: GRAPH.tied })));
      const pulled = drawn.filter(({ a, b }) => sentences.includes(a) && sentences.includes(b) && a.sunk === null && b.sunk === null).map(({ a, b, weight }) => ({ source: a, target: b, length: GRAPH.pull, hold: GRAPH.pulled * weight }));
      layout.force('links').links([...joins, ...own, ...ties, ...pulled]);
      layout.alpha(LAYOUT.heat);
    }
    const middle = { x: area() / 2, y: (PAD.top + height - PAD.bottom) / 2 };
    for (const hub of shown) {
      const still = hub === held?.hub || hub === hauled() || hub.pinned ? hub : hub === centre ? middle : null;
      [hub.fx, hub.fy] = still ? [still.x, still.y] : [null, null];
    }
    // Weights and rooms change as the crawler lays; the forces read them again.
    layout.force('collide').radius(roomRadius);
    layout.tick();
  }

  // The graph has the web to itself, less the drawer when it is open. A
  // subject's room stops at its edges.
  const area = () => width - (open ? drawer.offsetWidth + DRAWER_GAP : 0);
  function fit() {
    width = sheet.clientWidth;
    height = sheet.clientHeight;
  }
  new ResizeObserver(fit).observe(sheet);
  // Where a subject's centre may be, with its name inside the web.
  function limits(hub) {
    const [left, right] = [PAD.side + hub.left, Math.max(area() - PAD.side - hub.right, PAD.side + hub.left)];
    const [top, bottom] = [PAD.top + hub.up, Math.max(height - PAD.bottom - hub.down, PAD.top + hub.up)];
    return { x: [left, right], y: [top, bottom] };
  }
  function keepIn(hub) {
    const { x, y } = limits(hub);
    if (hub.x < x[0] || hub.x > x[1]) [hub.x, hub.vx] = [clamp(hub.x, ...x), 0];
    if (hub.y < y[0] || hub.y > y[1]) [hub.y, hub.vy] = [clamp(hub.y, ...y), 0];
  }

  // Where the crawler goes to lay a sentence under the subject `topic`: a
  // point beside its label, in document coordinates, that keeps to the
  // subject as the web moves.
  function aim(topic) {
    const hub = home(hubs[topic]);
    bear(hub);
    spot = { hub, point: { x: 0, y: 0 } };
    place();
    return spot.point;
  }

  // A subject comes onto the web `at` a point, or else a stem's length from
  // its theme on the side away from the middle, or else in the middle. Its
  // springs to subjects already there come up with it.
  function bear(hub, at = null) {
    if (hub.born) return;
    const middle = { x: area() / 2, y: (PAD.top + height - PAD.bottom) / 2 };
    const by = hub.parent?.born ? hub.parent : null;
    const angle = by ? Math.atan2(by.y - middle.y, by.x - middle.x) + (Math.random() - 0.5) * 1.6 : 0;
    const { x, y } = at ?? (by ? { x: by.x + Math.cos(angle) * STEM.length, y: by.y + Math.sin(angle) * STEM.length } : middle);
    [hub.x, hub.y] = [x, y];
    hub.born = true;
    room(hub);
    for (const { a, b, line, figure } of springs) if ((a === hub && b.born) || (b === hub && a.born)) for (const part of [line, figure]) part.classList.remove('is-unborn');
  }

  // A subject's count, once its name is written out: what is filed under it and under the subjects that belong to it.
  function counted(hub) {
    if (hub.written < hub.label.length) return;
    hub.count.textContent = ` ·${two(hub === centre ? laid.sentences : filedIn(hub))}`;
    const folded = hubs.filter((other) => other.fused === hub).length;
    hub.folded.textContent = folded ? ` +${folded}` : '';
  }

  // The point is just clear of the subject's label, on the side the crawler comes from.
  function place() {
    Object.assign(spot.point, clearOf(spot.hub));
  }

  // The point, in document coordinates, just clear of a subject's label on the side the crawler's head is.
  function clearOf(hub) {
    const half = hub.el.getComputedTextLength() / 2;
    const away = Math.hypot(head.x - hub.x, head.y - hub.y) || 1;
    const toward = { x: (head.x - hub.x) / away, y: (head.y - hub.y) / away };
    const reach = Math.min((half + STANDOFF) / Math.abs(toward.x || 1e-6), (hub.up + STANDOFF) / Math.abs(toward.y || 1e-6));
    return { x: origin.x + hub.x + toward.x * reach, y: origin.y + hub.y + toward.y * reach };
  }

  // The subject the crawler has hold of, if it has.
  const hauled = () => (towed?.offset ? towed.hub : null);

  // Of the springs between subjects that both have sentences, are free and
  // shown, the one stretched furthest past its length for its weight, if it
  // is far enough: its lighter subject is to be hauled toward the other.
  // Gives `{ grip, to, at }`, points in document coordinates kept up to date as
  // the web moves, or null when the web is tidy.
  function untidy() {
    let most = TIDY.far;
    towed = crowd();
    for (const { a, b, length, weight } of towed ? [] : springs) {
      if ([a, b].some((hub) => hub.hidden || hub.pinned || hub === held?.hub || hub === pending?.sub || !hub.sentences.length)) continue;
      const over = ((Math.hypot(a.x - b.x, a.y - b.y) - length) / length) * weight;
      if (over <= most) continue;
      most = over;
      const [hub, other] = a.sentences.length <= b.sentences.length ? [a, b] : [b, a];
      towed = { hub, other, length, offset: null, grip: { x: 0, y: 0 }, to: { x: 0, y: 0 }, at: { x: 0, y: 0 } };
    }
    if (!towed) return null;
    tow();
    return towed;
  }

  // Of the subjects the plan has fall into another, the first that has been given all it will be, and whose host is on the web to take it: to be brought to that host.
  function crowd() {
    for (const hub of hubs) {
      const host = hub.host && home(hub.host);
      if (!host || host === hub || hub.fused || hub.restored || hub.hidden || hub.pinned || hub === held?.hub || hub === pending?.sub || host === pending?.sub) continue;
      if (!hub.born || !host.born || host.hidden || hub.sentences.length < hub.total) continue;
      return { hub, other: host, length: STEM.length, fuse: true, offset: null, grip: { x: 0, y: 0 }, to: { x: 0, y: 0 }, at: { x: 0, y: 0 } };
    }
    return null;
  }

  // The crawler has brought a subject into the one the plan has it fall into, and the two are one: its
  // sentences are the theme's, threads to it go to the theme, and its node,
  // its name and its springs leave the web.
  // `sub` falls into `theme`, by default the theme it belongs under: its sentences and the subjects under it become the theme's.
  function fuse(sub, theme = sub.parent) {
    const touching = springs.filter(({ a, b }) => a === sub || b === sub);
    fusions.push({
      sub,
      theme,
      parent: theme.parent,
      words: sub.words,
      hanging: sub.hanging,
      sentences: sub.sentences.filter((index) => !theme.sentences.includes(index)),
      children: hubs.filter((hub) => hub.parent === sub && hub !== theme).map((child) => ({ child, stems: springs.filter((spring) => spring.stem && spring.a === child) })),
      ties: beads.map((leaf) => ({ leaf, ties: [...leaf.ties], threads: [...leaf.tieThreads], places: leaf.tieThreads.map((thread) => [thread.parentNode, thread.nextSibling]) })),
      shown: [sub.el, sub.dot, ...touching.flatMap(({ line, figure }) => [line, figure])].filter((part) => !part.classList.contains('is-hidden')),
    });
    sub.fused = theme;
    sub.hidden = true;
    for (const child of hubs.filter((hub) => hub.parent === sub && hub !== theme)) {
      child.parent = theme;
      for (const spring of springs) if (spring.stem && spring.a === child) spring.b = theme;
    }
    if (theme.parent === sub) theme.parent = sub.parent;
    for (const leaf of sub.hanging) leaf.from = theme;
    theme.hanging.push(...sub.hanging);
    sub.hanging = [];
    for (const index of sub.sentences) if (!theme.sentences.includes(index)) theme.sentences.push(index);
    theme.words += sub.words;
    for (const leaf of beads) {
      leaf.ties = leaf.ties.map((tie) => (tie === sub ? theme : tie));
      for (let i = leaf.ties.length - 1; i >= 0; i--) {
        if (leaf.ties[i] !== leaf.from && leaf.ties.indexOf(leaf.ties[i]) === i) continue;
        leaf.tieThreads[i].remove();
        leaf.ties.splice(i, 1);
        leaf.tieThreads.splice(i, 1);
      }
    }
    for (const part of [sub.el, sub.dot]) part.classList.add('is-hidden');
    for (const { a, b, line, figure } of springs) if (a === sub || b === sub) for (const part of [line, figure]) part.classList.add('is-hidden');
    counted(theme);
    room(theme);
    if (open === sub) show(null);
    else if (open === 'summary' || open === theme) show(open);
  }

  // The last fusion undone: the subject is back on the web, a stem's length
  // from the theme that took it in, with what it carried, and the theme as it
  // was. Says whether there was one to undo.
  function unfuse() {
    const undo = fusions.pop();
    if (!undo) return false;
    const { sub, theme } = undo;
    delete sub.fused;
    sub.restored = true; // the reader has had it back: the plan does not fold it again
    sub.hidden = false;
    for (const part of undo.shown) part.classList.remove('is-hidden');
    for (const { child, stems } of undo.children) {
      child.parent = sub;
      for (const spring of stems) spring.b = sub;
    }
    theme.parent = undo.parent;
    for (const leaf of undo.hanging) leaf.from = sub;
    theme.hanging = theme.hanging.filter((leaf) => !undo.hanging.includes(leaf));
    sub.hanging = undo.hanging;
    theme.sentences = theme.sentences.filter((index) => !undo.sentences.includes(index));
    theme.words -= undo.words;
    for (const { leaf, ties, threads, places } of undo.ties) {
      leaf.ties = ties;
      leaf.tieThreads = threads;
      threads.forEach((thread, i) => {
        if (thread.isConnected) return;
        const [parent, next] = places[i];
        parent.insertBefore(thread, next?.parentNode === parent ? next : null);
      });
    }
    // It comes back on the side it was dropped from, or else away from the middle.
    const [dx, dy] = [sub.x - theme.x, sub.y - theme.y];
    const [mx, my] = [theme.x - (centre?.x ?? theme.x - 1), theme.y - (centre?.y ?? theme.y)];
    const [ux, uy] = Math.hypot(dx, dy) > 1 ? [dx, dy] : [mx, my];
    const length = Math.hypot(ux, uy) || 1;
    [sub.x, sub.y, sub.vx, sub.vy] = [theme.x + (ux / length) * STEM.length, theme.y + (uy / length) * STEM.length, 0, 0];
    for (const hub of [theme, sub]) {
      counted(hub);
      room(hub);
    }
    if (open === 'summary' || open === theme) show(open);
    told.push({ kind: 'unfuse', at: onPage(sub) });
    return true;
  }

  // Where the crawler takes the subject, where its head goes to haul it near
  // the other, and where the other is.
  function tow() {
    const { hub, other, length, grip, to, at, offset } = towed;
    if (!offset) Object.assign(grip, clearOf(hub));
    const apart = Math.hypot(hub.x - other.x, hub.y - other.y) || 1;
    const near = towed.fuse ? FUSE.reach : length * TIDY.near;
    const lead = offset ?? { x: hub.x - (grip.x - origin.x), y: hub.y - (grip.y - origin.y) };
    Object.assign(to, { x: origin.x + other.x + ((hub.x - other.x) / apart) * near - lead.x, y: origin.y + other.y + ((hub.y - other.y) / apart) * near - lead.y });
    Object.assign(at, { x: origin.x + other.x, y: origin.y + other.y });
  }

  // The crawler takes hold of the subject it came to tidy, and lets it go.
  function grab() {
    if (towed) towed.offset = { x: towed.hub.x - head.x, y: towed.hub.y - head.y };
  }
  function drop() {
    if (towed?.fuse && towed.offset) fuse(towed.hub, towed.other);
    towed = null;
  }

  // The crawler begins to lay the sentence at `index`: it comes out of the
  // crawler, held to its subject.
  function lay(index) {
    const { worth, topic, ties, text } = kept[index];
    const hub = home(hubs[topic]);
    const tied = [...new Set(ties.map((tie) => home(hubs[tie])))].filter((other) => other !== hub);
    // The subjects it is filed under come up, their names written out.
    for (const other of [hub, ...tied]) {
      bear(other);
      for (const part of [other.el, other.dot]) part.classList.remove('is-unborn');
    }
    const leaf = { index, worth, from: hub, ties: tied, words: 0, text: text.match(/\S+/g), x: head.x, y: head.y };
    hub.hanging.push(leaf);
    leaf.thread = draw('path', threads, '');
    leaf.tieThreads = leaf.ties.map(() => draw('path', threads, 'is-tie'));
    leaf.el = draw('g', leaves, `web-leaf is-${worth} is-laying`);
    leaf.dot = draw(worth === 'prize' ? 'rect' : 'circle', leaf.el, '');
    leaf.el.addEventListener('pointerenter', () => {
      pointed = leaf;
      held || light(leaf);
    });
    leaf.el.addEventListener('pointerleave', () => {
      pointed = null;
      held || light(null);
    });
    leaf.el.addEventListener('click', () => onPick(index));
    for (const part of [leaf.el, leaf.thread, ...leaf.tieThreads]) part.classList.toggle('is-hidden', Boolean(hub.hidden));
    beads.push(leaf);
    made.set(index, leaf);
    for (const { a, b, weight } of pulls) {
      if ((a !== index && b !== index) || !made.has(a) || !made.has(b)) continue;
      drawn.push({ a: made.get(a), b: made.get(b), weight });
    }
    // The subjects it is joined to feel it being fed.
    for (const { a, b, weight } of springs) {
      const other = a === hub ? b : b === hub ? a : null;
      if (!other || other === held?.hub) continue;
      const away = Math.hypot(hub.x - other.x, hub.y - other.y) || 1;
      other.vx = (other.vx ?? 0) + ((hub.x - other.x) / away) * TUG * weight;
      other.vy = (other.vy ?? 0) + ((hub.y - other.y) / away) * TUG * weight;
    }
    noted = { leaf, until: Infinity };
    room(hub);
  }

  // One more word of the sentence at `index` is out.
  function feed(index) {
    const leaf = made.get(index);
    leaf.words += 1;
    leaf.from.words += 1;
    laid.words += 1;
  }

  // The sentence at `index` is whole, and under its subjects for good.
  function settle(index) {
    const leaf = made.get(index);
    for (const hub of [leaf.from, ...leaf.ties]) {
      hub.sentences.push(index);
      // A theme is fed by what is filed under its subjects too.
      for (const fed of hub.parent ? [hub, hub.parent] : [hub]) {
        for (const part of [fed.el, fed.dot]) part.classList.add('is-fed');
        counted(fed);
      }
      room(hub);
    }
    leaf.whole = true;
    leaf.el.classList.remove('is-laying');
    laid.sentences += 1;
    if (centre) counted(centre);
    noted.until = clock + NOTE.linger;
    tally();
    if (open === 'summary' || [leaf.from, ...leaf.ties].includes(open)) show(open);
  }

  function tally() {
    const count = el.querySelector('.web-count');
    count.textContent = laid.sentences;
    count.dataset.of = `/${kept.length}`;
    const words = el.querySelector('.web-words');
    words.textContent = number.format(laid.words);
    words.dataset.of = `/${number.format(wordCount)}`;
  }

  // The reader pauses to read, or goes back to the crawl: the web takes the
  // window or gives it back, over the next moments, and is measured again.
  function remeasure() {
    fit();
    hubs.forEach(room);
  }
  // Pausing to read stops the crawler and gives the graph the window but for
  // a strip of the text, with the summary open beside it; going back shuts it.
  let paused = false;
  pause.addEventListener('click', () => {
    paused = !paused;
    document.body.classList.toggle('is-reading', paused);
    pause.textContent = paused ? 'Back to the crawl' : 'Pause and read';
    pause.setAttribute('aria-pressed', paused);
    onRead(paused);
    show(paused ? 'summary' : null);
    layout.alpha(LAYOUT.heat);
    remeasure();
    el.addEventListener('transitionend', remeasure, { once: true });
  });

  // Bonds are the reader's to switch: the hairlines between subjects, and from each theme to the centre.
  bondsToggle.addEventListener('click', () => {
    const on = bondsToggle.getAttribute('aria-pressed') !== 'true';
    bondsToggle.setAttribute('aria-pressed', on);
    el.classList.toggle('no-bonds', !on);
  });

  // What a subject has with the others on the web, strongest first: each with
  // how much they share, and whether that clears the line from which two fall
  // into one. A subject's theme is always offered.
  function bondsOf(hub) {
    return hubs
      .filter((other) => other !== hub && other.born && !other.hidden)
      .map((other) => ({ other, share: bond(hub, other), theme: other === hub.parent }))
      .filter(({ share, theme }) => share > 0 || theme)
      .sort((a, b) => b.share - a.share);
  }

  // Two subjects become one: the lighter falls into the heavier, a subject
  // into its theme, and nothing falls into what it was brought into by.
  // The reader's merge is not made at once: the subject stays where it was let go
  // while the crawler comes to bite it, and falls in at the bite (or, if the
  // crawler is far or busy, a moment later).
  function merge(hub, other) {
    if (pending) return;
    const lighter = hub.sentences.length <= other.sentences.length;
    const [sub, into] = other === hub.parent || other === centre || (hub !== centre && lighter) ? [hub, other] : [other, hub];
    pending = { sub, into, wait: 0, pinned: Boolean(sub.pinned) };
    sub.pinned = true;
    told.push({ kind: 'merge', at: onPage(into), from: onPage(sub) });
  }
  function finishMerge(bitten = false) {
    const { sub, into, pinned } = pending;
    pending = null;
    sub.pinned = pinned;
    fuse(sub, into);
    told.push({ kind: 'fused', at: onPage(into), from: onPage(sub), label: sub.label.toUpperCase(), bitten });
    show(open === sub ? into : open);
    layout.alpha(LAYOUT.heat);
  }

  // A bond as Jev's gauges draw a yes or no: the bar to what they share, the line at the share from which they fall into one.
  function bondGauge(parent, share) {
    const meter = Object.assign(document.createElement('span'), { className: 'jev-gauge is-boolean' });
    meter.style.setProperty('--line', `${WELL.bond * 100}%`);
    meter.classList.toggle('is-close', share >= WELL.bond);
    meter.append(document.createElement('u'), document.createElement('s'), Object.assign(document.createElement('i'), { style: `width:${share * 100}%` }));
    parent.append(meter);
  }

  // The drawer of a subject lists its bonds, each with the gauge and a way to merge.
  function showBonds(hub) {
    const rows = hub === 'summary' ? [] : bondsOf(hub);
    bondList.hidden = !rows.length;
    if (!rows.length) return;
    const head = Object.assign(document.createElement('li'), { className: 'web-bonds-head', textContent: `Bonds · fall into one from ${WELL.bond.toFixed(2).slice(1)}` });
    bondList.replaceChildren(head, ...rows.map(({ other, share, theme }) => {
      const row = document.createElement('li');
      const name = Object.assign(document.createElement('button'), { className: 'web-bond-name', type: 'button', textContent: other.label });
      name.addEventListener('click', () => show(other));
      row.append(name, Object.assign(document.createElement('em'), { textContent: theme ? 'theme' : '' }));
      bondGauge(row, share);
      row.append(Object.assign(document.createElement('b'), { textContent: share ? share.toFixed(2).slice(1) : '.00' }));
      const go = Object.assign(document.createElement('button'), { className: 'web-merge', type: 'button', textContent: 'Merge', disabled: share < WELL.bond && !theme });
      go.addEventListener('click', () => merge(hub, other));
      row.append(go);
      return row;
    }));
  }

  // The subjects with something under them, what the document is called
  // first and the others in the order the document comes to them, so the
  // summary reads as the document does however far the crawler has got; each
  // with the sentences filed under it itself in reading order, and the
  // subjects brought into it that have any of their own, with them.
  const ownOf = (hub) => kept.flatMap((sentence, index) => (hubs[sentence.topic] === hub && made.get(index)?.whole ? [index] : []));
  const firstOf = (hub) => kept.findIndex(({ topic }) => hubs[topic] === hub || hubs[topic].fused === hub);
  const filed = () => hubs.filter((hub) => hub.sentences.length && !hub.fused).sort((a, b) => (b.label === title) - (a.label === title) || firstOf(a) - firstOf(b)).map((hub) => ({ hub, own: ownOf(hub), folded: hubs.filter((sub) => sub.fused === hub).map((sub) => ({ hub: sub, own: ownOf(sub) })).filter(({ own }) => own.length) }));

  // A sentence in the drawer, with the other subjects it belongs under after it.
  function entry(index, label) {
    const { worth, topic, ties, text } = kept[index];
    const item = document.createElement('li');
    item.className = `is-${worth}`;
    if (label) item.append(Object.assign(document.createElement('b'), { textContent: label }));
    item.append(text);
    const also = [topic, ...ties].filter((other) => hubs[other] !== open).map((other) => hubs[other].label);
    if (open !== 'summary' && also.length) item.append(Object.assign(document.createElement('i'), { textContent: `Also under ${also.join(', ')}` }));
    item.addEventListener('click', () => onPick(index));
    return item;
  }

  // Opens the drawer on `what`: the page of a subject, or the 'summary',
  // every subject's sentences under its name. With nothing, shuts it.
  function show(what) {
    if ((what === 'summary') !== (open === 'summary')) told.push({ kind: what === 'summary' ? 'summary' : 'summary-end' });
    const fresh = what !== open; // opened on something else, it starts at the top; kept up to date, it stays where the reader has it
    open = what;
    drawer.hidden = !what;
    for (const hub of hubs) for (const part of [hub.el, hub.dot, hub.reach]) part.classList.toggle('is-open', hub === what);
    if (!what) return;
    const [heading, meta] = [drawer.querySelector('h2'), drawer.querySelector('p')];
    const list = drawer.querySelector('ol');
    copy.hidden = what !== 'summary';
    hide.hidden = what === 'summary';
    showBonds(what);
    if (what === 'summary') {
      heading.textContent = 'Summary';
      meta.textContent = laid.sentences ? `${plural(laid.sentences, 'sentence')} under ${plural(filed().length, 'subject')}, so far` : 'Nothing on the web yet';
      // The document in one sentence comes first, once the crawler has laid it.
      const lead = kept.findIndex((sentence, index) => sentence.lead && made.get(index)?.whole);
      const subject = (label, folded) => Object.assign(document.createElement('li'), { className: `web-page-subject${folded ? ' is-folded' : ''}`, textContent: label });
      list.replaceChildren(...(lead < 0 ? [] : [Object.assign(entry(lead, 'In one sentence'), { className: 'web-page-lead' })]), ...filed().flatMap(({ hub, own, folded }) => [
        subject(hub.label),
        ...own.map((index) => entry(index)),
        ...folded.flatMap(({ hub: sub, own: theirs }) => [subject(sub.label, true), ...theirs.map((index) => entry(index))]),
      ]));
    } else {
      heading.textContent = what.label;
      meta.textContent = what.sentences.length ? plural(what.sentences.length, 'sentence') : 'Nothing under it yet';
      list.replaceChildren(...what.sentences.toSorted((a, b) => a - b).map((index) => entry(index)));
    }
    if (fresh) for (const part of [drawer, list]) part.scrollTop = 0;
  }
  drawer.querySelector('.web-close').addEventListener('click', () => show(null));

  // The subject open in the drawer leaves the web, and the drawer shuts.
  hide.addEventListener('click', () => {
    const hub = open;
    hub.hidden = true;
    const gone = (leaf) => leaf.from === hub;
    for (const part of [hub.el, hub.dot, ...beads.filter(gone).flatMap((leaf) => [leaf.el, leaf.thread, ...leaf.tieThreads])]) part.classList.add('is-hidden');
    for (const { a, b, line, figure } of springs) if (a === hub || b === hub) for (const part of [line, figure]) part.classList.add('is-hidden');
    for (const leaf of beads) leaf.tieThreads.forEach((thread, i) => leaf.ties[i] === hub && thread.classList.add('is-hidden'));
    light(null);
    show(null);
  });
  el.querySelector(':scope > header .web-read').addEventListener('click', () => show(open === 'summary' ? null : 'summary'));

  // The summary as Markdown: a heading a subject, under it a smaller one for
  // each subject brought into it, an item a sentence, and links to the other
  // subjects one belongs under, to its section for one brought into another.
  copy.addEventListener('click', async () => {
    const link = (hub) => ` [[${hub.fused ? `${hub.fused.label}#${hub.label}` : hub.label}]]`;
    const items = (own) => own.map((index) => `- ${kept[index].text}${kept[index].ties.map((tie) => link(hubs[tie])).join('')}`).join('\n');
    const sections = filed().map(({ hub, own, folded }) => [`## ${hub.label}`, items(own), ...folded.map(({ hub: sub, own: theirs }) => `### ${sub.label}\n\n${items(theirs)}`)].filter(Boolean).join('\n\n'));
    const lead = kept.find((sentence, index) => sentence.lead && made.get(index)?.whole);
    await navigator.clipboard.writeText(`# ${title}\n\n${lead ? `> ${lead.text}\n\n` : ''}${sections.join('\n\n')}\n`);
    copy.textContent = 'Copied';
    setTimeout(() => (copy.textContent = 'Copy as Markdown'), COPIED_MS);
  });

  // The text of a sentence, beside its bead: as much of it as is out.
  function annotate() {
    const shown = noted && clock < noted.until ? noted.leaf : pointed;
    const leaf = shown?.from.hidden ? null : shown;
    note.hidden = !leaf;
    if (!leaf) return;
    const texts = leaf.group && rested ? leaf.group.map((one) => (one.text.length > BUNDLE.words ? `${one.text.slice(0, BUNDLE.words).join(' ')}…` : one.text.join(' '))) : [leaf.text.slice(0, leaf === noted?.leaf ? leaf.words : Infinity).join(' ')];
    const text = texts.slice(0, BUNDLE.shown).join('\n');
    if (note.dataset.text !== text) {
      note.dataset.text = text;
      note.replaceChildren(...texts.slice(0, BUNDLE.shown).map((line) => Object.assign(document.createElement('p'), { textContent: line })));
      if (texts.length > BUNDLE.shown) note.append(Object.assign(document.createElement('p'), { className: 'web-note-more', textContent: `+${texts.length - BUNDLE.shown}` }));
    }
    note.className = `web-note is-${leaf.worth}`;
    // On the side of the bead with more room.
    const y = leaf.y;
    const left = leaf.x > area() / 2 ? leaf.x - NOTE.gap - NOTE.width : leaf.x + NOTE.gap;
    const above = y > height / 2;
    note.style.left = `${clamp(left, 8, width - NOTE.width - 8)}px`;
    note.style.top = above ? '' : `${y + NOTE.gap}px`;
    note.style.bottom = above ? `${height - y + NOTE.gap}px` : '';
  }

  // Draws the thread `el` between `a` and `b`, as a thread with weight: it
  // trails, sags, sways in the draught and rings when the web is knocked.
  // A strand drawn out past the length it has settled at loses its slack and
  // goes taut, the more the lighter it shows; drawn out too far while the
  // crawler hauls, it snaps: it whips free from the end at `b`, then is spun
  // again from `a`. A tie is never seen taut, and never snaps.
  const strands = new WeakMap();
  const lengths = new WeakMap(); // a strand → the length it has settled at, px
  const cuts = new WeakMap(); // a snapped strand → seconds since it snapped
  function line(el, a, b, dt, slack = STRAND.slack, felt = true) {
    let thread = strands.get(el);
    if (!thread) strands.set(el, (thread = createThread({ damping: STRAND.damping, gravity: STRAND.gravity, wind: STRAND.wind })));
    const gap = Math.hypot(b.x - a.x, b.y - a.y);
    const rest = (lengths.get(el) ?? gap) + (gap - (lengths.get(el) ?? gap)) * (1 - Math.exp(-dt / TENSION.settle));
    lengths.set(el, rest);
    const strain = felt && rest > 1 ? Math.max(0, gap / rest - 1) : 0;
    if (!cuts.has(el) && strain > TENSION.snap && hauled()) {
      cuts.set(el, 0);
      thread.recoil(TENSION.recoil);
    }
    if (cuts.has(el)) {
      const since = cuts.get(el) + dt;
      cuts.set(el, since);
      if (since < TENSION.whip) thread.let(b, dt);
      else {
        if (since - dt < TENSION.whip) thread.reset();
        const spun = clamp((since - TENSION.whip) / TENSION.spin, 0, 1);
        thread.hold(a, { x: a.x + (b.x - a.x) * spun, y: a.y + (b.y - a.y) * spun }, dt, slack);
        if (spun >= 1) cuts.delete(el);
      }
    } else thread.hold(a, b, dt, slack * Math.max(0, 1 - strain / TENSION.taut));
    el.style.setProperty('--strain', cuts.has(el) ? 0 : Math.min(strain / TENSION.snap, 1).toFixed(2)); // snapped, it holds nothing
    for (const hit of knocks) thread.ring(hit.x, hit.y, hit.t * KNOCK.speed, KNOCK.band, hit.power * KNOCK.push * STRAND.flick * Math.exp(-KNOCK.decay * hit.t));
    thread.knock(head.x, head.y, STRAND.brush, TREAD.push * STRAND.flick);
    el.setAttribute('d', thread.d);
  }

  // Marks, or stops marking, a subject as the one a dragged one would fall into.
  const docking = (hub, on) => hub && [hub.el, hub.dot].forEach((part) => part.classList.toggle('is-docking', on));

  // How much two subjects share: what Jev says they have to do with each
  // other, or the sentences filed under one and joined to the other, a quarter
  // each, whichever is more.
  function bond(a, b) {
    const spring = springs.filter((link) => (link.a === a && link.b === b) || (link.a === b && link.b === a)).reduce((most, link) => Math.max(most, link.weight), 0);
    const shared = beads.filter((leaf) => (leaf.from === a && leaf.ties.includes(b)) || (leaf.from === b && leaf.ties.includes(a))).length;
    return Math.max(spring, Math.min(shared * 0.25, 0.8));
  }

  // Where a subject held at `at` is drawn to: toward each subject by how much
  // they share and how near it is, and on a close bond close by it takes hold.
  // Says which it would fall into.
  function attract(hub, at) {
    const spot = { ...at };
    let falls = null;
    let most = 0;
    for (const other of hubs) {
      if (other === hub || !other.born || other.hidden) continue;
      const share = bond(hub, other);
      if (!share) continue;
      const [dx, dy] = [other.x - at.x, other.y - at.y];
      const away = Math.hypot(dx, dy) || 1;
      if (away > WELL.reach) continue;
      const close = share >= WELL.bond;
      const draw = Math.min(0.9, share * WELL.pull * (1 - away / WELL.reach) ** 2 + (close && away < WELL.snap ? 0.85 * (1 - away / WELL.snap) ** 2 : 0));
      spot.x += dx * draw;
      spot.y += dy * draw;
      if (close && draw > most) [most, falls] = [draw, other];
    }
    return { spot, falls: falls && Math.hypot(falls.x - spot.x, falls.y - spot.y) < WELL.dock ? falls : null };
  }

  // While a subject is dragged, Jev's reading of it against the nearest one it is bonded to: the
  // share, the line it has to clear, and whether letting go now would fold the two into one.
  function measure(hub, at, falls) {
    let near = null;
    for (const other of hubs) {
      if (other === hub || !other.born || other.hidden) continue;
      const share = bond(hub, other);
      const away = Math.hypot(other.x - at.x, other.y - at.y);
      if (share && away < WELL.reach && (!near || away < near.away)) near = { other, share, away };
    }
    gauge.hidden = !near || hub === centre;
    if (gauge.hidden) return near;
    const key = `${near.other.label}|${near.share}|${near.other === falls}`;
    if (gauge.dataset.key !== key) {
      gauge.dataset.key = key;
      gauge.replaceChildren(Object.assign(document.createElement('span'), { textContent: near.other.label }));
      bondGauge(gauge, near.share);
      gauge.append(Object.assign(document.createElement('b'), { textContent: near.share.toFixed(2).slice(1) }), Object.assign(document.createElement('i'), { textContent: near.other === falls ? 'lets go: one' : near.share >= WELL.bond ? 'closer' : `below ${WELL.bond.toFixed(2).slice(1)}` }));
    }
    gauge.style.left = `${clamp(at.x + 18, 8, width - 220)}px`;
    gauge.style.top = `${clamp(at.y + 18, 8, height - 40)}px`;
    return near;
  }

  // A frame of `dt` seconds: the web moves on, giving under the crawler,
  // whose head is at `at` in document coordinates.
  function step(dt, at) {
    clock += dt;
    const box = sheet.getBoundingClientRect();
    origin = { x: box.left + scrollX, y: box.top + scrollY };
    head = { x: at.x - origin.x, y: at.y - origin.y };

    // A subject held follows the reader's hand; moved hard, it shakes the web.
    shaken = null;
    if (held?.moved) {
      const { hub } = held;
      if (Math.hypot(held.at.x - hub.x, held.at.y - hub.y) > SHAKE) shaken = { x: origin.x + held.at.x, y: origin.y + held.at.y };
      const { spot, falls } = hub === centre ? { spot: { ...held.at }, falls: null } : attract(hub, held.at);
      // What hangs from it and the subjects under it come along, a little behind.
      const [dx, dy] = [spot.x - hub.x, spot.y - hub.y];
      for (const node of [...beads.filter((leaf) => leaf.from === hub), ...hubs.filter((other) => other !== hub && primary(other) === hub && other.born && !other.hidden)]) {
        if (node.pinned) continue;
        const follow = node.from ? WELL.family.leaf : hub === centre ? WELL.family.theme : WELL.family.sub;
        node.x += dx * follow;
        node.y += dy * follow;
      }
      [hub.x, hub.y] = [spot.x, spot.y];
      if (falls !== dock) {
        docking(dock, false);
        docking(falls, true);
        dock = falls;
      }
      const near = measure(hub, spot, falls);
      hand = { at: onPage(spot), dock: falls ? onPage(falls) : null, share: near?.share ?? 0, close: Boolean(near && near.share >= WELL.bond && hub !== centre) };
    } else {
      hand = null;
      if (!gauge.hidden) gauge.hidden = true;
    }
    if (pending && (pending.wait += dt) >= BITE.wait) finishMerge();
    // A subject the crawler hauls follows its head, until the reader takes it from it.
    if (towed && (towed.hub.hidden || towed.hub.pinned || towed.hub === held?.hub || towed.other.hidden)) towed = null;
    if (hauled()) [towed.hub.x, towed.hub.y] = [head.x + towed.offset.x, head.y + towed.offset.y];
    // The web gives under the crawler, all but the subject it is making for, which would only be pushed on ahead of it.
    for (const node of [...hubs, ...beads]) {
      if (node.pinned || node === hauled() || node === spot?.hub) continue;
      const dx = node.x - head.x;
      const dy = node.y - head.y;
      const away = Math.hypot(dx, dy) || 1;
      if (away > TREAD.reach) continue;
      const push = TREAD.push * (1 - away / TREAD.reach) * (node.from ? 1 : 0.3);
      node.x += (dx / away) * push;
      node.y += (dy / away) * push;
    }
    // A landing, a take-off, a thread hooked on: a ring goes out from it over the web.
    knocks = knocks.filter((hit) => (hit.t += dt) * KNOCK.speed < KNOCK.reach);
    for (const hit of knocks) {
      const ring = hit.t * KNOCK.speed;
      const strength = hit.power * KNOCK.push * Math.exp(-KNOCK.decay * hit.t);
      for (const node of [...hubs, ...beads]) {
        if (node.pinned || node === hauled() || node === spot?.hub) continue;
        const dx = node.x - hit.x;
        const dy = node.y - hit.y;
        const away = Math.hypot(dx, dy) || 1;
        const off = Math.abs(away - ring);
        if (off > KNOCK.band) continue;
        const push = strength * Math.cos((off / KNOCK.band) * (Math.PI / 2)) * (node.from ? 1 : 0.3);
        node.x += (dx / away) * push;
        node.y += (dy / away) * push;
      }
    }
    weigh();
    arrange();
    hubs.forEach((hub) => hub.born && room(hub));
    hubs.forEach(keepIn);
    for (const leaf of beads) [leaf.x, leaf.y] = [clamp(leaf.x, LEAF_EDGE, area() - LEAF_EDGE), clamp(leaf.y, LEAF_EDGE, height - LEAF_EDGE)];
    if (spot) place();
    if (towed) tow();

    for (const hub of hubs) {
      if (!hub.born) continue;
      // Its name is written out a letter at a time, once it is shown.
      if (!hub.el.classList.contains('is-unborn') && hub.written < hub.label.length) {
        hub.written = Math.min(hub.written + dt / WRITE_S, hub.label.length);
        hub.name.textContent = hub.label.toUpperCase().slice(0, Math.floor(hub.written));
        counted(hub);
        room(hub);
      }
      // Its node, and its name under it.
      hub.dot.setAttribute('cx', hub.x);
      hub.dot.setAttribute('cy', hub.y);
      hub.dot.setAttribute('r', radius(hub));
      hub.reach.setAttribute('cx', hub.x);
      hub.reach.setAttribute('cy', hub.y);
      // A theme keeps its ring when it is full, a frame a little off its node; the centre's is a dial of ticks.
      const framed = hub === centre || !hub.parent;
      hub.reach.setAttribute('r', reach(hub) + mass() * (hub === centre ? NODE.dial : framed ? NODE.frame : 0));
      for (const cls of ['is-unborn', 'is-hidden']) hub.reach.classList.toggle(cls, hub.dot.classList.contains(cls));
      hub.reach.classList.toggle('is-full', !framed && reach(hub) - radius(hub) < 1.5);
      hub.reach.classList.toggle('is-framed', framed);
      hub.reach.classList.toggle('is-dial', hub === centre);
      if (hub === centre) hub.reach.style.strokeDasharray = `1.2 ${((2 * Math.PI * (reach(hub) + mass() * NODE.dial)) / NODE.ticks - 1.2).toFixed(2)}`;
      hub.el.setAttribute('x', hub.x);
      hub.el.setAttribute('y', hub.y + edge(hub) + LABEL.gap + LABEL.size / 2);
    }
    for (const { a, b, weight, stem, line: el, figure } of springs) {
      // A stem is a strand with weight; a bond between subjects is measured, so it is drawn straight.
      if (stem) line(el, a, b, dt, STRAND.spring * (1 - weight) + 0.01);
      else el.setAttribute('d', `M${a.x} ${a.y}L${b.x} ${b.y}`);
      figure.setAttribute('x', (a.x + b.x) / 2);
      figure.setAttribute('y', (a.y + b.y) / 2);
    }
    const heaviest = Math.max(1, ...tethers.map(({ hub }) => filedIn(hub)));
    for (const { hub, el: tether } of tethers) {
      const on = centre?.born && hub !== centre && hub.born && !hub.hidden && !centre.hidden;
      tether.classList.toggle('is-hidden', !on);
      if (!on) continue;
      tether.style.setProperty('--weight', filedIn(hub) / heaviest);
      tether.setAttribute('d', `M${centre.x} ${centre.y}L${hub.x} ${hub.y}`);
    }
    for (const leaf of beads) {
      const { from } = leaf;
      if (leaf.worth === 'prize') {
        const side = Math.min(BEAD.side + BUNDLE.grow * ((leaf.group?.length ?? 1) - 1), BUNDLE.most);
        leaf.dot.setAttribute('x', leaf.x - side / 2);
        leaf.dot.setAttribute('y', leaf.y - side / 2);
        leaf.dot.setAttribute('width', side);
        leaf.dot.setAttribute('height', side);
      } else {
        leaf.dot.setAttribute('cx', leaf.x);
        leaf.dot.setAttribute('cy', leaf.y);
        leaf.dot.setAttribute('r', leaf.whole ? BEAD.r * (1 - (GRAPH.fade / 2) * Math.min(age(leaf) ?? 0, GRAPH.recent)) : BEAD.lit);
      }
      line(leaf.thread, from, leaf, dt);
      // The older the fainter, and one sinking into its subject fades out.
      const fade = sinking(leaf) ? Math.max(0, 1 - (clock - leaf.sunk) / GRAPH.sink) * (1 - GRAPH.fade * GRAPH.recent) : 1 - GRAPH.fade * (age(leaf) ?? 0);
      for (const part of [leaf.el, leaf.thread]) part.style.setProperty('--fade', Math.max(fade, 0));
      for (const part of [leaf.el, leaf.thread, ...leaf.tieThreads]) part.classList.toggle('is-sunk', sunk(leaf));
      leaf.tieThreads.forEach((thread, i) => line(thread, leaf.ties[i], leaf, dt, STRAND.tie, false));
    }
    annotate();
  }

  // The themes the web opens on.
  const titled = hubs.find(({ label }) => label === title) ?? null;
  const seeds = hubs.filter((hub) => hub !== titled && !hub.parent);
  // The title in the middle, the others round it, spread over the web.
  if (titled) bear(titled);
  seeds.forEach((hub, i) => {
    const angle = (i / seeds.length) * 2 * Math.PI - Math.PI / 2 + 0.4;
    bear(hub, { x: width / 2 + Math.cos(angle) * width * 0.3, y: (PAD.top + height - PAD.bottom) / 2 + Math.sin(angle) * height * 0.3 });
  });
  for (const hub of [titled, ...seeds]) for (const part of hub ? [hub.el, hub.dot] : []) part.classList.remove('is-unborn');

  tally();
  // The crawler took off or landed at `at`, in document coordinates, `power` hard.
  function knock(at, power) {
    knocks.push({ x: at.x - origin.x, y: at.y - origin.y, t: 0, power });
  }

  return {
    aim,
    knock,
    lay,
    feed,
    settle,
    // The crawler has eaten it all: what is not essential sinks into its subject.
    rest() {
      rested = true;
      // The essential sentences of a subject gather into one bead, the latest, which carries all of them: a square that says one short thing is a label, and the node already says what it is about.
      for (const hub of hubs) {
        const prizes = hub.hanging.filter((leaf) => leaf.worth === 'prize' && leaf.whole && !leaf.merged);
        if (prizes.length < BUNDLE.least) continue;
        const lead = prizes.at(-1);
        lead.group = prizes.sort((a, b) => a.index - b.index);
        for (const leaf of prizes) if (leaf !== lead) leaf.merged = lead;
      }
    },
    // Every subject the plan folds falls into its host at once, with no crawler to bring it.
    foldAll() {
      for (let job = crowd(); job; job = crowd()) fuse(job.hub, job.other);
    },
    untidy,
    grab,
    drop,
    step,
    unfuse,
    // What the reader is doing with a subject they hold, if they are: where it is, the one it would fall into, how much they share and whether that is close, in document coordinates.
    get hand() {
      return hand;
    },
    // Where what the reader points at is, in document coordinates, if they point at something.
    get hover() {
      return hovered && !hovered.hidden && !hovered.from?.hidden ? onPage(hovered) : null;
    },
    // What the reader has done on the web since this was last asked: `{ kind, at, from? }` for a `merge` (`at` the subject it falls into, `from` the one that falls),
    // a subject left `pin`ned, a fusion put back (`unfuse`), and the summary opened or shut.
    told() {
      return told.splice(0);
    },
    // A blow of the crawler's has landed at `point`: a merge the reader made, waiting, is bitten through if it landed on it.
    bite(point) {
      if (!pending) return false;
      const near = [pending.sub, pending.into].some((hub) => Math.hypot(origin.x + hub.x - point.x, origin.y + hub.y - point.y) < BITE.reach);
      if (near) finishMerge(true);
      return near;
    },
    // The summary drawer as the crawler sees it, in document coordinates: its box, and the essential sentences showing in it. Null when it is shut.
    drawer() {
      if (open !== 'summary' || drawer.hidden) return null;
      const [rect, shown] = [drawer.getBoundingClientRect(), drawer.querySelector('ol').getBoundingClientRect()];
      const prizes = [...drawer.querySelectorAll('li.is-prize')]
        .map((li) => li.getBoundingClientRect())
        .filter((box) => box.top > shown.top + 6 && box.bottom < shown.bottom - 6)
        .map((box) => ({ x: box.left + scrollX, y: (box.top + box.bottom) / 2 + scrollY }));
      return { box: { left: rect.left + scrollX, top: rect.top + scrollY, right: rect.right + scrollX, bottom: rect.bottom + scrollY }, prizes };
    },
    // The crawler's leg lands on the essential sentence of the drawer at `point`: it is shoved aside for a moment.
    touch(point) {
      const li = [...drawer.querySelectorAll('li.is-prize')].find((one) => {
        const box = one.getBoundingClientRect();
        return point.x - scrollX >= box.left - 12 && point.x - scrollX <= box.right && point.y - scrollY >= box.top && point.y - scrollY <= box.bottom;
      });
      if (!li) return;
      li.classList.add('is-touched');
      setTimeout(() => li.classList.remove('is-touched'), 420);
    },
    // Whether the crawler still has a subject to tidy, or hold of it.
    get tidying() {
      return Boolean(towed);
    },
    // Where the reader is shaking the web this frame, if they are.
    get shaken() {
      return shaken;
    },
    // Whether a subject the plan folds is due to be brought into its host.
    get crowded() {
      return Boolean(crowd());
    },
  };
}
