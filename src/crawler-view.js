// The crawler as it is seen: a spider modelled part by part in art/spidi.py,
// each part placed where the pose of the body in src/crawler.js has its joint.
// Seen from straight above, x and z here are the page's x and y, and y is the
// height above it. Its markings are the only colour on it: the mark over its
// heart shows while it feeds, and the chevrons down its abdomen light one by
// one as it fills, each in the colour of what filled it. Its body is as high
// off the page as the crawler says, in a jump or a crouch, and leans as it
// says: rolled into a turn, its head dipped or raised, its abdomen swung. Each
// jaw's fang opens out of it as the jaw opens wide, and the spinnerets at the
// tail turn out while it spins a thread.

import { Color, Group, Matrix4, MeshPhysicalMaterial, Quaternion, Vector3 } from 'three';
import { PEDICEL, SIZE } from './crawler.js';
import { clamp } from './util.js';

const HEAD_REACH = 2.2 * SIZE; // px from the head joint forward to the hinges of the jaws
const JAW_APART = 1 * SIZE; // px from the middle to each hinge
const ABDOMEN = { grow: 0.1, throb: 0.08, follow: 0.45 }; // how much longer it is once full, and how much it swells when a sentence is finished; how much of the head's rise or dip it tips the other way by, hung from the waist
const FANG = { from: 0.35, span: 0.6, angle: 1.1 }; // the jaw angle from which a fang starts to open, and over how many radians it gets fully open; radians open
const SPIN = { spread: 0.5, lift: 0.3, dragline: 0.4 }; // radians each spinneret turns out and up while a thread is spun, and how much of that a dragline takes
const GLOW = { mark: 0.5, heart: 0.75 }; // how brightly a lit marking shows

const FUZZ = { sheen: 0.5, colour: '#9fb2c6', roughness: 0.6 }; // the soft light along the edge of its hair and velvet

const UP = new Vector3(0, 1, 0);
const at = ({ x, y, z = 0 }) => new Vector3(x, z, y);

