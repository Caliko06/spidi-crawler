// What the reader draws and marks with.

export const number = new Intl.NumberFormat('en');
// A probability, or any share, without its leading zero: .87
export const figure = (p) => p.toFixed(2).replace(/^0/, '');
// A new element in `parent`, with its class and text.
export const make = (tag, parent, className = '', text = '') => {
  const el = parent.appendChild(document.createElement(tag));
  if (className) el.className = className;
  el.textContent = text;
  return el;
};

// A block's text may be split among the links and emphasis in it: its text
// nodes, each with where it starts in the block's text, found once.
const texts = new WeakMap();
function textsOf(el) {
  if (!texts.has(el)) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes = [];
    for (let at = 0, node = walker.nextNode(); node; at += node.data.length, node = walker.nextNode()) nodes.push({ node, at });
    texts.set(el, nodes);
  }
  return texts.get(el);
}
// The text node of `el` and the offset in it of the place `offset` of its text.
function pointIn(el, offset) {
  const nodes = textsOf(el);
  let i = nodes.length - 1;
  while (i > 0 && nodes[i].at > offset) i -= 1;
  return [nodes[i].node, offset - nodes[i].at];
}
// The range of `el`'s text from `start` to `end`, to mark.
export const rangeIn = (el, start, end) => {
  const range = document.createRange();
  range.setStart(...pointIn(el, start));
  range.setEnd(...pointIn(el, end));
  return range;
};
// Where in `el`'s text the place `offset` of its text node `node` is.
export const offsetIn = (el, node, offset) => (textsOf(el).find((one) => one.node === node)?.at ?? 0) + offset;
