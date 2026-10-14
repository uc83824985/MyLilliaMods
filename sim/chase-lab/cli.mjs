import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { DEFAULT, legacyConfig, World, clone } from './dist/core.mjs';
import { presetConfig } from './dist/presets.mjs';
import { consume, suite, train, games, episode, diagnostics } from './dist/experiments.mjs';
const args = process.argv.slice(2), command = args.shift() || 'bench';
const flag = (key, fallback) => { const i = args.indexOf(`--${key}`); return i >= 0 ? args[i + 1] : fallback; };
if (args.includes('--help') || command === 'help') {
  console.log('node cli.mjs bench|train|replay|episode [--config file] [--preset single-stride] [--current] [--legacy] [--seeds 12] [--candidates 8] [--holdout 24] [--seed 1000] [--profiles configured,fast,slow] [--output file]\nReplay: node cli.mjs replay --input replay.json\nEpisode: node cli.mjs episode --policy perfect --seed 42');
  process.exit(0);
}
let config = flag('config') ? JSON.parse(await readFile(flag('config'), 'utf8')) : flag('preset') ? presetConfig(flag('preset')) : args.includes('--legacy') ? legacyConfig() : clone(DEFAULT);
const seeds = Number(flag('seeds', 12)), seedBase = Number(flag('seed', 1000));
if (!Number.isInteger(seeds) || seeds < 1 || seeds > 1000) throw new Error('--seeds must be 1..1000');
let report, last = 0, lastLog = 0;
const output = path.resolve(flag('output', `../../artifacts/chase-lab/${command}.json`)); await mkdir(path.dirname(output), { recursive: true });
const stem = output.replace(/\.json$/i, ''), statusFile = flag('status', stem + '.status.json'), stopFile = flag('stop-file', stem + '.stop');
const started = new Date().toISOString(), status = data => writeFileSync(statusFile, JSON.stringify({ pid: process.pid, command, started, updated: new Date().toISOString(), output, ...data }, null, 2));
status({ state: 'running', progress: 0 }); writeFileSync(stem + '.episodes.jsonl', '');
const progress = r => {
  if (existsSync(stopFile)) { status({ state: 'cancelled', progress: r.progress }); console.log('Cancelled between episodes.'); process.exit(0); }
  if (r.episode) appendFileSync(stem + '.episodes.jsonl', JSON.stringify({ stage: r.stage || 'benchmark', candidate: r.candidate, ...r.episode }) + '\n');
  const now = Date.now();
  if (now - last > 1000) { status({ state: 'running', progress: r.progress, label: r.label, done: r.done, total: r.total }); last = now; }
  if (now - lastLog > 3000) { console.log(`${Math.round(r.progress * 100)}% ${r.label}`); lastLog = now; }
};
process.on('uncaughtException', error => { status({ state: 'failed', error: error.message }); console.error(error.stack); process.exit(1); });
if (command === 'bench') { report = consume(suite(config, { seeds, seedBase, profiles: flag('profiles', 'configured,fast,slow').split(','), ...(args.includes('--current') ? { distributions: { current: config.weights }, exposures: [config.exposure] } : {}) }), progress); report.games = games(report); report.diagnostics = diagnostics(report); }
else if (command === 'train') report = consume(train(config, { seeds, seedBase, candidates: Number(flag('candidates', 8)), holdoutSeeds: Number(flag('holdout', 24)) }), progress);
else if (command === 'episode') report = episode(config, seedBase, flag('policy', 'adaptive'), null, true);
else if (command === 'replay') {
  const raw = JSON.parse(await readFile(flag('input'), 'utf8')), replay = raw.replay || raw;
  const w = new World(replay.config, replay.seed); let index = 0, input = {};
  while (w.tick < replay.endTick && !w.result) { while (index < replay.inputs.length && replay.inputs[index].tick <= w.tick + 1) input = replay.inputs[index++].input; w.step(input); }
  report = { ...w.summary(), eventsMatch: JSON.stringify(w.events) === JSON.stringify(replay.events) };
  if (!report.eventsMatch) process.exitCode = 1;
} else throw new Error('Unknown command');
const hash = createHash('sha256'); for (const f of ['core.mjs', 'bots.mjs', 'experiments.mjs']) hash.update(await readFile(new URL(`./dist/${f}`, import.meta.url)));
report.provenance = { codeHash: hash.digest('hex'), started, completed: new Date().toISOString(), runtime: process.version, fixedStep: 1 / 120 };
await writeFile(output, JSON.stringify(report, null, 2));
const cells = report.validation?.cells || report.cells;
if (cells) {
  const columns = ['profile', 'exposure', 'distribution', 'policy', 'n', 'caught', 'escaped', 'timeout', 'noEngagement', 'score', 'seconds', 'evades', 'perfect', 'attacks', 'positionMiss', 'wallMiss'];
  const csv = [columns.join(','), ...cells.map(c => columns.map(k => c[k]).join(','))].join('\n'); await writeFile(stem + '.summary.csv', '\uFEFF' + csv);
}
if (report.best) await writeFile(stem + '.best-config.json', JSON.stringify(report.best.config, null, 2));
status({ state: 'complete', progress: 1, codeHash: report.provenance.codeHash, hypothesisMet: report.hypothesisMet });
console.log(`Report: ${output}`);
if (report.kind === 'training') console.log(JSON.stringify({ hypothesisMet: report.hypothesisMet, loss: report.validationObjective.loss, best: report.best.index, validation: report.validationObjective.diagnostics }, null, 2));
else if (report.cells) console.table(report.cells.filter(c => ['mixed', 'current'].includes(c.distribution)).map(c => ({ profile: c.profile, exposure: c.exposure, policy: c.policy, caught: c.caught.toFixed(2), escaped: c.escaped.toFixed(2), evades: c.evades.toFixed(1), perfect: c.perfect.toFixed(1), score: c.score.toFixed(1) })));
else console.log(JSON.stringify({ ...report, replay: report.replay ? 'saved' : undefined }));
