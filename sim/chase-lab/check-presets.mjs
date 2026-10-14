import { mkdir, writeFile } from 'node:fs/promises';
import { PRESETS, presetConfig } from './dist/presets.mjs';
import { consume, suite } from './dist/experiments.mjs';
const dir = new URL('../../artifacts/chase-lab/staged-presets/', import.meta.url);
await mkdir(dir, { recursive: true });
const report = { date: new Date().toISOString(), note: '阶段筛查，非收敛认证；每格8种子，当前反应档，随机出生场景。', presets: [] };
for (const p of PRESETS) {
  const c = presetConfig(p.id);
  await writeFile(new URL(`${p.id}.json`, dir), JSON.stringify(c, null, 2));
  if (!p.id.startsWith('single-')) continue;
  const r = consume(suite(c, { seeds: 8, seedBase: 31000, distributions: { current: c.weights }, exposures: [c.exposure], profiles: ['configured'] }));
  const valid = r.cells.filter(c => c.policy !== 'oracle');
  const flags = [];
  if (valid.some(c => c.noEngagement >= .5)) flags.push('部分策略至少一半场次无交锋：优先检查接近能力');
  if (valid.every(c => c.caught >= .875)) flags.push('所有对照策略抓捕率至少87.5%：优先检查反制空间');
  report.presets.push({ id: p.id, config: c, flags, cells: r.cells });
  console.log(JSON.stringify({ id: p.id, flags, rows: r.cells.map(c => ({ policy: c.policy, caught: c.caught, attacks: c.attacks, evades: c.evades, noEngagement: c.noEngagement })) }));
}
await writeFile(new URL('report.json', dir), JSON.stringify(report, null, 2));
