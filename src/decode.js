// A line that resolves left to right out of noise, like a terminal locking on:
// what is already read is final, what is still ahead is not. Said once, then still.
const GLYPHS = '01<>/\\|+=*#';
const timers = new WeakMap();

export function say(el, text, reduced = matchMedia('(prefers-reduced-motion: reduce)').matches) {
  cancelAnimationFrame(timers.get(el));
  if (reduced || !text) { el.textContent = text; return; }
  const start = performance.now();
  const step = (now) => {
    const locked = Math.floor((now - start) / 18);
    if (locked >= text.length) { el.textContent = text; return; }
    const ahead = [...text.slice(locked, locked + 8)].map((c) => (c === ' ' ? c : GLYPHS[(Math.random() * GLYPHS.length) | 0])).join('');
    el.textContent = text.slice(0, locked) + ahead;
    timers.set(el, requestAnimationFrame(step));
  };
  timers.set(el, requestAnimationFrame(step));
}
