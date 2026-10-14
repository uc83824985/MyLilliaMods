import test from 'node:test';
import assert from 'node:assert/strict';
import { World, clone } from '../dist/core.mjs';
import { presetConfig } from './geometry-fixture.mjs';
import { Bot } from '../dist/bots.mjs';
const config = () => presetConfig('rhythm');
function recovering() {
  const w = new World(config(),7);
  Object.assign(w.police,{x:0,y:0,dir:0,moveDir:0,lastSeen:{x:1,y:0}});
  Object.assign(w.player,{x:-2,y:0});
  w.startAttack('stride'); w.miss(w.police.attack,'position'); return w;
}
test('walking and standing restore equal stamina; running does not', () => {
  const results = [];
  for (const input of [{x:0,y:0},{x:1,y:0,walk:true},{x:1,y:0}]) {
    const c=config(); c.practice=true; const w=new World(c); w.player.stamina=20;
    for(let i=0;i<120;i++) w.step(input); results.push(w.player.stamina);
  }
  assert.ok(Math.abs(results[0]-40)<1e-8); assert.equal(results[0],results[1]); assert.ok(Math.abs(results[2]-10)<1e-8);
});
test('miss holds position and view for 1.5s, then scans instead of instantly seeing behind', () => {
  const w=recovering(), start={x:w.police.x,y:w.police.y,dir:w.police.dir};
  for(let i=0;i<179;i++) w.step({walk:true});
  assert.deepEqual({x:w.police.x,y:w.police.y,dir:w.police.dir},start); assert.equal(w.police.visible,false); assert.equal(w.metrics.attacks,1);
  w.step({walk:true}); assert.equal(w.police.attack,null); assert.equal(w.police.search.phase,'scan');
  w.step({walk:true}); assert.notEqual(w.police.dir,start.dir); assert.equal(w.police.visible,false);
});
test('perfect refunds stamina and removes only player recovery', () => {
  const w=new World(config(),7); Object.assign(w.police,{x:0,y:0,dir:0,moveDir:0}); Object.assign(w.player,{x:.85,y:0,stamina:50});
  w.startAttack('stand');
  while(w.time<.31&&!w.result) { if(w.tick===25) w.player.stamina=50; w.step({x:0,y:w.tick>=25?1:0,dodge:w.tick===25}); }
  assert.equal(w.metrics.perfect,1); assert.equal(w.player.stamina,50); assert.equal(w.config.capture.missRecovery*w.police.attack.recoveryScale,1.5);
  assert.equal(w.config.dodge.recovery*w.config.perfectBonus.playerRecoveryScale,0);
  while(w.player.dodge){assert.notEqual(w.phase(),'recovery');w.step({x:1});}
  assert.equal(w.phase(),'ready');assert.equal(w.dodge(1,0),true);
});
test('hidden player relocation does not change last-seen investigation decisions', () => {
  const a=new World(config(),7), b=new World(config(),7);
  for(const [w,y] of [[a,10],[b,13]]) { Object.assign(w.police,{x:0,y:10,dir:0,moveDir:0,lastSeen:{x:0,y:9}}); Object.assign(w.player,{x:22,y}); }
  for(let i=0;i<60;i++) { a.step({walk:true}); b.step({walk:true}); }
  assert.deepEqual(a.police.lastSeen,{x:0,y:9}); assert.deepEqual(a.police,b.police);
});
test('running emits a real sound clue behind police; walking remains quiet', () => {
  const a=recovering(),b=recovering(); a.step({x:0,y:1});b.step({x:0,y:1,walk:true});
  assert.ok(a.police.lastHeard);assert.equal(b.police.lastHeard,undefined);assert.deepEqual(a.police.lastSeen,{x:1,y:0});
});
test('scanning can reacquire a visible target and search budget can expire', () => {
  const w=new World(config(),7);Object.assign(w.police,{x:0,y:0,dir:0,moveDir:0});Object.assign(w.player,{x:0,y:3});w.beginSearch('scan');
  w.police.visible=false;for(let i=0;i<300&&!w.police.visible;i++)w.step({walk:true});
  assert.equal(w.police.visible,true);assert.equal(w.police.search,null);
  const c=config();c.visionRange=0;c.search.hearingRange=0;const lost=new World(c,7);
  while(!lost.result) lost.step({walk:true});
  assert.equal(lost.result,'escaped');assert.ok(lost.time>=c.search.budgetSeconds*(1+c.exposure));
  assert.ok(lost.events.some(e=>e.type==='search'&&e.phase==='giveup'));
});
test('chase bots continue escaping after a miss instead of returning behind police', () => {
  for(const policy of ['adaptive','anticipate','oracle','perfect','reactive']) for(const phase of ['dash','recovery','ready']) for(const stamina of [20,75,100]) {
    const w=recovering();Object.assign(w.player,{x:3,y:0,dir:0,stamina});
    const b=new Bot(w.config,7,policy);b.route={x:12,y:0};b.nextRouteAt=10;
    const o=w.observation();o.player.phase=phase;
    const action=b.decide(o,w.map,w.time);
    assert.ok(action.x>.9,`${policy}/${phase}/${stamina} continues forward`);assert.equal(action.walk,false);assert.equal(action.dodge,false);
  }
});

test('a stale route toward police does not reverse a successful escape during recovery', () => {
  const w=recovering();Object.assign(w.player,{x:3,y:0,dir:0,stamina:75});
  const b=new Bot(w.config,7,'adaptive');b.route={x:-12,y:0};b.nextRouteAt=10;
  assert.ok(b.decide(w.observation(),w.map,w.time).x>.9);
});

test('low stamina bot walks along escape route only at a safe recovery distance', () => {
  const w=recovering();Object.assign(w.player,{x:6,y:0,dir:0,stamina:30});
  const b=new Bot(w.config,7,'adaptive');b.route={x:12,y:0};b.nextRouteAt=10;
  const action=b.decide(w.observation(),w.map,w.time);
  assert.equal(action.walk,true);assert.ok(action.x>.9);assert.match(b.intent,/回体/);
});
