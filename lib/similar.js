// How alike two ideas are, measured and not judged: a small multilingual
// embedding model runs on this machine (no key, no bill, a few milliseconds a
// text) and the cosine of two ideas' vectors is their similarity. It is the
// number the notebook's thresholds are set on; the model that reads the
// sources only says what the alike ideas are to one another.

import { pipeline } from '@huggingface/transformers';

const MODEL = 'Xenova/multilingual-e5-small';
let extractor;

// A unit vector for each text, as an array of numbers. e5 is told what a text is for: a `passage` is what is compared, a `query` what is looked for in them.
export async function embed(texts, role = 'passage') {
  extractor ??= pipeline('feature-extraction', MODEL, { dtype: 'q8' });
  const out = await (await extractor)(texts.map((text) => `${role}: ${text}`), { pooling: 'mean', normalize: true });
  return out.tolist();
}

// Of unit vectors, the cosine is the dot product.
export const cosine = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0);
