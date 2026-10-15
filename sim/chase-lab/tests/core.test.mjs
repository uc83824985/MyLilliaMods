import { metres as M } from '../dist/units.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { BASE, RUN, World, StreetMap, validate } from '../dist/core.mjs';
import {presetConfig} from './geometry-fixture.mjs';
import { Bot } from '../dist/bots.mjs';
import { episode, solveGame, wilson } from '../dist/experiments.mjs';
test('map dimensions fixed to two seconds of scaled native running', () => {
  assert.equal(new StreetMap().width, RUN * 2); assert.equal(BASE.globalScale, 1.5); assert.equal(validate(presetConfig('rhythm')).length, 0);
});
test('walls stop fast movement, obstruct perception, and route around blocks', () => {
  const map = new StreetMap(), p = { x: 0, y:M(10) };
  map.move(p, 100, 0, .3); assert.ok(p.x < map.width / 2); assert.ok(map.free(p, .3));
  assert.equal(map.clear({ x: 0, y:M(10) }, { x:M(22), y:M(10) }), false);
  const wp = map.waypoint({ x: 0, y:M(10) }, { x:M(22), y:M(10) }, .3); assert.ok(map.clear({ x: 0, y:M(10) }, wp, .3)); assert.notDeepEqual(wp, { x:M(22), y:M(10) });
});
test('exposure extends last-seen memory without revealing hidden coordinates', () => {
  const low = presetConfig('rhythm'), high = presetConfig('rhythm'); low.exposure = 0; high.exposure = 1;
  const a = new World(low), b = new World(high); assert.equal(b.escapeDelay(), a.escapeDelay() * 5);
  Object.assign(b.police, { x: 0, y:M(10), lastSeen: { x: 0, y:M(9) } }); Object.assign(b.player, { x:M(22), y:M(10) });
  b.step({}); assert.equal(b.police.visible, false); assert.deepEqual(b.police.lastSeen, { x: 0, y:M(9) }); assert.equal(b.observation().police, null);
});
test('robot does not observe sampled next attack or private weights', () => {
  const w = new World(presetConfig('rhythm')), o = w.observation(); assert.equal(o.police.plan, undefined); assert.equal(o.weights, undefined);
  const b = new Bot(presetConfig('rhythm'), 10); for (let i = 0; i < 500 && !w.result; i++) w.step(b.action(w));
  assert.ok(new Set(b.delays.map(x => x.toFixed(5))).size > 5);
});
test('seeded bots and recorded inputs replay identical outcomes and event streams', () => {
  const c = presetConfig('rhythm'); c.duration = 8;
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
  const c = presetConfig('rhythm'); c.capture.stand.trackUntil = 1; assert.throws(() => new World(c));
  c.capture.stand.trackUntil = .29; c.weights = { stand: 0, stride: 0, sweep: 0, lunge: 0 }; assert.throws(() => new World(c));
});
