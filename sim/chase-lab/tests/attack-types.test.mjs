import { metres as M } from '../dist/units.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {World,RUN,validate,DEFAULT,clone,dist} from '../dist/core.mjs';
import {presetConfig} from './geometry-fixture.mjs';
import {drillInput} from '../dist/drills.mjs';
import {perceptionCue} from '../dist/perception.mjs';
function attack(mode){const w=new World(presetConfig('rhythm'),7);Object.assign(w.police,{x:0,y:0,dir:0,moveDir:0});Object.assign(w.player,{x:M(20),y:0});w.startAttack(mode);return w;}
test('edge-range straight running is caught; contact-range perfect refunds stamina and opens distance',()=>{
 for(const mode of ['stand','lunge'])for(const response of ['none','perfect','late']){
  const w=attack(mode),m=w.config.capture[mode];w.config.player.runDrain=0;w.player.x=response==='perfect'?M(mode==='lunge'?2.2:.9):m.trigger;w.player.stamina=70;
  const press=m.windup-(response==='perfect'?w.config.dodge.perfectDuration/2:.005);
  while(w.time<m.windup+.001&&!w.result)w.step({x:1,dodge:response!=='none'&&w.metrics.dodges===0&&w.time>=press-1e-8});
  if(response==='perfect'){
   assert.equal(w.metrics.perfect,1);assert.equal(w.player.stamina,70);assert.equal(w.police.attack.recoveryScale,1);
   const gap=dist(w.player,w.police);while(w.time<m.windup+1&&!w.result)w.step({x:1});assert.ok(dist(w.player,w.police)>gap+M(3));
  }else assert.equal(w.result,'caught',`${mode}/${response}`);
 }
});
test('fatigue can reduce speed with uninterrupted sight and logs both transitions',()=>{
 const w=attack('stand');w.police.attack=null;w.police.stamina=.01;w.police.speed=RUN*1.1;
 w.step({});w.step({});assert.equal(w.police.visible,true);assert.equal(w.police.tired,true);assert.ok(w.police.speed<RUN*1.1);
 assert.equal(w.events.find(e=>e.type==='fatigue').tired,true);
 w.police.stamina=w.config.police.staminaMax*w.config.police.resumeAt;w.step({});assert.equal(w.police.tired,false);assert.equal(w.events.filter(e=>e.type==='fatigue').at(-1).tired,false);
});
test('eye and ear independently show actual sight and fresh hearing; walking emits no cue',()=>{
 const w=attack('stand');w.player.x=M(3);w.step({x:1,walk:true});assert.deepEqual(perceptionCue(w),{eye:'visible',ear:'quiet'});
 w.step({x:1});assert.equal(perceptionCue(w).ear,'heard');
 w.police.visible=false;assert.equal(perceptionCue(w).eye,'lost');assert.equal(perceptionCue(w).ear,'heard');
 w.time+=w.config.search.soundInterval;assert.equal(perceptionCue(w).ear,'quiet');
});
test('all rhythm light variants keep normal movement throughout windup',()=>{
 for(const mode of ['stand','stride','sweep']){const w=attack(mode);while(w.time<.45)w.step({});assert.ok(Math.abs(w.police.x-RUN*1.1*.3)<1e-7);assert.equal(w.police.y,0);assert.equal(w.events.find(e=>e.type==='miss').t,.3);}
});
test('charged attack moves at 1.2x from first frame and only judges after full windup',()=>{
 const w=attack('lunge');while(w.time<.4-1e-8)w.step({});assert.ok(Math.abs(w.police.x-RUN*1.1*1.2*.4)<1e-8);assert.equal(w.metrics.evades,0);
 while(w.time<.6-1e-8)w.step({});assert.ok(Math.abs(w.police.x-RUN*1.1*1.2*.6)<1e-7);assert.equal(w.events.find(e=>e.type==='miss').t,.6);
});
test('unit perfect timing follows per-attack windup instead of global 300ms',()=>{
 const w=new World(presetConfig('drill-charge'),7);while(w.time<.57&&!w.result)w.step(drillInput(w));
 const dodge=w.events.find(e=>e.type==='dodge');assert.ok(dodge.t>=.55&&dodge.t<.567);
});
test('invalid movement onset is rejected',()=>{const c=presetConfig('rhythm');c.capture.lunge.moveFrom=.7;assert.ok(validate(c).length>0);});
test('continuous charge is stopped by physical contact rather than old target travel budget',()=>{
 const w=attack('lunge');w.player.x=M(1.4);
 while(w.time<.6-1e-8&&!w.result)w.step({});
 assert.ok(Math.abs(dist(w.police,w.player)-M(.62))<1e-7);assert.equal(w.police.attack.advanceTarget,undefined);assert.equal(w.result,'caught');
});
test('faster charge tracking catches the late lateral dodge that escaped old tracking on both sides',()=>{
 for(const rate of [180,540])for(const side of [-1,1]){
  const w=attack('lunge');w.player.x=M(2.4);w.police.attack.snapshot.turnRate=rate;
  while(w.time<.61&&!w.result)w.step({x:0,y:w.tick>=48?side:0,dodge:w.tick===48});
  if(rate===180){assert.equal(w.result,null);assert.ok(['angle','range'].includes(w.events.find(e=>e.type==='miss').cause));}
  else assert.equal(w.result,'caught');
  assert.ok(w.police.dir*side>0);
 }
});
test('light tracking beats resource-free circling and tangential crossing on both sides',()=>{
 for(const mode of ['stand','stride','sweep']) for(const side of [-1,1]) for(const motion of ['orbit','tangent']) for(const radius of [.65,.85,1.2]) {
  const w=attack(mode);w.player.x=M(radius);
  while(w.time<.31&&!w.result){const t=Math.atan2(w.player.y-w.police.y,w.player.x-w.police.x);w.step(motion==='orbit'?{x:-Math.sin(t)*side,y:Math.cos(t)*side}:{x:0,y:side});}
  assert.equal(w.result,'caught',`${mode}/${side}/${motion}/${radius}`);assert.equal(w.metrics.dodges,0);
 }
});
test('tracking light still allows early distance dodge and actual perfect response',()=>{
 for(const response of ['early','perfect']){const c=presetConfig('drill-response');c.drill.response=response;const w=new World(c,7);while(w.time<.31&&!w.result)w.step(drillInput(w));assert.equal(w.result,null,response);assert.equal(w.metrics.evades,1,response);}
});
test('spiral response produces curved pursuit and angular miss for lunge, but is caught by light',()=>{
 for(const side of [-1,1]) for(const mode of ['stand','lunge']) {
  const c=presetConfig('drill-charge');Object.assign(c.drill,{response:'spiral',mode,side});const w=new World(c,7);
  let burstStartDir=null;
  while(w.time<.61&&!w.result){w.step(drillInput(w));if(w.time>=.4&&burstStartDir===null)burstStartDir=w.police.dir;}
  if(mode==='stand')assert.equal(w.result,'caught');
  else{assert.equal(w.result,null);const miss=w.events.find(e=>e.type==='miss');assert.ok(['angle','range'].includes(miss.cause));assert.ok(miss.angleDegrees>c.capture.lunge.angle/2);assert.ok(Math.hypot(w.police.x,w.police.y)>M(.4));assert.ok(Math.abs(w.police.dir-burstStartDir)>.2);}
 }
});
