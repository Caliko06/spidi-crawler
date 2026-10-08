// What the crawler makes of the reader's work on the web: the one other hand
// that is on it. A subject the reader holds is something to watch, and how it
// is watched says what Jev's gauge says (wary while it is far from falling in,
// reared and ready when letting go would fold it into the other); a merge the
// reader makes is a thing to bite; a subject left alone is gone to and
// tapped; a fusion put back is spat out; and the summary, opened, is a list of
// essential sentences to go down and touch. This only decides, from what the
// web tells it, what the crawler is to do; crawler.js carries it out.
//
// What it is told each step (`web`): `hand`, what the reader holds, `{ at, dock, share, close }` or null;
// `told`, what has happened by the reader's hand since, `{ kind, at, from? }`, which it uses up;
// `drawer`, the summary as it shows, `{ box, prizes }` or null; and `calm`, whether the crawler is
// free for a summary (the reader has paused it, or it has eaten it all).

import { between } from './util.js';

const WATCH = { after: 0.4, bold: 0.85, busy: 0.3 }; // seconds a subject is held before it comes to watch; how likely it does, and while it feeds
const BITE = { reach: 1400, bold: 1, busy: 0.85, after: 0.6 }; // px away a merge may be and be bitten; how likely it is, and while it feeds; how likely it goes to see one it did not bite
const TAP = { reach: 800, odds: 0.45, cool: [4, 9] }; // px away a subject left alone may be and be gone to, how likely it is, and seconds before it may be again
const SPIT = { reach: 900 }; // px away a fusion put back may be and be spat out

export function createAgency() {
  let held = 0; // seconds the reader has had a subject in hand
  let decided = false; // whether it has chosen what to do about this one
  let wants = false; // whether the summary is open and it means to go down it when it can
  let cool = 0;
  const curiosity = between([0.55, 1]);

  const far = (body, point) => Math.hypot(point.x - body.x, point.y - body.y);

  return {
    // Time passes. `body` is `{ x, y, feeding, busy, leaping, dead }` of the crawler. Gives what it is to do now, `{ kind, ... }` each.
    step(dt, web, body) {
      const acts = [];
      cool -= dt;
      if (web.hand) {
        held += dt;
        if (!decided && held > WATCH.after && !body.leaping) {
          decided = true;
          if (!body.dead && Math.random() < (body.feeding ? WATCH.busy : WATCH.bold) * curiosity) acts.push({ kind: 'witness' });
        }
      } else {
        held = 0;
        decided = false;
      }
      for (const event of web.told) {
        if (body.dead) continue;
        if (event.kind === 'merge') {
          if (far(body, event.from) < BITE.reach && Math.random() < (body.feeding ? BITE.busy : BITE.bold)) acts.push({ kind: 'devour', at: event.from, into: event.at });
        } else if (event.kind === 'fused') {
          if (!event.bitten && Math.random() < BITE.after * curiosity) acts.push({ kind: 'inspect', at: event.at, tap: true });
        } else if (event.kind === 'pin') {
          if (cool <= 0 && far(body, event.at) < TAP.reach && !body.feeding && Math.random() < TAP.odds * curiosity) {
            acts.push({ kind: 'inspect', at: event.at, tap: true });
            cool = between(TAP.cool);
          }
        } else if (event.kind === 'unfuse') {
          if (far(body, event.at) < SPIT.reach) acts.push({ kind: 'spit', at: event.at });
        } else if (event.kind === 'summary') wants = true;
        else if (event.kind === 'summary-end') {
          wants = false;
          acts.push({ kind: 'release' });
        }
      }
      if (wants && web.drawer && web.calm && !body.busy && !body.leaping && !body.dead) {
        wants = false;
        acts.push({ kind: 'ritual' });
      }
      return acts;
    },
  };
}
