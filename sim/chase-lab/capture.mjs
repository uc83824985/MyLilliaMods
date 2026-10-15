import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { POLICIES } from './dist/bots.mjs';
import { PRESETS } from './dist/presets.mjs';
const args = process.argv.slice(2), flag = (k, fallback) => { const i = args.indexOf(`--${k}`); return i < 0 ? fallback : args[i + 1]; };
const port = Number(flag('debug-port', 9222)), seed = Number(flag('seed', 42)), steps = Math.min(36000, Math.max(0, Number(flag('steps', 600)))), policy = flag('policy', 'adaptive');
if (!Number.isInteger(port) || port < 1 || port > 65535 || !Number.isFinite(seed) || !Number.isFinite(steps) || !POLICIES[policy]) throw new Error('Invalid capture arguments');
const preset=flag('preset','candidate');if(!PRESETS.some(p=>p.id===preset))throw new Error('Unknown preset');
const localURL = `http://127.0.0.1:4173/?preset=${encodeURIComponent(preset)}&seed=${seed}&steps=${steps}&policy=${encodeURIComponent(policy)}`;
const output = path.resolve(flag('output', '../../artifacts/chase-lab/checkpoint.png'));
let ws, targetId, sessionId, nextId = 0; const pending = new Map(), errors = [];
function call(method, params = {}, session = null) {
  return new Promise((resolve, reject) => {
    const id = ++nextId, timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 20000);
    pending.set(id, { resolve, reject, timeout }); ws.send(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) }));
  });
}
try {
  const check = await fetch('http://127.0.0.1:4173/', { signal: AbortSignal.timeout(3000) }); if (!check.ok) throw new Error('Local lab server is not ready');
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(3000) })).json();
  ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  ws.addEventListener('message', event => {
    const msg = JSON.parse(event.data);
    if (msg.method === 'Runtime.exceptionThrown' && msg.sessionId === sessionId) errors.push(msg.params.exceptionDetails.text);
    const p = pending.get(msg.id); if (!p) return; clearTimeout(p.timeout); pending.delete(msg.id); msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
  });
  ({ targetId } = await call('Target.createTarget', { url: 'about:blank', background: true }));
  ({ sessionId } = await call('Target.attachToTarget', { targetId, flatten: true }));
  await call('Runtime.enable', {}, sessionId); await call('Page.enable', {}, sessionId);
  await call('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false }, sessionId);
  await call('Page.navigate', { url: localURL }, sessionId);
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 100));
    const value = await call('Runtime.evaluate', { expression: 'document.documentElement.dataset.labReady === "true"', returnByValue: true }, sessionId);
    if (value.result.value) { ready = true; break; }
  }
  if (!ready || errors.length) throw new Error(errors.join('; ') || 'Simulation page did not become ready');
  if(flag('view','local')==='full')await call('Runtime.evaluate',{expression:'if(document.querySelector("#zoom").getAttribute("aria-pressed")==="true")document.querySelector("#zoom").click()'},sessionId);
  const result = await call('Page.captureScreenshot', { format: 'png' }, sessionId);
  await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, Buffer.from(result.data, 'base64'));
  console.log(JSON.stringify({ screenshot: output, seed, steps, policy, browserLaunched: false, backgroundTab: true }));
} catch (error) { console.error(`Capture unavailable: ${error.message}. No browser was launched; background simulations are independent.`); process.exitCode = 1; }
finally {
  if (ws?.readyState === WebSocket.OPEN) {
    if (targetId) await call('Target.closeTarget', { targetId }).catch(() => {});
    ws.close();
  }
}
