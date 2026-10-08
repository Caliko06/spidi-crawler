// What the crawler does with its body besides getting there: a catalog of
// small moves, each using some parts of it and leaving the rest alone, so that
// any that use different parts can go on at once. A groom takes the front
// legs and the feelers; a wag takes only the abdomen; a rock takes only the
// lean of the body. Standing or walking, it draws from the catalog every so
// often (up to `MOST` at once), so what it does is a different mixture each
// time, not one thing from a list. No two are alike: each time a move is made
// it is a little bigger or smaller, quicker or slower (`amp`, `pace`); some
// lead on to another (`then`); and which it picks depends on its mood, the
// restless doing the quick ones and the calm the slow. A move is a
// description: `pose` is asked each step how far into it it is and says, in
// `fx`, where its parts are to be. The crawler (crawler.js) reads `fx` and
// moves the parts there; nothing here knows of a leg's joints or the page.
//
// Lengths are in the units of the crawler's measures at size 1, along the
// body from the middle of its thorax and out to the side of the leg that
// is moved (negative across the middle). Parts:
//   leg0 … leg7  a leg, two to a pair, front pair first, left then right
//   feelers      both palps
//   jaws         both jaws and their fangs
//   spinnerets   the pair at the tail
//   turn         which way it faces
//   height       how high or low the body stands
//   tilt         how its body leans, head up or down, rolled
//   abdomen      how it hangs and swings off the thorax
//
// `fx` is: `leg[i]` `{ up, along, out, z }` (`up` 0 to 1 is how far the leg is
// held from the page toward there), `feeler(side)` `{ along, out }` from the
// head, `jaw` radians, `face` an angle, and, to be added to, `crouch` 0 to 1,
// `rise` units, `pitch` and `roll` radians, `side` and `up` of the abdomen in
// units, `spin` how far the spinnerets are turned out, 0 to 1.

import { between, clamp } from './util.js';

const MOST = 3; // moves at once
const GAP = [0.4, 1.4]; // seconds between one draw from the catalog and the next
const AFTER = 0.45; // seconds standing before it starts to do something
const ATTACK = 0.18; // seconds a move takes to come on, and to go off when what it needs stops
const VARY = { amp: [0.75, 1.25], pace: [0.8, 1.25] }; // how much bigger or smaller, and quicker or slower, one making of a move is than another
const AGAIN = [1, 3]; // seconds after a move, on top of its own length, before it may come up again
const ease = (t) => t * t * (3 - 2 * t);

const side = (i) => (i & 1 ? 1 : -1);
const FRONT = [0, 1];
const legs = (...which) => which.map((i) => `leg${i}`);
const oneOf = (...of) => of[Math.floor(Math.random() * of.length)];
// A rate that is high when the crawler is restless (`mood` 1) and low when calm (0), or the other way about.
const when = (calm, wild) => (mood) => calm + (wild - calm) * mood;

