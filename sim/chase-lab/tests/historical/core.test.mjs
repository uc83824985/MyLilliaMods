import { metres as M } from '../../dist/units.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { BASE, RUN, DEFAULT, World, StreetMap, clone, legacyConfig, validate, dist } from '../../dist/core.mjs';
import { Bot } from '../../dist/bots.mjs';
import { episode, solveGame, wilson } from '../../dist/experiments.mjs';
function duel(config, start = 1.8, mode = 'stand') {
  const w = new World(config, 7);
  Object.assign(w.police, { x: 0, y: 0, dir: 0, moveDir: 0 }); Object.assign(w.player, { x: M(start), y: 0, dir: 0 });
  w.startAttack(mode); return w;
}
test('legacy red-then-backdodge at 200ms escapes scaled legacy radius before 300ms judgement', () => {
  const w = duel(legacyConfig());
  while (w.time < .31 && !w.result) w.step({ x: w.tick >= 23 ? 1 : 0, y: 0, dodge: w.tick === 23 });
  assert.equal(w.result, null); assert.equal(w.metrics.positionMiss, 1); assert.equal(w.metrics.perfect, 0); assert.ok(w.player.x > M(2.5));
});
test('candidate standing close attack beats late backward movement outside perfect protection', () => {
  const c = clone(DEFAULT); c.dodge.perfectDuration = 0;
  const w = duel(c, .85);
  while (w.time < .31 && !w.result) w.step({ x: w.tick >= 23 ? 1 : 0, y: 0, dodge: w.tick === 23 });
  assert.equal(w.result, 'caught');
});
test('valid short perfect window protects a real contact once and grants bounded rewards', () => {
  const w = duel(DEFAULT, .85); w.player.stamina = 50;
  while (w.time < .31 && !w.result) w.step({ x: 0, y: w.tick >= 22 ? 1 : 0, dodge: w.tick === 22 });
  assert.equal(w.result, null); assert.equal(w.metrics.perfect, 1); assert.equal(w.player.dodge.used, true);
  assert.ok(w.player.stamina >= 50 - DEFAULT.dodge.cost + DEFAULT.perfectBonus.refund);
  assert.equal(w.police.attack.recoveryScale, DEFAULT.perfectBonus.policeRecoveryScale);
  w.police.attack.phase = 'active'; w.police.attack.hitDir = Math.atan2(w.player.y, w.player.x);
  w.resolve(w.police.attack); assert.equal(w.result, 'caught');
});
test('early preemptive dodge can leave the standing attack radius', () => {
  const w = duel(DEFAULT, .85); while (w.time < .31 && !w.result) w.step({ x: 1, y: 0, dodge: w.tick === 0 });
  assert.equal(w.result, null); assert.equal(w.metrics.positionMiss, 1);
});
test('stride body stays on its original line despite attack-facing rotation', () => {
  const w = duel(DEFAULT, 1.4, 'stride'); w.player.y = M(.8);
  for (let i = 0; i < 12; i++) w.step({});
  assert.ok(Math.abs(w.police.y) < 1e-9); assert.ok(w.police.x > 0); assert.ok(w.police.dir > 0);
});
test('cost-free backward running and tight circling are caught by close tracking stand attack', () => {
  for (const behavior of ['backward', 'circle']) {
    const w = duel(DEFAULT, .85);
    while (w.time < .32 && !w.result) {
      const theta = Math.atan2(w.player.y - w.police.y, w.player.x - w.police.x) + (behavior === 'circle' ? Math.PI / 2 : 0);
      w.step({ x: Math.cos(theta), y: Math.sin(theta) });
    }
    assert.equal(w.result, 'caught', behavior); assert.equal(w.metrics.dodges, 0); assert.equal(w.player.stamina, DEFAULT.player.staminaMax);
  }
});
test('shorter perfect recovery ends sooner without enabling a second protected contact', () => {
  const w = duel(DEFAULT, .85);
  while (w.time < .31 && !w.result) w.step({ x: 0, y: w.tick >= 22 ? 1 : 0, dodge: w.tick === 22 });
  assert.equal(w.metrics.perfect, 1);
  const normalEnd = .19 + DEFAULT.dodge.startup + DEFAULT.dodge.duration + DEFAULT.dodge.recovery;
  while (w.player.dodge && !w.result && w.time < 2) w.step({ x: 0, y: 1 });
  assert.ok(w.time < normalEnd); assert.equal(w.metrics.perfect, 1);
});
