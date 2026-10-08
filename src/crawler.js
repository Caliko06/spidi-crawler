// The crawler's body in motion: a head that walks a route, a short spine that
// follows it, eight legs that step to keep up and two feelers that sweep ahead.
// Pure simulation in document coordinates; it knows nothing of text or the DOM.
// The body moves over the page in x and y; it and its legs also have a height
// above it, z.
//
// It goes where it is sent, but how is its own: its mood drifts between
// restless and calm, and it runs in bursts, freezing and darting off at a pace
// it picks each time. It feeds in bites: a strike at the start of a sentence,
// front legs clawing at the word under its jaws, a jerk as each word goes down
// and a yank as a sentence is torn loose. It eats on the move: what it does to a
// word slows it, and only a blow that takes its legs stops it.
//
// A long leg of its route it may cross another way, with a rest between
// (`SPARE`), never a short one: a leap, a zip down a cord it shoots, or a
// swing round a thread hooked on the corner of a text block. Each begins by
// looking where it is going (`SCOUT`), throwing its head up and rearing its
// front legs, and ends with a landing that skids and that the web feels.
//
// Standing it is never idle, and nor is it when it walks: it draws from a
// catalog of small moves (moves.js), each using some of its parts, and
// several at once if they use different ones. It can be made to stop and
// regard something, to hop where it is, and when the web it stands on is
// shaken it freezes, turns on the shaking and rears.

import { clipMoves } from './clips.js';
import { createAgency } from './agency.js';
import { createHeed } from './heed.js';
import { createMoves } from './moves.js';
import { createTemper } from './temper.js';
import { between, clamp } from './util.js';

export const SIZE = 1.5; // how large the crawler is, against the 1.0 its measures below are given at

// Head first: head, thorax, abdomen, tail. The gap from each joint to the next.
const SPINE_GAP = [7, 10, 8].map((gap) => gap * SIZE);
const GIRTH = [3.2, 5.9, 5.5, 3.6].map((radius) => radius * SIZE); // px each joint takes up to either side, on an empty stomach
const SWELL = [0, 0, 1.3, 1].map((radius) => radius * SIZE); // and how much more once it is full
// How far, in radians, the spine bends at the thorax (the waist, between the
// head end and the abdomen) and at the abdomen, which is one rigid piece: the
// body turns as a whole, its abdomen swung round the waist, never left behind.
const BEND = [0.32, 0.06];
export const PEDICEL = 4.8 * SIZE; // px behind the thorax joint where head end and abdomen meet, the waist its head end pitches about

// How it moves over each kind of ground. A waypoint names the gait used to reach it.
// `bursts` when it goes in fits and starts, `leap` how likely it is to jump a
// leg of its route that is long enough.
// `bursts` how it goes in fits and starts, if it does; `leap` and `swing` how
// likely it is to jump, swing or zip a leg of its route that is long enough.
const BURST = { run: [0.3, 0.9], stop: [0.03, 0.1], stops: 0.25, pace: [0.8, 1.3] }; // seconds it runs for, and stops for; how likely a run ends in a stop; how much faster or slower than its gait a run goes
const BITE = { run: [0.1, 0.45], stop: [0.03, 0.1], stops: 0.45, pace: [0.7, 1.4] }; // the same, as it tears along what it eats
const GAIT = {
  crawl: { speed: 560, accel: 4000, bursts: BURST, leap: 0, swing: 0 }, // a deliberate walk
  skim: { speed: 2000, accel: 11000, bursts: BURST, leap: 0.35, swing: 0.2, zip: 0.12 }, // the quick run along text it has no use for
  feed: { speed: 950, accel: 7000, bursts: BITE, feeding: true, leap: 0, swing: 0 }, // jaws working, tearing along what it eats
  bolt: { speed: 2800, accel: 15000, leap: 0.3, swing: 0.3, zip: 0.35 }, // flat out, down the margin to text further on
  haul: { speed: 1300, accel: 7000, bursts: BURST, leap: 0.3, swing: 0.2, zip: 0.15 }, // heavy with what it has eaten, out over its web
  tow: { speed: 320, accel: 2500, bursts: { run: [0.35, 0.9], stop: [0.08, 0.22], stops: 0.45, pace: [0.7, 1.2] }, leap: 0, swing: 0 }, // hauling a subject of its web along, in heaves
};

// Its mood: how restless it is, from 0 to 1, drifting toward a new mood every
// few seconds. Restless, it runs faster and stops less, steps higher, and
// leaps and swings more.
const MOOD = { every: [2, 7], rate: 0.8, wander: 0.4 }; // seconds before it drifts toward another; how fast it gets there, 1/s; how far its own mood takes it from what its temper says
const restless = (mood, calm, wild) => calm + (wild - calm) * mood;
// Every jump falls by the same gravity, so how high it goes says how long it is in the air: a low pounce is a snap, a high arc hangs.
const GRAVITY = 5200; // px/s^2
const LEAP = { shortest: 260, longest: 1400, load: 0.2, draw: 7 * SIZE, tuck: 4 * SIZE, height: [0.1, 0.24], highest: 170, follow: 0.8, most: 0.65 }; // px of the legs it jumps; seconds it gathers itself for, drawing its body back over its hind legs by `draw` px; how high it goes for each px it covers, and at most; how much of the climb or fall of its flight its body points along, and at most, radians
// A pounce: from a leg of its way to a sentence, it jumps straight onto the
// first word of it, low and fast, lands claws in with a blow, and goes on to
// feed from there. How likely it is, against its drives, at full urge.
const POUNCE = { shortest: 140, longest: 560, load: 0.12, height: 0.09, odds: (d) => 0.1 + 0.45 * d.fury + 0.25 * d.hunger, blow: 0.85 };
const SWING = { shortest: 320, longest: 380, load: 0.05, air: 0.12, pace: 1700, sag: [0.25, 0.75], height: 0.12, highest: 60, fade: 0.7, hook: 0.3 }; // px of the legs it swings, and the most one swing covers; seconds it takes to shoot its thread; seconds on the thread, and px a second on top; how far the anchor is from the middle of the leg, against its length; how high it rides for each px, and at most; seconds its thread takes to go once it lets go, and how far from where a swing would hang, against the length of the swing, a post it hooks onto may be
const SPARE = [1.5, 4]; // seconds, at least and at most, it goes on foot after a jump, swing or zip before it may do another: threads are seasoning, and it gets there on its own legs
const SCOUT = { least: 0.14, most: 0.34, far: 1400, over: [0.14, 0.3], settle: 9, ring: 26, wiggle: 3.2 * SIZE, rate: 20, crouch: 0.15, rise: 0.24, shot: 0.6 }; // seconds it looks at where it is going for, at least, at most, and the distance in px that takes the most; radians its head overshoots by, how fast that dies away and rings, 1/s and rad/s; px its abdomen shivers by, and how fast, rad/s; how low it stands as it looks, how far it throws its head up, radians, and the share of the look it takes to shoot a thread
const ZIP = { shortest: 760, longest: 3200, load: 0.08, air: 0.22, pace: 2600, drop: 1.6, height: 16 * SIZE, rise: 0.16, fall: 0.08, grip: 0.75, reach: [0.55, 0.15, -0.2, -0.5] }; // px of the legs it zips, at least and at most; seconds it coils; seconds on the cord and px a second on top; how much it speeds up down the cord, as the power of how far it has gone; px it hangs off the page by, how much of the ride it takes to get up to it and to come down, and how high its legs reach for the cord, against their length; where along its body, against that length, each pair of legs holds the cord
// How its legs are flung out in the air, pair by pair: [radians off straight ahead, share of the leg's length reached out, and up (below 0 down) from the hip], in a jump and in a pounce.
const STAR = { star: [[0.45, 0.85, 0.12], [1.05, 0.8, -0.05], [2.1, 0.8, -0.12], [2.65, 0.9, -0.08]], claws: [[0.22, 0.95, 0.05], [0.6, 0.85, -0.02], [1.9, 0.75, -0.15], [2.6, 0.9, -0.1]], hang: [[0.55, 0.55, 0.1], [1.25, 0.5, 0], [1.95, 0.5, -0.05], [2.55, 0.6, 0]] }; // and riding a thread, tucked in close
const FLIGHT = { ...STAR, push: 0.22, hold: 0.4, ripple: 0.06, reach: 0.62, stretch: 0.8, fold: 0.48, droop: 0.28, pitch: 0.35, thump: 55 * SIZE, jolt: 0.5 }; // the share of a flight it spends pushing off, and of that the share its feet stay planted; the share of a flight by which one pair of legs lags the next; the share after which it reaches ahead to land; how far, against the length of a leg, the legs stretch out in pushing off and landing, how far out from the hips the feet are drawn in the air, folding the knees up, and how far down; radians its head is thrown up at take-off and down at landing; px/s its abdomen is kicked down by a landing, and how much of that it is kicked to the side
const RAKE = { rate: 26, reach: 3.2 * SIZE, out: 1.8 * SIZE, z: 1.5 * SIZE }; // as it feeds its front legs claw at the word under its jaws, one then the other: how fast, rad/s; how far ahead of its head they strike and how far out to the side; how high they lift
const YANK = { side: 30 * SIZE, up: 14 * SIZE }; // px/s its abdomen is thrown to the side, and up, as it tears a sentence loose
const BREATH = { rate: 2.6, px: 0.22 * SIZE }; // how fast its body rises and falls as it stands, rad/s, and by how many px
const SKID = { carry: 0.75, friction: 7, yaw: [0.25, 0.9], until: 60, most: 0.4, longest: 40 * SIZE }; // how much of its speed in the air it lands with; how fast it slows, 1/s; radians its body slews round; px/s at which it has stopped skidding; the most of what is left of a leg it skids, against its length, and in px
const JOLT = { px: 1.6 * SIZE, decay: 22, reach: 8 * SIZE }; // px a blow that lands shudders its body by, at full power; how fast that dies away, 1/s; px ahead of its head the blow lands
const LUNGE = { speed: 1500, s: 0.1 }; // px/s it strikes at what it is to feed on, and for how long
const CROUCH = { hips: 0.45, body: 1.5 * SIZE, rate: 14, gulp: 0.3 }; // how much lower its hips are crouched, and its body; how fast it gets there, 1/s; how far down a word going down jerks it
const HOP = { s: 0.24, coil: 0.06 }; // seconds a hop lasts, and of that it coils before it leaves the page
const REGARD = { turn: 1.1, tap: 9 }; // the most radians it turns its head toward what it regards, and how fast its front legs feel for it, 1/s
const ALARM = { s: 1.3, rest: 2.5 }; // seconds it stands reared at a shaking of its web, and after that before another can startle it
const RAISE = { along: 12 * SIZE, z: 16 * SIZE, body: 2 * SIZE, rate: 12 }; // a raised front leg: how far ahead it reaches and how high; how much it rears its body; how fast a leg goes up or down, 1/s
const SILK_S = 0.5; // seconds a dragline stays on its tail once it has landed, before it is left lying
const TRAIL = { s: 3.4, most: 5 }; // seconds a dragline it has left lying takes to go, and how many lie at once
const SILK_S_OLD = 1.4; // seconds a dragline takes to fade once it has landed

// What it does about the reader's pointer (heed.js decides; these are how it is done).
const LOOK = { head: 0.5, feeding: 0.3, rate: 9 }; // radians its head turns toward a pointer it watches, at most, and while it feeds (the share of that); how fast it gets there, 1/s
const FLEE = { shortest: 300, longest: 720, scout: [0.04, 0.16], backward: 0.4, hop: [130, 260], zig: [0.5, 1.1], dodge: [110, 190] }; // px of the leap it flees by; seconds it looks first, more the less it is frightened; how likely it is to flee facing what frightens it, backing away; px of the hop it gives at a start
const RECOIL = { speed: [320, 900], slew: 0.5, hop: 5 * SIZE }; // px/s it slides back at a flinch, for a light and a hard one; radians its body slews
const SWAT = { s: 0.34, wind: 0.4, blow: 0.55, hit: 0.5, reach: 0.95, high: 14, low: 1.2 }; // seconds a swat takes; the share of it winding up, the share at which the blow lands, and the share at which it is strongest; how far out a front leg reaches, against its length; how high the leg is wound, and how low it comes down, in units
const STALK = { speed: 150, fast: 320, crouch: 0.7, strike: [120, 200], giveUp: 14, ease: 4 }; // px/s it creeps at; the pointer's px/s above which it freezes; how low it creeps; px from the pointer at which it springs; seconds before it gives up, and how fast it speeds up and slows, 1/s
const INSPECT = { speed: 330, near: 95, hold: [1.6, 3.4], giveUp: 9 }; // px/s it goes at; px it comes to; seconds it stays; seconds before it gives up
const BOUND = { shortest: 520, odds: 0.5, hops: [2, 4], jitter: 0.14 }; // px of a leg it may cross in several hops, how likely it does that rather than one leap, how many hops, and how far each wanders off the line, against the leg
const DEAD = { s: [2.4, 5], legs: [0.3, 0.42] }; // seconds it lies as if dead; how far its legs are drawn in under it, along and out, as a share of where they rest
const WITNESS = { far: 150, near: 96, slack: 26, speed: 560, grace: 0.5, giveUp: 90, rate: 7, crouch: 0.4, rear: 14 }; // px from a subject the reader holds that it stands to watch it, and when it is about to fall in; px it may drift before it follows; px/s it goes at; seconds it waits after the hand lets go; seconds it gives up after; 1/s it takes to rear or sink; how low it crouches to watch, and how high its front legs go when it is ready
const RITUAL = { stand: 40, speed: 520, savor: [0.5, 1.1], power: 0.34, reach: 16 }; // px left of the summary it goes down; px/s it goes at; seconds it dwells on each sentence it has touched; how hard it taps one; px into the drawer it taps
const DEVOUR = { scout: 0.05, short: 90, blow: 1 }; // seconds it looks before it pounces on a subject it is to bite; px under which it strikes instead of leaping; how hard it lands
const TAPPED = { power: 0.35, odds: 0.85 }; // how hard it taps a subject it has gone to, and how likely it does
const TUMBLE = { odds: 0.22, least: 70, from: 0.1, to: 0.9, lift: 22 * SIZE, kinds: ['front', 'back', 'roll'] }; // how likely a jump that rises at least this high is turned over in the air; the share of the flight it turns between; px it is lifted at the middle of the turn, for room to turn in; which ways
const STYLES = { spring: 0.45, rear: 0.2, lunge: 0.2, lob: 0.15 }; // how a jump it chooses is made, and how often: sprung from a crouch; reared up on its hind legs first, front legs high; thrown low and flat and fast, head down; lofted high with its legs tucked
const STYLE = { rear: { rise: 1.8, scout: 1.5, up: 1.15 }, lunge: { height: 0.35, time: 0.7, pitch: 0.5 }, lob: { height: 1.7 } }; // a reared jump: how much more its head is thrown up, how much longer it looks, how much higher its front legs go; a lunge: how much of the height it rises, how much of the time it takes, how much it points down along its way; a lob: how much higher it goes
const SHOT = { s: 0.14, spin: 0.55 }; // seconds a thread it shoots at a hand takes to reach it, and seconds its spinnerets stay turned out
const AWARE_GIVE = 680; // px from the pointer past which a stalk is given up
const TURN = 24; // rad/s, how fast it can swing its head round
const BRAKE = 13000; // px/s^2
const LOOKAHEAD = 30; // px ahead along the current leg of the route that it aims for
const ARRIVE = 12; // 1/s, slow-down rate when closing in on a waypoint
const MIN_APPROACH = 50; // px/s, so the final approach always finishes
const CORNER = 750; // px/s, the speed it takes a waypoint in the middle of a route at
const REACH = 3; // px, distance at which the final waypoint counts as reached
const PASS = 14; // px, same for waypoints in the middle of a route

