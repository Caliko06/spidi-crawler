// Segmentation: the sentences of a document's prose, in reading order. A
// sentence is addressed by character offsets into its block's text, so the
// page can find the very words it is made of.

import { split } from 'sentence-splitter';

const PROSE = new Set(['p', 'li', 'quote']);
// The splitter takes any number followed by a full stop for the index of a list
// item, and never ends a sentence there. Past the first word of a sentence it
// is the end of one, when a capital follows: "…since 1969. Earth stores…".
const AFTER_NUMBER = /(?<=\s\S*\d\.)\s+(?=\p{Lu})/u;

// `[{ block, start, end, text, section }]`: `block` indexes `blocks`, and
// `section` is the index of the heading the sentence comes under.
export function segment(blocks) {
  const sentences = [];
  let section = 0;
  blocks.forEach((block, index) => {
    if (!PROSE.has(block.kind)) {
      if (block.kind !== 'pre') section = index;
      return;
    }
    for (const node of split(block.text)) {
      if (node.type !== 'Sentence') continue;
      let start = node.range[0];
      for (const text of node.raw.split(AFTER_NUMBER)) {
        const end = start + text.length;
        const before = sentences.at(-1);
        // What follows a sentence with no space between them is still part of it: "…but conscience?—in which…".
        if (before?.block === index && before.end === start) Object.assign(before, { end, text: block.text.slice(before.start, end) });
        else if (/\p{L}/u.test(text)) sentences.push({ block: index, start, end, text, section });
        start = end + block.text.slice(end).match(/^\s*/)[0].length;
      }
    }
  });
  return sentences;
}

export const countWords = (text) => text.split(/\s+/).filter(Boolean).length;
// Where a sentence is, `{ block, start, end }`, as the plan tells it.
export const where = ({ block, start, end }) => ({ block, start, end });
