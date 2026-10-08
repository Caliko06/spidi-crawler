// The crawler's temper: what it is driven by, and so what it does to what it
// eats, when, and what that leads on to.
//
// Four drives, each from 0 to 1, rise and fall with what happens to it:
// hunger grows while it is not eating and falls with every word it gets
// down; fury flares at a prize, a surprise, a shaken web or a blow that lands,
// and cools; caution comes of being startled and wears off; fatigue builds
// with every violent clip and goes off as it rests. How restless it is, the
// mood its gait and its idle moves read, is made of them.
//
// It hunts as a spider does, in a sequence with room in it (tap, strike,
// bite, wrap, feed, each sometimes left out or done twice). At the opening of
// a sentence it strikes, stalks first (freezes and feels for it, then
// strikes), stabs, or just snatches it up; on a word it may gulp, thrash it
// or stab again; at the close it may tear it loose, wrap it in silk, stomp it
// or chew. Each choice is drawn by weight, the weights set by its drives, and
// what it has just done weighs less (`NOVELTY`), so it keeps to a pattern
// without repeating itself. A clip that ends may lead on to another
// (`THEN`), the same way. A blow that lands (`HITS` in clips.js) is felt: the
// crawler says where and how hard (`impacts`), and is jolted.

import { between, clamp } from './util.js';

const DRIVE = {
  hunger: { grow: 1 / 50, word: 0.0045, prize: 0.008 }, // a second without food, a word, and a prize word
  fury: { cool: 0.12, prize: 0.16, surprise: 0.3, alarm: 0.45, hit: 0.018 },
  caution: { wear: 0.09, alarm: 0.6, landing: 0.12 },
  fatigue: { rest: 0.06, per: 0.05 }, // per second of a violent clip
};
// Its nature: what fury and caution settle back to, drawn for each crawler from these ranges, and wandering
// within them over a minute or so, so that no two sessions with it are alike and one is not the same throughout.
const NATURE = { fury: [0.08, 0.45], caution: [0, 0.25], wander: 0.012 };
const VIOLENT = new Set(['strike', 'thrash', 'tear', 'stab', 'stomp', 'threat', 'wrap']);
const NOVELTY = { keep: 4, weight: 0.35 }; // how many choices it remembers, and how much less a choice weighs for each time it is among them
// How a clip it makes over what it eats checks its pace: for `s` seconds it goes at `pace` of its gait. One that leaves
// its legs to walk on (a thrash, a stab, a gulp, a chew: the front legs and jaws) only slows it, and it eats on the move;
// one that takes its legs (a strike, a tear, a wrap, a stomp) stops it dead, briefly.
const CHECK = { strike: { s: 0.14, pace: 0 }, stalk: { s: 0.4, pace: 0 }, stab: { s: 0.3, pace: 0.6 }, thrash: { s: 0.55, pace: 0.4 }, tear: { s: 0.16, pace: 0 }, wrap: { s: 0.9, pace: 0 }, stomp: { s: 0.3, pace: 0 }, chew: { s: 0.6, pace: 0.5 }, gulp: { s: 0.25, pace: 0.75 } };
const WORD = { gulp: 0.16, thrash: 0.018, stab: 0.02, every: 4 }; // how likely a word sets off each, and how many words at least between two
const THEN = {
  strike: { thrash: (d) => 0.45 * d.fury, stab: () => 0.25, gulp: () => 0.5 },
  thrash: { tear: (d) => 0.6 * d.fury + 0.15, gulp: () => 0.4 },
  tear: { gulp: () => 0.6, stomp: (d) => 0.35 * d.fury, chew: (d) => 0.25 * d.fatigue },
  stab: { stab: () => 0.3, thrash: (d) => 0.3 * d.fury },
  wrap: { chew: () => 0.5, pluck: (d) => 0.4 * d.caution },
  stomp: { threat: (d) => 0.25 * d.fury },
  threat: { stomp: (d) => 0.4 + 0.4 * d.fury },
};
const NONE = 1; // the weight of doing nothing more, against what an end may lead on to
const PACE = { calm: 0.85, wild: 1.25 }; // how much slower or quicker a clip is made, from calm to furious
const AMP = { calm: 0.8, wild: 1.3 }; // and how much smaller or bigger