// The four pairs of legs, front to back: where on the thorax each is hinged,
// where its foot rests, along the body and out to the side, how long its three
// parts are, from hip to knee, knee to ankle and ankle to foot, and how it steps against the
// others: how high, and how slowly. The first pair is the longest and reaches
// far ahead, high-stepping, feeling more than it carries; the third is the
// shortest, quick under the body; the fourth pushes from behind.
const LEGS = [
  { hip: 3.5, along: 26, out: 17, upper: 16, lower: 12, last: 13.5, lift: 1.7, pace: 1.15 },
  { hip: 1.2, along: 10, out: 25, upper: 13.5, lower: 9.5, last: 10.5, lift: 1, pace: 1 },
  { hip: -1.2, along: -6, out: 22, upper: 11.5, lower: 8, last: 9, lift: 0.75, pace: 0.85 },
  { hip: -3.5, along: -23, out: 19, upper: 14.5, lower: 10.5, last: 12.5, lift: 1.1, pace: 1.05 },
].map((leg) => ({ ...leg, hip: leg.hip * SIZE, along: leg.along * SIZE, out: leg.out * SIZE, upper: leg.upper * SIZE, lower: leg.lower * SIZE, last: leg.last * SIZE, long: (leg.upper + leg.lower + leg.last) * SIZE }));
const LEG_HIP = 3 * SIZE; // how far out from the middle of the thorax the hips are
const LEG_HIP_HEIGHT = 3.4 * SIZE; // and how high above the page
const KNEE_SPLAY = 1.1; // px a knee leans out to the side for each px it rises, in a leg that points straight ahead
const TARSUS = { pitch: 1.0, raised: 0.45, stretch: 0.25 }; // radians the last part of a planted leg rises from its foot to its ankle, and of a leg held up, its claws hooked down; and of a leg at full stretch, flattened out to reach
// It walks on two sets of four, each a leg of one side and the next of the
// other, R1 L2 R3 L4 and L1 R2 L3 R4: one set steps while the other carries.
const STEP_LIFT = 3 * SIZE; // px a foot is off the page in the middle of a step, for a leg that lifts 1
const STEP_TRAVEL = 18 * SIZE; // px the body may cover while a foot is in the air; faster body, quicker step
const STEP_S = { min: 0.06, max: 0.13 }; // seconds a step lasts, at least (three and a half frames: quick, but never a blink) and at most
const STEP_VARY = [0.85, 1.15]; // no two steps alike: how much quicker or slower, and lower or higher, a step is than the last
const STEP_OVERSHOOT = 0.28; // how far a foot swings past where it lands and settles back, against the step
const STEP_RIPPLE = 0.07; // of a step, how long each pair waits after the pair behind it: a set steps rear to front, a wave, not all at once
const STEP_TRIGGER = 8 * SIZE; // px a foot may stray before it steps, if its neighbours are planted
const STEP_EAGER = 0.45; // and the share of that at which a foot of the set whose turn it is steps, on the move
const STEP_FORCE = 14 * SIZE; // px at which it steps regardless
const PHASE = { still: 40, stride: 48 * SIZE, rate: 14, duty: [0.66, 0.64], fast: 1400, room: 1, ripple: 0.02, lift: [1, 1.5] }; // px/s below which it only settles its feet; px of body per step cycle at least, and most steps a second; the share of a cycle a foot is planted, slow and fast, and the speed that is fast; how much of what a leg can reach it strides over; the share of a cycle each pair lags the one in front; how much higher its feet go, slow and fast
const RHYTHM = { roll: 0.05, heave: 0.5 * SIZE, speed: 500, most: 8, rate: 22 }; // on the move its body rocks with its feet: radians it rolls onto the set that is planted, and px it rises over each set's stance, at a speed of `speed` px/s and on; and the most steps a second it does so at, for it blurs beyond that; how fast it takes it up, 1/s
const STEP_LEAD_S = 0.045; // a step lands this far ahead in time
const STEP_LEAD_MAX = 11 * SIZE;

const FEELER_BASE = { along: 2.5 * SIZE, out: 1.6 * SIZE };
const FEELER_REACH = 13 * SIZE;
const FEELER_SPREAD = 5 * SIZE;
const FEELER_FOLLOW = 16; // 1/s
const FEELER_SLACK = 4 * SIZE; // px a feeler's tip may fall behind where it reaches for, however fast the body goes
const FEELER_SWEEP = { px: 3 * SIZE, rate: 5.5, still: 0.45 }; // side-to-side probing; slower when standing

const JAW = { shut: 0.1, open: 0.5, work: 0.3, rate: 7, feedRate: 30, follow: 20, snap: 0.5 }; // radians each jaw swings out; they work when it stands, and fast when it feeds

const GULP_S = 0.3; // how long a swallowed word takes to travel from the mouth to the abdomen
const THROB_DECAY = 5; // 1/s, how fast the swell of a sentence it has just finished or laid settles
const HOLD_S = 0.1; // how long it stops dead when halted

// The weight of its body. It sinks a little while a set of legs is in the
// air, rolls into a turn, dips its head as it darts off and lifts it as it
// brakes, and its abdomen hangs off the thorax on a spring, swinging out on a
// turn, and bouncing as it lands, stops, or swallows. Before it darts off from
// standing it coils for an instant.
const BOB = 0.7 * SIZE; // px it sinks with a whole set of legs up
const ROLL = { per: 0.00012, most: 0.22, rate: 10 }; // radians it rolls for each px/s it goes times each rad/s it turns, and at most; how fast it gets there, 1/s
const PITCH = { per: 0.000018, most: 0.18, rate: 9 }; // radians its head dips for each px/s^2 it speeds up, and at most; how fast it gets there, 1/s
const SWAY = { stiff: 170, damp: 8, side: 0.0025, up: 0.00045, most: 5 * SIZE, gulp: 40 * SIZE }; // the spring of its abdomen: its stiffness and damping; px it swings out for each px/s times rad/s of a turn, and up for each px/s^2 of braking; at most; px/s it is kicked down by a swallow
const COIL = { s: 0.06, crouch: 0.45 }; // seconds it coils for before it darts off, and how low
const ease = (t) => t * t * (3 - 2 * t);
// Where the moves say its parts are to be, before any does.
const blankFx = () => ({ leg: Array(8).fill(null), feeler: null, jaw: null, face: null, crouch: 0, rise: 0, pitch: 0, roll: 0, yaw: 0, lean: { along: 0, out: 0 }, side: 0, up: 0, spin: 0, hits: [] });
// A step's way across the ground: it leaves gently, swings through fast, carries a little past and settles, landing still.
const stride = (t) => ease(t) + STEP_OVERSHOOT * Math.sin(Math.PI * t) ** 2 * t;

// When each clip keyed in Blender (clips.js) may be made, and how often it comes up of its own accord.
const CLIPS = {
  strike: { on: ['standing', 'walking', 'feeding'] },
  thrash: { on: ['standing', 'feeding'] },
  tear: { on: ['standing', 'feeding'] },
  stab: { on: ['standing', 'feeding'] },
  wrap: { on: ['standing'] },
  stomp: { on: ['standing'], often: (mood) => 0.2 + 1.2 * mood },
  threat: { on: ['standing', 'alarm'] },
  gulp: { on: ['standing', 'walking', 'feeding'] },
  pluck: { on: ['standing'], often: (mood) => 1.2 - 0.8 * mood },
  drag: { on: ['walking', 'towing'] },
  chew: { on: ['standing'], often: 0.6 },
};

