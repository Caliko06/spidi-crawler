// An LLM that answers what Jev is asked, in Jev's own shape. `createLlm` takes
// what `createJev` takes and gives what it gives, so a page can be read by
// either, or by both and compared. The model is any OpenAI-compatible
// endpoint (an OpenCode gateway, say). Its answers are kept on disk beside
// the request, as Jev's are, under the model's name.

import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ATTEMPTS = 2;
const TIMEOUT_MS = 30_000; // what a request may take before its questions are counted
const PER_QUESTION_MS = 10_000; // and what each question adds: a model that reasons spends seconds on every one
const RECALL_MS = [280, 520];

export const SYSTEM = [
  'You answer typed questions about a document, as a careful reader would. Reply with one JSON object and nothing else.',
  'Its keys are the question names. Each value is an object of the probabilities you give, summing to 1:',
  '- boolean: {"probability": p} is the chance the answer is yes.',
  '- choice: {"probabilities": {option: p, ...}} over the option names, those under 0.01 left out.',
  '- score: {"probabilities": {"0": p, "1": p, ...}} over the level numbers given.',
  'Be honest about doubt: a close call is a split, not a certainty.',
].join('\n');

// The key the model is asked with: OPENCODE_API_KEY from the environment, or from .env.local in `root`.
export async function readLlmKey(root) {
  const envFile = await readFile(join(root, '.env.local'), 'utf8').catch(() => '');
  return process.env.OPENCODE_API_KEY ?? envFile.match(/^OPENCODE_API_KEY=(.+)$/m)?.[1].trim();
}

const render = ([name, { type, instructions, criteria }]) => {
  const options = !criteria ? '' : Array.isArray(criteria)
    ? `\nLevels:\n${criteria.map((says, i) => `${i}: ${says}`).join('\n')}`
    : `\nOptions:\n${Object.entries(criteria).map(([key, says]) => `${key}: ${says}`).join('\n')}`;
  return `### ${name} (${type})\n${instructions}${options}`;
};

// A model's probabilities as Jev gives them: shares of one, the answer the likeliest, its confidence that share.
function shaped({ type, criteria }, answer) {
  const given = answer[type] ?? answer; // some models nest the answer under its type
  if (type === 'boolean') return { type, probability: Math.min(1, Math.max(0, Number(given.probability))) };
  const names = Array.isArray(criteria) ? criteria.map((_, i) => String(i)) : Object.keys(criteria);
  const shares = [given.probabilities, given.probability, given].find((value) => value && typeof value === 'object'); // the key a model puts them under varies
  const raw = Object.fromEntries(names.map((name) => [name, Math.max(0, Number(shares[name]) || 0)]));
  const total = Object.values(raw).reduce((a, b) => a + b, 0);
  if (total === 0) throw new Error('the model gave no probability to any option: ' + JSON.stringify(given).slice(0, 300));
  const probabilities = Object.fromEntries(Object.entries(raw).map(([name, p]) => [name, Math.round((p / total) * 100) / 100]));
  const [top, confidence] = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0];
  if (type === 'choice') return { type, choice: top, probabilities, confidence };
  return { type, score: Math.round(Object.entries(probabilities).reduce((sum, [level, p]) => sum + Number(level) * p, 0) * 100) / 100, probabilities, confidence };
}

