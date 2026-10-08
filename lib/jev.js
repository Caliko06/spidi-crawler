// Jev, TypeSafe's typed decision model, reached through Vercel's AI Gateway. Its answers
// are kept on disk, one file per request, with how long Jev took to give
// them, so what has been asked once needs neither the key nor the network
// again, and can be given again at the pace it was first given.

import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { asked, tokens } from './questions.js';

const URL = 'https://ai-gateway.vercel.sh/v1/evaluate';
const MODEL = 'typesafe-ai/jev'; // the gateway serves Jev by no other name, so its version cannot be pinned
const PROVIDER = { gateway: { only: ['typesafe-ai'] } }; // TypeSafe itself: the gateway would otherwise fall back to another host of the model
const ATTEMPTS = 5; // the provider answers 429 or 5xx under load, or not at all
const TIMEOUT_MS = 20_000; // how long one attempt may take: Jev answers in half a second at the median, so an attempt out for this long is lost
// What a request may hold, from docs.typesafe.ai/models (jev-1.13): 32k
// tokens of state with its longest question, 64k of state and all its
// questions. Some is left over for what `tokens` misjudges.
const STATE_AND_ONE = 28_000;
const ALL = 56_000;
const ASKING = 8; // such requests out at once
const RECALL_MS = [280, 520]; // how long Jev took over an answer kept before its time was: the range it answers in

// What a request cost: the tokens Jev read and the dollars the gateway billed.
const spent = ({ usage, providerMetadata }) => ({ tokens: usage?.inputTokens ?? 0, dollars: Number(providerMetadata?.gateway?.cost ?? 0) });

// The key Jev is asked with: AI_GATEWAY_API_KEY from the environment, or else
// from .env.local in `root`. An empty one in the environment means none.
export async function readKey(root) {
  const envFile = await readFile(join(root, '.env.local'), 'utf8').catch(() => '');
  return process.env.AI_GATEWAY_API_KEY ?? envFile.match(/^AI_GATEWAY_API_KEY=(.+)$/m)?.[1].trim();
}

// What one question about one state is kept under, whatever else it was asked
// with: Jev answers each question of a request on its own (measured
// 2026-10-07 on 3,323 questions asked twice about the same state in
// different requests: the answers differ by .019 on average, as two askings
// of anything do, and the choice made by 14), so an answer is as good taken
// from another request as asked again.
const questionKey = (stateKey, question) => createHash('sha256').update(`${stateKey}\u0000${JSON.stringify(question)}`).digest('hex').slice(0, 16);
const stateKey = (state) => createHash('sha256').update(JSON.stringify(state ?? null)).digest('hex').slice(0, 16);

