// The crawler on the page: a canvas just large enough for it, moved to where
// it is, in document coordinates so it scrolls with the page natively. What is
// drawn on it is the crawler seen from above and a good way down the page, in
// orthographic projection as isometric drawings are (no perspective: a px
// is a px wherever it stands), a px of the page to a unit of the scene where
// the page lies, lit from the top left of the page, with the shadow it casts
// on the page under it. What is higher is shifted up the page by as much as
// the eye leans (`height * tan(TILT)`), and its shadow comes apart from it,
// softer and fainter, so in a jump it leaves the page. The dragline of a jump is drawn over the
// page, from where it left the page to its tail, and the thread of a swing
// from its tail to its anchor. Both are threads with weight (thread.js): one
// is shot out to its anchor, taut while the crawler rides it, and once let go
// it whips free of the tail and fades; a dragline goes slack once it has
// landed.

import { Color, DirectionalLight, HemisphereLight, Mesh, MeshBasicMaterial, NeutralToneMapping, OrthographicCamera, PlaneGeometry, PMREMGenerator, Scene, ShadowMaterial, SphereGeometry, BackSide, VSMShadowMap, WebGLRenderer } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { SIZE } from './crawler.js';
import { createCrawlerView } from './crawler-view.js';
import { createThread } from './thread.js';

const CANVAS_SIZE = 190 * SIZE; // px, large enough for the crawler at full stretch and its shadow
const HEIGHT = 200; // how high above the page the lights stand; nothing of the crawler reaches as high
const EYE = 560; // px from the eye to the page; with no perspective it only has to clear the crawler
const TILT = 32 * Math.PI / 180; // how far the eye leans down the page from straight above, so the body shows its height and flanks
const KEY = { colour: '#fff3e2', strength: 3.3, from: [-0.75, 0.5, -0.4] }; // the light on the page, from its top left
const RIM = { colour: '#9db8d6', strength: 1.7, from: [0.75, 0.2, 0.55] }; // a cold light low on the far side, so the flank in shadow does not go flat
const SKY = { above: '#aeb9c8', below: '#0a0c10', strength: 0.25 };
const SHELL = 0.11; // how much of the room its shell reflects, so the planes are told apart by the key and the rim
const SHADOW = { darkness: 0.6, softness: 2, map: 1024, parts: 0.04, fades: 90 }; // its opacity and blur on the page, how much blurrier it gets per px of lift, and the lift in px that halves it
const FLOOR = 1.5; // px the plane that takes the shadow lies under the page, so the plane never shadows itself
const CONTACT = { softness: 7 }; // how soft the dark under its body is
const SILK = 0.3; // how strongly a fresh dragline shows
const CORD = { push: 2.5, radius: 60 }; // px a cord is pressed down by a crawler hung from it, as it rides, and px round it within which it is
const THREAD = { show: 0.7, taut: 0.01, slack: 0.1, damping: 0.9, wind: 6 }; // how strongly a thread shows, against a fresh dragline's; how much longer than its gap a thread riding is, and a dragline goes once it lies; how much of its speed a thread keeps a step, and the draught on it, px/s^2

