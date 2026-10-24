import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { root, loadThemes, themeSignature, setImage } from './src/theme.mjs';
import { apply, applyWhenReady, restore, check } from './src/controller.mjs';
import { writePreview } from './src/preview.mjs';

const [command = 'help', ...args] = process.argv.slice(2);
const settings = JSON.parse(await fs.readFile(path.join(root, 'settings.json'), 'utf8'));
if (!Number.isInteger(settings.debugPort) || settings.debugPort < 1024 || settings.debugPort > 65535) throw new Error('Invalid debugPort in settings.json');
const options = { port:settings.debugPort, executable:process.env.CODEX_SKIN_EXE };
const owner = `${String(Date.now()).padStart(13, '0')}-${randomUUID()}`;
const stateDir = path.join(process.env.APPDATA || root, 'codex-work-skin');
const logFile = path.join(stateDir, 'watcher.log');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const print = message => console.log(`[${new Date().toLocaleTimeString()}] ${message}`);
let lastLog = '';
async function log(message) {
  if (message === lastLog) return;
  lastLog = message;
  await fs.mkdir(stateDir, { recursive:true });
  await fs.appendFile(logFile, `[${new Date().toISOString()}] ${message}\n`);
}
async function watch() {
  let themes = await loadThemes(), signature = await themeSignature(), missingSince = null, stopping = false;
  process.on('SIGINT', () => { stopping = true; });
  process.on('SIGTERM', () => { stopping = true; });
  await log('Watcher started');
  try {
    while (!stopping) {
      try {
        const current = await themeSignature();
        if (current !== signature) {
          // A bad edit keeps the last valid skin until the files are fixed.
          themes = await loadThemes(); signature = current;
          await log('Theme/image files reloaded');
        }
        const result = await apply(options, themes, owner, true);
        if (result.some(r => r.takeover)) { await log('A newer skin instance took over'); break; }
        if (!result.length) {
          missingSince ??= Date.now();
          await log('Waiting for a supported app window');
        } else { missingSince = null; await log(`Applied: ${result.map(r => `${r.mode}:${r.applied}`).join(', ')}`); }
      } catch (error) {
        // Invalid configs are not mistaken for a closed client. Check connection independently.
        let connected = false;
        try { connected = (await check(options)).length > 0; } catch {}
        if (!connected) missingSince ??= Date.now(); else missingSince = null;
        await log(`Waiting/error: ${error.message}`);
      }
      if (missingSince && Date.now() - missingSince > 15000) { await log('App connection absent for 15 seconds; watcher exited'); break; }
      if (!stopping) await delay(3000);
    }
  } finally {
    const recordPath = path.join(stateDir, 'watcher.json');
    try {
      const record = JSON.parse((await fs.readFile(recordPath, 'utf8')).replace(/^\uFEFF/, ''));
      if (record.pid === process.pid) await fs.rm(recordPath);
    } catch (error) { if (error.code !== 'ENOENT') console.error('Could not clean watcher record:', error.message); }
  }
}
async function main() {
  if (command !== 'set-image' && args.length) throw new Error('Unexpected arguments');
  if (command === 'set-image') {
    if (args.length !== 1) throw new Error('Usage: node skin.mjs set-image "full path to image"');
    print(`Background selected: ${await setImage(path.resolve(args[0]))}`); return;
  }
  if (command === 'list') {
    for (const theme of await loadThemes()) print(`${theme.id}: ${theme.mode}, ${theme.image}`);
    return;
  }
  if (command === 'preview') { print(await writePreview(await loadThemes())); return; }
  if (command === 'ready') { if (!(await check(options)).length) process.exitCode = 1; return; }
  if (command === 'check') {
    const result = await check(options);
    if (!result.length) throw new Error('No supported Codex window found on the configured debug port');
    console.log(JSON.stringify({ port:options.port, windows:result }, null, 2)); return;
  }
  if (command === 'apply') {
    const result = await applyWhenReady(options, await loadThemes(), owner);
    if (!result.length) throw new Error('No supported Codex window. Launch via start.bat first');
    print(JSON.stringify(result)); return;
  }
  if (command === 'restore') {
    const result = await restore(options);
    if (!result.length) throw new Error('No supported window found; restoration was not confirmed');
    print(`Skin removed from ${result.length} window(s)`); return;
  }
  if (command === 'watch') { await watch(); return; }
  if (command !== 'help') throw new Error('Unknown command');
  console.log('Codex Skin: start.bat / stop.bat / change-image.bat / preview.bat / check.bat\nCLI: node skin.mjs list|apply|restore|check|preview|set-image "path"\nRequires Node.js 22+. No npm install needed.');
}
main().catch(error => { if (command !== 'ready') console.error(`Error: ${error.message}`); process.exitCode = 1; });
