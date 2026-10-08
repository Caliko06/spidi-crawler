// What the crawler makes of the reader's pointer: the one thing on the page it
// did not put there. It notices it first (its head and feelers turn toward it
// as it nears), then judges it: a pointer that comes fast at its face is
// flinched from, one that lingers near it is threatened, swatted at or struck
// according to its temper, one that holds still at a distance is stalked or
// gone and inspected, and a click near it is a startle it flees in a leap or
// answers with a pounce. Each is an `act` that crawler.js carries out; this
// only decides, from where the pointer is and has been, how bold this crawler
// is and what it is in the middle of.
//
// A pointer is `{ x, y }` in page coordinates, or null when there is none.

import { between, clamp } from './util.js';

const AWARE = 460; // px from the thorax within which it notices the pointer, and turns its head to it
const WARY = 240; // px within which it keeps its feelers on it
const CLOSE = 150; // px within which a pointer is in its face
const PERSONAL = 80; // px within which a click is on it
const SMOOTH = 14; // 1/s, how fast the pointer's velocity is followed
const FLINCH = { speed: 1000, closing: 800, cool: 2.2 }; // px/s a pointer comes at, and closes in at, to be flinched from; seconds before it may again
const DWELL = { s: [0.9, 1.7], still: 200, cool: [3.5, 8] }; // seconds a pointer must linger in its face before it answers it; px/s below which it is lingering; seconds before it answers again
const CURIOUS = { still: [1.4, 2.6], cool: [9, 18] }; // seconds a pointer must be still at a distance to be gone to, and between two visits
const ANNOY = { poke: 0.34, linger: 0.22, fade: 0.12 }; // how much a click angers it, and how fast that wears off, 1/s
const SHOOT = { odds: 0.22 }; // how likely a hand that waits at a distance is lassoed with a thread, for a crawler of middling boldness
const BOLDNESS = [0.12, 0.85]; // how bold a crawler is, drawn for each, and wandering