// A run may spend `limit` dollars on questions not yet kept: `JEV_LIMIT` in the
// environment, or else the `limit` given. Past it Jev is not asked, and the run
// stops with the way to raise it. What a run has spent is in `ask.live`.
//
// Returns `ask({ state, questions })`, which resolves to Jev's answers by
// question name. Answers are kept in `dir`; without a `key` only kept answers
// can be given. `ask.asked` holds the names of the files of the answers it
// has given. A request made again while the first is out waits for its
// answer: Jev may answer the same request two ways, and only one is kept.
// `ask.paced(request)` resolves to `{ answers, recalled }`, a kept answer
// (`recalled`) only after as long as Jev first took over it;
// `ask.billed(request)` to `{ answers, recalled, tokens, dollars }` at once,
// what it cost when it was first asked. A request not
// kept whose questions were each answered in another request about the same
// state is given those answers, and Jev is asked only the questions none
// answered; the request is then kept whole. Without a `key`, a request with
// questions none answered fails with the error's `answers` those some did
// and `missing` the names of the others.
export function createJev({ key, dir, limit = Infinity }) {
  const asked = new Set();
  const live = { requests: 0, dollars: 0 }; // what Jev has been asked now, not given from what was kept
  const spendable = Number(process.env.JEV_LIMIT ?? limit);
  const out = new Map(); // file name → the answer on its way, until it is in
  let known = null; // question key → its answer, from every request kept in `dir`
  return Object.assign(ask, { asked, paced, billed: given, live });

  // Every answer kept in `dir`, by the key of its question, read once.
  function answered() {
    known ??= readdir(dir).catch(() => []).then(async (names) => {
      const all = new Map();
      for (const name of names.filter((one) => one.endsWith('.json'))) {
        const { answers, keys } = JSON.parse(await readFile(join(dir, name), 'utf8'));
        for (const [question, key] of Object.entries(keys ?? {})) if (answers[question]) all.set(key, answers[question]);
      }
      return all;
    });
    return known;
  }

  function given(request) {
    const body = JSON.stringify({ model: MODEL, ...request, providerOptions: PROVIDER });
    const name = `${createHash('sha256').update(body).digest('hex').slice(0, 16)}.json`;
    asked.add(name);
    if (!out.has(name)) out.set(name, answer(request, join(dir, name)).finally(() => out.delete(name)));
    return out.get(name);
  }

  function ask(request) {
    return given(request).then(({ answers }) => answers);
  }

  async function paced(request) {
    const { answers, ms, recalled, tokens, dollars } = await given(request);
    if (recalled) await new Promise((resolve) => setTimeout(resolve, ms));
    return { answers, recalled, ms, tokens, dollars };
  }

  async function answer(request, file) {
    const recall = (ms) => ms ?? RECALL_MS[0] + (parseInt(file.slice(-13, -5), 16) % (RECALL_MS[1] - RECALL_MS[0]));
    const at = stateKey(request.state);
    const keys = Object.fromEntries(Object.entries(request.questions).map(([question, asked]) => [question, questionKey(at, asked)]));
    const kept = await readFile(file, 'utf8').catch(() => null);
    if (kept) {
      const { answers, ms, ...rest } = JSON.parse(kept);
      // An answer kept before questions had keys is given them, so other requests can be given it.
      if (!rest.keys) {
        await writeFile(file, JSON.stringify({ answers, keys, ...rest, ...(ms === undefined ? {} : { ms }) }));
        const all = await answered();
        for (const [question, key] of Object.entries(keys)) if (answers[question]) all.set(key, answers[question]);
      }
      return { answers, ms: recall(ms), recalled: true, ...spent(rest) };
    }
    const all = await answered();
    const answers = Object.fromEntries(Object.entries(keys).flatMap(([question, key]) => (all.has(key) ? [[question, all.get(key)]] : [])));
    const missing = Object.keys(keys).filter((question) => !(question in answers));
    const keep = async (more, rest = {}) => {
      Object.assign(answers, more);
      for (const question of Object.keys(more)) all.set(keys[question], more[question]);
      await mkdir(dir, { recursive: true });
      await writeFile(file, JSON.stringify({ answers, keys, ...rest }));
    };
    if (missing.length === 0) {
      await keep({});
      return { answers, ms: recall(), recalled: true, reused: true, tokens: 0, dollars: 0 };
    }
    if (!key) throw Object.assign(new Error(`Jev has not been asked ${missing.length} of these questions, and there is no AI_GATEWAY_API_KEY to ask it with`), { answers, missing });
    const body = JSON.stringify({ model: MODEL, state: request.state, questions: Object.fromEntries(missing.map((question) => [question, request.questions[question]])), providerOptions: PROVIDER });
    if (live.dollars >= spendable) throw new Error(`this run has spent $${live.dollars.toFixed(2)} of Jev's, its limit of $${spendable}; set JEV_LIMIT=<dollars> to spend more on purpose`);

    const started = performance.now();
    let response;
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
      try {
        response = await fetch(URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
          body,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (error) {
        if (attempt === ATTEMPTS - 1) throw error;
        continue;
      }
      if (response.status !== 429 && response.status < 500) break;
    }
    const text = await response.text();
    if (!response.ok) throw new Error(`Jev gave no answer (${response.status}): ${text.slice(0, 200)}`);
    const ms = Math.round(performance.now() - started);
    const { answers: given, ...rest } = JSON.parse(text);
    live.requests += 1;
    live.dollars += spent(rest).dollars;
    await keep(given, { ...rest, ms });
    return { answers, ms, recalled: false, ...spent(rest) };
  }
}

// Puts many `questions` about one `state` to Jev, as few requests as hold
// them, and resolves to its answers by question name. A state too large to
// be read with its longest question is a fault of whoever made it.
export async function askAll(ask, state, questions) {
  const size = tokens(state);
  const longest = Math.max(0, ...Object.values(questions).map(asked));
  if (size + longest > STATE_AND_ONE) throw new Error(`a state of ${size} tokens is too large for Jev to read with its questions`);
  const requests = [];
  let used = Infinity;
  for (const entry of Object.entries(questions)) {
    const cost = asked(entry[1]) + tokens(entry[0]);
    if (used + cost > ALL) {
      requests.push([]);
      used = size;
    }
    requests.at(-1).push(entry);
    used += cost;
  }
  const answers = {};
  let next = 0;
  const worker = async () => {
    while (next < requests.length) Object.assign(answers, await ask({ state, questions: Object.fromEntries(requests[next++]) }));
  };
  await Promise.all(Array.from({ length: ASKING }, worker));
  return answers;
}
