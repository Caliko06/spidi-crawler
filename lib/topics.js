// The words a subject can be called by. Jev writes nothing, so what a subject
// is called has to come out of the page: the terms of a sentence are what it
// could be said to be about, in whatever language it is written, and which of
// them it is about is Jev's to say, in lib/subjects.js.
//
// A term is a word that is not one of its language's function words, or up
// to three such words side by side.

import stopwords from 'stopwords-iso' with { type: 'json' };
import { detect } from 'tinyld';

const LONGEST = 3; // words a term can be made of
const SHORTEST = 3; // letters a word has to have

// A word as it is compared: without case, accents or a plural's s.
export const fold = (word) => word.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/(?<=.{3})s$/, '');

// For the language `sentences` are written in, the function that finds the
// terms of a text: `[{ key, words, form }]`, `form` the term as written and
// `key` what it is told from the others by.
export function termsIn(sentences) {
  const language = detect(sentences.map(({ text }) => text).join(' '));
  const idle = new Set((stopwords[language] ?? stopwords.en).map(fold));
  const content = (word) => word.length >= SHORTEST && /^\p{L}/u.test(word) && !idle.has(fold(word));

  return (text) => {
    const terms = new Map();
    // Words are side by side only with nothing but a space between them.
    for (const run of text.split(/[^\p{L}\p{N}\s'’.-]+|\.(?=\s|$)/u)) {
      const written = run.split(/\s+/).map((word) => word.replace(/^['’.-]+|['’.-]+$/g, '')).filter(Boolean);
      written.forEach((word, i) => {
        for (let length = 1; length <= LONGEST && content(written[i + length - 1] ?? ''); length++) {
          const words = written.slice(i, i + length).map(fold);
          terms.set(words.join(' '), { key: words.join(' '), words, form: written.slice(i, i + length).join(' ') });
        }
      });
    }
    return [...terms.values()];
  };
}
