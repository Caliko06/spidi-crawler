// The letters in flight: a word the crawler eats leaves the page letter by
// letter and is drawn into its mouth, wherever the mouth has got to by then.
// They are copies set exactly over the word, in document coordinates; the
// word itself stays where it was, as a ghost.
//
// Each letter is a body on a spring to the mouth, the spring stiffening the
// longer it flies, so it comes off the page slowly and goes in fast, and is
// whipped about by a head that thrashes. While the jaws are at work on a
// mouthful (`gripped`) the letters that come to the mouth hang in them rather
// than going down, and a blow that lands (`strike`) tears what is near it
// apart: the letters are thrown out spinning, full size again, and drawn back
// in. What hangs in the jaws goes down once they let go.

import { between } from './util.js';

const STAGGER_S = 0.011; // each letter of a word leaves this long after the one before
const PULL = { k: 170, grow: 14, damp: 0.8 }; // the spring to the mouth, 1/s^2 as a letter leaves, how much stiffer for each second it flies, and its damping against critical
const DOWN = 6; // px from the mouth at which a letter is down
const LATEST_S = 1.5; // seconds of flight after which a letter is down wherever it is, unless the jaws hold it
const SHRINK = 0.2; // the size a letter gets to the mouth at
const JAWS = { reach: 10, size: 0.5, most: 40 }; // px about the mouth a letter hangs in the jaws, at what size, and how many it holds at most
const TEAR = { reach: 120, push: 950, spread: 0.7, spin: 16, slack: 0.15 }; // px about a blow within which letters are thrown; px/s at the blow for power 1; radians either side of straight away; rad/s of spin; what is left of a letter's flight time (and so of the spring's stiffness)
const SPLIT = { odds: 0.55, apart: 0.45, spin: 0.8 }; // how likely a letter a blow tears is torn in two, at full power, the share of the blow's push the halves fly apart by, and how much of its spin they take
const BURST = { speed: [260, 620], spin: 14 }; // px/s the letters of a name torn off the web burst out at, and rad/s they spin
const SPIN_DAMP = 3; // 1/s
const MOUTHFUL = new Set(['thrash', 'tear', 'chew', 'wrap', 'stab']); // the clips in which the jaws work on what they hold

// Whether the jaws are at work on a mouthful, from the moves the crawler is making.
export const gripping = (moves) => moves.some((name) => MOUTHFUL.has(name));