// `clips` are the clips keyed in Blender, as assets/clips.json has them.
export function createCrawler({ clips } = {}) {
  const spine = SPINE_GAP.map(() => ({ x: 0, y: 0 }));
  spine.push({ x: 0, y: 0 });
  const legs = LEGS.flatMap((pair) =>
    [-1, 1].map((side) => ({
      ...pair,
      side,
      t: 1, // step progress; 1 means planted
      stepS: STEP_S.max, // how long the step it is taking lasts
      height: STEP_LIFT, // and how high it goes
      from: { x: 0, y: 0 }, // where the step started, relative to the foot's rest spot
      ground: { x: 0, y: 0 }, // where the foot is planted
      foot: { x: 0, y: 0, z: 0 }, // where it is, held up or not
      up: 0, // how far it is held up off the ground, from 0 to 1
      held: null, // where it was last held
      root: { x: 0, y: 0, z: 0 },
      knee: { x: 0, y: 0, z: 0 },
      ankle: { x: 0, y: 0, z: 0 },
    })),
  );
  const feelers = [-1, 1].map((side) => ({ side, base: { x: 0, y: 0 }, tip: { x: 0, y: 0 } }));
  let route = [];
  let index = 0;
  let origin = { x: 0, y: 0 }; // where the current leg of the route started
  let angle = 0; // which way the head faces
  let speed = 0;
  let feeding = false;
  let clock = 0;
  let jaw = JAW.shut;
  let gulps = []; // words on their way down: `{ at, worth }`, `at` from 0 at the mouth to 1 at the abdomen
  let throb = 0; // the swell of the last sentence it finished, from 1 down to 0
  // What it eats checks its pace: for `left` seconds it goes at `pace` of its gait, 0 a dead stop. A clip that
  // leaves its legs to walk only slows it; one that takes them stops it. Its temper says which (temper.js `CHECK`).
  let check = { left: 0, pace: 1 };
  let fill = 0; // how full its belly is with what it has eaten and not yet laid, from 0 to 1
  let begun = -1; // the leg of the route it has set out on
  let burst = { left: 0, stopped: false, pace: 1 }; // the run or stop it is in, seconds left of it, and the pace of a run
  let leap = null; // a jump: `{ flying, t, from, to, time, height }`
  let lunge = 0; // seconds of a strike left
  let crouch = 0; // how low it is crouched, from 0 to 1
  let lift = 0; // px its body is off the page in a jump
  let tumbled = { pitch: 0, roll: 0 }; // how far it has turned over in the air, radians: head over heels, and about its length
  let doing = null; // what it does in answer to something, `alarm` or `regard`: `{ kind, t, last, at }`
  const moves = createMoves(clips ? clipMoves(clips, CLIPS) : {}); // what it does of its own accord, besides getting there
  const temper = createTemper(moves, Boolean(clips)); // what drives it, and so what it does to what it eats
  const fx = blankFx(); // where the moves say its parts are to be this step
  const rest = LEGS.flatMap((leg) => [leg, leg]).map((leg) => ({ along: leg.along / SIZE, out: leg.out / SIZE }));
  let calm = 0; // seconds before its web can startle it again
  let silk = null; // the dragline of its last jump: `{ from, fade }`
  let turn = 0; // the set of legs whose turn it is to step
  let rocking = { roll: 0, heave: 0 }; // how its body is rocked by its feet: radians it is rolled, and px it is raised
  let gait = null; // how far round the cycle of its feet it is, from 0 to 1, while it is on the move: every foot's own phase is this, a set later
  let mood = 0.5; // how restless it is, from 0 to 1
  let moodTo = 0.5; // and what it is drifting toward
  let moodIn = between(MOOD.every); // seconds before it drifts toward another
  let skid = null; // a landing it is skidding out of: `{ x, y, speed, slew, along }`, the way it goes as x, y and its body slewed `slew` from that
  let tether = null; // its thread on a swing: `{ anchor, fade }`
  let away = null; // the x it keeps the bulge of a swing away from: the middle of the text
  let roll = 0; // radians it leans into a turn, its side +1 down
  let pitch = 0; // radians its head is raised, below 0 when it dips
  let accel = 0; // px/s^2 it is speeding up by, smoothed
  const sway = { side: 0, up: 0, vside: 0, vup: 0 }; // px its abdomen has swung out to side +1 and up, and how fast
  let coil = 0; // seconds of coiling left
  let hopping = null; // a hop where it is: `{ t, height }`, `t` seconds into it
  let wanted = 0; // the speed it wanted last
  let hooks = null; // where it may hook a thread on: `(near, within)` gives the nearest post within px of `near`, or null
  let spare = 0; // seconds left before it may jump, swing or zip again
  let knocks = []; // where it has taken off and landed, and how hard, since the web was last told: `{ x, y, power }`
  let shoved = { x: 0, y: 0 }; // px the moves have its whole body moved by, on the page
  let yawed = 0; // radians the moves have its head turned by about its thorax
  let trails = []; // draglines it has left lying where it landed: `{ from, to, fade, sway }`
  let impacts = []; // where its blows have landed, and how hard, since this was last asked: `{ x, y, power }`
  let jolt = 0; // how hard the last blow shudders it still, from 1 down to 0
  let pounced = null; // the opening it last pounced on, which it has struck already
  let brace = 0; // px it has drawn its body back over its hind legs, gathering itself to jump
  const heedBrain = createHeed(); // what it makes of the reader's pointer
  const agency = createAgency(); // what it makes of the reader's hand on the web
  let webState = null; // what the web says is going on, as main.js tells it each frame
  let held = false; // whether the reader has stopped it to read: its route waits, and it stays where it is, alive
  let pointer = null; // where the pointer is, in page coordinates
  let looking = { watch: 0, look: 0, yaw: 0 }; // how much it watches the pointer, the bearing of it, and how far its head is turned toward it
  let detour = null; // something it does off its route, in answer to the pointer: `{ kind, t, ... }`, `stalk` or `inspect`
  let swat = null; // a front leg struck out at the pointer: `{ t, leg, at }`
  let room = () => null; // the window the page is seen through, `{ left, top, right, bottom }`, which it flees within
  let scrolled = 0; // how fast the reader's hand was scrolling the page, px/s
  let resume = null; // the waypoint it goes back to if the pointer took it from the end of its route
  let current = null; // what it is up to, as the moves see it

  // Checks its pace by `{ s, pace }`, if anything does: the harder check holds while it lasts.
  function slow(by) {
    if (!by) return;
    if (check.left <= 0 || by.pace < check.pace) check = { left: by.s, pace: by.pace };
    else if (by.pace === check.pace) check.left = Math.max(check.left, by.s);
  }

  // Unit vector pointing from a spine joint toward the one ahead of it.
  function heading(joint) {
    const ahead = spine[Math.max(joint - 1, 0)];
    const behind = spine[Math.max(joint, 1)];
    const dx = ahead.x - behind.x;
    const dy = ahead.y - behind.y;
    const length = Math.hypot(dx, dy) || 1;
    return { x: dx / length, y: dy / length };
  }

  // Where a point sits relative to a joint: `along` its heading, `out` to one side.
  function offset(joint, along, out) {
    const h = heading(joint);
    return { x: spine[joint].x + h.x * along - h.y * out, y: spine[joint].y + h.y * along + h.x * out };
  }

  const legHome = (leg) => offset(1, leg.along, leg.side * leg.out);

  // Where a feeler reaches for: ahead, sweeping, while it goes; drawn in to
  // the mouth while it cleans them; spread wide when it rears; trailing in the air.
  function feelerRest(feeler) {
    const { side } = feeler;
    if (leap?.flying) return offset(0, FEELER_REACH * 0.6, side * FEELER_SPREAD * 1.6);
    if (leap) return offset(0, FEELER_REACH * 1.25, side * FEELER_SPREAD * 0.4 + Math.sin(clock * 40 + side) * SIZE);
    if (fx.feeler) {
      const { along, out } = fx.feeler(side);
      return offset(0, along * SIZE, side * out * SIZE);
    }
    if (looking.watch > 0.35 && !feeding && pointer && !doing) {
      // Both feel toward the pointer it is watching, one a little ahead of the other.
      const head = spine[0];
      const away = Math.hypot(pointer.x - head.x, pointer.y - head.y) || 1;
      const reach = Math.min(away, FEELER_REACH * 1.1) * (0.8 + 0.2 * Math.sin(clock * REGARD.tap * 1.3 + side * 1.9));
      const [ux, uy] = [(pointer.x - head.x) / away, (pointer.y - head.y) / away];
      return { x: head.x + ux * reach - uy * side * FEELER_SPREAD * 0.55, y: head.y + uy * reach + ux * side * FEELER_SPREAD * 0.55 };
    }
    if (doing?.kind === 'regard') {
      // Both reach for it, close together, one then the other.
      const head = spine[0];
      const away = Math.hypot(doing.at.x - head.x, doing.at.y - head.y) || 1;
      const reach = Math.min(away, FEELER_REACH) * (0.85 + 0.15 * Math.sin(clock * REGARD.tap + side * 1.6));
      const [ux, uy] = [(doing.at.x - head.x) / away, (doing.at.y - head.y) / away];
      return { x: head.x + ux * reach - uy * side * FEELER_SPREAD * 0.5, y: head.y + uy * reach + ux * side * FEELER_SPREAD * 0.5 };
    }
    const pace = speed > 1 ? 1 : FEELER_SWEEP.still;
    const sweep = Math.sin(clock * FEELER_SWEEP.rate * pace + side) * FEELER_SWEEP.px;
    return offset(0, FEELER_REACH, side * FEELER_SPREAD + sweep);
  }

  // Finds the ankle and the knee. The last part rises from the foot back
  // toward the hip, steep when planted, hooked when held up, flatter the
  // further the foot is reached; the first two keep their length, so what the
  // ankle does not reach for goes into the knee, which rises and leans out.
  function poseLeg(leg) {
    const h = heading(1);
    leg.root = { ...offset(1, leg.hip, leg.side * LEG_HIP), z: LEG_HIP_HEIGHT * (1 - CROUCH.hips * crouch) + body() - leg.side * roll * LEG_HIP + Math.sin(pitch) * (leg.hip + PEDICEL) };
    const { upper, lower, last, long } = leg;
    // A body carried higher than a leg is long takes its feet up with it.
    leg.foot.z = Math.max(leg.foot.z, leg.root.z - (long - 1));
    let dz = leg.foot.z - leg.root.z;
    let dx = leg.foot.x - leg.root.x;
    let dy = leg.foot.y - leg.root.y;
    let flat = Math.hypot(dx, dy) || 1;
    leg.strained = false;
    // A foot the body has outrun is dragged along at full stretch.
    const most = Math.sqrt(Math.max((long - 0.5) ** 2 - dz ** 2, 1));
    if (flat > most) {
      leg.strained = true;
      dx *= most / flat;
      dy *= most / flat;
      flat = most;
      leg.foot.x = leg.root.x + dx;
      leg.foot.y = leg.root.y + dy;
    }
    // And one the body has run over, under its own hip, is pushed out.
    const least = Math.sqrt(Math.max((Math.abs(upper - lower) + 1) ** 2 - dz ** 2, 0));
    if (flat < least) {
      leg.strained = true;
      const away = flat > 1e-3 ? { x: dx / flat, y: dy / flat } : { x: -h.y * leg.side, y: h.x * leg.side };
      dx = away.x * least;
      dy = away.y * least;
      flat = least;
      leg.foot.x = leg.root.x + dx;
      leg.foot.y = leg.root.y + dy;
    }
    // The ankle: back from the foot toward the hip and up, as steep as the leg is held and as it can reach.
    const stretched = clamp((Math.hypot(flat, dz) - (upper + lower) * 0.75) / (long - (upper + lower) * 0.75), 0, 1);
    const rise = TARSUS.pitch + (TARSUS.raised - TARSUS.pitch) * leg.up + (TARSUS.stretch - TARSUS.pitch) * stretched * (1 - leg.up);
    leg.ankle = { x: leg.foot.x - (dx / flat) * Math.cos(rise) * last, y: leg.foot.y - (dy / flat) * Math.cos(rise) * last, z: leg.foot.z + Math.sin(rise) * last };
    dx = leg.ankle.x - leg.root.x;
    dy = leg.ankle.y - leg.root.y;
    dz = leg.ankle.z - leg.root.z;
    let reach = Math.hypot(dx, dy, dz);
    // An ankle out of reach is drawn in: the last part takes up what the others cannot.
    if (reach > upper + lower - 0.5) {
      const share = (upper + lower - 0.5) / reach;
      [dx, dy, dz] = [dx * share, dy * share, dz * share];
      reach = upper + lower - 0.5;
      leg.ankle = { x: leg.root.x + dx, y: leg.root.y + dy, z: leg.root.z + dz };
    }
    const u = { x: dx / reach, y: dy / reach, z: dz / reach };
    const along = (upper ** 2 - lower ** 2 + reach ** 2) / (2 * reach);
    const out = Math.sqrt(Math.max(upper ** 2 - along ** 2, 0));
    // The knee rises, and leans to the side of its leg by as much as the leg
    // points along the body: the front legs reach forward round their knees,
    // the rear legs back, and those at the sides stand straight over theirs.
    // Out to the leg's own side, always: a foot drawn in across the middle
    // (rearing, grooming) must not flip the knee over to the other side.
    const span = Math.hypot(dx, dy) || 1;
    const forward = (dx * h.x + dy * h.y) / span;
    const lean = (leg.side * forward * KNEE_SPLAY) / span;
    const pole = { x: -dy * lean, y: dx * lean, z: 1 };
    const dot = pole.x * u.x + pole.y * u.y + pole.z * u.z;
    const p = { x: pole.x - u.x * dot, y: pole.y - u.y * dot, z: pole.z - u.z * dot };
    const length = Math.hypot(p.x, p.y, p.z);
    leg.knee = {
      x: leg.root.x + u.x * along + (p.x / length) * out,
      y: leg.root.y + u.y * along + (p.y / length) * out,
      z: leg.root.z + u.z * along + (p.z / length) * out,
    };
  }

  // How far up a leg is held off the ground by what it is doing, from 0 to
  // 1, and where it is held: one of the moves holds it, or it rakes at what it
  // feeds on, regards, or reaches for a thread it has shot.
  function raised(leg, i) {
    const pair = i >> 1;
    const kind = doing?.kind;
    const move = fx.leg[i];
    if (move) return { up: move.up, at: { ...offset(1, move.along * SIZE, leg.side * move.out * SIZE), z: move.z * SIZE } };
    if (pair === 0 && feeding) return { up: ease(Math.max(Math.sin(clock * RAKE.rate + leg.side * Math.PI / 2), 0)), at: { ...offset(0, RAKE.reach, leg.side * RAKE.out), z: RAKE.z } };
    if (pair === 0 && kind === 'regard') return { up: Math.max(Math.sin(clock * REGARD.tap + leg.side * 1.6), 0) * 0.3, at: { ...offset(1, leg.along + 3 * SIZE, leg.side * leg.out * 0.85), z: 6 * SIZE } };
    if (leap && !leap.flying && leap.style === 'rear' && pair < 2) return { up: 1, at: { ...offset(1, leg.along + RAISE.along * (pair ? 0.6 : 1.1), leg.side * leg.out * (pair ? 0.8 : 0.5)), z: RAISE.z * STYLE.rear.up * (pair ? 0.75 : 1.1) } };
    if (leap && !leap.flying && (leap.scouting || leap.kind === 'leap' || leap.kind === 'pounce') && pair === 0) return { up: 1, at: { ...offset(1, leg.along + RAISE.along * 1.15, leg.side * leg.out * 0.55), z: RAISE.z * 1.1 } };
    if (leap?.scouting && pair === 1) return { up: 0.25, at: { ...offset(1, leg.along + 3 * SIZE, leg.side * leg.out), z: 4 * SIZE } };
    return { up: 0, at: null };
  }

  // The set a leg walks in.
  const set = (i) => ((i >> 1) + (i & 1)) & 1;

  // How far ahead of where it rests and how far behind a foot can be before its leg is at full stretch: a foot lands in the middle of that range, and the stride is no longer than half the narrowest.
  const reachOf = (leg) => {
    const [ahead, out] = [leg.along - leg.hip, leg.out - LEG_HIP];
    const flat = Math.sqrt(Math.max((leg.long - 0.5) ** 2 - LEG_HIP_HEIGHT ** 2, 0) - out ** 2);
    return { front: flat - ahead, back: flat + ahead };
  };
  const STANCE = LEGS.map(reachOf).map(({ front, back }) => ({ centre: (front - back) / 2, half: ((front + back) / 2) * PHASE.room }));
  const REACH_HALF = Math.min(...STANCE.map(({ half }) => half));

  // The legs: a planted foot steps when the body has left it behind and it is
  // its set's turn, and the turn passes to the other set once this one has
  // landed; in the air they are drawn in under it; and those it holds up go
  // where they are held. `leg.ground` is where a foot is planted, `leg.foot`
  // where it is.
  function stepLegs(dt) {
    // On the move the feet keep a gait, a cycle that goes with the distance the body covers: a set of four is planted while the other swings, so it is never carried on feet that are not on the page.
    const walking = speed > PHASE.still && !leap && !skid;
    const fast = clamp(speed / PHASE.fast, 0, 1);
    const duty = PHASE.duty[0] + (PHASE.duty[1] - PHASE.duty[0]) * fast;
    const span = Math.min(Math.max(PHASE.stride, speed / PHASE.rate), (2 * REACH_HALF) / duty); // px of body per cycle
    const cycle = walking ? speed / span : 0; // cycles a second
    const lead = walking ? (span * duty) / 2 : Math.min(speed * STEP_LEAD_S, STEP_LEAD_MAX);
    const stepS = clamp(STEP_TRAVEL / (speed || 1), STEP_S.min, STEP_S.max);
    gait = walking ? ((gait ?? 0) + cycle * dt) % 1 : null;
    const rock = walking ? clamp(speed / RHYTHM.speed, 0, 1) * clamp(RHYTHM.most / Math.max(cycle, 1e-3), 0, 1) : 0;
    const take = 1 - Math.exp(-RHYTHM.rate * dt);
    rocking.roll += ((walking ? Math.sin(2 * Math.PI * gait) : 0) * rock * RHYTHM.roll - rocking.roll) * take;
    rocking.heave += ((walking ? Math.sin(4 * Math.PI * gait + 1) : 0) * rock * RHYTHM.heave - rocking.heave) * take;
    const h = heading(1);
    legs.forEach((leg, i) => {
      const home = legHome(leg);
      const hold = raised(leg, i);
      // The cycle goes on while a foot is in the air: one set a half cycle after the other, each pair a little behind the one in front.
      let round = false; // whether its cycle has come round this frame: a step is due
      if (walking) {
        const was = leg.phase;
        leg.phase = (gait + (set(i) ? 0.43 : 0.93) - PHASE.ripple * (i >> 1) + 1) % 1;
        round = was != null && leg.phase < was;
      } else leg.phase = null;
      leg.up += (hold.up - leg.up) * (1 - Math.exp(-RAISE.rate * dt));
      if (leap?.flying) leg.launch ??= { ...leg.foot }; // where the foot left from, held through the push
      else leg.launch = null;
      if (leap?.flying && leap.kind === 'zip') {
        // Hung from the cord by every leg, each reaching up to it, the front ones ahead and the rear ones behind;
        // the legs go up to it one pair after another, front first, not all in one frame.
        const { long } = leg;
        const hold = { ...offset(1, long * ZIP.reach[i >> 1], leg.side * long * 0.08), z: leg.root.z + long * ZIP.grip };
        // And come down off it with the body at the end, rear pair first, onto where they will stand.
        const up = ease(clamp((leap.along - (i >> 1) * FLIGHT.ripple) / ZIP.rise, 0, 1));
        const down = ease(clamp((leap.along - (1 - ZIP.fall) + (3 - (i >> 1)) * FLIGHT.ripple * 0.3) / ZIP.fall, 0, 1));
        const stand = { ...home, z: 0 };
        for (const axis of ['x', 'y', 'z']) {
          const hung = (leg.launch[axis] ?? 0) + (hold[axis] - (leg.launch[axis] ?? 0)) * up;
          leg.foot[axis] = hung + (stand[axis] - hung) * down;
        }
        Object.assign(leg.ground, { x: leg.foot.x, y: leg.foot.y });
        leg.t = 1;
        poseLeg(leg);
        return;
      }
      if (leap?.flying) {
        // Pushing off, its feet stay where they were planted while the body
        // leaves them, the front pair first and the rear last, then trail
        // behind it; in the air the legs fold, knees up and feet drawn in
        // under it; and at the end they open again, the front ones reaching
        // ahead to land, the rear trailing.
        const root = offset(1, leg.hip, leg.side * LEG_HIP);
        const [pair, long] = [i >> 1, leg.long];
        const along = clamp(leap.along - pair * FLIGHT.ripple * 0.5, 0, 1); // the rear pair, pushing, holds on longest
        const planted = 1 - ease(clamp(along / (FLIGHT.push * FLIGHT.hold), 0, 1));
        const pushing = 1 - ease(clamp((along - FLIGHT.push * FLIGHT.hold) / (FLIGHT.push * (1 - FLIGHT.hold)), 0, 1));
        const landing = ease(clamp((leap.along - FLIGHT.reach) / (1 - FLIGHT.reach), 0, 1));
        // In the air its legs are flung open round it like a star, level with its body: the front pairs ahead and up, reaching (in a pounce, claws first, close together), the rear pairs stretched back from the push.
        const pounce = leap.kind === 'pounce';
        const [bearing, stretch, rise] = (pounce ? FLIGHT.claws : leap.kind === 'swing' || leap.style === 'lob' ? FLIGHT.hang : FLIGHT.star)[pair];
        const facing = Math.atan2(heading(1).y, heading(1).x) + leg.side * bearing;
        const fold = { x: root.x + Math.cos(facing) * long * stretch, y: root.y + Math.sin(facing) * long * stretch, z: leg.root.z + long * rise };
        const trail = { ...offset(1, -long * FLIGHT.stretch * (0.5 + 0.15 * pair), leg.side * leg.out * 0.7), z: lift * 0.5 };
        const reach = { ...offset(1, pair < 2 ? leg.along + long * FLIGHT.stretch : leg.along - long * 0.3, leg.side * leg.out * 0.8), z: lift * 0.25 };
        for (const axis of ['x', 'y', 'z']) {
          const air = fold[axis] + (trail[axis] - fold[axis]) * pushing;
          const landed = air + (reach[axis] - air) * landing;
          leg.foot[axis] = landed + ((axis === 'z' ? 0 : leg.launch[axis]) - landed) * planted;
        }
        Object.assign(leg.ground, { x: leg.foot.x, y: leg.foot.y });
        leg.t = 1;
        poseLeg(leg);
        return;
      }
      let z = 0;
      if (leg.t < 1) {
        // A foot in the air swings relative to its rest spot, which is moving
        // with the body, so it lands ahead instead of trailing behind.
        // It snaps up, swings a little past where it lands and settles back.
        // Below 0 it is waiting for the pair behind it to go first, still planted.
        leg.t = Math.min(leg.t + dt / leg.stepS, 1);
        if (leg.t > 0) {
          const gone = stride(leg.t);
          leg.ground.x = home.x + leg.from.x * (1 - gone) + h.x * (leg.lead + leg.centre) * gone;
          leg.ground.y = home.y + leg.from.y * (1 - gone) + h.y * (leg.lead + leg.centre) * gone;
          z = leg.height * Math.sin(Math.PI * leg.t ** 0.7);
        } else leg.from = { x: leg.ground.x - home.x, y: leg.ground.y - home.y };
      } else if (leg.up < 0.05 && walking) {
        if (round || leg.strained) {
          leg.from = { x: leg.ground.x - home.x, y: leg.ground.y - home.y };
          leg.lead = lead;
          leg.centre = STANCE[i >> 1].centre;
          leg.stepS = clamp((1 - duty) / cycle, 0.015, 0.2) * between([0.94, 1]);
          leg.t = 0;
          leg.height = STEP_LIFT * leg.lift * (PHASE.lift[0] + (PHASE.lift[1] - PHASE.lift[0]) * fast) * between(STEP_VARY) * restless(mood, 0.8, 1.3);
        }
      } else if (leg.up < 0.05) {
        const stray = Math.hypot(leg.ground.x - home.x, leg.ground.y - home.y);
        const others = legs.every((other, j) => set(j) === set(i) || other.t === 1);
        leg.wants = stray > STEP_TRIGGER * (speed > 1 ? STEP_EAGER : 1);
        if (!skid && (stray > STEP_FORCE || (leg.wants && set(i) === turn && others))) {
          leg.lead = lead;
          leg.centre = 0;
          leg.from = { x: leg.ground.x - home.x, y: leg.ground.y - home.y };
          leg.wants = false;
          leg.stepS = stepS * leg.pace * between(STEP_VARY);
          leg.t = stray > STEP_FORCE ? 0 : -(3 - (i >> 1)) * STEP_RIPPLE;
          leg.height = STEP_LIFT * leg.lift * between(STEP_VARY) * restless(mood, 0.8, 1.3);
        }
      }
      z += hopped() * 0.7; // its feet leave the page in a hop
      const at = hold.at ?? leg.held ?? leg.ground;
      if (hold.at) leg.held = hold.at;
      Object.assign(leg.foot, {
        x: leg.ground.x + (at.x - leg.ground.x) * leg.up,
        y: leg.ground.y + (at.y - leg.ground.y) * leg.up,
        z: z + ((at.z ?? 0) - z) * leg.up,
      });
      poseLeg(leg);
      if (leg.up < 0.05) Object.assign(leg.ground, { x: leg.foot.x, y: leg.foot.y });
    });
    const landed = legs.every((leg, i) => set(i) !== turn || leg.t === 1);
    if (landed && legs.some((leg, i) => set(i) !== turn && leg.wants)) turn ^= 1;
  }

  // How much of a set of legs is in the air, from 0 to 1.
  const aloft = () => legs.reduce((sum, leg) => sum + (leg.t > 0 && leg.t < 1 ? Math.sin(Math.PI * leg.t) : 0), 0) / 4;

  // Its weight: it rolls into a turn and dips its head as it speeds up, and
  // its abdomen swings on its spring. `turning` is how fast it turns, rad/s.
  function carry(dt, turning, was) {
    const blend = (rate) => 1 - Math.exp(-rate * dt);
    accel += ((speed - was) / Math.max(dt, 1e-3) - accel) * blend(12);
    const within = (value, most) => clamp(value, -most, most);
    roll += (within(turning * speed * ROLL.per, ROLL.most) + fx.roll + rocking.roll - roll) * blend(ROLL.rate);
    // In a leap its head is thrown up as it looks and as it pushes off, and down as it comes in; otherwise it dips and lifts with its speed.
    const thrown = leap?.flying && (leap.kind === 'leap' || leap.kind === 'pounce');
    // Thrown, it points along its flight: nose up as it climbs, down as it falls.
    const climb = thrown ? Math.atan((4 * leap.height * (1 - 2 * leap.along)) / Math.max(Math.hypot(leap.to.x - leap.from.x, leap.to.y - leap.from.y), 1)) : 0;
    const lean = !leap ? null : leap.flying && leap.kind === 'zip' ? null : !leap.flying ? (leap.scouting ? SCOUT.rise * (leap.style === 'rear' ? STYLE.rear.rise : 1) : -0.12) : thrown ? clamp(climb * LEAP.follow, -LEAP.most, LEAP.most) - (leap.style === 'lunge' ? STYLE.lunge.pitch * Math.sin(Math.PI * leap.along) : 0) : FLIGHT.pitch * 0.4 * (1 - 2 * leap.along);
    pitch += ((lean ?? within(-accel * PITCH.per, PITCH.most)) + fx.pitch - pitch) * blend(lean === null ? PITCH.rate : 18);
    if (leap?.flying && leap.kind !== 'swing') roll = 0;
    const want = { side: within(-turning * speed * SWAY.side + fx.side * SIZE, SWAY.most), up: within(-accel * SWAY.up + fx.up * SIZE, SWAY.most) };
    // Gathered to spring, its abdomen is drawn down; looking and coiled, it shivers.
    if (leap && !leap.flying) want.up -= LEAP.tuck * (brace / LEAP.draw);
    if (leap && !leap.flying) want.side = within(want.side + Math.sin(clock * SCOUT.rate) * SCOUT.wiggle, SWAY.most);
    for (const axis of ['side', 'up']) {
      const v = `v${axis}`;
      sway[v] += (SWAY.stiff * (want[axis] - sway[axis]) - SWAY.damp * sway[v]) * dt;
      sway[axis] = within(sway[axis] + sway[v] * dt, SWAY.most);
    }
  }

  function stepFeelers(dt) {
    const blend = 1 - Math.exp(-FEELER_FOLLOW * dt);
    for (const feeler of feelers) {
      const rest = feelerRest(feeler);
      feeler.base = offset(0, FEELER_BASE.along, feeler.side * FEELER_BASE.out);
      feeler.tip.x += (rest.x - feeler.tip.x) * blend;
      feeler.tip.y += (rest.y - feeler.tip.y) * blend;
      const behind = Math.hypot(feeler.tip.x - rest.x, feeler.tip.y - rest.y);
      if (behind > FEELER_SLACK) {
        feeler.tip.x = rest.x + ((feeler.tip.x - rest.x) / behind) * FEELER_SLACK;
        feeler.tip.y = rest.y + ((feeler.tip.y - rest.y) / behind) * FEELER_SLACK;
      }
    }
  }

  // How high its body is off the page: up in a jump, down in a crouch, and
  // up at the front when it rears.
  const hopped = () => (hopping && hopping.t > HOP.coil ? hopping.height * Math.sin((Math.PI * (hopping.t - HOP.coil)) / (HOP.s - HOP.coil)) : 0);
  const body = () => lift + hopped() - CROUCH.body * crouch + RAISE.body * legs[0].up + fx.rise * SIZE - BOB * aloft() + rocking.heave + BREATH.px * Math.sin(clock * BREATH.rate);

  // Puts the crawler at `point`, at rest, facing `toward`, and forgets its route.
  function place(point, toward) {
    route = [];
    index = 0;
    begun = -1;
    leap = null;
    skid = null;
    doing = null;
    detour = null;
    swat = null;
    resume = null;
    moves.clear();
    silk = null;
    trails = [];
    tether = null;
    knocks = [];
    shoved = { x: 0, y: 0 };
    yawed = 0;
    angle = Math.atan2(toward.y - point.y, toward.x - point.x);
    speed = 0;
    let along = 0;
    spine.forEach((joint, i) => {
      joint.x = point.x - Math.cos(angle) * along;
      joint.y = point.y - Math.sin(angle) * along;
      along += SPINE_GAP[i] ?? 0;
    });
    for (const leg of legs) {
      leg.ground = legHome(leg);
      leg.foot = { ...leg.ground, z: 0 };
      leg.up = 0;
      leg.t = 1;
      poseLeg(leg);
    }
    for (const feeler of feelers) feeler.tip = feelerRest(feeler);
    stepFeelers(0);
  }

  // Sets the waypoints to visit in order: `{ x, y, gait }`, crawling by
  // default. `clear` is the x of the middle of the text, which a swing bulges away from.
  function follow(points, clear = away) {
    detour = null;
    resume = null;
    route = points;
    away = clear;
    index = 0;
    begun = -1;
    origin = { ...spine[0] };
  }

  // The point it steers at: a little way ahead along the current leg of the
  // route, so it settles onto that line rather than cutting across to its end.
  function aim(head, waypoint) {
    const dx = waypoint.x - origin.x;
    const dy = waypoint.y - origin.y;
    const length = Math.hypot(dx, dy);
    if (length < 1) return waypoint;
    const along = ((head.x - origin.x) * dx + (head.y - origin.y) * dy) / length;
    const ahead = clamp(along + LOOKAHEAD, 0, length) / length;
    return { x: origin.x + dx * ahead, y: origin.y + dy * ahead };
  }

  // Turns where it stands to face `toward`, an angle: the head swings round
  // the thorax. Says whether it faces that way.
  function face(toward, dt) {
    let error = toward - angle;
    error = Math.atan2(Math.sin(error), Math.cos(error));
    angle += clamp(error, -TURN * dt, TURN * dt);
    spine[0].x = spine[1].x + Math.cos(angle) * SPINE_GAP[0];
    spine[0].y = spine[1].y + Math.sin(angle) * SPINE_GAP[0];
    yawed = 0; // set straight from where it faces
    return Math.abs(error) < 0.15;
  }

  // How long it looks at where it is going before it goes, `distance` away: longer when calm, and the further it is going; and how far its head overshoots as it comes onto it.
  const glance = (distance) => (SCOUT.least + (SCOUT.most - SCOUT.least) * Math.min(distance / SCOUT.far, 1)) * restless(mood, 1.3, 0.7);
  const overshoot = () => between(SCOUT.over) * (Math.random() < 0.5 ? -1 : 1);

  // It sets out on a leg of its route, to `waypoint` at `distance`, in
  // `gait`: a leg long enough it may jump, and what it is to feed on it strikes at.
  function setOut(waypoint, gait, distance) {
    const urge = spare > 0 ? 0 : restless(mood, 0.4, 1.6);
    // The first word of a sentence it is on its way to, and the waypoint it stands at.
    const opening = gait.feeding ? -1 : route.findIndex((one, i) => i > index && one.gait === 'feed' && one.opens) - 1;
    const prey = opening > index - 1 ? route[opening] : null;
    const reach = prey ? Math.hypot(prey.x - spine[0].x, prey.y - spine[0].y) : 0;
    if (prey && reach >= POUNCE.shortest && reach <= POUNCE.longest && Math.random() < POUNCE.odds(temper.drives) * urge) {
      leap = { kind: 'pounce', flying: false, t: 0, to: { x: prey.x, y: prey.y }, scout: glance(reach) * 0.6, over: overshoot() * 0.5, along: 0, lands: opening };
      doing = null;
    } else if (distance >= ZIP.shortest && distance <= ZIP.longest && Math.random() < (gait.zip ?? 0) * urge) {
      const head = spine[0];
      leap = { kind: 'zip', flying: false, t: 0, to: { x: waypoint.x, y: waypoint.y }, scout: glance(distance), over: overshoot(), along: 0 };
      // The cord is fixed at both ends where the spider's legs can reach it from, and hung at its height.
      tether = { anchor: leap.to, from: { x: head.x, y: head.y }, high: ZIP.height + ZIP.grip * LEGS[0].long, fade: 1, shot: 0 };
      doing = null;
    } else if (distance >= SWING.shortest && Math.random() < gait.swing * urge) {
      const head = spine[0];
      const reach = Math.min(SWING.longest / distance, 1);
      const to = { x: head.x + (waypoint.x - head.x) * reach, y: head.y + (waypoint.y - head.y) * reach };
      leap = { kind: 'swing', flying: false, t: 0, to, scout: glance(distance * reach), over: overshoot(), anchor: anchorFor(head, to), along: 0 };
      tether = { anchor: leap.anchor, fade: 1, shot: 0 };
      doing = null;
    } else if (distance >= BOUND.shortest && distance <= LEAP.longest * 1.6 && Math.random() < gait.leap * urge * BOUND.odds) {
      // A bounding run: several low hops in a row along the leg, each off the ground the last touched, a little off the line.
      const head = spine[0];
      const hops = Math.round(between(BOUND.hops));
      const [ux, uy] = [(waypoint.x - head.x) / distance, (waypoint.y - head.y) / distance];
      const points = Array.from({ length: hops }, (_, i) => {
        const share = (i + 1) / hops;
        const wander = i === hops - 1 ? 0 : (Math.random() - 0.5) * 2 * BOUND.jitter * distance;
        return { x: head.x + (waypoint.x - head.x) * share - uy * wander, y: head.y + (waypoint.y - head.y) * share + ux * wander };
      });
      const [first, ...chain] = points;
      leap = null;
      launch('leap', first, { scout: glance(distance / hops), chain });
    } else if (distance >= LEAP.shortest && distance <= LEAP.longest && Math.random() < gait.leap * urge) {
      leap = { kind: 'leap', flying: false, t: 0, to: { x: waypoint.x, y: waypoint.y }, scout: glance(distance), over: overshoot(), along: 0 };
      doing = null;
    }
    if (leap) spare = between(SPARE);
    if (gait.feeding) {
      lunge = LUNGE.s;
      jaw = JAW.open + JAW.snap;
      // At the opening of a sentence its temper says how it takes it: a strike, a stalk, a stab, or a snatch.
      if (waypoint.opens && waypoint !== pounced) slow(temper.open(waypoint, angle));
    }
  }

  // Where a swing from `from` to `to` hangs: an anchor off the middle of the
  // leg, on the side of the text, so that riding round it the crawler bulges
  // out away from the text. Gives the anchor, the radius and the angles it
  // rides from and to.
  function anchorFor(from, to) {
    const [dx, dy] = [to.x - from.x, to.y - from.y];
    const length = Math.hypot(dx, dy);
    const normal = { x: -dy / length, y: dx / length };
    const middle = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    // The bulge is on the side away from the anchor.
    let side = Math.random() < 0.5 ? 1 : -1;
    if (away !== null && Math.abs(normal.x) > 0.2) side = Math.sign((middle.x - away) * normal.x) * -1 || side;
    const sag = between(SWING.sag) * length;
    const hung = { x: middle.x + normal.x * sag * side, y: middle.y + normal.y * sag * side };
    return hooks?.(hung, length * SWING.hook) ?? hung;
  }

  function hang(from, to, anchor) {
    const start = Math.atan2(from.y - anchor.y, from.x - anchor.x);
    let sweep = Math.atan2(to.y - anchor.y, to.x - anchor.x) - start;
    sweep = Math.atan2(Math.sin(sweep), Math.cos(sweep));
    return { anchor, radius: Math.hypot(from.x - anchor.x, from.y - anchor.y), start, sweep };
  }

  // Sets off at once on a jump of its own, off its route: `kind` is `leap` or `pounce`, to `to`. `look` is where it faces while it gathers itself
  // (the way it is going if not given) and `after` the way it faces on landing, if it is to turn in the air.
  function launch(kind, to, { scout = 0.1, look = null, after = null, blow = 0, chain = [] } = {}) {
    if (leap) return false;
    leap = { kind, flying: false, t: 0, to: { x: to.x, y: to.y }, scout, over: 0, along: 0, free: true, look, after, blow, chain };
    doing = null;
    detour = null;
    skid = null;
    swat = null;
    resume ??= index >= route.length ? route.at(-1) ?? null : null;
    return true;
  }

  // A jump or a swing: it crouches and turns to where it is going, then goes
  // there in a set time, high in the middle, and lands still going, into a
  // skid. A jump flies straight, paying out a dragline; a swing rides round
  // the anchor of its thread, fastest at the bottom of its arc.
  function jump(dt) {
    const head = spine[0];
    leap.t += dt;
    if (leap.style === undefined) {
      // How this jump is to be made: a flee or a pounce is sprung or lunged; the rest are drawn from the styles.
      const pool = leap.kind === 'leap' ? Object.entries(leap.free ? { spring: STYLES.spring, lunge: STYLES.lunge } : STYLES) : [];
      let pick = Math.random() * pool.reduce((sum, [, odds]) => sum + odds, 0);
      leap.style = pool.find(([, odds]) => (pick -= odds) < 0)?.[0] ?? 'spring';
      if (leap.style === 'rear') leap.scout *= STYLE.rear.scout;
    }
    const swinging = leap.kind === 'swing';
    const zipping = leap.kind === 'zip';
    if (!leap.flying) {
      speed = Math.max(speed - BRAKE * dt, 0);
      // It looks first: its head comes onto where it is going, overshoots and rings in.
      const toward = leap.look ?? Math.atan2(leap.to.y - head.y, leap.to.x - head.x);
      const facing = face(toward + leap.over * Math.exp(-SCOUT.settle * leap.t) * Math.cos(SCOUT.ring * leap.t), dt);
      leap.scouting = leap.t < leap.scout;
      if (swinging || zipping) {
        // Its thread is shot off to the anchor while it looks, and the web it is fixed to feels it.
        tether.shot = Math.min(leap.t / (leap.scout * SCOUT.shot), 1);
        if (tether.shot === 1 && !leap.hooked) {
          leap.hooked = true;
          knocks.push({ ...(leap.anchor ?? leap.to), power: 0.8 });
          sway.vup += SWAY.gulp * 0.5;
        }
      }
      // Done looking, it gathers itself: crouched, its body drawn back over its hind legs, and it springs.
      const load = swinging ? SWING.load : zipping ? ZIP.load : leap.kind === 'pounce' ? POUNCE.load : LEAP.load;
      if (!swinging && !zipping && !leap.scouting) brace = LEAP.draw * ease(clamp((leap.t - leap.scout) / load, 0, 1));
      if (leap.t < leap.scout + load || !(facing || swinging)) return;
      leap.scouting = false;
      brace = 0;
      const distance = Math.hypot(leap.to.x - head.x, leap.to.y - head.y);
      const from = { ...head };
      const pace = restless(mood, 0.8, 1.25);
      if (swinging) {
        const arc = hang(from, leap.to, leap.anchor);
        const length = arc.radius * Math.abs(arc.sweep);
        Object.assign(leap, arc, { time: SWING.air + length / (SWING.pace * pace), height: Math.min(length * SWING.height, SWING.highest) });
        speed = length / leap.time;
      } else if (zipping) {
        // It rides the cord to where it is fixed, and brakes at the end, skidding on from there.
        const flight = distance;
        Object.assign(leap, { time: ZIP.air + flight / (ZIP.pace * pace), height: ZIP.height });
        tether.from = { ...from };
      } else {
        // It flies as anything thrown does: an even pace over the page and a
        // parabola above it, as long in the air as its height says. A jump
        // lands short of where it is going by as far as it will skid; a pounce lands on it.
        const pouncing = leap.kind === 'pounce';
        const rise = (d) => Math.max(Math.min(d * (pouncing ? POUNCE.height : between(LEAP.height)), LEAP.highest), 6 * SIZE);
        const guess = rise(distance) * (leap.style === 'lunge' ? STYLE.lunge.height : leap.style === 'lob' ? STYLE.lob.height : 1);
        const time = 2 * Math.sqrt((2 * guess) / GRAVITY) * (leap.style === 'lunge' ? STYLE.lunge.time : 1);
        const short = pouncing ? 0 : Math.min((distance / time) * SKID.carry / SKID.friction, distance * SKID.most, SKID.longest);
        const to = { x: leap.to.x - ((leap.to.x - from.x) / distance) * short, y: leap.to.y - ((leap.to.y - from.y) / distance) * short };
        const flight = Math.hypot(to.x - from.x, to.y - from.y);
        Object.assign(leap, { to, time, height: guess, facing: angle, turn: 0 });
        if (!pouncing && guess >= TUMBLE.least && Math.random() < TUMBLE.odds * restless(mood, 0.6, 1.6)) leap.tumble = { kind: TUMBLE.kinds[Math.floor(Math.random() * TUMBLE.kinds.length)], way: Math.random() < 0.5 ? -1 : 1 };
        // In the air it turns to face the way it goes on from where it lands, if that is not the way it flies.
        const after = leap.free ? null : route[(pouncing ? leap.lands : index) + 1];
        if (leap.free && leap.after !== null) leap.turn = Math.atan2(Math.sin(leap.after - angle), Math.cos(leap.after - angle));
        if (after) {
          const onward = Math.atan2(after.y - leap.to.y, after.x - leap.to.x);
          if (Math.hypot(after.x - leap.to.x, after.y - leap.to.y) > 20) leap.turn = Math.atan2(Math.sin(onward - angle), Math.cos(onward - angle));
        }
        silk = { from: { ...spine.at(-1) }, fade: 1 };
        speed = flight / time;
      }
      leap.from = from;
      leap.flying = true;
      // The body springs and its abdomen is left behind for an instant, then follows.
      if (!swinging && !zipping) sway.vup -= FLIGHT.thump * 0.6;
      leap.t = 0;
      knocks.push({ ...from, power: 0.4 + Math.min(Math.hypot(leap.to.x - from.x, leap.to.y - from.y) / 700, 1) });
      return;
    }
    const along = Math.min(leap.t / leap.time, 1);
    leap.along = along;
    const before = { ...head };
    if (swinging) {
      // A pendulum: slow at the ends of its arc, fast through the bottom.
      const turned = leap.start + leap.sweep * (0.5 - 0.5 * Math.cos(Math.PI * along));
      head.x = leap.anchor.x + Math.cos(turned) * leap.radius;
      head.y = leap.anchor.y + Math.sin(turned) * leap.radius;
      if (along > 0) angle = Math.atan2(head.y - before.y, head.x - before.x);
    } else if (zipping) {
      // On a cord it speeds up all the way down.
      const gone = along ** ZIP.drop;
      head.x = leap.from.x + (leap.to.x - leap.from.x) * gone;
      head.y = leap.from.y + (leap.to.y - leap.from.y) * gone;
      speed = (Math.hypot(leap.to.x - leap.from.x, leap.to.y - leap.from.y) / leap.time) * ZIP.drop * along ** (ZIP.drop - 1);
    } else {
      // Thrown: its thorax flies the line at an even pace while the whole of it
      // turns about it, late in the flight, to where it will go on.
      const going = { x: Math.cos(leap.facing), y: Math.sin(leap.facing) };
      const thorax = { x: leap.from.x + (leap.to.x - leap.from.x) * along - going.x * SPINE_GAP[0], y: leap.from.y + (leap.to.y - leap.from.y) * along - going.y * SPINE_GAP[0] };
      angle = leap.facing + leap.turn * ease(clamp((along - 0.25) / 0.65, 0, 1));
      let back = 0;
      spine.forEach((joint, i) => {
        joint.x = thorax.x + Math.cos(angle) * (i ? -back : SPINE_GAP[0]);
        joint.y = thorax.y + Math.sin(angle) * (i ? -back : SPINE_GAP[0]);
        if (i) back += SPINE_GAP[i];
      });
    }
    if (zipping) {
      // Up onto the cord quickly, hung from it, and down again at the end.
      const hung = Math.min(1, along / ZIP.rise, (1 - along) / ZIP.fall);
      lift = leap.height * hung * hung * (3 - 2 * hung);
    } else lift = 4 * leap.height * along * (1 - along);
    if (leap.tumble) {
      // Over in the air: one whole turn, the body lifted for room to make it.
      const turned = ease(clamp((along - TUMBLE.from) / (TUMBLE.to - TUMBLE.from), 0, 1));
      const angle2 = Math.PI * 2 * turned * leap.tumble.way;
      tumbled = leap.tumble.kind === 'roll' ? { pitch: 0, roll: angle2 } : { pitch: leap.tumble.kind === 'front' ? angle2 : -angle2, roll: 0 };
      lift += TUMBLE.lift * Math.sin(Math.PI * turned);
    }
    if (along < 1) return;
    lift = 0;
    tumbled = { pitch: 0, roll: 0 };
    crouch = 1;
    // It lands head down, and the whole of it is jolted: its abdomen kicked down and to one side.
    pitch = -FLIGHT.pitch;
    sway.vup -= FLIGHT.thump;
    sway.vside += FLIGHT.thump * FLIGHT.jolt * (Math.random() < 0.5 ? -1 : 1);
    knocks.push({ x: head.x, y: head.y, power: 0.7 + Math.min(speed / 1500, 1) });
    if (silk && !swinging && !zipping) {
      // Its dragline is left lying, fixed where it set off and where it landed, to go slack and fade.
      const tail = spine.at(-1);
      trails.push({ from: silk.from, to: { x: tail.x, y: tail.y }, fade: 1, power: Math.min(speed / 1500, 1) });
      if (trails.length > TRAIL.most) trails.shift();
    }
    temper.landed();
    const going = swinging ? angle : Math.atan2(leap.to.y - leap.from.y, leap.to.x - leap.from.x);
    if (leap.kind === 'pounce') {
      // Claws in where it meant to land, with a blow on what it came for; it feeds from there.
      if (!leap.free) index = leap.lands;
      const h = heading(0);
      const blow = { x: head.x + h.x * JOLT.reach, y: head.y + h.y * JOLT.reach, power: leap.blow || POUNCE.blow };
      impacts.push(blow);
      knocks.push(blow);
      jolt = 1;
      temper.hit();
      if (leap.free) slow(temper.pounced({ worth: 'prize', surprise: false }, angle));
      const opening = leap.free ? null : route[index + 1];
      if (opening?.opens) {
        slow(temper.pounced(opening, angle));
        pounced = opening;
      }
    } else {
      // It skids no further than is left of the leg it is on, on the way it flew, facing the way it turned to.
      const waypoint = route[index];
      const left = waypoint ? Math.hypot(waypoint.x - head.x, waypoint.y - head.y) : 0;
      const far = Math.min(left * SKID.most, SKID.longest) * SKID.friction;
      const turned = Math.abs(leap.turn ?? 0) > 0.3;
      skid = { x: Math.cos(going), y: Math.sin(going), speed: Math.min(speed * SKID.carry, far), slew: between(SKID.yaw) * (turned ? 0.3 : 1) * (Math.random() < 0.5 ? -1 : 1), along: swinging ? going : angle };
    }
    const was = leap;
    leap = null;
    if (was.free && was.chain.length) {
      // Another hop at once, off the ground it has just touched: a scatter, zigzagging.
      const [next, ...rest] = was.chain;
      launch('leap', next, { scout: 0.025, chain: rest, look: was.look, after: rest.length ? null : was.after });
      leap.chained = true;
    } else if (was.free) finishDetour();
    // Its feet come down where they were reaching to, and the steps that follow
    // gather them in; it goes on from where it is: another swing, perhaps, if it is not there yet.
    for (const leg of legs) {
      leg.ground = { x: leg.foot.x, y: leg.foot.y };
      leg.t = 1;
    }
    begun = -1;
  }

  // A skid: the whole body slides on the way it landed, slewed round, slowing,
  // its feet dragged behind, and straightens as it stops.
  function slide(dt) {
    skid.speed *= Math.exp(-SKID.friction * dt);
    for (const joint of spine) {
      joint.x += skid.x * skid.speed * dt;
      joint.y += skid.y * skid.speed * dt;
    }
    speed = skid.speed;
    const share = Math.min(skid.speed / 600, 1);
    face(skid.along + skid.slew * share, dt);
    if (skid.speed < SKID.until) {
      skid = null;
      moves.start('shake', undefined, angle); // it shakes itself after the landing
    }
  }

  // An excursion in answer to the pointer, off its route: it creeps up on it (`stalk`), freezing whenever it moves, and springs; or it goes to it and feels it over (`inspect`).
  function wander(dt) {
    const head = spine[0];
    detour.t += dt;
    if (detour.kind === 'dead') return playDead(dt);
    if (detour.kind === 'witness') return witness(dt);
    if (detour.kind === 'ritual') return ritual(dt);
    const target = detour.tap ? detour.at : pointer ?? detour.at;
    const [dx, dy] = [target.x - head.x, target.y - head.y];
    const d = Math.hypot(dx, dy);
    const bearing = Math.atan2(dy, dx);
    let error = Math.atan2(Math.sin(bearing - angle), Math.cos(bearing - angle));
    angle += clamp(error, -TURN * 0.6 * dt, TURN * 0.6 * dt);
    let want = 0;
    const pace = (speed) => (speed * restless(mood, 0.85, 1.2));
    if (detour.kind === 'stalk') {
      const seen = looking.pointerSpeed ?? 0;
      detour.frozen = seen > STALK.fast || Math.abs(error) > 0.9;
      want = detour.frozen ? 0 : pace(STALK.speed) * (0.6 + 0.4 * Math.min(d / 400, 1));
      detour.near ??= between(STALK.strike);
      if (!pointer || detour.t > STALK.giveUp || d > AWARE_GIVE) detour = null;
      else if (d < detour.near && !detour.frozen) {
        // Close enough: it springs onto where the pointer is.
        const u = { x: dx / d, y: dy / d };
        launch('pounce', { x: target.x - u.x * JOLT.reach, y: target.y - u.y * JOLT.reach }, { scout: 0.12, blow: 0.9 });
        return jump(dt);
      }
    } else {
      want = d > INSPECT.near ? pace(INSPECT.speed) * Math.min(d / 120, 1) : 0;
      if (d <= INSPECT.near && detour.stayed === undefined) detour.stayed = detour.t + between(INSPECT.hold);
      // A subject it has been sent to it taps with a front leg, to feel whether it is there.
      if (d <= INSPECT.near && detour.tap && !detour.tapped && !swat) {
        detour.tapped = true;
        if (Math.random() < TAPPED.odds) swat = { t: 0, leg: Math.sin(bearing - angle) > 0 ? 1 : 0, at: { x: target.x, y: target.y }, power: TAPPED.power };
      }
      if (detour.stayed !== undefined && detour.t > detour.stayed) detour = null;
      else if (detour.t > INSPECT.giveUp + (detour.stayed !== undefined ? INSPECT.hold[1] : 0)) detour = null;
    }
    if (!detour) {
      origin = { ...spine[0] };
      begun = -1;
      return finishDetour();
    }
    detour.speed = want;
    speed += clamp(want - speed, -BRAKE * dt, 5000 * dt);
    if (want === 0 && speed < 4) speed = 0;
    head.x += Math.cos(angle) * speed * dt;
    head.y += Math.sin(angle) * speed * dt;
    feeding = false;
  }

  // Goes toward `point` at up to `pace` px/s, turning as it goes and slowing as it comes in. Says how far it has still to go.
  function walkTo(point, pace, dt, within = 10) {
    const head = spine[0];
    const [dx, dy] = [point.x - head.x, point.y - head.y];
    const d = Math.hypot(dx, dy);
    const error = Math.atan2(Math.sin(Math.atan2(dy, dx) - angle), Math.cos(Math.atan2(dy, dx) - angle));
    angle += clamp(error, -TURN * dt, TURN * dt);
    const want = d > within ? Math.min(pace * restless(mood, 0.9, 1.15), d * 7) * (Math.abs(error) > 1.2 ? 0.25 : 1) : 0;
    speed += clamp(want - speed, -BRAKE * dt, 5000 * dt);
    if (want === 0 && speed < 4) speed = 0;
    head.x += Math.cos(angle) * speed * dt;
    head.y += Math.sin(angle) * speed * dt;
    feeding = false;
    return d;
  }

  // Stands where it is and comes to rest, facing `toward`. Says whether it faces it.
  function stay(toward, dt) {
    speed = Math.max(speed - BRAKE * dt, 0);
    return face(toward, dt);
  }

  // An excursion that has run its course: back to its route, or to where that ended.
  function endDetour() {
    detour = null;
    origin = { ...spine[0] };
    begun = -1;
    finishDetour();
  }

  // The reader holds a subject of the web: it comes to a stand off it, as near as it is about to fall into another,
  // and watches it, low and wary while it is far from falling in, reared with its jaws wide when letting go would fold it in.
  function witness(dt) {
    const hand = webState?.hand ?? null;
    if (hand) {
      detour.focus = hand;
      detour.gone = 0;
    } else detour.gone += dt;
    const { focus } = detour;
    if (!focus || detour.gone > WITNESS.grace || detour.t > WITNESS.giveUp) return endDetour();
    const thorax = spine[1];
    const [dx, dy] = [focus.at.x - thorax.x, focus.at.y - thorax.y];
    const d = Math.hypot(dx, dy) || 1;
    const ready = focus.close && focus.dock ? 1 : 0;
    // Letting go would fold it in: its jaws snap at the moment that becomes so.
    if (ready && !detour.wasReady) {
      jaw = JAW.open + JAW.snap;
      sway.vup += SWAY.gulp * 0.6;
    }
    detour.wasReady = ready;
    detour.ready += (ready - detour.ready) * (1 - Math.exp(-WITNESS.rate * dt));
    const stand = ready ? WITNESS.near : WITNESS.far;
    if (d > stand + WITNESS.slack) walkTo({ x: focus.at.x - (dx / d) * stand, y: focus.at.y - (dy / d) * stand }, WITNESS.speed, dt, 6);
    else stay(ready ? Math.atan2(focus.dock.y - thorax.y, focus.dock.x - thorax.x) : Math.atan2(dy, dx), dt);
    detour.moving = speed > 8;
  }

  // The summary is open: it goes down the left of the drawer, and at each essential sentence in turn it stops, taps it and dwells on it.
  function ritual(dt) {
    const drawer = webState?.drawer;
    if (!drawer) return endDetour();
    const thorax = spine[1];
    const next = drawer.prizes.find((prize) => prize.y > detour.last + 4);
    if (detour.stage === 'go') {
      if (!next) {
        detour.stage = 'flourish';
        detour.until = detour.t + 1.3;
        moves.start('rear', 1.3, angle);
        return;
      }
      const stand = { x: drawer.box.left - RITUAL.stand, y: next.y };
      if (walkTo(stand, RITUAL.speed, dt, 8) < 14) Object.assign(detour, { stage: 'tap', at: { x: drawer.box.left + RITUAL.reach, y: next.y }, struck: false });
    } else if (detour.stage === 'tap') {
      const facing = stay(Math.atan2(detour.at.y - thorax.y, detour.at.x - thorax.x), dt);
      if (facing && !swat && !detour.struck) {
        detour.struck = true;
        swat = { t: 0, leg: Math.sin(Math.atan2(detour.at.y - thorax.y, detour.at.x - thorax.x) - angle) > 0 ? 1 : 0, at: detour.at, power: RITUAL.power };
      } else if (detour.struck && !swat) Object.assign(detour, { stage: 'savor', until: detour.t + between(RITUAL.savor), last: detour.at.y });
    } else if (detour.stage === 'savor') {
      stay(Math.atan2(detour.at.y - thorax.y, detour.at.x - thorax.x), dt);
      if (detour.t > detour.until) detour.stage = 'go';
    } else {
      stay(0, dt);
      if (detour.t > detour.until) endDetour();
    }
  }

  // Playing dead: it lies still until it has lain long enough, then comes to with a shake.
  function playDead(dt) {
    speed = Math.max(speed - BRAKE * dt, 0);
    if (detour.t < detour.last) return;
    detour = null;
    moves.start('shake', undefined, angle);
    origin = { ...spine[0] };
    begun = -1;
    finishDetour();
  }

  // An excursion is over: if it had come to the end of its route, it goes back to where that ended.
  function finishDetour() {
    const back = resume;
    resume = null;
    if (back && index >= route.length) follow([{ ...back, gait: 'crawl' }], away);
  }

  function steer(dt) {
    const head = spine[0];
    if (doing?.kind === 'alarm' || doing?.kind === 'regard') {
      speed = Math.max(speed - BRAKE * dt, 0);
      let toward = Math.atan2(doing.at.y - spine[1].y, doing.at.x - spine[1].x);
      // What it regards it turns its head toward, as far as its head goes round.
      if (doing.kind === 'regard') toward = doing.from + Math.max(Math.min(Math.atan2(Math.sin(toward - doing.from), Math.cos(toward - doing.from)), REGARD.turn), -REGARD.turn);
      face(toward, dt);
      return;
    }
    if (leap) return jump(dt);
    if (skid) return slide(dt);
    if (detour) return wander(dt);
    if (held) {
      speed = Math.max(speed - BRAKE * dt, 0);
      feeding = false;
      return;
    }
    let want = 0;
    let gait = GAIT.crawl;

    while (route[index]) {
      const waypoint = route[index];
      const final = index === route.length - 1;
      const distance = Math.hypot(waypoint.x - head.x, waypoint.y - head.y);
      if (distance < (final ? REACH : PASS)) {
        origin = waypoint;
        index += 1;
        continue;
      }

      gait = GAIT[waypoint.gait ?? 'crawl'];
      if (begun !== index) {
        begun = index;
        setOut(waypoint, gait, distance);
        if (leap) return jump(dt);
      }
      const target = aim(head, waypoint);
      let error = Math.atan2(target.y - head.y, target.x - head.x) - angle;
      error = Math.atan2(Math.sin(error), Math.cos(error));
      angle += clamp(error, -TURN * dt, TURN * dt);

      // It runs in fits and starts where it is not feeding.
      const fits = gait.bursts;
      if (fits) {
        burst.left -= dt;
        if (burst.left <= 0) burst = !burst.stopped && Math.random() < fits.stops * restless(mood, 1.5, 0.5) ? { left: between(fits.stop), stopped: true, pace: burst.pace } : { left: between(fits.run), stopped: false, pace: between(fits.pace) * restless(mood, 0.8, 1.2) };
      } else burst = { left: 0, stopped: false, pace: restless(mood, 0.85, 1.15) };

      // No faster than lets it turn onto the point it is aiming for.
      const reach = Math.hypot(target.x - head.x, target.y - head.y);
      const bend = Math.abs(error) > Math.PI / 2 ? 1 : Math.abs(Math.sin(error));
      const turning = (TURN * reach) / (2 * bend + 1e-6);
      const closing = distance * ARRIVE + (final ? MIN_APPROACH : CORNER);
      const paced = check.left > 0 ? check.pace : 1;
      want = burst.stopped ? 0 : Math.min(gait.speed * burst.pace * paced, turning, closing);
      if (lunge > 0 && paced === 1) want = clamp(want, LUNGE.speed, closing);
      break;
    }
    // From standing, it coils before it goes.
    if (want > 0 && wanted === 0 && speed < 5 && !gait.feeding) coil = COIL.s; // not between one bite and the next
    wanted = want;
    if (coil > 0) want = 0;

    feeding = Boolean(gait.feeding) && want > 0;
    speed += clamp(want - speed, -BRAKE * dt, (lunge > 0 ? BRAKE : gait.accel) * dt);
    head.x += Math.cos(angle) * speed * dt;
    head.y += Math.sin(angle) * speed * dt;
  }

  // The moves shove its whole body over its planted feet and turn its head
  // about its thorax: by what they ask for now, less what they asked before.
  function shove() {
    const h = heading(1);
    const { along, out } = fx.lean;
    const shudder = { x: (Math.random() - 0.5) * 2 * JOLT.px * jolt, y: (Math.random() - 0.5) * 2 * JOLT.px * jolt };
    const want = { x: (h.x * along - h.y * out) * SIZE - h.x * brace + shudder.x, y: (h.y * along + h.x * out) * SIZE - h.y * brace + shudder.y };
    for (const joint of spine) {
      joint.x += want.x - shoved.x;
      joint.y += want.y - shoved.y;
    }
    shoved = want;
    const turn = fx.yaw - yawed;
    if (turn) {
      const [c, s] = [Math.cos(turn), Math.sin(turn)];
      const [dx, dy] = [spine[0].x - spine[1].x, spine[0].y - spine[1].y];
      spine[0].x = spine[1].x + dx * c - dy * s;
      spine[0].y = spine[1].y + dx * s + dy * c;
      yawed = fx.yaw;
    }
  }

  // It watches the pointer, turning its head and feelers to it, and does what heed.js says to it; a swat in the middle of being struck is carried on.
  function attend(dt, now) {
    const body = { x: spine[1].x, y: spine[1].y, angle, now, drives: temper.drives, leaping: Boolean(leap || skid), busy: Boolean(doing || detour || swat), feeding: route[index]?.gait === 'feed' && !leap };
    const seen = heedBrain.step(dt, pointer, body);
    looking.watch += (seen.watch - looking.watch) * (1 - Math.exp(-LOOK.rate * dt));
    looking.look = seen.look;
    looking.pointerSpeed = heedBrain.speed;
    if (seen.act) act(seen.act);
    if (webState) {
      const mine = { x: spine[1].x, y: spine[1].y, feeding: body.feeding, busy: body.busy, leaping: body.leaping, dead: detour?.kind === 'dead' };
      const told = agency.step(dt, webState, mine);
      webState.told = [];
      for (const what of told) act(what);
    }
    // What the reader holds it watches, whatever the pointer does, and what it points at on the web it glances at.
    if (detour?.kind === 'witness' && detour.focus) {
      const aim = detour.focus.close && detour.focus.dock ? detour.focus.dock : detour.focus.at;
      looking.watch = 1;
      looking.look = Math.atan2(aim.y - spine[1].y, aim.x - spine[1].x);
    } else if (webState?.hover && !pointer && !detour) {
      const [dx, dy] = [webState.hover.x - spine[1].x, webState.hover.y - spine[1].y];
      if (Math.hypot(dx, dy) < AWARE_GIVE) {
        looking.watch = Math.max(looking.watch, 0.75);
        looking.look = Math.atan2(dy, dx);
      }
    }
    // Its head turns toward what it watches, as far as that goes round, less while it feeds.
    const relative = Math.atan2(Math.sin(looking.look - angle), Math.cos(looking.look - angle));
    const share = (leap || skid || doing?.kind === 'alarm') ? 0 : (body.feeding ? LOOK.feeding : 1) * looking.watch;
    const want = clamp(relative * 0.6, -LOOK.head, LOOK.head) * share;
    looking.yaw += (want - looking.yaw) * (1 - Math.exp(-LOOK.rate * dt));
    fx.yaw += looking.yaw;
    if (detour?.kind === 'stalk') fx.crouch += STALK.crouch * (detour.frozen ? 1 : 0.8);
    if (detour?.kind === 'witness') {
      // Low and wary while what the reader holds is far from falling in; up on its hind legs, jaws wide and trembling, when it is about to.
      const r = detour.ready;
      fx.crouch += WITNESS.crouch * (1 - r) * (detour.moving ? 0.5 : 1);
      if (r > 0.02) {
        for (const i of [0, 1]) fx.leg[i] = { up: r, along: rest[i].along + 12, out: rest[i].out * 0.8, z: WITNESS.rear * (0.7 + 0.3 * Math.sin(clock * 5 + i * 2)) };
        fx.jaw = 0.4 + 0.6 * r;
        fx.pitch += 0.22 * r;
        fx.side += Math.sin(clock * 34) * 0.9 * r;
        fx.spin = Math.max(fx.spin, 0.5 * r);
      }
    }
    if (detour?.kind === 'dead') {
      const under = ease(clamp(detour.t / 0.25, 0, 1)) * ease(clamp((detour.last - detour.t) / 0.3, 0, 1));
      for (let i = 0; i < 8; i++) fx.leg[i] = { up: under, along: rest[i].along * (1 - (1 - DEAD.legs[0]) * under), out: rest[i].out * (1 - (1 - DEAD.legs[1]) * under), z: 1.6 + (i < 2 ? 1.5 : 0) };
      fx.crouch += under;
      fx.roll += 0.28 * under;
      fx.pitch -= 0.1 * under;
      fx.jaw = 0.08;
      fx.up -= 2 * under;
    }
    if (swat) {
      swat.t += dt;
      const p = swat.t / SWAT.s;
      if (p >= 1) swat = null;
      else {
        const h = heading(1);
        const [rx, ry] = [swat.at.x - spine[1].x, swat.at.y - spine[1].y];
        const reach = Math.min(Math.hypot(rx, ry) / SIZE, LEGS[0].long / SIZE * SWAT.reach);
        const bearing = Math.atan2(ry, rx);
        const [ux, uy] = [Math.cos(bearing), Math.sin(bearing)];
        const sideSign = swat.leg & 1 ? 1 : -1;
        const to = { along: (ux * h.x + uy * h.y) * reach, out: (-ux * h.y + uy * h.x) * reach * sideSign };
        const wind = ease(clamp(p / SWAT.wind, 0, 1));
        const blow = ease(clamp((p - SWAT.wind) / (SWAT.blow - SWAT.wind), 0, 1));
        const back = ease(clamp((p - SWAT.blow) / (1 - SWAT.blow), 0, 1));
        const lift = SWAT.high * wind * (1 - blow) + SWAT.low * blow;
        const reachNow = 0.45 + 0.55 * blow;
        const mixed = (1 - back);
        const i = swat.leg;
        fx.leg[i] = { up: 1 * (1 - 0.7 * back), along: rest[i].along + (to.along * reachNow - rest[i].along) * mixed * wind, out: rest[i].out + (to.out * reachNow - rest[i].out) * mixed * wind, z: (lift * mixed + 3 * back) };
        fx.pitch += 0.12 * wind * (1 - back);
        fx.jaw = 0.9;
        if (!swat.hit && p >= SWAT.blow) {
          swat.hit = true;
          const at = { x: spine[1].x + ux * reach * SIZE, y: spine[1].y + uy * reach * SIZE, power: swat.power };
          impacts.push(at);
          knocks.push(at);
          jolt = Math.max(jolt, swat.power * 0.7);
          temper.hit();
        }
      }
    }
  }

  // Carries out what heed.js has decided.
  function act(what) {
    const head = spine[0];
    const away = (from) => {
      const [dx, dy] = [spine[1].x - from.x, spine[1].y - from.y];
      const d = Math.hypot(dx, dy) || 1;
      return { x: dx / d, y: dy / d };
    };
    const toward = (point) => Math.atan2(point.y - spine[1].y, point.x - spine[1].x);
    const feedingNow = route[index]?.gait === 'feed' && !leap;
    if (what.kind === 'flinch') {
      // Back, on its feet, still facing it; or, at its meal, a jolt on the spot.
      const u = away(what.from);
      moves.start('rear', 0.45, angle);
      hop(RECOIL.hop * what.power);
      sway.vup += SWAY.gulp * what.power;
      jaw = JAW.open + JAW.snap;
      temper.alarm(angle);
      const dodging = !feedingNow && what.power > 0.45 && Math.random() < 0.5;
      if (dodging) {
        // A sidestep in the air, still facing it.
        const side = Math.random() < 0.5 ? -1 : 1;
        const reach = between(FLEE.dodge);
        let to = { x: head.x + (-u.y * side * 0.9 + u.x * 0.45) * reach, y: head.y + (u.x * side * 0.9 + u.y * 0.45) * reach };
        const bounds = room();
        if (bounds) to = { x: clamp(to.x, bounds.left + 60, bounds.right - 60), y: clamp(to.y, bounds.top + 60, bounds.bottom - 60) };
        launch('leap', to, { scout: 0.02, look: toward(what.from), after: toward(what.from) });
      } else if (!feedingNow) skid = { x: u.x, y: u.y, speed: RECOIL.speed[0] + (RECOIL.speed[1] - RECOIL.speed[0]) * what.power, slew: (Math.random() < 0.5 ? -1 : 1) * RECOIL.slew * Math.random(), along: toward(what.from) };
      detour = null;
    } else if (what.kind === 'flee') {
      const u = away(what.from);
      const far = FLEE.shortest + (FLEE.longest - FLEE.shortest) * what.power * (0.7 + 0.3 * Math.random());
      const bounds = room();
      const spread = (Math.random() - 0.5) * 0.9;
      const [c, s] = [Math.cos(spread), Math.sin(spread)];
      let to = { x: head.x + (u.x * c - u.y * s) * far, y: head.y + (u.x * s + u.y * c) * far };
      if (bounds) to = { x: clamp(to.x, bounds.left + 60, bounds.right - 60), y: clamp(to.y, bounds.top + 60, bounds.bottom - 60) };
      if (Math.hypot(to.x - head.x, to.y - head.y) < FLEE.shortest * 0.5) {
        // Cornered: it turns the other way along the wall.
        to = { x: head.x + (-u.y) * far * 0.8, y: head.y + u.x * far * 0.8 };
        if (bounds) to = { x: clamp(to.x, bounds.left + 60, bounds.right - 60), y: clamp(to.y, bounds.top + 60, bounds.bottom - 60) };
      }
      const backing = Math.random() < FLEE.backward;
      temper.alarm(angle);
      // A badly frightened one scatters: a few hops, zigzagging, each off the ground it has just touched.
      const hops = what.power > 0.75 ? 1 + Math.floor(Math.random() * 3) : 0;
      const chain = [];
      let [from, flip] = [to, Math.random() < 0.5 ? -1 : 1];
      for (let i = 0; i < hops; i++) {
        const turn = Math.atan2(u.y, u.x) + flip * between(FLEE.zig);
        const reach = between(FLEE.hop);
        from = { x: from.x + Math.cos(turn) * reach, y: from.y + Math.sin(turn) * reach };
        if (bounds) from = { x: clamp(from.x, bounds.left + 60, bounds.right - 60), y: clamp(from.y, bounds.top + 60, bounds.bottom - 60) };
        chain.push(from);
        flip = -flip;
      }
      launch('leap', to, { scout: between(FLEE.scout) * (1.2 - what.power), look: backing ? toward(what.from) : null, after: chain.length ? null : backing ? toward(what.from) : Math.atan2(to.y - head.y, to.x - head.x), chain });
      spare = between(SPARE) * 0.5;
    } else if (what.kind === 'swat') {
      if (swat || leap) return;
      swat = { t: 0, leg: Math.sin(toward(what.at) - angle) > 0 ? 1 : 0, at: what.at, power: what.power };
      jaw = JAW.open + JAW.snap;
    } else if (what.kind === 'threat') {
      doing = { kind: 'alarm', t: 0, last: ALARM.s, at: what.at };
      calm = ALARM.s + ALARM.rest * 0.4;
      temper.alarm(angle);
    } else if (what.kind === 'strike') {
      const d = Math.hypot(what.at.x - head.x, what.at.y - head.y);
      if (d < 70) return act({ kind: 'swat', at: what.at, power: 0.8 });
      const u = { x: (what.at.x - head.x) / d, y: (what.at.y - head.y) / d };
      const to = { x: what.at.x - u.x * JOLT.reach, y: what.at.y - u.y * JOLT.reach };
      launch('pounce', to, { scout: 0.1, blow: 0.9 });
    } else if (what.kind === 'dead') {
      // Curled up with its legs under it and still, as a spider plays dead; it comes to with a shake.
      if (leap) return;
      moves.clear();
      swat = null;
      doing = null;
      skid = null;
      detour = { kind: 'dead', t: 0, last: between(DEAD.s) };
      resume ??= index >= route.length ? route.at(-1) ?? null : null;
      temper.drives.caution = clamp(temper.drives.caution + 0.3, 0, 1);
    } else if (what.kind === 'stalk' || what.kind === 'inspect') {
      if (feedingNow) return;
      resume ??= index >= route.length ? route.at(-1) ?? null : null;
      moves.clear();
      detour = { kind: what.kind, t: 0, at: what.at, tap: what.tap };
    } else if (what.kind === 'shoot') {
      // A thread shot at the hand: it turns on it, its abdomen thrown up, and the silk goes out and sticks where the hand is.
      if (feedingNow || leap || swat || detour) return;
      moves.start('pulse', SHOT.spin, angle);
      angle += clamp(Math.atan2(Math.sin(toward(what.at) - angle), Math.cos(toward(what.at) - angle)), -0.8, 0.8);
      sway.vup += YANK.up * 1.4;
      jaw = JAW.open + JAW.snap;
      const tail = spine.at(-1);
      trails.push({ from: { x: what.at.x, y: what.at.y }, to: { x: tail.x, y: tail.y }, fade: 1.6, power: 0.8, shot: 0 });
      if (trails.length > TRAIL.most) trails.shift();
    } else if (what.kind === 'witness' || what.kind === 'ritual') {
      if (leap || detour?.kind === 'dead') return;
      resume ??= index >= route.length ? route.at(-1) ?? null : null;
      moves.clear();
      swat = null;
      doing = null;
      detour = what.kind === 'witness' ? { kind: 'witness', t: 0, ready: 0, gone: 0, focus: null } : { kind: 'ritual', t: 0, stage: 'go', last: -Infinity };
    } else if (what.kind === 'release') {
      if (detour?.kind === 'ritual') endDetour();
    } else if (what.kind === 'devour') {
      // What the reader has let fall into another it bites through: in one blow if it is close, else in a pounce that lands on it.
      if (leap || detour?.kind === 'dead') return;
      detour = null;
      doing = null;
      swat = null;
      skid = null;
      moves.clear();
      resume ??= index >= route.length ? route.at(-1) ?? null : null;
      const d = Math.hypot(what.at.x - head.x, what.at.y - head.y) || 1;
      if (d < DEVOUR.short) act({ kind: 'swat', at: what.at, power: DEVOUR.blow });
      else {
        const u = { x: (what.at.x - head.x) / d, y: (what.at.y - head.y) / d };
        launch('pounce', { x: what.at.x - u.x * JOLT.reach, y: what.at.y - u.y * JOLT.reach }, { scout: DEVOUR.scout, blow: DEVOUR.blow });
      }
    } else if (what.kind === 'spit') {
      // A fusion put back: it heaves it up again, jaws wide.
      if (leap || detour?.kind === 'dead') return;
      moves.start('hiss', 0.9, angle);
      hop(7 * SIZE);
      jaw = JAW.open + JAW.snap;
      sway.vup += SWAY.gulp * 0.8;
      knocks.push({ x: what.at.x, y: what.at.y, power: 0.7 });
    }
  }

  // What it does in answer to the web and what it does of its own accord:
  // standing or walking, it draws moves from the catalog, and where they
  // put its parts is kept in `fx` for the steps that follow.
  function behave(dt) {
    calm = Math.max(calm - dt, 0);
    if (doing) {
      doing.t += dt;
      if (doing.t >= doing.last) doing = null;
    }
    const going = Boolean(route[index]) && !leap && !skid && speed > 1 && !feeding;
    const gait = route[index]?.gait;
    const now = doing ? (doing.kind === 'alarm' ? 'alarm' : null) : leap || skid ? null : detour ? (detour.kind === 'dead' ? null : speed > 1 ? 'walking' : 'standing') : held ? 'standing' : gait === 'feed' ? 'feeding' : gait === 'tow' && going ? 'towing' : going ? 'walking' : index >= route.length ? 'standing' : null;
    Object.assign(fx, blankFx());
    current = now;
    moves.step(dt, now, angle, clock, rest, fx, mood);
    attend(dt, now);
    slow(temper.step(dt, angle, now));
    if (fx.face !== null && now === 'standing') face(fx.face, dt);
    // Its blows land ahead of its head, and the web and the page feel them.
    for (const power of fx.hits) {
      const head = spine[0];
      const h = heading(0);
      const at = { x: head.x + h.x * JOLT.reach, y: head.y + h.y * JOLT.reach, power };
      impacts.push(at);
      knocks.push(at);
      jolt = Math.max(jolt, power);
      temper.hit();
    }
  }

  function step(dt) {
    clock += dt;
    if ((moodIn -= dt) <= 0) {
      moodTo = Math.random() ** 0.6; // it runs restless more often than calm
      moodIn = between(MOOD.every);
    }
    // Its temper sets how restless it is, and a mood of its own wanders about that.
    mood += (clamp(temper.mood + (moodTo - 0.5) * MOOD.wander, 0, 1) - mood) * (1 - Math.exp(-MOOD.rate * dt));
    jolt *= Math.exp(-JOLT.decay * dt);
    const [was, facing] = [speed, angle];
    behave(dt);
    steer(dt);
    shove();
    const turning = Math.atan2(Math.sin(angle - facing), Math.cos(angle - facing)) / Math.max(dt, 1e-3);

    for (let i = 1; i < spine.length; i++) {
      let [dx, dy] = [spine[i].x - spine[i - 1].x, spine[i].y - spine[i - 1].y];
      if (i > 1) {
        // No more bent than the joint allows: past it, the part behind is swung round with the one ahead.
        const back = Math.atan2(spine[i - 1].y - spine[i - 2].y, spine[i - 1].x - spine[i - 2].x);
        const bent = Math.atan2(Math.sin(Math.atan2(dy, dx) - back), Math.cos(Math.atan2(dy, dx) - back));
        const most = BEND[i - 2];
        if (Math.abs(bent) > most) [dx, dy] = [Math.cos(back + Math.sign(bent) * most), Math.sin(back + Math.sign(bent) * most)];
      }
      const length = Math.hypot(dx, dy) || 1;
      spine[i].x = spine[i - 1].x + (dx / length) * SPINE_GAP[i - 1];
      spine[i].y = spine[i - 1].y + (dy / length) * SPINE_GAP[i - 1];
    }

    // Crouched to jump, low as it lands, and up again after.
    crouch += (Math.min((leap && !leap.flying ? (leap.scouting ? SCOUT.crouch : 1) : coil > 0 ? COIL.crouch : 0) + fx.crouch, 1) - crouch) * (1 - Math.exp(-CROUCH.rate * dt));
    coil = Math.max(coil - dt, 0);
    carry(dt, turning, was);
    stepLegs(dt);
    stepFeelers(dt);

    // Jaws tucked in on the move, open and working when it stands or feeds,
    // and spread wide when it rears.
    const working = JAW.open + Math.sin(clock * (feeding ? JAW.feedRate : JAW.rate)) * JAW.work;
    const want = fx.jaw ?? (speed > 1 && !feeding ? JAW.shut : working);
    jaw += (want - jaw) * (1 - Math.exp(-JAW.follow * dt));

    if (hopping && (hopping.t += dt) >= HOP.s) hopping = null;
    throb *= Math.exp(-THROB_DECAY * dt);
    check.left = Math.max(check.left - dt, 0);
    lunge = Math.max(lunge - dt, 0);
    if (silk && !leap?.flying) silk.fade -= dt / SILK_S;
    for (const trail of trails) {
      trail.fade -= dt / TRAIL.s;
      if (trail.shot !== undefined) trail.shot = Math.min(trail.shot + dt / SHOT.s, 1);
    }
    trails = trails.filter((trail) => trail.fade > 0);
    spare = Math.max(spare - dt, 0);
    if (tether) tether.held = Boolean(leap);
    if (tether && !leap) tether.fade -= dt / SWING.fade;
    if (tether?.fade <= 0) tether = null;
    if (silk?.fade <= 0) silk = null;
    for (const gulp of gulps) gulp.at += dt / GULP_S;
    gulps = gulps.filter((gulp) => gulp.at < 1);
  }

  // Takes a word of the given worth in at the mouth, the `at`th of a sentence
  // of `of`: the jaws snap and the body jerks, and its temper may make
  // more of it. `fullness` is how full that leaves it.
  function swallow(worth, fullness, at = 0, of = 1) {
    jaw = JAW.open + JAW.snap;
    crouch = Math.min(crouch + CROUCH.gulp, 1);
    sway.vup -= SWAY.gulp;
    gulps.push({ at: 0, worth });
    fill = fullness;
    slow(temper.word(worth, at, of, angle));
  }

  // It has the whole of a sentence of the given worth: it tears it loose, and its temper says how it finishes it.
  function devour(worth) {
    surge();
    slow(temper.close({ worth }, angle));
  }

  // Lets a word out at the mouth, into the web: the jaws open wide.
  // `fullness` is how full that leaves it.
  function lay(fullness) {
    jaw = JAW.open + JAW.snap;
    fill = fullness;
  }

  // It hops `height` px off the page where it is, jaws snapping, after a crouch.
  function hop(height) {
    if (leap || hopping) return;
    hopping = { t: 0, height };
    crouch = Math.max(crouch, COIL.crouch);
    jaw = JAW.open + JAW.snap;
  }

  // Stops it dead for a beat, as when it comes upon a prize.
  function halt() {
    slow({ s: HOLD_S, pace: 0 });
  }

  // A sentence is complete, eaten or laid: its abdomen swells for a moment.
  function surge() {
    throb = 1;
    // It tears the sentence loose with a yank of its whole body, its jaws snapping.
    sway.vside += YANK.side * (Math.random() < 0.5 ? -1 : 1);
    sway.vup += YANK.up;
    jaw = JAW.open + JAW.snap;
  }

  // It stops and regards `point` for `seconds`, unless it is in the air or alarmed.
  function regard(point, seconds) {
    if (leap || doing?.kind === 'alarm') return;
    moves.clear();
    doing = { kind: 'regard', t: 0, last: seconds, at: point, from: angle };
  }

  // The web it is on is shaken at `point`: unless it is feeding, in the air,
  // or has only just been startled, it freezes, turns on it and rears.
  function sense(point) {
    if (calm > 0 || leap || route[index]?.gait === 'feed') return;
    if (clips) temper.alarm(angle);
    else moves.start('rear', ALARM.s, angle);
    doing = { kind: 'alarm', t: 0, last: ALARM.s, at: point };
    calm = ALARM.s + ALARM.rest;
  }

  return {
    spine,
    legs,
    feelers,
    place,
    follow,
    step,
    swallow,
    devour,
    lay,
    halt,
    surge,
    hop,
    regard,
    sense,
    // Says what the web is doing, each frame: `{ hand, told, drawer, calm }` (agency.js).
    web(state) {
      webState = state;
    },
    // Stops its route while the reader reads, or lets it go on; it stays alive, and answers the web.
    hold(on) {
      held = on;
    },
    // Tells it where the reader's pointer is, `{ x, y }` in page coordinates, or null when there is none.
    heed(point) {
      pointer = point;
    },
    // The reader clicks at `point`.
    poke(point) {
      const what = heedBrain.poke(point, { x: spine[1].x, y: spine[1].y, drives: temper.drives, leaping: Boolean(leap || skid) });
      if (what) act(what);
    },
    // The reader scrolls the page by hand at `speed` px/s (down is positive): the crawler, holding on, is jerked by every change of it, its abdomen thrown, and crouches
    // as it speeds up.
    jostle(speed) {
      const change = clamp(speed - scrolled, -6000, 6000);
      scrolled = speed;
      sway.vup += clamp(-change * 0.012, -SWAY.gulp, SWAY.gulp);
      sway.vside += (Math.random() - 0.5) * Math.abs(change) * 0.002 * SIZE;
      crouch = Math.min(crouch + Math.abs(change) / 40000, 1);
    },
    // Says what the page is seen through, `() => ({ left, top, right, bottom })` in page coordinates, which it flees within.
    watch(find) {
      room = find;
    },
    // Whether it is out on the web, in answer to what the reader does there: the page is not to follow it.
    get attending() {
      return Boolean(detour && (detour.kind === 'witness' || detour.kind === 'ritual' || detour.tap));
    },
    // Whether it is away from its route in answer to the pointer.
    get detouring() {
      return Boolean(detour || leap?.free || swat);
    },
    // Says where it may hook a thread on, for a swing, instead of on thin air:
    // `find(near, within)` gives the nearest post within `within` px of `near`.
    hook(find) {
      hooks = find;
    },
    // Where it has taken off and landed, and how hard, since this was last
    // asked: `{ x, y, power }`, for the web to feel.
    knocks() {
      return knocks.splice(0);
    },
    // Where its blows have landed, and how hard, since this was last asked: `{ x, y, power }`.
    impacts() {
      return impacts.splice(0);
    },
    // What drives it: `{ hunger, fury, caution, fatigue }`, each 0 to 1.
    get drives() {
      return temper.drives;
    },
    // How much room each joint of the spine takes up to either side, in px.
    get girth() {
      return GIRTH.map((radius, i) => radius + SWELL[i] * fill);
    },
    get gulps() {
      return gulps;
    },
    // How far the moves have turned its spinnerets out, from 0 to 1.
    get spin() {
      return fx.spin;
    },
    // The moves it is making of its own accord, by name.
    get moves() {
      return moves.active;
    },
    get fill() {
      return fill;
    },
    get throb() {
      return throb;
    },
    // How far each jaw is swung out from straight ahead, in radians.
    get jaw() {
      return jaw;
    },
    // How far it has turned over in the air, `{ pitch, roll }` radians: head over heels, and about its length.
    get tumble() {
      return tumbled;
    },
    // How high its body is off the page, in px.
    get lift() {
      return body();
    },
    // How its body leans: `roll`, radians its side +1 is down; `pitch`,
    // radians its head is raised; `sway`, px its abdomen hangs out to side
    // +1 and up from where the spine has it.
    get tilt() {
      return { roll, pitch, sway };
    },
    // The dragline of its last jump, from where it left the page to its
    // tail: `{ from, fade }`, `fade` from 1 down to 0 once it has landed.
    get silk() {
      return silk;
    },
    // The draglines it has left lying where it landed: `{ from, to, fade, power }`.
    get trails() {
      return trails;
    },
    // Its thread on a swing, from its tail to its anchor, or a cord it rides, from
    // where it set off, `from`, to its anchor, `high` px off the page:
    // `{ anchor, from, high, fade, shot, held }`,
    // `held` while it is on it, `shot` from 0 to 1 as it is shot to the anchor, `fade` from 1 down to 0
    // once it has let go.
    get tether() {
      return tether;
    },
    // What it is doing in the air, or gathering itself for: `leap`, `pounce`, `swing` or `zip`, or null.
    get flight() {
      return leap ? (leap.flying ? leap.kind : `${leap.kind}-load`) : null;
    },
    get done() {
      return index >= route.length && !detour && !leap?.free;
    },
    // Whether it is stopped regarding something.
    get regarding() {
      return doing?.kind === 'regard';
    },
    // The waypoint currently being headed for, if any.
    get waypoint() {
      return route[index] ?? null;
    },
  };
}