// `model` is the scene of assets/spidi.glb; `palette` is `{ catch, prize }`,
// CSS colours. Returns `{ object, pose }`: `object` goes in the scene, and
// `pose(crawler)` puts it as the crawler is.
export function createCrawlerView(model, palette) {
  const measures = model.getObjectByName('spidi').userData;
  const scale = SIZE / measures.unit;
  const object = new Group();
  const worth = { catch: new Color(palette.catch), prize: new Color(palette.prize) };

  // One of the part called `name`, with whatever lies on it.
  const part = (name) => {
    const made = model.getObjectByName(name).clone();
    made.matrixAutoUpdate = false;
    made.traverse((child) => {
      child.castShadow = !child.name.startsWith('fur'); // its hair throws no shadow
      // Its shell and its hair catch light along their edges, as fine hair does.
      if (child.isMesh && child.material?.vertexColors && child.material.name !== 'mark') {
        const source = child.material;
        child.material = new MeshPhysicalMaterial().copy(source);
        Object.assign(child.material, { sheen: FUZZ.sheen, sheenColor: new Color(FUZZ.colour), sheenRoughness: FUZZ.roughness });
      }
    });
    return object.add(made) && made;
  };
  // A marking of its own colour, apart from the others'.
  const marking = (owner, name) => {
    const mesh = owner.getObjectByName(name);
    mesh.material = mesh.material.clone();
    mesh.castShadow = false;
    return mesh.material;
  };

  const prosoma = part('prosoma');
  const abdomen = part('abdomen');
  const heart = marking(abdomen, 'heart');
  const marks = Array.from({ length: measures.marks }, (_, i) => marking(abdomen, `chevron${i}`));
  const jaws = [part('chelicera_L'), part('chelicera_R')];
  const fangs = jaws.map((jaw) => jaw.children.find((child) => child.name.startsWith('fang')));
  const spinnerets = ['L', 'R'].map((side) => abdomen.getObjectByName(`spinneret_${side}`));
  const feelers = [part('palp_L'), part('palp_R')];
  // Each pair of legs is its own length; one is modelled for each, on the left.
  const legs = Array.from({ length: 8 }, (_, i) => ({ pair: i >> 1, upper: part(`femur_L${(i >> 1) + 1}`), lower: part(`tibia_L${(i >> 1) + 1}`), last: part(`tarsus_L${(i >> 1) + 1}`) }));
  let last = 'catch'; // the worth of what it swallowed last

  // Puts `made`, modelled along its own x from its joint, at `a` pointing at
  // `b`, as upright as that allows, `roll`ed about its length by as many
  // radians, its side +1 down: `along` and `across` times its modelled size,
  // and `mirror`ed to make a left part a right one.
  const sized = new Matrix4();
  function place(made, a, b, { along = 1, across = 1, mirror = false, roll = 0 } = {}) {
    const x = b.clone().sub(a).normalize();
    const side = x.clone().cross(UP).normalize();
    const up = side.clone().cross(x);
    const z = side.clone().multiplyScalar(Math.cos(roll)).addScaledVector(up, -Math.sin(roll));
    const y = up.multiplyScalar(Math.cos(roll)).addScaledVector(side, Math.sin(roll));
    made.matrix.makeBasis(x, y, z).setPosition(a).multiply(sized.makeScale(along * scale, across * scale, (mirror ? -across : across) * scale));
    made.matrixWorldNeedsUpdate = true;
  }
  // How much a part modelled `length` long is stretched to reach from `a` to `b`.
  const stretch = (a, b, length) => a.distanceTo(b) / (length * SIZE);

  // Turned over in the air, the whole of it turns about its thorax: head over heels about its side, or about its length.
  const turnOver = new Matrix4();
  const quarter = new Quaternion();
  function tumble(crawler, thorax, forward, side) {
    const { pitch, roll } = crawler.tumble;
    object.matrixAutoUpdate = pitch !== 0 || roll !== 0 ? false : true;
    if (object.matrixAutoUpdate) return object.matrix.identity();
    quarter.setFromAxisAngle(side, pitch).multiply(new Quaternion().setFromAxisAngle(forward, roll));
    turnOver.makeTranslation(thorax.x, thorax.y, thorax.z).multiply(new Matrix4().makeRotationFromQuaternion(quarter)).multiply(new Matrix4().makeTranslation(-thorax.x, -thorax.y, -thorax.z));
    object.matrix.copy(turnOver);
    object.matrixWorldNeedsUpdate = true;
  }

  function pose(crawler) {
    const [head, thorax, , tail] = crawler.spine.map(({ x, y }) => at({ x, y, z: crawler.lift }));
    const forward = head.clone().sub(thorax).normalize();
    const side = forward.clone().cross(UP);
    tumble(crawler, thorax.clone().setY(thorax.y + 3 * SIZE), forward.clone(), side.clone().normalize());
    const { roll, pitch, sway } = crawler.tilt;
    // Head and thorax are one rigid piece, the abdomen another, joined at the
    // waist behind the thorax: a raised or dipped head turns the front piece
    // about the waist, and the abdomen, hung from it, tips a little the other
    // way, so the two never come apart.
    const waist = thorax.clone().addScaledVector(forward, -PEDICEL);
    const about = (point) => {
      const reach = point.clone().sub(waist).dot(forward);
      return waist.clone().addScaledVector(forward, reach * Math.cos(pitch)).addScaledVector(UP, reach * Math.sin(pitch));
    };
    const [front, middle] = [about(head), about(thorax)];
    place(prosoma, middle, front, { roll });

    const swell = 1 + ABDOMEN.throb * crawler.throb;
    const along = (1 + ABDOMEN.grow * crawler.fill) * swell;
    tail.addScaledVector(side, sway.side).addScaledVector(UP, sway.up - Math.sin(pitch * ABDOMEN.follow) * waist.distanceTo(tail));
    const back = tail.sub(waist).normalize();
    // Its front stays at the waist however long it grows.
    const centre = waist.clone().addScaledVector(back, measures.abdomen[0] * SIZE * along);
    place(abdomen, centre, centre.clone().sub(back), { along, across: (crawler.girth[2] / (measures.abdomen[1] * SIZE)) * swell, roll });
    head.copy(front);
    const lifted = front.y - crawler.lift; // how far the head is raised by its pitch, for the feelers

    const hinge = head.clone().addScaledVector(forward, HEAD_REACH);
    jaws.forEach((jaw, i) => {
      const out = i ? 1 : -1;
      const from = hinge.clone().addScaledVector(side, out * JAW_APART);
      place(jaw, from, from.clone().addScaledVector(forward, Math.cos(crawler.jaw)).addScaledVector(side, out * Math.sin(crawler.jaw)), { mirror: out > 0 });
    });

    // A fang opens out of its jaw as the jaw opens wide; the spinnerets spread while a thread is shot and held, and a little while a dragline is paid out.
    const open = clamp((crawler.jaw - FANG.from) / FANG.span, 0, 1);
    fangs.forEach((fang) => (fang.rotation.z = FANG.angle * open));
    const spun = Math.max(crawler.spin, crawler.tether ? crawler.tether.fade * (0.4 + 0.6 * crawler.tether.shot) : crawler.silk ? SPIN.dragline * crawler.silk.fade : 0);
    spinnerets.forEach((nub, i) => {
      nub.rotation.y = (i ? -1 : 1) * SPIN.spread * spun;
      nub.rotation.z = SPIN.lift * spun;
    });

    crawler.feelers.forEach((feeler, i) => {
      const [base, tip] = [at(feeler.base), at(feeler.tip)];
      base.y = measures.palpZ[0] * SIZE + crawler.lift + lifted;
      tip.y = measures.palpZ[1] * SIZE + crawler.lift + lifted;
      place(feelers[i], base, tip, { along: stretch(base, tip, measures.palp), mirror: feeler.side > 0 });
    });

    crawler.legs.forEach((leg, i) => {
      const [root, knee, ankle, foot] = [at(leg.root), at(leg.knee), at(leg.ankle), at(leg.foot)];
      const { pair, upper, lower, last } = legs[i];
      const bowed = leg.side > 0 === leg.along > 0; // a leg's shin bows away from the middle of the body's length
      place(upper, root, knee, { along: stretch(root, knee, measures.femur[pair]) });
      place(lower, knee, ankle, { along: stretch(knee, ankle, measures.tibia[pair]), mirror: bowed });
      place(last, ankle, foot, { along: stretch(ankle, foot, measures.tarsus[pair]), mirror: bowed });
    });

    // The mark over its heart shows in the colour of the word going down, and
    // fades as it gets there; a chevron is lit by the word that fills it.
    const gulp = crawler.gulps.at(-1);
    if (gulp) last = gulp.worth;
    heart.emissive.copy(worth[last]);
    heart.emissiveIntensity = gulp ? GLOW.heart * (1 - gulp.at) : 0;
    marks.forEach((mark, i) => {
      const lit = clamp(crawler.fill * marks.length - i, 0, 1);
      if (lit > 0 && mark.emissiveIntensity === 0) mark.emissive.copy(worth[last]);
      mark.emissiveIntensity = GLOW.mark * lit;
    });
  }

  return { object, pose };
}