const draw = (weights) => {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  let pick = Math.random() * entries.reduce((sum, [, w]) => sum + w, 0);
  return entries.find(([, w]) => (pick -= w) < 0)?.[0] ?? null;
};

// `moves` is the crawler's catalog (moves.js); `clips` whether it has the clips keyed in Blender.
export function createTemper(moves, clips) {
  const nature = { fury: between(NATURE.fury), caution: between(NATURE.caution) };
  const drives = { hunger: 0.6, fury: nature.fury, caution: nature.caution, fatigue: 0 };
  const recent = []; // the latest choices, newest last
  let since = WORD.every; // words since a word set something off
  let thrashed = false; // whether it has thrashed what it is eating
  let queue = []; // clips to make: `{ name, in }`, `in` seconds from now
  let ending = new Map(); // a clip it is making → the seconds left of it, to know when it ends

  const fresh = (name) => NOVELTY.weight ** recent.filter((one) => one === name).length;
  function choose(weights) {
    const weighed = Object.fromEntries(Object.entries(weights).map(([name, w]) => [name, w * (name === 'none' ? 1 : fresh(name))]));
    const name = draw(weighed);
    if (name && name !== 'none') {
      recent.push(name);
      if (recent.length > NOVELTY.keep) recent.shift();
    }
    return name === 'none' ? null : name;
  }

  // How it makes a clip now: quicker and bigger the more furious, slower the more tired.
  const style = () => ({
    pace: (PACE.calm + (PACE.wild - PACE.calm) * drives.fury) * (1 - 0.2 * drives.fatigue) * between([0.92, 1.08]),
    amp: (AMP.calm + (AMP.wild - AMP.calm) * drives.fury) * between([0.9, 1.1]),
  });

  // Makes `name` now; says how it checks its pace for it, if it does.
  function make(name, angle) {
    if (!clips) return null;
    const made = moves.start(name, undefined, angle, style());
    if (made) ending.set(name, made.last);
    return made ? (CHECK[name] ?? null) : null;
  }
  // The harder of two checks: the slower, or the longer of two as slow.
  const harder = (a, b) => (!a ? b : !b ? a : a.pace !== b.pace ? (a.pace < b.pace ? a : b) : a.s > b.s ? a : b);

  return {
    drives,
    // How restless it is, 0 to 1, for its gait and idle moves.
    get mood() {
      return clamp(0.2 + 0.45 * drives.hunger + 0.5 * drives.fury - 0.35 * drives.fatigue + 0.25 * drives.caution, 0, 1);
    },

    // Time passes: the drives drift, what was queued is made, and a clip that ends may lead on to another.
    step(dt, angle, now) {
      drives.hunger = clamp(drives.hunger + DRIVE.hunger.grow * dt, 0, 1);
      for (const drive of ['fury', 'caution']) {
        nature[drive] = clamp(nature[drive] + (Math.random() - 0.5) * NATURE.wander * Math.sqrt(dt) * 4, ...NATURE[drive]);
        const back = drive === 'fury' ? DRIVE.fury.cool : DRIVE.caution.wear;
        drives[drive] += (nature[drive] - drives[drive]) * Math.min(back * dt * 3, 1);
      }
      const violent = [...ending.keys()].some((name) => VIOLENT.has(name) && moves.has(name));
      drives.fatigue = clamp(drives.fatigue + (violent ? DRIVE.fatigue.per : -DRIVE.fatigue.rest) * dt, 0, 1);
      let check = null;
      for (const [name, left] of ending) {
        if (left - dt > 0 && moves.has(name)) {
          ending.set(name, left - dt);
          continue;
        }
        ending.delete(name);
        if (now !== 'feeding' && now !== 'standing') continue;
        const next = choose({ ...Object.fromEntries(Object.entries(THEN[name] ?? {}).map(([then, weight]) => [then, weight(drives)])), none: NONE });
        if (next) queue.push({ name: next, in: between([0.02, 0.12]) });
      }
      for (const one of queue) one.in -= dt;
      for (const one of queue.filter((one) => one.in <= 0)) check = harder(check, make(one.name, angle));
      queue = queue.filter((one) => one.in > 0);
      // Hauling a subject of its web, it leans into it with its front legs locked on.
      if (clips && now === 'towing' && !moves.has('drag')) moves.start('drag', undefined, angle);
      return now === 'feeding' || now === 'standing' ? check : null;
    },

    // It comes to the opening of a sentence of the given `worth`, a `surprise`
    // or not: how it takes it. Says how that checks its pace.
    open({ worth, surprise }, angle) {
      thrashed = false;
      since = WORD.every;
      if (surprise) drives.fury = clamp(drives.fury + DRIVE.fury.surprise, 0, 1);
      if (worth === 'prize') drives.fury = clamp(drives.fury + DRIVE.fury.prize, 0, 1);
      const prize = worth === 'prize' ? 1 : 0;
      const how = choose({
        strike: 1 + 2 * drives.fury + drives.hunger + 2 * prize,
        stalk: 3 * drives.caution + 1.2 * prize + 0.3 - drives.hunger,
        stab: 0.6 + drives.hunger,
        snatch: 0.8 + 2 * drives.hunger - drives.fury - prize,
      });
      if (how === 'stalk') {
        // It freezes, feels for it, then strikes.
        moves.start('freeze', 0.3, angle);
        moves.start('drum', 0.3, angle);
        queue.push({ name: 'strike', in: 0.3 });
        return CHECK.stalk;
      }
      if (how === 'snatch' || !how) return null;
      return make(how, angle);
    },

    // A word of the given `worth` goes down, the `at`th of a sentence of `of`. Says how what that sets off checks its pace.
    word(worth, at, of, angle) {
      drives.hunger = clamp(drives.hunger - (worth === 'prize' ? DRIVE.hunger.prize : DRIVE.hunger.word), 0, 1);
      since += 1;
      if (since < WORD.every || moves.has('strike') || moves.has('thrash')) return null;
      const left = of - at;
      const what = choose({
        gulp: WORD.gulp * (0.6 + drives.hunger),
        thrash: !thrashed && left > 4 ? WORD.thrash * (1 + 3 * drives.fury) * (worth === 'prize' ? 2.5 : 1) : 0,
        stab: left > 2 ? WORD.stab * (1 + drives.fury) : 0,
        none: 1,
      });
      if (!what) return null;
      since = 0;
      if (what === 'thrash') thrashed = true;
      return make(what, angle);
    },

    // It has the whole of a sentence of the given `worth`: how it finishes it. Says how that checks its pace.
    close({ worth }, angle) {
      const prize = worth === 'prize' ? 1 : 0;
      const how = choose({
        tear: 0.35 + 0.6 * drives.fury + 0.3 * prize,
        wrap: prize * 0.7 * (1 - drives.hunger) * (1 - drives.fatigue),
        stomp: 0.25 * drives.fury,
        chew: 0.2 * (1 - drives.fury) + 0.3 * drives.fatigue,
        none: 1 - 0.4 * drives.fury,
      });
      return how ? make(how, angle) : null;
    },

    // Its web is shaken: it rears in threat, angrier and warier.
    alarm(angle) {
      drives.fury = clamp(drives.fury + DRIVE.fury.alarm, 0, 1);
      drives.caution = clamp(drives.caution + DRIVE.caution.alarm, 0, 1);
      recent.push('threat');
      make('threat', angle);
    },

    // A blow it struck landed.
    hit() {
      drives.fury = clamp(drives.fury + DRIVE.fury.hit, 0, 1);
    },

    // It pounced on the opening of a sentence of the given `worth` and landed claws in: the pounce was its strike, and this is what it does next. Says how that checks its pace.
    pounced({ worth, surprise }, angle) {
      thrashed = false;
      since = WORD.every;
      if (surprise) drives.fury = clamp(drives.fury + DRIVE.fury.surprise, 0, 1);
      if (worth === 'prize') drives.fury = clamp(drives.fury + DRIVE.fury.prize, 0, 1);
      recent.push('strike');
      if (recent.length > NOVELTY.keep) recent.shift();
      const next = choose({ ...Object.fromEntries(Object.entries(THEN.strike).map(([then, weight]) => [then, weight(drives)])), none: NONE });
      return next ? make(next, angle) : null;
    },

    // It landed from a jump.
    landed() {
      drives.caution = clamp(drives.caution + DRIVE.caution.landing, 0, 1);
    },

    // What it has done of late, newest last.
    get recent() {
      return recent;
    },
  };
}