export function createFlight(layer) {
  let last = null; // where the mouth was a step ago, to know how fast it goes
  let flying = []; // the letters: where each left from (`x0`, `y0`), is (`x`, `y`) and goes (`vx`, `vy`), its turn and spin, seconds it has flown (below 0 while it waits its turn), how far it was from the mouth when it last set off, and whether the jaws hold it

  // The `word` of the page, of the given `worth`, comes off it; `back`
  // when the crawler takes it from its right end.
  function eat(word, worth, back) {
    const holder = layer.appendChild(document.createElement('span'));
    holder.className = `is-${worth}`;
    holder.style.font = getComputedStyle(word.range.startContainer.parentElement).font; // an emphasised word flies in its own face
    holder.style.lineHeight = `${word.bottom - word.top}px`; // the box of the word itself, not of its line
    holder.style.translate = `${word.left}px ${word.top}px`;
    const letters = [...word.text].map((letter) => {
      const el = holder.appendChild(document.createElement('b'));
      el.textContent = letter;
      return el;
    });
    letters.forEach((el, i) => {
      const turn = back ? letters.length - 1 - i : i;
      const [x, y] = [word.left + el.offsetLeft + el.offsetWidth / 2, (word.top + word.bottom) / 2];
      flying.push({ el, holder, x0: x, y0: y, x, y, vx: 0, vy: 0, turn: 0, spin: 0, age: -turn * STAGGER_S, from: null, held: null });
    });
  }

  // Moves every letter on toward `mouth`, a point of the page; `gripped` while the jaws are at work on a mouthful.
  function step(dt, mouth, gripped) {
    let held = 0;
    // The spring is damped against the mouth's own way, so a letter keeps up with a mouth on the move.
    const [mx, my] = last && dt > 0 ? [(mouth.x - last.x) / dt, (mouth.y - last.y) / dt] : [0, 0];
    last = { x: mouth.x, y: mouth.y };
    for (const letter of flying) {
      letter.age += dt;
      if (letter.age <= 0) continue;
      letter.from ??= Math.hypot(mouth.x - letter.x, mouth.y - letter.y) || 1;
      if (letter.held && !gripped) letter.held = null; // the jaws let go: it goes down
      const to = letter.held ? { x: mouth.x + letter.held.x, y: mouth.y + letter.held.y } : mouth;
      const k = PULL.k * (1 + PULL.grow * letter.age);
      const c = 2 * PULL.damp * Math.sqrt(k);
      letter.vx += (k * (to.x - letter.x) - c * (letter.vx - mx)) * dt;
      letter.vy += (k * (to.y - letter.y) - c * (letter.vy - my)) * dt;
      letter.x += letter.vx * dt;
      letter.y += letter.vy * dt;
      letter.spin *= Math.exp(-SPIN_DAMP * dt);
      letter.turn += letter.spin * dt;
      const off = Math.hypot(mouth.x - letter.x, mouth.y - letter.y);
      if (!letter.held && off < DOWN + (gripped ? JAWS.reach : 0)) {
        if (!gripped) letter.down = true;
        else {
          const a = Math.random() * Math.PI * 2;
          letter.held = { x: Math.cos(a) * JAWS.reach * Math.random(), y: Math.sin(a) * JAWS.reach * Math.random() };
        }
      }
      if (letter.held) held += 1;
      if (!letter.held && letter.age > LATEST_S) letter.down = true;
      const near = letter.held ? JAWS.size : SHRINK + (1 - SHRINK) * Math.min(off / letter.from, 1);
      letter.el.style.translate = `${letter.x - letter.x0}px ${letter.y - letter.y0}px`;
      letter.el.style.rotate = `${letter.turn}rad`;
      letter.el.style.scale = near;
    }
    // A mouthful has room for so many: the first in go down.
    for (const letter of flying) if (letter.held && held > JAWS.most) (letter.held = null), (letter.down = true), (held -= 1);
    for (const letter of flying.filter(({ down }) => down)) letter.el.style.visibility = 'hidden';
    flying = flying.filter(({ down }) => !down);
    for (const holder of [...layer.children]) if (!flying.some((letter) => letter.holder === holder)) holder.remove();
  }

  // A name torn off the web: its letters burst out from where it hung, spinning, and are drawn into the mouth.
  function scatter(text, centre, font) {
    const holder = layer.appendChild(document.createElement('span'));
    holder.className = 'is-name';
    holder.style.font = font;
    holder.style.letterSpacing = '0.06em';
    holder.style.lineHeight = '1';
    const letters = [...text].map((letter) => Object.assign(holder.appendChild(document.createElement('b')), { textContent: letter }));
    const [width, height] = [holder.offsetWidth, holder.offsetHeight];
    holder.style.translate = `${centre.x - width / 2}px ${centre.y - height / 2}px`;
    for (const el of letters) {
      const [x, y] = [centre.x - width / 2 + el.offsetLeft + el.offsetWidth / 2, centre.y];
      const away = Math.atan2(y - centre.y + (Math.random() - 0.5) * 24, x - centre.x + (Math.random() - 0.5));
      const push = between(BURST.speed);
      flying.push({ el, holder, x0: x, y0: y, x, y, vx: Math.cos(away) * push, vy: Math.sin(away) * push - 120, turn: 0, spin: (Math.random() * 2 - 1) * BURST.spin, age: 1e-3, from: null, held: null });
    }
  }

  // A blow lands at `x`, `y` with the given `power`, 0 to 1: what is near it is torn apart and thrown.
  function strike({ x, y, power }) {
    for (const letter of [...flying]) {
      const off = Math.hypot(letter.x - x, letter.y - y);
      if (off > TEAR.reach) continue;
      letter.age = Math.max(letter.age, 1e-3); // a letter waiting its turn is torn off with the rest
      const away = (off > 1 ? Math.atan2(letter.y - y, letter.x - x) : Math.random() * Math.PI * 2) + (Math.random() * 2 - 1) * TEAR.spread;
      const speed = TEAR.push * power * (1 - off / TEAR.reach) * (0.5 + Math.random());
      letter.vx += Math.cos(away) * speed;
      letter.vy += Math.sin(away) * speed;
      letter.spin += (Math.random() * 2 - 1) * TEAR.spin * power;
      letter.held = null;
      letter.age *= TEAR.slack;
      letter.from = null; // full size again as it sets off
      // Torn through: the one letter is two halves, thrown apart.
      if (!letter.half && Math.random() < SPLIT.odds * power) {
        const twin = letter.el.cloneNode(true);
        letter.holder.appendChild(twin);
        letter.el.style.clipPath = 'inset(0 50% 0 0)';
        twin.style.clipPath = 'inset(0 0 0 50%)';
        const side = Math.random() < 0.5 ? -1 : 1;
        const kick = speed * SPLIT.apart;
        flying.push({ ...letter, el: twin, half: true, vx: letter.vx - Math.sin(away) * kick * side, vy: letter.vy + Math.cos(away) * kick * side, spin: -letter.spin * SPLIT.spin });
        letter.half = true;
        letter.vx += Math.sin(away) * kick * side;
        letter.vy -= Math.cos(away) * kick * side;
      }
    }
  }

  // Every letter in flight is gone: the crawler has been taken elsewhere.
  function clear() {
    layer.replaceChildren();
    flying = [];
    last = null;
  }

  return { eat, scatter, step, strike, clear };
}
