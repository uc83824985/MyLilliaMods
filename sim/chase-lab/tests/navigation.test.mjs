import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT, World, StreetMap, clone } from '../dist/core.mjs';
import { Bot } from '../dist/bots.mjs';

test('corner route has traversable segments and actually turns behind a block', () => {
  const map = new StreetMap(), start = { x: 0, y: 10 }, goal = { x: 22, y: 10 };
  const route = map.route(start, goal, .65);
  assert.ok(route.length >= 3); assert.deepEqual(route.at(-1), goal);
  for (let i = 0; i < route.length; i++) assert.ok(map.clear(i ? route[i - 1] : start, route[i], .65));
  assert.equal(map.clear(start, goal), false);
});
test('self position is current while visual enemy observation remains delayed', () => {
  const w = new World(DEFAULT, 7), b = new Bot(DEFAULT, 7); let checked = 0;
  b.decide = (o, map, now) => {
    assert.equal(o.player.x, w.player.x); assert.ok(o.time < now); checked++;
    return { x: 1, y: 0 };
  };
  for (let i = 0; i < 120; i++) w.step(b.action(w));
  assert.ok(checked > 10);
});
test('anticipation waits for plausible attack distance rather than spending at 2.3m', () => {
  const c = clone(DEFAULT), w = new World(c), b = new Bot(c, 7, 'anticipate');
  Object.assign(w.police, { x: 0, y: 0, dir: 0, moveDir: 0, speed: 6.9 });
  Object.assign(w.player, { x: 2.2, y: 0 }); b.route = { x: 20, y: 0 }; b.nextRouteAt = 100;
  assert.equal(b.decide(w.observation(), w.map, 0).dodge, false);
  w.player.x = .92;
  assert.equal(b.decide(w.observation(), w.map, 0).dodge, true);
});
test('wall avoidance finds an open direction rather than driving into the block', () => {
  const w = new World(DEFAULT), b = new Bot(DEFAULT, 7, 'retreat');
  Object.assign(w.player, { x: 5.8, y: 10 }); Object.assign(w.police, { x: 4, y: 10 });
  b.route = { x: 10, y: 0 }; b.nextRouteAt = 100;
  const input = b.decide(w.observation(), w.map, 0), end = { x: w.player.x + input.x, y: w.player.y + input.y };
  assert.ok(w.map.clear(w.player, end, DEFAULT.player.radius));
});
