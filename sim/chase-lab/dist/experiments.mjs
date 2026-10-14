import { World, clone, MODES, RNG } from './core.mjs';
import { Bot, POLICIES } from './bots.mjs';
import { drillInput } from './drills.mjs';
export const DISTRIBUTIONS = {
  mixed: { stand: 1, stride: 1, sweep: 1, lunge: 1 },
  stand80: { stand: 8, stride: .667, sweep: .667, lunge: .666 },
  stride80: { stand: .667, stride: 8, sweep: .667, lunge: .666 },
  sweep80: { stand: .667, stride: .667, sweep: 8, lunge: .666 },
  lunge80: { stand: .667, stride: .667, sweep: .666, lunge: 8 }
};
export function episode(config, seed, policy, knownMode = null, record = false) {
  const world = new World(config, seed), bot = new Bot(config, seed, policy, knownMode), inputs = [];
  let previous = '';
  while (!world.result) {
    const input = config.drill ? drillInput(world) : bot.action(world);
    if (record) { const str = JSON.stringify(input); if (str !== previous) { inputs.push({ tick: world.tick + 1, input }); previous = str; } }
    world.step(input);
  }
  const mean = bot.delays.reduce((a, b) => a + b, 0) / Math.max(1, bot.delays.length), std = Math.sqrt(bot.delays.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, bot.delays.length));
  return { ...world.summary(), reaction: { mean, std }, observedModes: bot.counts, ...(record ? { replay: { version: 1, config, seed, endTick: world.tick, inputs, events: world.events } } : {}) };
}
export function wilson(success, n) {
  if (!n) return [0, 1]; const z = 1.96, p = success / n, d = 1 + z * z / n, a = (p + z * z / (2 * n)) / d, b = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d; return [a - b, a + b];
}
export function aggregate(rows) {
  const n = rows.length, caught = rows.filter(r => r.result === 'caught').length, escaped = rows.filter(r => r.result === 'escaped').length;
  const avg = key => rows.reduce((s, r) => s + r[key], 0) / Math.max(1, n);
  return { n, caught: caught / n, escaped: escaped / n, timeout: 1 - (caught + escaped) / n, noEngagement: rows.filter(r => r.noEngagement).length / n, caughtCI: wilson(caught, n), escapedCI: wilson(escaped, n), score: avg('score'), seconds: avg('seconds'), evades: avg('evades'), perfect: avg('perfect'), attacks: avg('attacks'), positionMiss: avg('positionMiss'), wallMiss: avg('wallMiss') };
}
export function* suite(config, { seeds = 16, seedBase = 1000, policies = Object.keys(POLICIES), distributions = DISTRIBUTIONS, exposures = [.15, .85], profiles = ['configured', 'fast', 'slow'] } = {}) {
  if (config.practice) throw new Error('无追兵练习不能用于胜率对照或参数搜索');
  if (config.drill) throw new Error('单元场景使用 run-drills.mjs；不能混入完整追逐胜率或参数搜索');
  const report = { version: 1, config: clone(config), seeds, seedBase, cells: [], assumptions: ['固定 120Hz；二维根位置判定', '逐次正态反应延迟截断在25–1000ms，决策Hz可调；非真人统计', 'fast=120±15ms/2°误差；slow=280±60ms/8°误差；configured使用草稿', '感知/体力/碰撞为明确标注的近似模型', '每种混合策略逐次出手采样；随机不代表GTO'] };
  const total = profiles.length * exposures.length * Object.keys(distributions).length * policies.length * seeds; let done = 0;
  for (const profile of profiles) for (const exposure of exposures) for (const [distribution, weights] of Object.entries(distributions)) for (const policy of policies) {
    const c = clone(config); c.exposure = exposure; c.weights = weights; c.spawn = 'random';
    if (profile === 'fast') { c.reaction.mean = .12; c.reaction.jitter = .015; c.behavior.motorErrorDegrees = 2; }
    if (profile === 'slow') { c.reaction.mean = .28; c.reaction.jitter = .06; c.behavior.motorErrorDegrees = 8; }
    const mode = MODES.reduce((a, b) => weights[a] > weights[b] ? a : b), rows = [];
    for (let i = 0; i < seeds; i++) { rows.push(episode(c, seedBase + i, policy, policy === 'oracle' ? mode : null)); done++; yield { progress: done / total, label: `${profile} / ${exposure.toFixed(2)} / ${distribution} / ${policy}`, done, total, episode: { profile, exposure, distribution, policy, ...rows.at(-1) } }; }
    report.cells.push({ profile, exposure, distribution, policy, ...aggregate(rows), rows });
  }
  return report;
}
export function consume(generator, progress = () => {}) { let r; do { r = generator.next(); if (!r.done) progress(r.value); } while (!r.done); return r.value; }
// Finite empirical zero-sum game: rows are complete per-attack police mixtures;
// columns are complete runner policies. Payoff is the player's normalized score.
export function solveGame(matrix, iterations = 8000) {
  const n = matrix.length, m = matrix[0].length, lr = .08;
  let row = Array(n).fill(1 / n), col = Array(m).fill(1 / m), ar = Array(n).fill(0), ac = Array(m).fill(0);
  for (let t = 0; t < iterations; t++) {
    const rv = matrix.map(r => r.reduce((s, x, j) => s + x * col[j], 0));
    const cv = col.map((_, j) => matrix.reduce((s, r, i) => s + r[j] * row[i], 0));
    row = row.map((x, i) => Math.max(1e-100, x * Math.exp(-lr * rv[i]))); col = col.map((x, j) => Math.max(1e-100, x * Math.exp(lr * cv[j])));
    const sr = row.reduce((a, b) => a + b), sc = col.reduce((a, b) => a + b);
    row = row.map(x => x / sr); col = col.map(x => x / sc);
    row.forEach((x, i) => ar[i] += x / iterations); col.forEach((x, j) => ac[j] += x / iterations);
  }
  const upper = Math.max(...matrix[0].map((_, j) => matrix.reduce((s, r, i) => s + r[j] * ar[i], 0)));
  const lower = Math.min(...matrix.map(r => r.reduce((s, x, j) => s + x * ac[j], 0)));
  return { policeMixture: ar, playerMixture: ac, lower, upper, gap: upper - lower, scope: '仅此有限策略库和经验收益矩阵；不是真实游戏GTO证明' };
}
export function games(report) {
  return [...new Set(report.cells.map(c => c.profile))].flatMap(profile => [...new Set(report.cells.map(c => c.exposure))].map(exposure => {
    const cells = report.cells.filter(c => c.profile === profile && c.exposure === exposure && c.policy !== 'oracle');
    const rows = [...new Set(cells.map(c => c.distribution))], cols = [...new Set(cells.map(c => c.policy))];
    const matrix = rows.map(r => cols.map(p => cells.find(c => c.distribution === r && c.policy === p).score / 100));
    return { profile, exposure, rows, cols, matrix, ...solveGame(matrix) };
  }));
}
export function diagnostics(report) {
  const comparisons = [];
  for (const profile of [...new Set(report.cells.map(c => c.profile))]) for (const exposure of [...new Set(report.cells.map(c => c.exposure))]) {
    const cells = report.cells.filter(c => c.profile === profile && c.exposure === exposure);
    const cell = (distribution, policy) => cells.find(c => c.distribution === distribution && c.policy === policy);
    const perfect = cell('mixed', 'perfect'), preempt = cell('mixed', 'anticipate'), reactive = cell('mixed', 'reactive'), retreat = cell('mixed', 'retreat'), footwork = cell('mixed', 'footwork');
    comparisons.push({ profile, exposure, mixedRetreatCaught: retreat?.caught, mixedReactiveCaught: reactive?.caught, mixedFootworkCaught: footwork?.caught, footworkNoEngagement: footwork?.noEngagement,
      perfectMinusPreemptScore: perfect && preempt ? perfect.score - preempt.score : null,
      preemptMinusReactiveScore: preempt && reactive ? preempt.score - reactive.score : null,
      biasLearning: Object.keys(DISTRIBUTIONS).filter(d => d !== 'mixed').map(d => ({ distribution: d, adaptiveScore: cell(d, 'adaptive')?.score, knownBiasScore: cell(d, 'oracle')?.score, retreatCaught: cell(d, 'retreat')?.caught, footworkCaught: cell(d, 'footwork')?.caught })) });
  }
  return { comparisons, caution: '无交锋超时代表接近/绕身漏洞，不代表完成多轮闪避；knownBias 是固定启发式，不是理论最优上界。' };
}
function objective(report) {
  let loss = 0; const diagnostics = [];
  for (const exposure of [.15, .85]) {
    const cells = report.cells.filter(c => c.exposure === exposure && c.profile === 'configured');
    const mixed = cells.filter(c => c.distribution === 'mixed' && c.policy !== 'oracle');
    const worstCapture = Math.min(...mixed.map(c => c.caught));
    const mixedBestScore = Math.max(...mixed.map(c => c.score));
    const biases = Object.keys(DISTRIBUTIONS).filter(d => d !== 'mixed').map(distribution => {
      const group = cells.filter(c => c.distribution === distribution);
      const adaptive = group.find(c => c.policy === 'adaptive');
      const oracle = group.find(c => c.policy === 'oracle');
      return { distribution, adaptiveScore: adaptive.score, oracleScore: oracle.score, gain: adaptive.score - mixedBestScore, caught: adaptive.caught };
    });
    // Explicit user hypothesis, not a label applied to any random distribution.
    loss += Math.max(0, .65 - worstCapture) * 3;
    const retreat = mixed.find(c => c.policy === 'retreat');
    if (retreat) loss += Math.max(0, .85 - retreat.caught) * 2;
    loss += biases.reduce((s, b) => s + Math.max(0, 15 - b.gain) / 100 + Math.max(0, b.caught - .45), 0);
    diagnostics.push({ exposure, worstCapture, mixedBestScore, biases });
  }
  return { loss, diagnostics };
}
export function* train(config, { candidates = 12, seeds = 6, seedBase = 2000, holdoutSeeds = 24 } = {}) {
  const rng = new RNG(seedBase ^ 789), rankings = []; let best;
  for (let k = 0; k < candidates; k++) {
    const c = clone(config);
    if (k > 0) {
      c.dodge.multiplier = rng.range(1.1, 1.9); c.dodge.duration = rng.range(.14, .28); c.dodge.recovery = rng.range(.2, .55); c.dodge.cost = rng.range(15, 35);
      c.police.speedScale = rng.range(1.04, 1.28); c.police.turnRate = rng.range(150, 340); c.police.drain = rng.range(3, 10);
      c.capture.missRecovery = rng.range(.3, .75);
      for (const m of MODES) { c.capture[m].trigger *= rng.range(.8, 1.15); c.capture[m].radius *= rng.range(.85, 1.15); }
    }
    const gen = suite(c, { seeds, seedBase, profiles: ['configured'], policies: ['retreat', 'footwork', 'reactive', 'anticipate', 'perfect', 'adaptive', 'oracle'] }); let item;
    do { item = gen.next(); if (!item.done) yield { ...item.value, candidate: k, stage: 'training', progress: (k + item.value.progress) / (candidates + 1), label: `候选 ${k + 1}/${candidates} · ${item.value.label}` }; } while (!item.done);
    const report = item.value;
    const result = { index: k, config: c, ...objective(report) }; rankings.push(result);
    if (!best || result.loss < best.loss) best = result;
    yield { progress: (k + 1) / (candidates + 1), label: `参数候选 ${k + 1}/${candidates}，目标差距 ${best.loss.toFixed(3)}` };
  }
  // Never report training-seed fitting as held-out convergence.
  const validationGenerator = suite(best.config, { seeds: holdoutSeeds, seedBase: seedBase + 100000 });
  let r;
  do { r = validationGenerator.next(); if (!r.done) yield { ...r.value, stage: 'holdout', progress: (candidates + r.value.progress) / (candidates + 1), label: `独立种子验证 · ${r.value.label}` }; } while (!r.done);
  const validation = r.value, checked = objective(validation);
  return { kind: 'training', candidates, seeds, holdoutSeeds, seedBase, best, rankings: rankings.sort((a, b) => a.loss - b.loss), validation, validationObjective: checked, hypothesisMet: checked.loss < 1e-6, games: games(validation), diagnostics: diagnostics(validation), note: '零目标差距只是样本点估计通过；仍须查看置信区间并进行真人测试。oracle仅作已知偏科启发式对照，不能证明最优。' };
}
