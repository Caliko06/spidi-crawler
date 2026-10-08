// Route planning: how the crawler gets to the next stretch of text it feeds
// on, and along it. Down a passage it weaves: along the lane under one line,
// round in the margin, and back along the next. To a stretch further on it
// goes by the gutter beside the text. It never cuts across the text. Plain
// geometry only.
//
// `ground` is `{ left, right }`, the x of the gutter on either side of the
// text. A stretch is `{ left, right, y }`: its extent and the lane under it.

import { SIZE } from './crawler.js';

const SAME_LANE = 4; // px of height within which the crawler is already on the stretch's lane
const NEAR = 110; // px of height it comes down across the margin, rather than by the gutter
const RUN_UP = 26 * SIZE; // px beyond the end of the stretch at which it joins its lane, so it comes to the stretch already running along it
const REST_DROP = 60 * SIZE; // px it walks along the gutter to rest, so its whole body ends up there

// From wherever the crawler is to `stretch`, then along it, feeding. A stretch
// that may be run `eitherWay` is come into at the end the crawler gets to
// first, and run to the other; one that may not, from left to right.
export function approach(from, stretch, ground, eitherWay) {
  const drop = stretch.y - from.y;
  const near = drop > -SAME_LANE && drop < NEAR;
  const gutter = !eitherWay || from.x - ground.left < ground.right - from.x ? ground.left : ground.right;
  const back = eitherWay && (near ? Math.abs(from.x - stretch.right) < Math.abs(from.x - stretch.left) : gutter === ground.right);
  const [start, end, out] = back ? [stretch.right, stretch.left, 1] : [stretch.left, stretch.right, -1];
  const feed = [
    { x: start, y: stretch.y, gait: 'skim' },
    { x: end, y: stretch.y, gait: 'feed' },
  ];

  // Further along the line it is already on.
  if (Math.abs(drop) < SAME_LANE && (start - from.x) * out <= 0) return feed;
  // A few lines down: round in the margin beyond the end it comes into.
  if (near) return [{ x: start + out * RUN_UP, y: stretch.y, gait: 'skim' }, ...feed];
  // Further than that: out to the gutter, flat out along it, and in along the lane.
  return [{ x: gutter, y: from.y, gait: 'skim' }, { x: gutter, y: stretch.y, gait: 'bolt' }, ...feed];
}

// Out of the text by the gutter on the side of the web, and over to `spot` on
// it. `spot` is a point that moves as the web does; the crawler heads for
// wherever it is.
export function carry(from, spot, ground) {
  return [{ x: ground.right, y: from.y, gait: 'skim' }, Object.assign(spot, { gait: 'haul' })];
}

// Out into the nearer gutter and a body length along it.
export function retreat(from, ground) {
  const gutter = from.x - ground.left < ground.right - from.x ? ground.left : ground.right;
  return [
    { x: gutter, y: from.y, gait: 'skim' },
    { x: gutter, y: from.y + REST_DROP },
  ];
}
