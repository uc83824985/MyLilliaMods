import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, open, unlink, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const lab = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.CHASE_LAB_PORT || 4173);
const origin = `http://127.0.0.1:${port}`;
const key = createHash('sha256').update(path.resolve(lab).toLowerCase()).digest('hex').slice(0, 16);
const state = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'LilliaChaseLab', key);
const profile = path.join(state, 'browser-profile');
const logs = path.resolve(lab, '../../artifacts/chase-lab/launcher');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const get = url => fetch(url, { signal: AbortSignal.timeout(1500) });

async function lock() {
  const filename = path.join(state, 'launch.lock');
  for (let i = 0; i < 150; i++) {
    try {
      const handle = await open(filename, 'wx');
      await handle.writeFile(String(process.pid));
      await handle.close();
      return () => unlink(filename).catch(() => {});
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const owner = Number(await readFile(filename, 'utf8').catch(() => ''));
      if (owner > 0) {
        try { process.kill(owner, 0); }
        catch (e) { if (e.code === 'ESRCH') await unlink(filename).catch(() => {}); }
      }
      await sleep(200);
    }
  }
  throw new Error(`Another launcher is busy. If it was interrupted, remove ${filename}`);
}

async function serverStatus() {
  let response;
  try { response = await get(`${origin}/__chase_lab_health`); }
  catch { return 'offline'; }
  if (response.ok) {
    const health = await response.json().catch(() => null);
    return health?.app === 'lillia-chase-lab' && health.root === lab ? 'ready' : 'occupied';
  }
  // Accept an already-running server from before the health endpoint was added.
  for (const name of ['index.html', 'app.mjs', 'core.mjs']) {
    const served = await get(`${origin}/${name}`);
    if (!served.ok || await served.text() !== await readFile(path.join(lab, 'dist', name), 'utf8')) return 'occupied';
  }
  return 'ready';
}

async function ensureServer() {
  const status = await serverStatus();
  if (status === 'ready') { console.log(`Reusing server: ${origin}`); return; }
  if (status === 'occupied') throw new Error(`Port ${port} belongs to another service or checkout. Set CHASE_LAB_PORT to a free port.`);
  const out = await open(path.join(logs, 'server-out.log'), 'a');
  const err = await open(path.join(logs, 'server-error.log'), 'a');
  let spawnError;
  try {
    const child = spawn(process.execPath, [path.join(lab, 'server.mjs')], {
      cwd: lab, detached: true, windowsHide: true,
      env: { ...process.env, CHASE_LAB_PORT: String(port) }, stdio: ['ignore', out.fd, err.fd],
    });
    child.on('error', error => { spawnError = error; });
    child.unref();
  } finally { await out.close(); await err.close(); }
  for (let i = 0; i < 40; i++) {
    if (spawnError) throw spawnError;
    if (await serverStatus() === 'ready') { console.log(`Started server: ${origin}`); return; }
    await sleep(200);
  }
  throw new Error(`Server did not become ready. Check ${logs}`);
}

async function browserEndpoint() {
  try {
    const [debugPort, socketPath] = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/);
    if (!/^\d+$/.test(debugPort)) return null;
    const info = await (await get(`http://127.0.0.1:${debugPort}/json/version`)).json();
    return new URL(info.webSocketDebuggerUrl).pathname === socketPath ? info.webSocketDebuggerUrl : null;
  } catch { return null; }
}

async function findBrowser() {
  const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
  const candidates = process.env.CHASE_LAB_BROWSER ? [process.env.CHASE_LAB_BROWSER] :
    ['Google/Chrome/Application/chrome.exe', 'Microsoft/Edge/Application/msedge.exe'].flatMap(name => roots.map(root => path.join(root, name)));
  for (const filename of candidates) { try { await access(filename); return filename; } catch {} }
  throw new Error('Chrome or Edge was not found. Set CHASE_LAB_BROWSER to its executable path.');
}