// `protocol` is the one the model speaks at its endpoint: 'chat' (chat/completions) or 'responses'.
// 'codex' has no endpoint: it asks the Codex CLI, which reads with the ChatGPT subscription it is logged in with.
export function createLlm({ baseURL, key, model, dir, protocol = 'chat', effort = 'low', limit = Infinity, headers = {} }) {
  const asked = new Set();
  const live = { requests: 0, dollars: 0, tokens: 0 }; // dollars stay 0: a subscription is not billed by the token
  const out = new Map();
  return Object.assign(ask, { asked, paced, live, model });

  function fileOf(request) {
    return `${createHash('sha256').update(JSON.stringify({ model, protocol, effort, ...request })).digest('hex').slice(0, 16)}.json`;
  }

  function given(request) {
    const name = fileOf(request);
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

  async function answer({ state, questions }, file, retry = true) {
    const kept = await readFile(file, 'utf8').catch(() => null);
    if (kept) {
      const { answers, ms, usage } = JSON.parse(kept);
      return { answers, ms: ms ?? RECALL_MS[0], recalled: true, tokens: usage?.prompt_tokens ?? 0, dollars: 0 };
    }
    if (!key && protocol !== 'codex') throw new Error(`${model} has not judged this text, and there is no OPENCODE_API_KEY to ask it with`);
    if (live.requests >= limit) throw new Error(`this run has made ${live.requests} requests of ${model}, its limit; raise it on purpose`);

    const prompt = `Document state:\n${typeof state === 'string' ? state : JSON.stringify(state)}\n\nQuestions:\n\n${Object.entries(questions).map(render).join('\n\n')}`;
    const started = performance.now();
    if (protocol === 'codex') {
      const said = await viaCodex(`${SYSTEM}\n\n${prompt}`, model, effort, TIMEOUT_MS + PER_QUESTION_MS * Object.keys(questions).length);
      return finish(said, { prompt_tokens: 0 });
    }
    let response;
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
      try {
        response = await fetch(`${baseURL}/${protocol === 'chat' ? 'chat/completions' : 'responses'}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, ...headers },
          body: JSON.stringify(protocol === 'chat'
            ? { model, temperature: 0, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }] }
            : { model, text: { format: { type: 'json_object' } }, instructions: SYSTEM, input: prompt }),
          signal: AbortSignal.timeout(TIMEOUT_MS + PER_QUESTION_MS * Object.keys(questions).length),
        });
      } catch (error) {
        if (attempt === ATTEMPTS - 1) throw error;
        continue;
      }
      if (response.status !== 429 && response.status < 500) break;
    }
    const text = await response.text();
    if (!response.ok) throw new Error(`${model} gave no answer (${response.status}, prompt of ${prompt.length} characters): ${text.slice(0, 200)}`);
    const reply = JSON.parse(text);
    const usage = protocol === 'chat' ? reply.usage : { prompt_tokens: reply.usage?.input_tokens, completion_tokens: reply.usage?.output_tokens };
    const said = protocol === 'chat' ? reply.choices[0].message.content : reply.output.flatMap(({ content = [] }) => content).filter(({ type }) => type === 'output_text').map(({ text }) => text).join('');
    return finish(said, usage);

    async function finish(said, usage) {
      const given = firstObject(said);
      const missing = Object.fromEntries(Object.entries(questions).filter(([name]) => !given[name]));
      if (Object.keys(missing).length && !retry) throw new Error(`${model} left ${Object.keys(missing).join(', ')} unanswered`);
      // A model may skip a question of a long batch: only those are asked again, once.
      const more = Object.keys(missing).length ? (await answer({ state, questions: missing }, join(dir, fileOf({ state, questions: missing })), false)).answers : {};
      const answers = Object.fromEntries(Object.entries(questions).map(([name, question]) => [name, more[name] ?? shaped(question, given[name])]));
      const ms = Math.round(performance.now() - started);
      live.requests += 1;
      live.tokens += usage?.prompt_tokens ?? 0;
      await mkdir(dir, { recursive: true });
      await writeFile(file, JSON.stringify({ answers, model, usage, ms }));
      return { answers, ms, recalled: false, tokens: usage?.prompt_tokens ?? 0, dollars: 0 };
    }
  }
}

// The Codex CLI asked once, in an empty directory so that no project's rules
// reach it, read-only, at the effort given: these are readings, not work.
export async function viaCodex(prompt, model, effort, timeout) {
  const cwd = await mkdtemp(join(tmpdir(), 'codex-reader-'));
  const out = join(cwd, 'answer.txt');
  const args = ['exec', '--ephemeral', '--skip-git-repo-check', '-s', 'read-only', '-C', cwd, '-m', model, '-c', `model_reasoning_effort="${effort}"`, '-o', out, '-'];
  const child = spawn('codex', args, { stdio: ['pipe', 'ignore', 'pipe'], signal: AbortSignal.timeout(timeout) });
  let errors = '';
  child.stderr.on('data', (chunk) => { errors += chunk; });
  child.stdin.end(prompt);
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  if (code !== 0) throw new Error(`codex exited ${code}: ${errors.slice(-300)}`);
  return readFile(out, 'utf8');
}

// The first JSON object in a reply: a model may add words, or a second copy, after it.
export function firstObject(text) {
  const start = text.indexOf('{');
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (char === '\\') i++;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return JSON.parse(text.slice(start, i + 1));
  }
  throw new Error(`no JSON object in the reply: ${text.slice(0, 200)}`);
}
