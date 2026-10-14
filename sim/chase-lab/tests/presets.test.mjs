import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, presetConfig } from '../dist/presets.mjs';
import { World, validate } from '../dist/core.mjs';
import { suite } from '../dist/experiments.mjs';

test('preset configurations validate and are independently editable', () => {
  for (const p of PRESETS) assert.deepEqual(validate(presetConfig(p.id)), [], p.id);
  const c = presetConfig('perfect'); c.dodge.cost = 0;
  assert.equal(presetConfig('perfect').dodge.cost, 25);
  assert.deepEqual(presetConfig('anticipate').dodge, presetConfig('perfect').dodge);
});
test('practice preserves player mechanics, freezes police, and cannot enter balance tests', () => {
  const c = presetConfig('practice'); c.duration = 2; const w = new World(c, 42);
  const e = JSON.stringify(w.police), x = w.player.x;
  while (!w.result) w.step({ x: 1, y: 0, dodge: w.tick === 0 });
  assert.equal(JSON.stringify(w.police), e); assert.notEqual(w.player.x, x);
  assert.equal(w.metrics.dodges, 1); assert.equal(w.metrics.attacks, 0); assert.equal(w.result, 'timeout');
  assert.throws(() => suite(c).next(), /无追兵/);
});
test('single-strategy presets select only the designated attack', () => {
  for (const mode of ['stand', 'stride', 'sweep', 'lunge']) {
    const w = new World(presetConfig(`single-${mode}`), 42);
    for (let n = 0; n < 100; n++) assert.equal(w.chooseMode(), mode);
  }
});