async function ensureBrowser() {
  let endpoint = await browserEndpoint();
  if (endpoint) return endpoint;
  // Local, write-probed profile avoids repository/network-drive permissions.
  const probe = path.join(profile, 'write-probe');
  await writeFile(probe, 'ok'); await unlink(probe);
  const browser = await findBrowser();
  let spawnError;
  const child = spawn(browser, [
    `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
    '--no-first-run', '--no-default-browser-check', '--disable-background-mode', `--app=${origin}/`,
  ], { detached: true, stdio: 'ignore', windowsHide: false });
  child.on('error', error => { spawnError = error; }); child.unref();
  for (let i = 0; i < 100; i++) {
    if (spawnError) throw spawnError;
    endpoint = await browserEndpoint();
    if (endpoint) return endpoint;
    await sleep(200);
  }
  throw new Error(`Browser did not become ready. Profile: ${profile}`);
}

async function connect(endpoint) {
  const ws = new WebSocket(endpoint), pending = new Map(); let sequence = 0;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { ws.close(); reject(new Error('Browser connection timeout')); }, 5000);
    ws.addEventListener('open', () => { clearTimeout(timeout); resolve(); }, { once: true });
    ws.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('Browser connection failed')); }, { once: true });
  });
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data), request = pending.get(message.id);
    if (!request) return;
    clearTimeout(request.timer); pending.delete(message.id);
    message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result);
  });
  return {
    close: () => ws.close(),
    call(method, params = {}, sessionId) {
      return new Promise((resolve, reject) => {
        const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error(`Browser timeout: ${method}`)); }, 5000);
        pending.set(id, { resolve, reject, timer });
        ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      });
    },
  };
}

async function showBrowser(endpoint) {
  const cdp = await connect(endpoint);
  try {
    let { targetInfos } = await cdp.call('Target.getTargets');
    // Wait for the --app window created during first launch.
    for (let i = 0; !targetInfos.some(t => t.type === 'page') && i < 30; i++) {
      await sleep(100); ({ targetInfos } = await cdp.call('Target.getTargets'));
    }
    let target = targetInfos.find(t => t.type === 'page' && t.url.startsWith(`${origin}/`));
    if (!target) {
      // The dedicated profile may still be alive after its app window was closed.
      const { targetId } = await cdp.call('Target.createTarget', { url: `${origin}/`, newWindow: true });
      target = { targetId };
    }
    const { sessionId } = await cdp.call('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    await cdp.call('Page.reload', { ignoreCache: true }, sessionId);
    const { windowId, bounds } = await cdp.call('Browser.getWindowForTarget', { targetId: target.targetId });
    if (bounds.windowState === 'minimized') await cdp.call('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
    await cdp.call('Target.activateTarget', { targetId: target.targetId });
    await cdp.call('Page.bringToFront', {}, sessionId);
    const { processInfo } = await cdp.call('SystemInfo.getProcessInfo');
    const browserPid = processInfo.find(p => p.type === 'browser')?.id;
    if (!browserPid) throw new Error('Cannot identify browser window process.');
    const message = execFileSync('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(lab, 'focus-window.ps1'), '-BrowserProcessId', String(browserPid),
    ], { windowsHide: true, encoding: 'utf8', timeout: 15000 });
    console.log(message.trim());
    console.log(`Refreshed: ${origin}/`);
  } finally { cdp.close(); }
}

let release;
try {
  if (process.platform !== 'win32') throw new Error('run.bat is a Windows launcher. On other systems use npm start.');
  if (typeof WebSocket !== 'function') throw new Error('Node.js 22 or newer is required.');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid CHASE_LAB_PORT.');
  await mkdir(profile, { recursive: true }); await mkdir(logs, { recursive: true });
  release = await lock();
  await ensureServer();
  await showBrowser(await ensureBrowser());
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { if (release) await release(); }
