import test from 'node:test';
import assert from 'node:assert/strict';
import {World,BASE} from '../dist/core.mjs';
import {presetConfig} from './geometry-fixture.mjs';
import {createCapture,advanceCapture,playerMotion} from '../dist/ai-actions.mjs';
import {buildAIContext} from '../dist/ai-context.mjs';
import {Bot} from '../dist/bot-mind.mjs';
const world=(preset='practice')=>{const w=new World(presetConfig(preset),42);Object.assign(w.player,{x:0,y:0});Object.assign(w.police,{x:20,y:0});return w;};
test('dodge feedback reports acceptance, recovery, completion and rejected overlap',()=>{
  const w=world();assert.equal(w.dodge(1,0),true);const request=w.player.dodge.request;
  assert.equal(w.dodge(1,0),false);assert.equal(w.actionFeedback.player.current.requestId,request.requestId);
  while(w.player.dodge)w.step({walk:true});
  const events=w.actionFeedback.player.events;
  assert.ok(events.some(e=>e.status==='running'&&e.phase==='recovery'));
  assert.equal(events.at(-1).status,'succeeded');assert.equal(events.at(-1).requestId,request.requestId);
});
test('insufficient stamina rejects dodge without charging or starting it',()=>{
  const w=world();w.player.stamina=1;assert.equal(w.dodge(1,0),false);
  assert.equal(w.player.stamina,1);assert.equal(w.player.dodge,null);
  assert.equal(w.actionFeedback.player.events.at(-1).reason,'stamina');
});
test('missed capture remains running through recovery then fails; overlap cannot reset progress',()=>{
  const w=world('rhythm');assert.equal(w.startAttack('stand'),true);const attack=w.police.attack;
  w.attackStep(BASE.dt);const elapsed=attack.elapsed;
  assert.equal(w.startAttack('lunge'),false);assert.equal(w.police.attack,attack);assert.equal(attack.elapsed,elapsed);
  while(w.police.attack?.phase!=='recovery')w.attackStep(BASE.dt);
  assert.equal(w.actionFeedback.police.current.phase,'recovery');
  while(w.police.attack)w.attackStep(BASE.dt);
  assert.equal(w.actionFeedback.police.events.at(-1).status,'failed');
});
test('confirmed capture succeeds and round ending interrupts unfinished dodge',()=>{
  const w=world('rhythm');Object.assign(w.police,{x:0,y:0,dir:0,moveDir:0});w.player.x=.5;
  w.dodge(1,0);w.player.dodge.elapsed=.2;w.startAttack('stand');
  const attack=w.police.attack;w.resolve(attack);
  assert.equal(w.actionFeedback.police.events.at(-1).status,'succeeded');
  assert.equal(w.actionFeedback.player.events.at(-1).status,'interrupted');
  assert.equal(buildAIContext(w,'police').feedback.status,'succeeded');
});
test('timeout is interruption, never inferred action success from an idle state',()=>{
  const w=world();w.config.duration=.05;w.dodge(1,0);while(!w.result)w.step({});
  assert.equal(w.actionFeedback.player.current,null);
  assert.equal(w.actionFeedback.player.events.at(-1).reason,'round-timeout');
});
test('shared capture process resumes from plain serialized state and needs only perceived target',()=>{
  const c=presetConfig('rhythm'),self={x:0,y:0,dir:0,moveDir:0,tired:false};
  const a=createCapture(c,self,'lunge',1,()=>.7),observation={target:{x:2,y:1},lastSeen:{x:2,y:1},visible:false};
  advanceCapture(c,self,a,observation,.1);const b=JSON.parse(JSON.stringify(a));
  assert.deepEqual(advanceCapture(c,self,a,observation,.1),advanceCapture(c,self,b,observation,.1));assert.deepEqual(a,b);
});
test('movement output is an intention: collision stays in host, and interaction locks freeze stamina',()=>{
  const c=presetConfig('rhythm'),self={x:0,y:0,dir:0,stamina:50};
  for(const phase of ['mirrorWindup','mirrorLanding']){
    const out=playerMotion(c,self,{x:1,walk:true},phase,.1);assert.equal(out.dx,0);assert.equal(out.stamina,50);
  }
  const out=playerMotion(c,self,{x:1},'ready',.1);assert.ok(out.dx>0);assert.equal(self.x,0);assert.equal(self.stamina,50);
});
test('ordinary player mind accepts restricted context without a World or actual police entity',()=>{
  const w=world('rhythm'),mind=new Bot(w.config,42);
  for(let i=0;i<40;i++){const context=buildAIContext(w,'player');assert.equal(context.police,undefined);w.step(mind.step(context));}
  assert.ok(mind.lastObservation);assert.ok(Number.isFinite(w.player.x));
});