const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export function createHeed() {
  let boldness = between(BOLDNESS);
  let seen = null; // the pointer as last seen: `{ x, y, vx, vy, d }`
  let still = 0; // seconds the pointer has been still
  let dwell = 0; // seconds it has lingered in its face
  let cool = 0; // seconds before it acts on the pointer again
  let visit = between([1, 4]); // seconds before it may go to see a pointer
  let annoyed = 0; // 0 to 1: how much clicks have made it of a mind to bite

  // How likely it is to stand and fight rather than give way.
  const bold = (drives) => clamp(boldness + 0.55 * drives.fury + 0.25 * drives.hunger - 0.5 * drives.caution + 0.4 * annoyed, 0, 1);

  return {
    // Time passes. `body` is `{ x, y, angle, now, drives, leaping, busy, feeding }`. Gives `{ watch, look, act }`: how much it is
    // watching the pointer (0 to 1), the bearing of it, and what it is to do about it, or null.
    step(dt, pointer, body) {
      boldness = clamp(boldness + (Math.random() - 0.5) * 0.02 * Math.sqrt(dt) * 4, ...BOLDNESS);
      annoyed = Math.max(annoyed - ANNOY.fade * dt, 0);
      cool -= dt;
      visit -= dt;
      if (!pointer) {
        seen = null;
        still = dwell = 0;
        return { watch: 0, look: 0, act: null };
      }
      const [dx, dy] = [pointer.x - body.x, pointer.y - body.y];
      const d = Math.hypot(dx, dy);
      // How the pointer moves is the reader's hand, not the page scrolling under it: from `cx`, `cy`, where it is in the window, if given.
      const [mx, my] = [pointer.cx ?? pointer.x, pointer.cy ?? pointer.y];
      if (seen) {
        const blend = 1 - Math.exp(-SMOOTH * dt);
        seen.vx += ((mx - seen.mx) / Math.max(dt, 1e-3) - seen.vx) * blend;
        seen.vy += ((my - seen.my) / Math.max(dt, 1e-3) - seen.vy) * blend;
        Object.assign(seen, { mx, my, x: pointer.x, y: pointer.y, d });
      } else seen = { x: pointer.x, y: pointer.y, mx, my, vx: 0, vy: 0, d, closing: 0 };
      // How fast it comes at the crawler: the part of its own velocity that points at it.
      seen.closing = d > 1 ? (seen.vx * -dx + seen.vy * -dy) / d : 0;
      const v = Math.hypot(seen.vx, seen.vy);
      still = v < 40 ? still + dt : 0;
      dwell = d < CLOSE && v < DWELL.still ? dwell + dt : Math.max(dwell - 2 * dt, 0);

      const out = { watch: smooth(AWARE, WARY * 0.45, d), look: Math.atan2(dy, dx), act: null };
      if (cool > 0 || body.leaping) return out;

      const from = { x: pointer.x, y: pointer.y };
      // Something comes fast at its face.
      if (d < CLOSE + 50 && v > FLINCH.speed && seen.closing > FLINCH.closing && !body.busy) {
        cool = FLINCH.cool;
        out.act = { kind: 'flinch', from, power: clamp(v / 2600, 0.3, 1) };
        return out;
      }
      // Something lingers in its face.
      if (dwell > between(DWELL.s) && !body.busy) {
        dwell = 0;
        cool = between(DWELL.cool);
        const mind = bold(body.drives);
        annoyed = clamp(annoyed + ANNOY.linger, 0, 1); // a pointer that stays makes it angrier each time it is answered
        if (body.feeding) out.act = mind > 0.45 ? { kind: 'swat', at: from, power: 0.35 + 0.4 * mind } : { kind: 'threat', at: from };
        else if (mind > 0.7 && d > PERSONAL) out.act = { kind: 'strike', at: from };
        else if (mind > 0.38) out.act = { kind: 'threat', at: from };
        else out.act = { kind: 'flee', from, power: 0.35 + 0.3 * (1 - mind) };
        return out;
      }
      // Something holds still where it can be got at, and it is not busy feeding.
      if (visit <= 0 && still > between(CURIOUS.still) && d > WARY && d < AWARE * 1.5 && body.now === 'standing' && !body.busy) {
        visit = between(CURIOUS.cool);
        const hungry = body.drives.hunger;
        const mind = bold(body.drives);
        // A hand that waits is stalked, gone to and felt over, or lassoed with a thread.
        const odds = Math.random();
        out.act = odds < SHOOT.odds * (0.5 + mind) ? { kind: 'shoot', at: from } : odds < 0.35 + 0.35 * mind + 0.2 * hungry ? { kind: 'stalk', at: from } : { kind: 'inspect', at: from };
      }
      return out;
    },

    // The reader clicks at `point`. Gives what it does about it, or null.
    poke(point, body) {
      annoyed = clamp(annoyed + ANNOY.poke, 0, 1);
      if (body.leaping) return null;
      const d = Math.hypot(point.x - body.x, point.y - body.y);
      cool = Math.max(cool, 0.4);
      const mind = bold(body.drives);
      // Poked again and again, it plays dead.
      if (annoyed > 0.6 && d < CLOSE * 2.5 && Math.random() < 0.45) return { kind: 'dead' };
      if (d < PERSONAL) return mind > 0.8 ? { kind: 'strike', at: point } : { kind: 'flee', from: point, power: 1 };
      if (d < CLOSE * 1.8) return Math.random() < mind * 0.9 - 0.1 ? { kind: 'strike', at: point } : { kind: 'flee', from: point, power: clamp(1 - d / (CLOSE * 2.2), 0.4, 0.9) };
      if (d < AWARE * 1.5) return { kind: 'threat', at: point };
      return null;
    },

    // How fast the pointer is going, px/s.
    get speed() {
      return seen ? Math.hypot(seen.vx, seen.vy) : 0;
    },

    get annoyed() {
      return annoyed;
    },
  };
}
