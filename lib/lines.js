// Every line at which an answer of Jev's becomes a decision, in one place, as
// TypeSafe advises (docs.typesafe.ai/agent-skill): the plan decides by them
// and the console says what Jev decided by them, so the two never disagree.
//
// Each line is `{ at, close, from }`: `at` the line itself, on the scale of
// the answer it reads (a probability, or a rating from 0 to 3); `close` the
// band around it, `[below, above]`, inside which Jev's answers agreed with
// the reference less often than `SURE` of the time, so a decision inside it
// is shown as a close call; and `from`, where the line comes from.
// `corpus/bench/score.mjs` sets them: against the writer of the texts
// written for the project where the writer judged (what is kept, what is
// essential), against the blind teacher elsewhere, and tests them on pages
// that never set them.

export const SURE = 0.8; // how often answers as far from the line have to agree with the reference for a decision to be shown as sure

export const LINES = {
  // A sentence's rating, the mean of Jev's levels from 0 (passed over) to 3 (main).
  // Against the writer (864 sentences, 7 texts): AUC .91; the lines that agree
  // best with the writer, each page's set by the others, fall at 1.61–1.91 and
  // do no better on the page held out (F1 .62) than this one (.68).
  keep: { at: 1.65, close: [1.46, 2.07], from: 'writer, 2026-10-07: confirmed' },
  // Against the writer: AUC .92; best lines 0.95–1.06, F1 .81 held out, .82 here.
  passed: { at: 1, close: [0.24, 1.46], from: 'writer, 2026-10-07: confirmed' },
  // Probabilities.
  // Against the teacher (the writer did not say): AUC .85 tuning, .88 held
  // out; at .21 F1 .72 on both, at .5 it was .55 and .66.
  alone: { at: 0.21, close: [0.12, 0.66], from: 'teacher, 21 pages, held out on 8' },
  // Against the writer: AUC .88; at .77 F1 .58 (.52 with each page's line set
  // by the others), where ranking with how many Jev said a reader needs gave .48.
  essential: { at: 0.77, close: [0.77, 0.98], from: 'writer, 2026-10-07' },
  // Whether a subject falls into another page: how likely that is, a logistic
  // of Jev's odds (`jev`, on their logit) and of how many sentences the subject
  // holds (`size`, on its log), against `at`. Fitted to the blind teacher's
  // folds of the plans' subjects, taken from the outline (27 pages, 178
  // subjects, it folds 57; corpus/gold/merges, refit by corpus/bench/score.mjs
  // on the tuning pages): F1 .67 tuning, .78 on the pages that never set it
  // (the line before: .62, .73); Jev's odds alone rank them at AUC .81, .87.
  fall: { bias: -0.38, jev: 1.45, size: -1.87, at: 0.28, close: [0.2, 0.4], from: 'blind teacher folds of the outline subjects, 2026-10-08; held out .78' },
  // Not yet measured against a reference: lines at even odds.
  apparatus: { at: 0.5, close: [0.35, 0.65], from: 'by hand: decisions agree with the teacher on .92 of sections held out' },
  repeat: { at: 0.5, close: [0.35, 0.65], from: 'by hand: the teacher finds too few repeats (1%) to set it' },
  subject: { at: 0.5, close: [0.35, 0.65], from: 'by hand' },
  alias: { at: 0.5, close: [0.35, 0.65], from: 'by hand' },
  belongs: { at: 0.5, close: [0.35, 0.65], from: 'by hand' },
  // Whether a heading names a subject. Against the teacher's subjects (199
  // headings, 21 pages): AUC .93; best at .34, F1 .95, and .95 on the 186
  // headings of the held-out and authored pages (AUC .86, .81), where two
  // passes of the teacher agree on .88–.97 of them.
  section: { at: 0.34, close: [0.2, 0.5], from: 'teacher, 21 pages, held out on 15' },
};

// Whether `value` clears `line`, and whether it is a close call.
export const clears = (value, { at }) => value >= at;
export const isClose = (value, { close: [below, above] }) => value >= below && value <= above;