// Each move: `on` when it may begin, from `standing`, `walking` and `alarm`; `often` against the others, or how often given its mood;
// `last` seconds it lasts; `uses` the parts it takes; `begin` anything it is to pick for itself, and `claims` the legs that is; `then` what it may lead on to, and how likely;
// `pose(move, fx, rest, clock)`, where `move.t` is the seconds in, `move.env` how fully it is on, from 0 to 1, with its size
// `move.amp` and its pace `move.pace` made into it, and `rest[i]` where leg i rests, `{ along, out }`.
// A move with no `often` is only begun by the crawler, for a reason.
export const MOVES = {
  // A front leg, then the other, wiped through the jaws, the feelers drawn in.
  groom: {
    on: ['standing'], often: when(4, 1.5), last: [1, 2.4], uses: [...legs(...FRONT), 'feelers'], then: { drum: 0.2 },
    pose({ env, pace }, fx, rest, clock) {
      for (const i of FRONT) fx.leg[i] = { up: (Math.sin(clock * 7 * pace) * side(i) > 0 ? 1 : 0) * env, along: 9, out: 2.5, z: 5 };
      fx.feeler = (s) => ({ along: 10, out: 1.5 + Math.sin(clock * 14 + s) });
    },
  },
  // The front legs feel the page, one then the other.
  tap: {
    on: ['standing'], often: when(1.5, 2.5), last: [1, 2.4], uses: legs(...FRONT),
    pose({ env, pace, amp }, fx, rest, clock) {
      for (const i of FRONT) fx.leg[i] = { up: Math.max(Math.sin(clock * 16 * pace + side(i) * 1.6), 0) * 0.35 * env, along: rest[i].along + 4 * amp, out: rest[i].out, z: 7 };
    },
  },
  // It looks round, one way and back.
  scan: {
    on: ['standing'], often: 3, last: [1, 2.4], uses: ['turn'], then: { sniff: 0.15 },
    begin: () => ({ turn: between([0.4, 0.9]) * (Math.random() < 0.5 ? -1 : 1) }),
    pose(move, fx) {
      fx.face = move.from + move.turn * move.amp * Math.sin((Math.PI * move.t) / move.last);
    },
  },
  // Up on its hind legs, front legs high and jaws wide, the feelers spread.
  rear: {
    on: ['standing', 'alarm'], often: 1, last: [1, 2.4], uses: [...legs(0, 1, 2, 3), 'feelers', 'jaws'], then: { hiss: 0.3 },
    pose({ env }, fx, rest) {
      for (const i of [0, 1, 2, 3]) fx.leg[i] = { up: (i < 2 ? 1 : 0.55) * env, along: rest[i].along + 12, out: rest[i].out * 0.8, z: 16 };
      fx.feeler = () => ({ along: 15, out: 9 });
      fx.jaw = 1;
    },
  },
  // One front leg raised high and waved slowly, as at someone.
  wave: {
    on: ['standing'], often: when(2.5, 1), last: [1.4, 2.6], uses: [],
    begin: () => ({ leg: oneOf(0, 1) }),
    claims: (move) => legs(move.leg),
    pose({ leg, env, pace, amp }, fx, rest, clock) {
      fx.leg[leg] = { up: env, along: rest[leg].along + 6, out: rest[leg].out * (0.7 + 0.35 * amp * Math.sin(clock * 6 * pace)), z: 21 };
    },
  },
  // It rises and sinks on its legs as if pressing up from the page, a few times.
  pump: {
    on: ['standing'], often: when(0.6, 2), last: [1.2, 2.2], uses: ['height'],
    pose({ env, t, pace, amp }, fx) {
      fx.rise += Math.max(Math.sin(t * 11 * pace), 0) ** 1.5 * 2.2 * amp * env;
      fx.crouch += Math.max(-Math.sin(t * 11 * pace), 0) * 0.2 * env;
    },
  },
  // The abdomen swung side to side.
  wag: {
    on: ['standing', 'walking'], often: when(1, 3), last: [0.9, 2], uses: ['abdomen'],
    pose({ env, t, pace, amp }, fx) {
      fx.side += Math.sin(t * 13 * pace) * 3.2 * amp * env;
    },
  },
  // A hind leg stretched out behind, slowly, with the abdomen lifted.
  stretch: {
    on: ['standing'], often: when(2, 0.5), last: [1.6, 3], uses: ['abdomen'],
    begin: () => ({ leg: oneOf(6, 7) }),
    claims: (move) => legs(move.leg),
    pose({ leg, env, t, pace, amp }, fx, rest) {
      fx.leg[leg] = { up: env * (0.8 + 0.2 * Math.sin(t * 3 * pace)), along: rest[leg].along - 17 * amp, out: rest[leg].out * 1.1, z: 6 };
      fx.up += 2.2 * env;
    },
  },
  // The feelers drum on the page ahead of it, fast.
  drum: {
    on: ['standing'], often: when(0.8, 2), last: [0.8, 1.8], uses: ['feelers'],
    pose({ pace }, fx, rest, clock) {
      fx.feeler = (s) => ({ along: 9 + Math.max(Math.sin(clock * 30 * pace + s * 1.7), 0) * 3, out: 3 });
    },
  },
  // A hind leg lifted over the abdomen and rubbed against it.
  preen: {
    on: ['standing'], often: when(2.5, 0.8), last: [1.4, 2.6], uses: [],
    begin: () => ({ leg: oneOf(6, 7) }),
    claims: (move) => legs(move.leg),
    pose({ leg, env, pace, amp }, fx, rest, clock) {
      fx.leg[leg] = { up: env, along: -10 + Math.sin(clock * 12 * pace) * 3 * amp, out: 4.5, z: 8.5 };
    },
  },
  // It turns on the spot, a good way round, and settles facing there.
  pivot: {
    on: ['standing'], often: when(0.5, 1.5), last: [0.5, 0.9], uses: ['turn'],
    begin: () => ({ turn: between([0.7, 1.5]) * (Math.random() < 0.5 ? -1 : 1) }),
    pose(move, fx) {
      fx.face = move.from + move.turn * move.amp * ease(clamp(move.t / (move.last * 0.8), 0, 1));
    },
  },
  // It flattens to the page and holds still, then comes slowly up.
  freeze: {
    on: ['standing'], often: when(2, 0.3), last: [1.2, 2.4], uses: ['height'],
    pose({ env }, fx) {
      fx.crouch += 0.9 * env;
    },
  },
  // Its head thrown up as it sniffs, the feelers held high.
  sniff: {
    on: ['standing'], often: 1.2, last: [1, 2], uses: ['tilt'], then: { drum: 0.3 },
    pose({ env, t, pace, amp }, fx) {
      fx.pitch += (0.3 * amp + 0.05 * Math.sin(t * 9 * pace)) * env;
    },
  },
  // It rocks from side to side on its legs.
  rock: {
    on: ['standing'], often: when(0.8, 1.6), last: [1.2, 2.2], uses: ['tilt'],
    pose({ env, t, pace, amp }, fx) {
      fx.roll += Math.sin(t * 5 * pace) * 0.12 * amp * env;
    },
  },
  // The abdomen trembles.
  shiver: {
    on: ['standing'], often: 0.8, last: [0.5, 1.1], uses: ['abdomen'],
    pose({ env, t, pace }, fx) {
      fx.side += Math.sin(t * 60 * pace) * 1.2 * env;
      fx.up += Math.sin(t * 47 * pace) * 0.8 * env;
    },
  },
  // The jaws chatter.
  chatter: {
    on: ['standing', 'walking'], often: when(0.6, 1.6), last: [0.5, 1.2], uses: ['jaws'],
    pose({ env, t, pace, amp }, fx) {
      fx.jaw = 0.3 + (0.5 + 0.4 * Math.sin(t * 40 * pace)) * 0.4 * amp * env;
    },
  },
  // The spinnerets work, as if it would spin.
  twitch: {
    on: ['standing'], often: 0.8, last: [0.6, 1.4], uses: ['spinnerets'],
    pose({ env, t, pace, amp }, fx) {
      fx.spin = Math.max(fx.spin, (0.5 + 0.5 * Math.sin(t * 14 * pace)) * 0.7 * amp * env);
    },
  },
  // Its front legs stamped on the page, one then the other, twice.
  stomp: {
    on: ['standing'], often: when(0.3, 1.6), last: [0.6, 1], uses: legs(...FRONT),
    pose({ env, t, pace }, fx, rest) {
      for (const i of FRONT) fx.leg[i] = { up: Math.max(Math.sin(t * 20 * pace + (i ? Math.PI : 0)), 0) * env, along: rest[i].along + 5, out: rest[i].out * 0.9, z: 9 };
    },
  },
  // Crouched low with its jaws open and its front legs up, fangs bare.
  hiss: {
    on: ['standing'], often: when(0.2, 0.7), last: [0.7, 1.3], uses: [...legs(0, 1), 'jaws', 'height', 'tilt'],
    pose({ env, t, pace }, fx, rest) {
      for (const i of FRONT) fx.leg[i] = { up: env, along: rest[i].along + 10, out: rest[i].out * 1.3, z: 12 };
      fx.jaw = 1;
      fx.crouch += 0.5 * env;
      fx.pitch += 0.2 * env;
      fx.side += Math.sin(t * 30 * pace) * 0.6 * env;
    },
  },
  // On the move, the feelers flicked out wide.
  flick: {
    on: ['walking'], often: 1.5, last: [0.3, 0.6], uses: ['feelers'],
    pose({ env, t, pace }, fx) {
      fx.feeler = () => ({ along: 15 + 3 * Math.sin(t * 20 * pace) * env, out: 5 + 7 * env });
    },
  },
  // On the move, a front leg held out ahead to feel what is there.
  probe: {
    on: ['walking'], often: 1.5, last: [0.5, 1.1], uses: [],
    begin: () => ({ leg: oneOf(0, 1) }),
    claims: (move) => legs(move.leg),
    pose({ leg, env, pace }, fx, rest, clock) {
      fx.leg[leg] = { up: env, along: rest[leg].along + 14, out: rest[leg].out * 0.6 + Math.sin(clock * 9 * pace) * 2, z: 4 };
    },
  },
  // On the move, its head held up, curious, and cocked to one side.
  curious: {
    on: ['walking'], often: 1, last: [0.8, 1.6], uses: ['tilt'],
    begin: () => ({ cock: oneOf(-1, 1) }),
    pose({ cock, env, amp }, fx) {
      fx.pitch += 0.22 * amp * env;
      fx.roll += cock * 0.1 * env;
    },
  },
  // On the move, springing a little at every stride.
  bounce: {
    on: ['walking'], often: when(0.4, 1.8), last: [0.8, 1.6], uses: ['height'],
    pose({ env, t, pace, amp }, fx) {
      fx.rise += Math.abs(Math.sin(t * 9 * pace)) * 1.2 * amp * env;
    },
  },
  // Its jaws drawn wide, slowly, its head thrown back, and held, as in a yawn.
  yawn: {
    on: ['standing'], often: when(1.2, 0.3), last: [1.6, 2.6], uses: ['jaws', 'tilt'],
    pose({ env, t, last, amp }, fx) {
      const open = Math.sin(Math.PI * Math.min(t / last, 1)) ** 0.6;
      fx.jaw = 0.3 + 1 * open * env * Math.min(amp, 1.1);
      fx.pitch += 0.2 * open * env;
    },
  },
  // It leans forward over the page, head down, as if to read what is under it, and back.
  peer: {
    on: ['standing'], often: when(1.5, 0.6), last: [1.1, 2], uses: ['lean', 'tilt', 'feelers'],
    pose({ env, t, last, amp }, fx) {
      const lean = Math.sin(Math.PI * Math.min(t / last, 1)) ** 0.8 * env;
      fx.lean.along += 4.5 * amp * lean;
      fx.pitch -= 0.16 * lean;
      fx.crouch += 0.25 * lean;
      fx.feeler = (s) => ({ along: 11 + 3 * lean, out: 1.8 + Math.sin(t * 22 + s) * 0.6 });
    },
  },
  // A quick shuffle sideways on its feet, one way and the other, as if the ground were hot.
  skitter: {
    on: ['standing'], often: when(0.4, 1.5), last: [0.5, 0.9], uses: ['lean', 'tilt'],
    pose({ env, t, pace, amp }, fx) {
      fx.lean.out += Math.sin(t * 22 * pace) * 2.6 * amp * env;
      fx.roll += Math.sin(t * 22 * pace + 1.2) * 0.1 * env;
      fx.yaw += Math.sin(t * 22 * pace + 0.6) * 0.12 * env;
    },
  },
  // Front legs stretched out low ahead and its chest dipped, like a cat's bow, then up.
  bow: {
    on: ['standing'], often: when(1.2, 0.4), last: [1.2, 2], uses: [...legs(...FRONT), 'height', 'tilt'],
    pose({ env, t, last }, fx, rest) {
      const bow = Math.sin(Math.PI * Math.min(t / last, 1)) ** 0.7 * env;
      for (const i of FRONT) fx.leg[i] = { up: env, along: rest[i].along + 12 * bow, out: rest[i].out * (1 + 0.15 * bow), z: 1.2 };
      fx.pitch -= 0.26 * bow;
      fx.crouch += 0.3 * bow;
      fx.up += 3 * bow;
    },
  },
  // A courtship dance, to no one: front legs raised and waved in turn, the body swaying, the abdomen wagging.
  dance: {
    on: ['standing'], often: when(0.4, 1.2), last: [1.6, 2.8], uses: [...legs(...FRONT), 'tilt', 'abdomen', 'lean'],
    pose({ env, t, pace, amp }, fx, rest) {
      const rate = 8 * pace;
      for (const i of FRONT) fx.leg[i] = { up: env, along: rest[i].along + 7 + 3 * Math.sin(t * rate + side(i) * 1.7), out: rest[i].out * (0.85 + 0.35 * Math.max(Math.sin(t * rate * 0.5 + (i ? Math.PI : 0)), 0)), z: 12 + 6 * Math.max(Math.sin(t * rate * 0.5 + (i ? Math.PI : 0)), 0) };
      fx.roll += Math.sin(t * rate * 0.5) * 0.14 * amp * env;
      fx.lean.out += Math.sin(t * rate * 0.5) * 1.8 * amp * env;
      fx.side += Math.sin(t * rate) * 2.4 * amp * env;
      fx.rise += Math.abs(Math.sin(t * rate * 0.5)) * 0.9 * env;
    },
  },
  // A feint: a short lunge forward with the jaws wide, and back, as if testing the page.
  feint: {
    on: ['standing'], often: when(0.3, 1.4), last: [0.5, 0.8], uses: ['lean', 'jaws', 'tilt'],
    pose({ env, t, last, amp }, fx) {
      const lunge = Math.sin(Math.PI * Math.min(t / last, 1)) ** 1.5 * env;
      fx.lean.along += 7 * amp * lunge;
      fx.pitch -= 0.2 * lunge;
      fx.jaw = 0.4 + 0.9 * lunge;
    },
  },
  // Each front and second leg lifted in turn and set down ahead, feeling the page, like fingers drumming.
  fingers: {
    on: ['standing'], often: when(1, 1.2), last: [1.2, 2], uses: legs(0, 1, 2, 3),
    pose({ env, pace }, fx, rest, clock) {
      for (const i of [0, 1, 2, 3]) {
        const phase = Math.sin(clock * 12 * pace - (i >> 1) * 1.1 - (i & 1) * 2.2);
        fx.leg[i] = { up: Math.max(phase, 0) * env, along: rest[i].along + 3.5 * Math.max(phase, 0), out: rest[i].out, z: 4 };
      }
    },
  },
  // One leg flicked quickly, as if shaking something off it.
  flick_leg: {
    on: ['standing', 'walking'], often: when(0.8, 0.8), last: [0.4, 0.7], uses: [],
    begin: () => ({ leg: oneOf(2, 3, 4, 5, 6, 7) }),
    claims: (move) => legs(move.leg),
    pose({ leg, env, t, pace }, fx, rest) {
      fx.leg[leg] = { up: env, along: rest[leg].along + Math.sin(t * 40 * pace) * 4, out: rest[leg].out * 1.25, z: 7 };
    },
  },
  // Both hind legs rubbed against the abdomen in turn.
  scrub: {
    on: ['standing'], often: when(1.2, 0.4), last: [1.4, 2.4], uses: legs(6, 7),
    pose({ env, pace, amp }, fx, rest, clock) {
      for (const i of [6, 7]) fx.leg[i] = { up: env, along: -9 + Math.sin(clock * 11 * pace + i * 2.1) * 3 * amp, out: 4.2, z: 8.2 };
    },
  },
  // On the move, springing high and low in a gait that is nearly a gallop, its body swaying.
  gallop: {
    on: ['walking'], often: when(0.3, 1.5), last: [0.8, 1.4], uses: ['height', 'lean', 'tilt'],
    pose({ env, t, pace, amp }, fx) {
      fx.rise += Math.abs(Math.sin(t * 7 * pace)) * 1.6 * amp * env;
      fx.lean.out += Math.sin(t * 7 * pace) * 1.4 * env;
      fx.roll += Math.sin(t * 7 * pace + 1) * 0.08 * env;
    },
  },
  // On the move, low and creeping, as if stalking.
  creep: {
    on: ['walking'], often: when(1.4, 0.2), last: [1, 1.8], uses: ['height', 'tilt'],
    pose({ env }, fx) {
      fx.crouch += 0.5 * env;
      fx.pitch -= 0.08 * env;
    },
  },
  // On the move, its head jerked to one side, and back, at something it saw.
  glance: {
    on: ['walking'], often: when(0.6, 1.6), last: [0.35, 0.6], uses: ['tilt'],
    begin: () => ({ cock: oneOf(-1, 1) }),
    pose({ cock, env, t, last }, fx) {
      fx.yaw += cock * 0.42 * Math.sin(Math.PI * Math.min(t / last, 1)) * env;
      fx.pitch += 0.1 * env;
    },
  },
  // Standing, its abdomen lifted and pulsed as if spinning silk, the spinnerets working.
  pulse: {
    on: ['standing'], often: when(0.6, 0.6), last: [1, 1.8], uses: ['abdomen', 'spinnerets'],
    pose({ env, t, pace }, fx) {
      fx.up += (1.6 + 1.1 * Math.sin(t * 9 * pace)) * env;
      fx.spin = Math.max(fx.spin, (0.4 + 0.4 * Math.sin(t * 9 * pace)) * env);
    },
  },
  // Each leg stretched out wide in turn, front to rear, as knuckles are cracked, and drawn in again.
  flex: {
    on: ['standing'], often: when(1.1, 0.5), last: [1.6, 2.4], uses: legs(0, 1, 2, 3, 4, 5, 6, 7),
    pose({ env, t, pace, amp }, fx, rest) {
      for (let i = 0; i < 8; i++) {
        const phase = Math.max(Math.sin((t * 4.2 * pace - (i >> 1) * 1.05) * 1), 0);
        if (phase > 0) fx.leg[i] = { up: phase * env, along: rest[i].along * (1 + 0.28 * amp * phase), out: rest[i].out * (1 + 0.45 * amp * phase), z: 1.5 + 2.5 * phase };
      }
    },
  },
  // Up on its toes, slowly, the whole body raised on its stretched legs, and back down.
  tiptoe: {
    on: ['standing'], often: when(1, 0.5), last: [1.3, 2.2], uses: ['height'],
    pose({ env, t, last, amp }, fx) {
      const up = Math.sin(Math.PI * Math.min(t / last, 1)) ** 0.7 * env;
      fx.rise += 3.6 * amp * up;
      fx.pitch += 0.1 * up;
    },
  },
  // A shrug: both sides of its body lifted and dropped in turn, quickly, twice.
  shrug: {
    on: ['standing'], often: when(0.5, 1.1), last: [0.6, 1], uses: ['tilt', 'height'],
    pose({ env, t, pace, amp }, fx) {
      fx.roll += Math.sin(t * 14 * pace) * 0.15 * amp * env;
      fx.rise += Math.abs(Math.sin(t * 7 * pace)) * 1.5 * amp * env;
    },
  },
  // Its head nodded in time, hard, as to something only it hears.
  headbang: {
    on: ['standing'], often: when(0.15, 0.6), last: [1.2, 2], uses: ['tilt', 'abdomen'],
    pose({ env, t, pace, amp }, fx) {
      const beat = Math.sin(t * 13 * pace);
      fx.pitch += (0.2 * beat - 0.04) * amp * env;
      fx.up += Math.max(-beat, 0) * 2.2 * env;
    },
  },
  // One front leg thrown straight up and held a moment, as a salute, then down.
  salute: {
    on: ['standing'], often: when(0.8, 0.4), last: [1, 1.6], uses: [],
    begin: () => ({ leg: oneOf(0, 1) }),
    claims: (move) => legs(move.leg),
    pose({ leg, env, t, last }, fx, rest) {
      const held = Math.sin(Math.PI * Math.min(t / last, 1)) ** 0.4;
      fx.leg[leg] = { up: held * env, along: rest[leg].along * 0.55, out: rest[leg].out * 0.4, z: 24 };
    },
  },
  // Its front legs jabbed forward in turn, quick, at nothing, like a boxer.
  shadowbox: {
    on: ['standing'], often: when(0.15, 1.4), last: [0.8, 1.5], uses: [...legs(...FRONT), 'tilt'],
    pose({ env, t, pace }, fx, rest) {
      for (const i of FRONT) {
        const jab = Math.max(Math.sin(t * 15 * pace + (i ? Math.PI : 0)), 0) ** 2;
        fx.leg[i] = { up: env, along: rest[i].along + 4 + 11 * jab, out: rest[i].out * 0.6, z: 7 + 2 * jab };
      }
      fx.pitch += 0.12 * env;
      fx.roll += Math.sin(t * 7.5 * pace) * 0.1 * env;
    },
  },
  // It leans out to one side over its feet, the far legs reaching, as if it would sidestep, and back.
  sidle: {
    on: ['standing', 'walking'], often: when(0.8, 0.8), last: [0.7, 1.3], uses: ['lean', 'tilt'],
    begin: () => ({ way: oneOf(-1, 1) }),
    pose({ way, env, t, last, amp }, fx) {
      const lean = Math.sin(Math.PI * Math.min(t / last, 1)) * env;
      fx.lean.out += way * 3.2 * amp * lean;
      fx.roll += way * 0.12 * lean;
      fx.yaw += way * 0.08 * lean;
    },
  },
  // It settles low and still, its legs a little drawn in, and breathes, as a spider at rest does.
  settle: {
    on: ['standing'], often: when(1.6, 0.1), last: [2.4, 4], uses: ['height'],
    pose({ env, t }, fx) {
      fx.crouch += 0.65 * env;
      fx.rise += Math.sin(t * 2.2) * 0.35 * env;
    },
  },
  // Shaking itself, as after a fall or a feed: all of it trembles at once. Only when something has happened.
  shake: {
    on: ['standing', 'walking'], last: [0.35, 0.55], uses: ['abdomen', 'height', 'tilt'],
    pose({ env, t, pace }, fx) {
      fx.side += Math.sin(t * 50 * pace) * 2 * env;
      fx.up += Math.sin(t * 41 * pace) * 1.2 * env;
      fx.roll += Math.sin(t * 38 * pace) * 0.08 * env;
      fx.rise += Math.abs(Math.sin(t * 29 * pace)) * 0.5 * env;
    },
  },
};

