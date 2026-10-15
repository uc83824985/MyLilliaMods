import test from 'node:test';
import assert from 'node:assert/strict';
import {World,validate} from '../dist/core.mjs';
import {presetConfig} from '../dist/presets.mjs';
import {Bot} from '../dist/bots.mjs';
import {configureOpenDuel} from '../dist/open-duel-config.mjs';
import {resolveOpenDuel} from '../dist/open-duel-runtime.mjs';
test('equilibrium resolution is deterministic, independent by side and leaves the draft intact',()=>{
 const c=presetConfig('open-equilibrium-fast'),before=JSON.stringify(c);
 const r=resolveOpenDuel(c,42),again=resolveOpenDuel(r,42);
 assert.deepEqual(r,again);assert.equal(JSON.stringify(c),before);
 assert.equal(r.player.staminaMax,100);assert.equal(r.player.walkRegen,20);
 c.duel.selection.hunter='slow_scan';const weak=resolveOpenDuel(c,42);
 assert.equal(weak.duel.human,r.duel.human);assert.equal(weak.search.scanTurnRate,45);
 weak.duel.selection.hunter='mixed';assert.equal(resolveOpenDuel(weak,42).search.scanTurnRate,150);
 for(const seed of [43,44,45])assert.deepEqual(resolveOpenDuel(r,seed),resolveOpenDuel({...c,duel:{...c.duel,selection:{human:'equilibrium',hunter:'equilibrium'}}},seed));
});
test('world and restricted player mind resolve the same strategy and stamina caps cannot prevent a direct hit',()=>{
 const c=presetConfig('open-equilibrium-typical'),w=new World(c,51),b=new Bot(c,51);
 assert.equal(w.config.duel.human,b.config.duel.human);assert.equal(w.config.duel.hunter,b.config.duel.hunter);
 const times=[];
 for(const capacity of [100,200]){
  const c=configureOpenDuel(presetConfig('rhythm-mixed'),{hunter:'fixed_light'});c.player.staminaMax=capacity;
  const w=new World(c,3);Object.assign(w.player,{x:.7,y:0});Object.assign(w.police,{x:0,y:0,dir:0,moveDir:0,lastSeen:{x:.7,y:0}});w.startAttack('stand');
  for(let i=0;i<100&&!w.result;i++)w.step({x:0,y:0});
  assert.equal(w.result,'caught');times.push(w.time);
 }
 assert.equal(times[0],times[1]);
});
test('close heavy spin commits without dodge, but light does not use the same free response',()=>{
 const c=configureOpenDuel(presetConfig('rhythm-mixed'),{human:'spin',profile:'fast'});c.duel.lapseProbability=0;
 const w=new World(c,7),b=new Bot(c,7,'perfect');
 const idle=w.observation();assert.doesNotThrow(()=>b.decide(idle,w.map,0));
 Object.assign(w.police,{x:0,y:0});Object.assign(w.player,{x:1.3,y:0});w.startAttack('lunge');
 const o=w.observation();o.player.phase='ready';o.police.attack.elapsed=.56;
 assert.equal(b.decide(o,w.map,.56).dodge,false);assert.equal(b.spinAttack,o.police.attack.id);
 assert.equal(b.handled.has(o.police.attack.id),true);
 const b2=new Bot(c,7,'perfect');o.police.attack.mode='stand';o.police.attack.elapsed=.28;
 assert.equal(b2.decide(o,w.map,.28).dodge,true);assert.equal(b2.spinAttack,undefined);
});
test('reverse dodge selects a backward diagonal without changing action physics',()=>{
 const c=configureOpenDuel(presetConfig('rhythm-mixed'),{human:'reverse',profile:'fast'});c.duel.lapseProbability=0;
 const w=new World(c,7),b=new Bot(c,7,'perfect');Object.assign(w.police,{x:0,y:0});Object.assign(w.player,{x:1.3,y:0});w.startAttack('stand');
 const o=w.observation();o.player.phase='ready';o.police.attack.elapsed=.28;
 const input=b.decide(o,w.map,.28);assert.equal(input.dodge,true);assert.ok(input.x<0);assert.ok(Math.abs(input.y)>.5);
 assert.equal(c.dodge.duration,.3);assert.equal(c.dodge.recovery,.6);
});
test('open duel is obstacle-free and excludes mirrors and stealth',()=>{
  const c=presetConfig('open-duel-typical'),w=new World(c,42);
  assert.equal(w.map.blocks.length,0);assert.equal(c.mirror,undefined);assert.equal(c.stealth,undefined);assert.equal(c.player.walkRegen,20);
  assert.ok(validate(c).length===0);c.duel.police.sigma=-1;assert.ok(validate(c).length>0);
});
test('perfect stamina feasibility: one second walking offsets two seconds running; normal dodge still costs',()=>{
  const c=presetConfig('open-duel-fast');
  const balance=(perfect,walk,run)=>c.player.walkRegen*walk-c.player.runDrain*run-c.dodge.cost+(perfect?c.perfectBonus.refund:0);
  assert.equal(balance(true,1,2),0);assert.equal(balance(false,1,2),-25);
  assert.ok(balance(true,1.5,2)>0);
});
test('timing instability is sampled per observed attack and lapse prevents repeated retry',()=>{
  const c=presetConfig('open-duel-typical');c.duel.lapseProbability=1;
  const w=new World(c,42),b=new Bot(c,42,'perfect');w.startAttack('stand');
  const o=w.observation();o.player.phase='ready';b.decide(o,w.map,0);
  assert.equal(b.handled.has(w.police.attack.id),true);const error=b.timingError;
  b.decide(o,w.map,.02);assert.equal(b.timingError,error);assert.equal(b.inputLapse,true);
});
test('range overestimation really permits a whiff against a non-dodging runner',()=>{
  const c=configureOpenDuel(presetConfig('rhythm-mixed'),{hunter:'charge'});
  Object.assign(c.duel.police,{bias:1,sigma:0,delayMax:0,misjudgeProbability:0});
  const w=new World(c,42);Object.assign(w.police,{x:0,y:0,dir:0,moveDir:0,speed:5.18595});Object.assign(w.player,{x:3,y:0});w.police.lastSeen={x:3,y:0};
  for(let i=0;i<180&&!w.result;i++)w.step({x:1});
  assert.equal(w.metrics.dodges,0);assert.ok(w.metrics.positionMiss>0);assert.equal(w.events.find(e=>e.type==='range-estimate').error,1);
});
