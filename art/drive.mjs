// Drives a headless Chrome over CDP, which is not throttled the way the real window is while it is hidden: opens the console, plays the crawl and
// prints the count of sentences and the hubs on the web every 10 s, then a screenshot and the result of any script given.
//   node art/drive.mjs <url> <speed label> <seconds> <out.png> [js to evaluate at the end]
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const [url, speed = '4×', seconds = '90', out = 'shot.png', ...script] = process.argv.slice(2);
const dir = mkdtempSync(join(tmpdir(), 'cdp-'));
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--remote-debugging-port=9333', `--user-data-dir=${dir}`, '--window-size=1568,900', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 6000));
const targets = await (await fetch('http://127.0.0.1:9333/json')).json();
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const waiting = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); } };
const send = (method, params = {}) => new Promise((r) => { waiting.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
await send('Page.enable'); await send('Emulation.setDeviceMetricsOverride', { width: 1568, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url });
await new Promise((r) => setTimeout(r, 3000));
const probe = `JSON.stringify({count: document.querySelector('.web-count')?.textContent, hubs: [...document.querySelectorAll('.web-hub')].filter(h=>!h.classList.contains('is-hidden')&&!h.classList.contains('is-unborn')).length, done: document.body.classList.contains('is-done'), vis: document.visibilityState})`;
await evaluate(`new Promise(r=>setTimeout(r,13000))`);
await evaluate("document.querySelector('button[value=open]').click()");
await evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(speed)})?.click()`);
const t0 = Date.now();
while ((Date.now() - t0) / 1000 < Number(seconds)) {
  await new Promise((r) => setTimeout(r, 10000));
  console.log(Math.round((Date.now() - t0) / 1000) + 's', await evaluate(probe));
  if (JSON.parse(await evaluate(probe)).done) { await new Promise((r) => setTimeout(r, 15000)); console.log('settled', await evaluate(probe)); break; }
}
for (const s of script) console.log('script', await evaluate(s));
const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
chrome.kill();
process.exit(0);