export async function createOverlay(container) {
  const { scene: model } = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync('assets/spidi.glb');
  const silk = container.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'svg'));
  const dragline = silk.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'path'));
  const thread = silk.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'path'));
  // The draglines it leaves lying, each a thread fixed at both ends, with a bead of silk where it was fixed to the page.
  const lying = Array.from({ length: 5 }, () => ({ path: silk.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'path')), bead: silk.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'circle')), thread: createThread({ damping: THREAD.damping, wind: THREAD.wind * 0.35 }), of: null }));
  for (const { bead } of lying) bead.setAttribute('r', '1.1');
  const draglineThread = createThread({ damping: THREAD.damping, wind: THREAD.wind });
  const threadThread = createThread({ damping: THREAD.damping, wind: THREAD.wind });
  let [swing, trail] = [null, null]; // the thread and the dragline being drawn, to know when a new one begins
  const canvas = container.appendChild(document.createElement('canvas'));
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Number(new URLSearchParams(location.search).get('ratio')) || Math.max(devicePixelRatio, 2)); // drawn at least twice over and brought down, so its hair and edges are smooth; `?ratio=` sets it, for a machine that has no GPU
  renderer.setSize(CANVAS_SIZE, CANVAS_SIZE);
  renderer.toneMapping = NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = VSMShadowMap; // a blur of the shadow map, the same wherever the crawler is: the noisy sampling of a soft PCF shadow crawls over the page as it moves

  // Its colours are the page's, set in the stylesheet.
  const style = getComputedStyle(container);
  const palette = Object.fromEntries(['catch', 'prize'].map((name) => [name, style.getPropertyValue(`--crawler-${name}`).trim()]));

  const scene = new Scene();
  const view = createCrawlerView(model, palette);
  scene.add(view.object);
  scene.environment = studio(renderer);
  scene.environmentIntensity = SHELL;
  scene.add(new HemisphereLight(SKY.above, SKY.below, SKY.strength));

  const half = CANVAS_SIZE / 2;
  // As wide at the page as the canvas, which the lean stretches back up to full height.
  const camera = new OrthographicCamera(-half, half, half, -half, EYE / 2, EYE * 2);
  camera.up.set(0, 0, -1);
  canvas.style.scale = `1 ${1 / Math.cos(TILT)}`;

  const key = new DirectionalLight(KEY.colour, KEY.strength);
  key.castShadow = true;
  key.shadow.mapSize.set(SHADOW.map, SHADOW.map);
  key.shadow.radius = SHADOW.softness;
  key.shadow.blurSamples = 16;
  key.shadow.bias = -0.0004;
  Object.assign(key.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: HEIGHT * 4 });
  const rim = new DirectionalLight(RIM.colour, RIM.strength);
  // A light straight above that gives no light, only the soft dark under its body where it nearly touches the page.
  const contact = new DirectionalLight('#000000', 0);
  contact.castShadow = true;
  contact.shadow.mapSize.set(512, 512);
  contact.shadow.radius = CONTACT.softness;
  contact.shadow.blurSamples = 16;
  contact.shadow.bias = -0.0004;
  Object.assign(contact.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: HEIGHT * 4 });
  scene.add(key, key.target, rim, rim.target, contact, contact.target);

  const page = new Mesh(new PlaneGeometry(CANVAS_SIZE * 2, CANVAS_SIZE * 2).rotateX(-Math.PI / 2), new ShadowMaterial({ opacity: SHADOW.darkness }));
  page.receiveShadow = true;
  scene.add(page);

  function renderOne(crawler, dt) {
    const centre = crawler.spine[1];
    const left = Math.round(centre.x - half);
    const top = Math.round(centre.y - half);
    canvas.style.translate = `${left}px ${top}px`;

    // Everything that sees the crawler keeps over the middle of the canvas.
    const [x, z] = [left + half, top + half];
    camera.position.set(x, EYE * Math.cos(TILT), z + EYE * Math.sin(TILT));
    camera.lookAt(x, 0, z);
    page.position.set(x, -FLOOR, z);
    contact.target.position.set(x, 0, z);
    contact.position.set(x + 8, HEIGHT, z + 6);
    for (const [light, { from }] of [[key, KEY], [rim, RIM]]) {
      light.target.position.set(x, 0, z);
      light.position.set(x + from[0] * HEIGHT, from[1] * HEIGHT, z + from[2] * HEIGHT);
    }

    view.pose(crawler);
    // The higher it is, the further its shadow lies from it, the softer and the fainter.
    const up = Math.max(crawler.lift, 0);
    key.shadow.radius = SHADOW.softness + up * SHADOW.parts;
    page.material.opacity = SHADOW.darkness / (1 + up / SHADOW.fades);
    renderer.render(scene, camera);

    const tail = crawler.spine.at(-1);
    thread.style.opacity = crawler.tether ? crawler.tether.fade * THREAD.show : 0;
    if (crawler.tether !== swing) threadThread.reset();
    swing = crawler.tether;
    if (crawler.tether) {
      const { anchor, from, high, fade, shot, held } = crawler.tether;
      const start = from ?? tail; // a cord is fixed where it was shot from; a swing's thread runs from the tail
      if (held) {
        // Shot out, fast at first, then taut; the crawler hung from it weighs it down.
        const reach = 1 - (1 - shot) ** 3;
        threadThread.hold(start, { x: start.x + (anchor.x - start.x) * reach, y: start.y + (anchor.y - start.y) * reach }, dt, THREAD.taut);
        if (high && shot === 1) threadThread.knock(crawler.spine[1].x, crawler.spine[1].y, CORD.radius, CORD.push);
      } else threadThread.let(anchor, dt); // let go, the loose end whips free
      // A cord hangs as high above the page as the crawler holds it, seen from the lean of the eye.
      thread.style.translate = high ? `0 ${-high * Math.tan(TILT)}px` : '';
      thread.setAttribute('d', threadThread.d);
    }
    dragline.style.opacity = crawler.silk && crawler.flight ? SILK * crawler.silk.fade : 0;
    if (crawler.silk !== trail) draglineThread.reset();
    trail = crawler.silk;
    if (crawler.silk && crawler.flight) {
      const { from, fade } = crawler.silk;
      draglineThread.hold(from, tail, dt, THREAD.taut + (1 - fade) * THREAD.slack);
      dragline.setAttribute('d', draglineThread.d);
    }
  }

  // A dragline left lying is held where it was fixed and where it landed, and slackens and fades as it goes.
  function leave(crawler, dt) {
    lying.forEach((slot, i) => {
      const trail = crawler.trails[i];
      if (trail !== slot.of) slot.thread.reset();
      slot.of = trail ?? null;
      slot.path.style.opacity = slot.bead.style.opacity = trail ? SILK * Math.min(trail.fade * 1.6, 1) : 0;
      if (!trail) return;
      // A thread shot at something goes out from the tail, fast at first, and sticks where it lands.
      const reach = trail.shot === undefined ? 1 : 1 - (1 - trail.shot) ** 3;
      if (trail.shot === undefined) slot.thread.hold(trail.from, trail.to, dt, THREAD.taut + (1 - trail.fade) * THREAD.slack * 1.2);
      else slot.thread.hold(trail.to, { x: trail.to.x + (trail.from.x - trail.to.x) * reach, y: trail.to.y + (trail.from.y - trail.to.y) * reach }, dt, THREAD.taut + (1 - trail.fade) * THREAD.slack * 1.2);
      slot.path.setAttribute('d', slot.thread.d);
      slot.bead.style.opacity = trail.shot === undefined || trail.shot === 1 ? slot.bead.style.opacity : 0;
      slot.bead.setAttribute('cx', trail.from.x);
      slot.bead.setAttribute('cy', trail.from.y);
    });
  }

  return { render: (crawler, dt) => (renderOne(crawler, dt), leave(crawler, dt)) };
}

// What its shell reflects: a dim room with a wide soft light up toward the top left of the page.
function studio(renderer) {
  const room = new Scene();
  room.add(new Mesh(new SphereGeometry(50), new MeshBasicMaterial({ color: new Color('#1b222c'), side: BackSide })));
  const lamp = new Mesh(new PlaneGeometry(46, 30), new MeshBasicMaterial({ color: new Color('#fff6ea').multiplyScalar(3) }));
  lamp.position.set(-18, 34, -20);
  lamp.lookAt(0, 0, 0);
  const cold = new Mesh(new PlaneGeometry(30, 12), new MeshBasicMaterial({ color: new Color('#a9bccc').multiplyScalar(1.4) }));
  cold.position.set(34, 8, 28);
  cold.lookAt(0, 0, 0);
  room.add(lamp, cold);
  const generator = new PMREMGenerator(renderer);
  const { texture } = generator.fromScene(room, 0.03);
  generator.dispose();
  return texture;
}
