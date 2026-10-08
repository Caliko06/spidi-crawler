// A thread with weight: a chain of points hung between two ends that something
// else moves, each point carrying on the way it was going, held to the next by
// the length of the thread and no more. The thread is longer than the gap by
// its slack, so it bows, sags under gravity, trails behind an end that moves,
// whips when an end is let go, and rings when it is knocked.
//
// Position-based Verlet: a point's speed is how far it moved last step.

const POINTS = 6; // points in a chain, ends included
const ITERATIONS = 10; // times the lengths are put right in a step
const STEP = 1 / 60; // seconds a step is worth, at most

// `stiffness` is how much of the way back to the straight line between its ends
// a held thread is drawn in a step, from 0, a cord, to 1, a rod.
export function createThread({ damping = 0.94, gravity = 0, wind = 0, stiffness = 0 } = {}) {
  let points = null;
  let length = 0; // how long the thread is, once let go
  let clock = Math.random() * 100;

  // Advances every point that is not held, then puts the lengths right.
  // `first` and `last` are where the ends are held, or null for one let go.
  function step(dt, rest, first, last) {
    clock += dt;
    const keep = Math.pow(damping, dt / STEP);
    points.forEach((point, i) => {
      if ((i === 0 && first) || (i === points.length - 1 && last)) return;
      const sway = wind * Math.sin(clock * 0.9 + point.x * 0.011 + point.y * 0.017 + i);
      const [vx, vy] = [(point.x - point.px) * keep, (point.y - point.py) * keep];
      [point.px, point.py] = [point.x, point.y];
      point.x += vx + sway * dt * dt;
      point.y += vy + (gravity + sway * 0.4) * dt * dt;
    });
    if (first) Object.assign(points[0], first);
    if (last) Object.assign(points.at(-1), last);
    for (let pass = 0; pass < ITERATIONS; pass++) {
      for (let i = 0; i < points.length - 1; i++) {
        const [a, b] = [points[i], points[i + 1]];
        const [dx, dy] = [b.x - a.x, b.y - a.y];
        const gap = Math.hypot(dx, dy) || 1e-6;
        const pull = (gap - rest) / gap;
        const [fixedA, fixedB] = [i === 0 && first, i === points.length - 2 && last];
        const share = fixedA || fixedB ? 1 : 0.5;
        if (!fixedA) [a.x, a.y] = [a.x + dx * pull * share, a.y + dy * pull * share];
        if (!fixedB) [b.x, b.y] = [b.x - dx * pull * share, b.y - dy * pull * share];
      }
      if (first) Object.assign(points[0], first);
      if (last) Object.assign(points.at(-1), last);
    }
    if (first && last && stiffness) {
      points.forEach((point, i) => {
        const share = i / (points.length - 1);
        point.x += (first.x + (last.x - first.x) * share - point.x) * stiffness;
        point.y += (first.y + (last.y - first.y) * share - point.y) * stiffness;
      });
    }
  }

  function seed(a, b) {
    points = Array.from({ length: POINTS }, (_, i) => {
      const [x, y] = [a.x + ((b.x - a.x) * i) / (POINTS - 1), a.y + ((b.y - a.y) * i) / (POINTS - 1)];
      return { x, y, px: x, py: y };
    });
  }

  return {
    // Forgets the shape it had, for a new thread.
    reset() {
      points = null;
    },
    // Both ends held, at `a` and `b`, for `dt` seconds. The thread is as long
    // as the gap between them and `slack` more, as a share of it.
    hold(a, b, dt, slack) {
      if (!points) seed(a, b);
      length = Math.hypot(b.x - a.x, b.y - a.y) * (1 + slack);
      step(Math.min(dt, STEP * 2), length / (POINTS - 1), { x: a.x, y: a.y }, { x: b.x, y: b.y });
    },
    // Only the last end held, at `a`, the first let go: it keeps the length it had.
    let(a, dt) {
      if (!points) return;
      step(Math.min(dt, STEP * 2), length / (POINTS - 1), null, { x: a.x, y: a.y });
    },
    // Snapped, with its last end still held: each point is flung back toward that end, the loose end most, `power` px a step.
    recoil(power) {
      if (!points) return;
      const end = points.at(-1);
      points.forEach((point, i) => {
        const [dx, dy] = [end.x - point.x, end.y - point.y];
        const away = Math.hypot(dx, dy) || 1;
        const share = 1 - i / (points.length - 1);
        [point.px, point.py] = [point.x - (dx / away) * power * share, point.y - (dy / away) * power * share];
      });
    },
    // Shoves every point `radius` px from (x, y) off it, up to `power` px.
    knock(x, y, radius, power) {
      if (!points) return;
      for (const point of points.slice(1, -1)) {
        const [dx, dy] = [point.x - x, point.y - y];
        const away = Math.hypot(dx, dy) || 1;
        if (away > radius) continue;
        const push = power * (1 - away / radius);
        point.x += (dx / away) * push;
        point.y += (dy / away) * push;
      }
    },
    // Shoves every point within `band` px of the ring `ring` px from (x, y) off
    // it, most at the ring itself, up to `power` px: a wave passing over.
    ring(x, y, ring, band, power) {
      if (!points) return;
      for (const point of points.slice(1, -1)) {
        const [dx, dy] = [point.x - x, point.y - y];
        const away = Math.hypot(dx, dy) || 1;
        const off = Math.abs(away - ring);
        if (off > band) continue;
        const push = power * Math.cos((off / band) * (Math.PI / 2));
        point.x += (dx / away) * push;
        point.y += (dy / away) * push;
      }
    },
    // The thread as an SVG path, smooth through its points.
    get d() {
      if (!points) return '';
      const mid = (a, b) => `${(a.x + b.x) / 2} ${(a.y + b.y) / 2}`;
      let d = `M${points[0].x} ${points[0].y}L${mid(points[0], points[1])}`;
      for (let i = 1; i < points.length - 1; i++) d += `Q${points[i].x} ${points[i].y} ${mid(points[i], points[i + 1])}`;
      return `${d}L${points.at(-1).x} ${points.at(-1).y}`;
    },
  };
}