// `extra` are more moves for the catalog: the clips keyed in Blender (clips.js).
export function createMoves(extra = {}) {
  const catalog = { ...MOVES, ...extra };
  // The parts a move holds: what it says it uses, and the legs it picked for itself.
  const holds = (move) => [...catalog[move.name].uses, ...(catalog[move.name].claims?.(move) ?? [])];
  const weight = (name, mood) => {
    const often = catalog[name].often;
    return typeof often === 'function' ? often(mood) : (often ?? 0);
  };
  let active = [];
  let gap = between(GAP);
  let idle = 0;
  const cool = new Map(); // seconds before a move may come up again

  // Makes `name` as it is made this time, and keeps it if what it holds is free, which it says.
  function make(name, seconds, angle, taken, style) {
    const made = { name, t: 0, last: seconds ?? between(catalog[name].last), env: 0, from: angle, amp: between(VARY.amp), pace: between(VARY.pace), ...style, ...catalog[name].begin?.() };
    if (catalog[name].clip && !seconds) made.last /= made.pace; // a clip lasts as long as it plays
    if (taken && holds(made).some((part) => taken.has(part))) return null;
    active.push(made);
    cool.set(name, made.last + between(AGAIN));
    return made;
  }

  // `now` says what it is up to: `standing`, `walking`, `alarm`, or nothing (in the air, feeding, regarding).
  // `angle` is the way it faces and `mood` how restless it is, 0 to 1. Writes where the parts are to be into `fx`.
  function step(dt, now, angle, clock, rest, fx, mood) {
    idle = now === 'standing' ? idle + dt : 0;
    for (const [name, left] of cool) cool.set(name, left - dt);
    for (const [name, left] of cool) if (left <= 0) cool.delete(name);

    const ended = [];
    for (const move of active) {
      move.t += dt;
      // What it needed has stopped: it lets go of it quickly.
      if (!catalog[move.name].on.includes(now) && move.last > move.t + ATTACK) move.last = move.t + ATTACK;
      if (move.t >= move.last && catalog[move.name].on.includes(now)) ended.push(move);
    }
    active = active.filter((move) => move.t < move.last);
    // Some lead on to another.
    for (const move of ended) for (const [name, likely] of Object.entries(catalog[move.name].then ?? {})) if (Math.random() < likely) begin(now, angle, mood, name);

    if ((now === 'walking' || (now === 'standing' && idle >= AFTER)) && (gap -= dt) <= 0) {
      gap = between(GAP);
      if (active.length < MOST) begin(now, angle, mood);
    }

    for (const move of active) {
      move.env = ease(clamp(Math.min(move.t / ATTACK, (move.last - move.t) / ATTACK, 1), 0, 1));
      catalog[move.name].pose(move, fx, rest, clock);
    }
  }

  // Draws one it may do now alongside what it is doing, or makes `only`, if it may.
  function begin(now, angle, mood, only) {
    const taken = new Set(active.flatMap(holds));
    const names = Object.keys(catalog).filter((name) => (only ? name === only : weight(name, mood) > 0) && catalog[name].on.includes(now) && !active.some((move) => move.name === name) && (only || !cool.has(name)) && !catalog[name].uses.some((part) => taken.has(part)));
    let pick = Math.random() * names.reduce((sum, name) => sum + (only ? 1 : weight(name, mood)), 0);
    const name = names.find((each) => (pick -= only ? 1 : weight(each, mood)) < 0);
    if (name) make(name, undefined, angle, taken);
  }

  return {
    step,
    // Drops everything it is doing.
    clear() {
      active = [];
      gap = between(GAP);
    },
    // Begins `name` at once for `seconds` (or as long as it lasts), dropping anything that uses what it needs;
    // `style` may set how big and how quick it is made, `{ amp, pace }`. Gives the move as it is made.
    start(name, seconds, angle, style) {
      const wants = holds({ name });
      active = active.filter((move) => move.name !== name && !holds(move).some((part) => wants.includes(part)));
      return make(name, seconds, angle, null, style);
    },
    // Whether `name` is being made.
    has(name) {
      return active.some((move) => move.name === name);
    },
    get active() {
      return active.map((move) => move.name);
    },
  };
}
