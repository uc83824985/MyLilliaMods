import { metres as M } from '../../dist/units.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {World,RUN,validate,DEFAULT,clone,dist} from '../../dist/core.mjs';
import {presetConfig} from '../geometry-fixture.mjs';
import {drillInput} from '../../dist/drills.mjs';
import {perceptionCue} from '../../dist/perception.mjs';
function attack(mode){const w=new World(presetConfig('rhythm'),7);Object.assign(w.police,{x:0,y:0,dir:0,moveDir:0});Object.assign(w.player,{x:M(20),y:0});w.startAttack(mode);return w;}
test('longer burst restores early charge and 240ms light distance dodges without perfect protection',()=>{
 for(const [mode,press] of [['stand',.24],['lunge',0]])for(const preset of ['rhythm-short-dodge','rhythm-mixed']){
  const c=presetConfig(preset);c.dodge.perfectDuration=0;c.player.runDrain=0;const w=new World(c,7);Object.assign(w.police,{x:0,y:0,dir:0,moveDir:0});Object.assign(w.player,{x:c.capture[mode].trigger,y:0,stamina:70});w.startAttack(mode);
  while(!w.result&&w.time+1e-8<c.capture[mode].windup)w.step({x:1,dodge:w.time+1e-8>=press&&w.metrics.dodges===0});
  assert.equal(w.metrics.perfect,0);assert.equal(w.player.stamina,45);
  if(preset==='rhythm-short-dodge')assert.equal(w.result,'caught');
  else {assert.equal(w.result,null);assert.equal(w.events.find(e=>e.type==='miss').cause,'range');}
 }
});
test('burst candidate retains recovery penalty, cost, perfect timing, and police performance',()=>{
 const old=presetConfig('rhythm-short-dodge'),now=presetConfig('rhythm-mixed');
 assert.deepEqual(old.capture,now.capture);assert.deepEqual(old.police,now.police);
 for(const key of ['startup','cost','recovery','recoveryScale','perfectDelay','perfectDuration'])assert.equal(now.dodge[key],old.dodge[key]);
 const d=now.dodge,cycleSpeed=RUN*(d.multiplier*d.duration+(1+d.recoveryScale)/2*d.recovery)/(d.startup+d.duration+d.recovery);
 assert.ok(cycleSpeed<RUN*now.police.speedScale,'repeated forward dodges do not outrun a fresh police in unobstructed full cycles');
});
test('old fixed lunge can pass a reversing target; rhythm attacks cannot be beaten by straight phasing',()=>{
 const old=new World(clone(DEFAULT),7);Object.assign(old.police,{x:0,y:0,dir:0,moveDir:0});Object.assign(old.player,{x:M(2.4),y:0});old.startAttack('lunge');
 while(old.time<.31&&!old.result)old.step({x:-1,y:0});assert.equal(old.result,null);assert.equal(old.metrics.evades,1);
 for(const mode of ['stand','stride','sweep','lunge']) {
  const w=attack(mode);w.player.x=M(mode==='lunge'?2.4:.85);
  while(w.time<.8&&!w.result){w.step({x:-1,y:0});assert.ok(dist(w.player,w.police)>=w.config.player.radius+w.config.police.radius-1e-7);}
  assert.equal(w.result,'caught',mode);assert.equal(w.metrics.dodges,0);
 }
});
