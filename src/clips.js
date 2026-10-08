// The clips the crawler acts out, keyed on its rig in Blender (art/clips.py)
// and read from assets/clips.json: a strike, a thrash, a tear, stabs of the
// fangs, a wrap in silk, a stomp, a threat, a gulp, a pluck at a strand, a
// drag and a chew. Each becomes a move of the catalog (moves.js): it holds
// the parts it keys, and each frame it says where they are, a little bigger
// or smaller and quicker or slower each time it is made (`amp`, `pace`).
//
// A frame says, in the crawler's units at size 1: `shove` [along, out, up],
// the thorax moved off where it stands; `turn` [pitch, roll, yaw]; `sway`
// [up, side] of the abdomen; `jaw` radians; `spin` 0 to 1; `palp` [along,
// out] of each feeler's tip from the head; and `feet`, for each leg in the
// order of crawler.js, [along, out, z, held], where it is against the thorax
// and how far the clip holds it off the page.
// A blow that lands is said in `fx.hits`, by how hard it is.

const CUT = 0.06; // seconds a clip cut short takes to let go
// The frames at which a clip's blows land, and how hard, from 0 to 1: the fangs going in, a foot slammed down, a strand plucked.
const HITS = {
  strike: [[14, 1]],
  stab: [[6, 0.45], [12, 0.45], [18, 0.6]],
  stomp: [[8, 0.8], [16, 0.95]],
  tear: [[20, 0.75]],
  thrash: [[4, 0.25], [8, 0.3], [12, 0.25], [16, 0.3]],
  gulp: [[5, 0.15]],
  pluck: [[8, 0.35], [17, 0.35], [27, 0.4]],
};

// Where a clip is at `t` seconds in, between the two frames either side.
function at(clip, fps, t) {
  const f = Math.min(Math.max(t * fps, 0), clip.frames.length - 1);
  const i = Math.min(Math.floor(f), clip.frames.length - 2);
  const s = f - i;
  const [a, b] = [clip.frames[i], clip.frames[i + 1]];
  const mix = (x, y) => (Array.isArray(x) ? x.map((v, k) => (Array.isArray(v) ? mix(v, y[k]) : v + (y[k] - v) * s)) : x + (y - x) * s);
  return { shove: mix(a.shove, b.shove), turn: mix(a.turn, b.turn), sway: mix(a.sway, b.sway), jaw: mix(a.jaw, b.jaw), spin: mix(a.spin, b.spin), palp: mix(a.palp, b.palp), feet: mix(a.feet, b.feet) };
}

// The moves of the clips in `data`, as assets/clips.json has them. `when`
// says, for each, in which states it may be made and how often it comes up
// of its own accord: `{ name: { on, often } }`; one with no `often` is only
// made when something makes it.
export function clipMoves(data, when) {
  const moves = {};
  for (const [name, clip] of Object.entries(data.clips)) {
    const length = (clip.frames.length - 1) / data.fps;
    const uses = clip.uses.filter((part) => !part.startsWith('leg'));
    const legs = clip.uses.filter((part) => part.startsWith('leg')).map((part) => Number(part.slice(3)));
    moves[name] = {
      on: when[name]?.on ?? ['standing'],
      often: when[name]?.often,
      last: [length, length],
      clip: true,
      uses,
      claims: () => legs.map((i) => `leg${i}`),
      then: when[name]?.then,
      pose(move, fx, rest) {
        const frame = at(clip, data.fps, move.t * move.pace);
        // The blows it has come to since it was last posed.
        const played = move.t * move.pace * data.fps;
        for (const [hit, power] of HITS[name] ?? []) if (hit <= played && hit > (move.played ?? -1)) fx.hits.push(power * move.amp);
        move.played = played;
        // A clip begins and ends at rest: it is only faded when it is cut short.
        const env = Math.min(1, (move.last - move.t) / CUT, move.t >= length / move.pace ? 0 : 1);
        const amp = move.amp * env;
        if (uses.includes('lean')) {
          fx.lean.along += frame.shove[0] * amp;
          fx.lean.out += frame.shove[1] * amp;
          fx.rise += frame.shove[2] * amp;
        }
        if (uses.includes('tilt')) {
          fx.pitch += frame.turn[0] * amp;
          fx.roll += frame.turn[1] * amp;
          fx.yaw += frame.turn[2] * amp;
        }
        if (uses.includes('abdomen')) {
          fx.up += frame.sway[0] * amp;
          fx.side += frame.sway[1] * amp;
        }
        if (uses.includes('jaws')) fx.jaw = frame.jaw;
        if (uses.includes('spinnerets')) fx.spin = Math.max(fx.spin, frame.spin * env);
        if (uses.includes('feelers')) fx.feeler = () => ({ along: frame.palp[0], out: frame.palp[1] });
        for (const i of legs) {
          const [along, out, z, held] = frame.feet[i];
          // Keyed on the page; held from the thorax, which the clip shoves: against it, then bigger or smaller about where the foot rests.
          const side = i & 1 ? 1 : -1;
          const [from, across] = [along - frame.shove[0], out - side * frame.shove[1]];
          fx.leg[i] = { up: held * env, along: rest[i].along + (from - rest[i].along) * move.amp, out: rest[i].out + (across - rest[i].out) * move.amp, z: z * move.amp };
        }
      },
    };
  }
  return moves;
}
