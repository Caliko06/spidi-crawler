// The shapes of what Jev is asked, as TypeSafe documents them
// (docs.typesafe.ai/primitives): a question is `{ type, instructions,
// criteria? }`, and its instructions and criteria may be strings or objects.
// A question's own material (the sentence it is about, the names it weighs)
// goes in its instructions object beside the `question`, which points at it,
// or at the state, by a path in backticks; the state holds only what the
// questions of one request share. All of it is what an answer is kept under,
// so none of it is changed without asking Jev again.

import { createHash } from 'node:crypto';

export const quote = (text) => `"${text}"`;

export const boolean = (instructions) => ({ type: 'boolean', instructions });
export const choice = (instructions, criteria) => ({ type: 'choice', instructions, criteria: shuffled(instructions, criteria) });
export const score = (instructions, criteria) => ({ type: 'score', instructions, criteria });

// Options `prefix0`, `prefix1`… for `values`, each as it is.
export const keyed = (prefix, values) => Object.fromEntries(values.map((value, i) => [`${prefix}${i}`, value]));

// Options that are items of a list Jev is shown, named by their path in it
// (`kept[3]`), so that what they say is read once, in the state, and not
// again in every question that offers them: `places` are their indexes.
export const listed = (path, places) => Object.fromEntries(places.map((i) => [`${path}[${i}]`, null]));
// The index of an option `listed` offered.
export const placeOf = (option) => Number(option.match(/\[(\d+)\]$/)[1]);

// Jev leans toward the option offered first (docs.typesafe.ai/model-jaggedness):
// a choice's options are offered in an order of their own, drawn from what
// the question asks, so that whatever comes first by our ordering (the
// heaviest subject, the likeliest sentence) is not favoured, and the same
// question is always put the same way.
function shuffled(instructions, criteria) {
  const seed = JSON.stringify(instructions);
  const rank = (name) => createHash('sha256').update(`${seed}\u0000${name}`).digest().readUInt32BE(0);
  return Object.fromEntries(Object.entries(criteria).sort(([a], [b]) => rank(a) - rank(b)));
}

// About how many tokens Jev reads of `value` as JSON: a token is some four
// characters of English, fewer of other languages, so three and a half are
// counted to stay on the safe side.
export const tokens = (value) => Math.ceil((typeof value === 'string' ? value : JSON.stringify(value)).length / 3.5);

// About how many tokens Jev reads of a question: its text, and some 15 more
// for the question and 17 for each option, as Jev frames them (measured on
// the gateway, 2026-10-07: a hundred options of a few characters read as
// 1,990 tokens, ten as 460).
export const asked = (question) => tokens(question) + 15 + 17 * (question.type === 'choice' ? Object.keys(question.criteria).length : 0);

// Of `items`, in their order, as many as fit in `budget` tokens, taking them
// by `rank` (higher first): what a state can hold of a long list.
export function fit(items, budget, rank = () => 0) {
  const order = items.map((_, i) => i).sort((a, b) => rank(items[b]) - rank(items[a]) || a - b);
  const taken = new Set();
  let used = 0;
  for (const i of order) {
    const cost = tokens(items[i]);
    if (used + cost > budget) continue;
    taken.add(i);
    used += cost;
  }
  return items.filter((_, i) => taken.has(i));
}
