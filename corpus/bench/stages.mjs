// The kinds of question the plan asks, in the order its stages ask them
// (lib/crawl.js): a stage reads what the stages before it decided, so what
// Jev answered at one stage stands only while every stage before it was
// answered by Jev too. Kinds in one stage are asked side by side.

const STAGES = [
  ['part'], // survey
  ['standing', 'needs'], // reading
  ['name'],
  ['section', 'subject', 'alias', 'heading'], // subjects
  ['file', 'belongs', 'whole'], // filing
  ['same'], // repeats
  ['prize', 'lead', 'pick'], // essentials, remarks
  ['closest', 'bond', 'theme', 'parent', 'nearest', 'pull'], // links, themes, pulls
  ['fall', 'host'], // folds
];

export const kindOf = (question) => question.replace(/\d.*$/, '');
const stageOf = new Map(STAGES.flatMap((kinds, stage) => kinds.map((kind) => [kind, stage])));

// Whether a decision that reads answers of `kinds` was made by Jev on a page
// where the questions `madeUp` were not asked of it: none of them is of those
// kinds, nor of a stage before the last of theirs.
export function real(kinds, madeUp) {
  const last = Math.max(...kinds.map((kind) => stageOf.get(kind)));
  return madeUp.every((question) => !kinds.includes(kindOf(question)) && stageOf.get(kindOf(question)) >= last);
}
