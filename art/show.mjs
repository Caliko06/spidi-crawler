// Brings the scenes of art/spidi.blend into the Blender that is open, through
// its blender-mcp socket: `node art/show.mjs [scene …]`, the first shown.
import { readFileSync } from 'node:fs';
import { connect } from 'node:net';

const scenes = process.argv.slice(2);
const path = new URL('spidi.blend', import.meta.url).pathname;
const code = `PATH = ${JSON.stringify(path)}\nSCENES = ${JSON.stringify(scenes.length ? scenes : ['Spidi · beast'])}\n${readFileSync(new URL('show.py', import.meta.url), 'utf8')}`;
const socket = connect(9876, '127.0.0.1', () => socket.write(JSON.stringify({ type: 'execute_code', params: { code } })));
let answer = '';
socket.on('data', (chunk) => {
  answer += chunk;
  try {
    const { status, result, message } = JSON.parse(answer);
    console.log(status, result?.result ?? message ?? '');
    socket.end();
  } catch {}
});
