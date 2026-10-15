import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { World, RUN } from '../dist/core.mjs';
import { presetConfig } from '../dist/presets.mjs';
import { mirrorInput } from '../dist/mirrors.mjs';
import { drillInput } from '../dist/drills.mjs';
import { Bot } from '../dist/bots.mjs';

test('1.5x calibration preserves travel time, stamina and decisions relative to 2x geometry', async () => {
  // Independent module graph at the previous scale: catches unscaled AI constants,
  // endpoint offsets and collision tolerances that a dimensions-only test misses.
  const directory = await mkdtemp(join(tmpdir(), 'lillia-scale-test-'));
  try {
    await cp(new URL('../dist/', import.meta.url), directory, { recursive: true });
    const units = join(directory, 'units.mjs');
    // This synthetic geometry comparison scales BOTH locomotion modes. The actual
    // game's walking multiplier is independent and remains 3 in production.
    await writeFile(units, (await readFile(units, 'utf8')).replace('globalScale: 1.5', 'globalScale: 2').replace('globalWalkScale: 3', 'globalWalkScale: 4'));
    const load = name => import(pathToFileURL(join(directory, name)).href);
    const old = await load('core.mjs'), presets = await load('presets.mjs');
    const mirrors = await load('mirrors.mjs'), drills = await load('drills.mjs'), bots = await load('bots.mjs');
    assert.ok(Math.abs(RUN-4.7145)<1e-12);
    for (const id of ['rhythm-mixed', 'drill-charge', 'mirror-ai-intercept', 'mirror-ai-wait', 'mirror-ai-triangle']) {
      const a = new World(presetConfig(id), 42), b = new old.World(presets.presetConfig(id), 42);
      const ba = new Bot(a.config,42), bb = new bots.Bot(b.config,42);
      const near = (x,y,label) => assert.ok(Math.abs(x-y)<1e-6, `${id} tick ${a.tick}: ${label} ${x} / ${y} police ${JSON.stringify([a.police,b.police])}`);
      for(let tick=0;tick<1200&&!a.result;tick++) {
        const ia=a.config.mirror?mirrorInput(a):a.config.drill?drillInput(a):ba.action(a);
        const ib=b.config.mirror?mirrors.mirrorInput(b):b.config.drill?drills.drillInput(b):bb.action(b);
        a.step(ia);b.step(ib);
        for(const who of ['player','police']) {
          near(a[who].x,b[who].x*.75,who+'.x');near(a[who].y,b[who].y*.75,who+'.y');
          near(a[who].stamina,b[who].stamina,who+'.stamina');
        }
        assert.equal(a.result,b.result);
      }
      assert.deepEqual(a.events.map(e=>[e.tick,e.type,e.choice,e.reason]),b.events.map(e=>[e.tick,e.type,e.choice,e.reason]));
    }
  } finally {
    // Only remove the exact isolated directory returned by mkdtemp above.
    await rm(directory, { recursive: true, force: true });
  }
});
