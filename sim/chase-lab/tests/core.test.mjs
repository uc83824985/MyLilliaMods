import test from 'node:test';
import assert from 'node:assert/strict';
import { BASE, RUN, DEFAULT, World, StreetMap, clone, legacyConfig, validate, dist } from '../dist/core.mjs';
import { Bot } from '../dist/bots.mjs';
import { episode, solveGame, wilson } from '../dist/experiments.mjs';
function duel(config, start = 1.8, mode = 'stand') {
  const w = new World(config, 7);
  Object.assign(w.police, { x: 0, y: 0, dir: 0, moveDir: 0 }); Object.assign(w.player, { x: start, y: 0, dir: 0 });
  w.startAttack(mode); return w;
}
test('map dimensions fixed to two seconds of scaled native running', () => {
  assert.equal(new StreetMap().width, RUN * 2); assert.equal(BASE.globalScale, 2); assert.equal(validate(DEFAULT).length, 0); assert.equal(validate(legacyConfig()).length, 0);
});
test('legacy red-then-backdodge at 200ms escapes 2m radius before 300ms judgement', () => {
  const w = duel(legacyConfig());
  while (w.time < .31 && !w.result) w.step({ x: w.tick >= 23 ? 1 : 0, y: 0, dodge: w.tick === 23 });
  assert.equal(w.result, null); assert.equal(w.metrics.positionMiss, 1); assert.equal(w.metrics.perfect, 0); assert.ok(w.player.x > 2.5);
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
test('walls stop fast movement, obstruct perception, and route around blocks', () => {
  const map = new StreetMap(), p = { x: 0, y: 10 };
  map.move(p, 100, 0, .3); assert.ok(p.x < map.width / 2); assert.ok(map.free(p, .3));
  assert.equal(map.clear({ x: 0, y: 10 }, { x: 22, y: 10 }), false);
  const wp = map.waypoint({ x: 0, y: 10 }, { x: 22, y: 10 }, .3); assert.ok(map.clear({ x: 0, y: 10 }, wp, .3)); assert.notDeepEqual(wp, { x: 22, y: 10 });
});
test('stride body stays on its original line despite attack-facing rotation', () => {
  const w = duel(DEFAULT, 1.4, 'stride'); w.player.y = .8;
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
test('exposure extends last-seen memory without revealing hidden coordinates', () => {
  const low = clone(DEFAULT), high = clone(DEFAULT); low.exposure = 0; high.exposure = 1;
  const a = new World(low), b = new World(high); assert.equal(b.escapeDelay(), a.escapeDelay() * 5);
  Object.assign(b.police, { x: 0, y: 10, lastSeen: { x: 0, y: 9 } }); Object.assign(b.player, { x: 22, y: 10 });
  b.step({}); assert.equal(b.police.visible, false); assert.deepEqual(b.police.lastSeen, { x: 0, y: 9 }); assert.equal(b.observation().police, null);
});
test('robot does not observe sampled next attack or private weights', () => {
  const w = new World(DEFAULT), o = w.observation(); assert.equal(o.police.plan, undefined); assert.equal(o.weights, undefined);
  const b = new Bot(DEFAULT, 10); for (let i = 0; i < 500 && !w.result; i++) w.step(b.action(w));
  assert.ok(new Set(b.delays.map(x => x.toFixed(5))).size > 5);
});
test('seeded bots and recorded inputs replay identical outcomes and event streams', () => {
  const c = clone(DEFAULT); c.duration = 8;
  const a = episode(c, 13, 'adaptive', null, true), b = episode(c, 13, 'adaptive', null, true); assert.deepEqual(a, b);
  const r = a.replay, w = new World(r.config, r.seed); let index = 0, input = {};
  while (!w.result) { while (index < r.inputs.length && r.inputs[index].tick <= w.tick + 1) input = r.inputs[index++].input; w.step(input); }
  assert.deepEqual(w.events, r.events); assert.equal(w.summary().score, a.score);
});
test('finite-game solver finds matching-pennies balance with reported exploitability', () => {
  const g = solveGame([[0, 1], [1, 0]]); assert.ok(Math.abs(g.policeMixture[0] - .5) < .01); assert.ok(g.gap < .01);
  const dominant = solveGame([[.1, .2], [.8, .9]]); assert.ok(dominant.policeMixture[0] > .9); assert.ok(dominant.playerMixture[1] > .9);
  const ci = wilson(0, 4); assert.ok(ci[1] > .4);
});
test('invalid parameters rejected before simulation', () => {
  const c = clone(DEFAULT); c.capture.stand.trackUntil = 1; assert.throws(() => new World(c));
  c.capture.stand.trackUntil = .29; c.weights = { stand: 0, stride: 0, sweep: 0, lunge: 0 }; assert.throws(() => new World(c));
});
