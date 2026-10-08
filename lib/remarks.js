// Remarks: what the crawler points out to the reader as it eats, besides
// keeping it. Of the kept sentences, those that would surprise a reader who
// knows the subject only in general, and those whose figures are worth
// remembering. Jev picks them one at a time from what is left, and says when
// none is left worth it; there are never more than a few of each, so that
// they stand out.

import { askAll } from './jev.js';
import { choice, keyed, quote } from './questions.js';
import { summaryOf } from './triage.js';

const MOST = 3; // of each, the most it points out
const OPTIONS = 255; // the most a choice can be between

const SURPRISE = {
  instructions: { question: 'A reader who knows the subject of `document` only in general reads these sentences. Which one would most make them stop and think "I did not know that": something unexpected, counterintuitive or striking, not merely one more fact?' },
  none: 'None: none of these would surprise such a reader.',
};

const FIGURE = {
  instructions: { question: 'Which of these sentences has the figure most worth remembering of `document`: a size, amount, rate, record, share or date the reader should take away, not one that only numbers, places or cites something?' },
  none: 'None: none of their figures is worth remembering.',
};

// Of `sentences`, the few Jev picks one after another as `instructions` ask,
// until it answers `none`: their indexes. The sentences are quoted in the
// options: named by their place in a long list, Jev picks among them nearly
// at random (measured 2026-10-07).
async function few(ask, state, sentences, { instructions, none }) {
  const picked = [];
  let left = sentences.map((_, i) => i);
  while (picked.length < MOST && left.length) {
    const offered = left.slice(0, OPTIONS - 1);
    const { choice: answer } = (await askAll(ask, state, { pick: choice(instructions, { ...keyed('s', offered.map((i) => quote(sentences[i].text))), none }) })).pick;
    if (answer === 'none') break;
    const at = offered[Number(answer.slice(1))];
    picked.push(at);
    left = left.filter((i) => i !== at);
  }
  return picked;
}

// For each of the `kept` sentences, `{ surprise, figures }`: whether the
// crawler points it out as surprising, and its figures as worth remembering.
export async function remark(doc, kept, ask) {
  const { state } = summaryOf(doc, kept);
  const counted = kept.flatMap(({ text }, i) => (/\d/.test(text) ? [i] : []));
  const [surprises, figures] = await Promise.all([few(ask, state, kept, SURPRISE), few(ask, state, counted.map((i) => kept[i]), FIGURE).then((picked) => picked.map((k) => counted[k]))]);
  return kept.map((_, i) => ({ surprise: surprises.includes(i), figures: figures.includes(i) }));
}
