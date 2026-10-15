import test from 'node:test';
import assert from 'node:assert/strict';
import {World} from '../dist/core.mjs';
import {presetConfig} from '../dist/presets.mjs';
import {mirrorInput, cancelMirror, startMirror} from '../dist/mirrors.mjs';
const gap=w=>Math.hypot(w.player.x-w.police.x,w.player.y-w.police.y);
const run=(w,t=3.6)=>{while(!w.result&&w.time<t)w.step(mirrorInput(w));return w;};
const duel=id=>new World(presetConfig('mirror-landing-'+id),42);
test('feint seed 42 does not abandon a witnessed exit interception to reroll entry guarding',()=>{
 const c=presetConfig('mirror-cancel-feint');Object.assign(c.mirror,{playerWindup:1.5,playerRecovery:.8,policeWindup:.8});
 const w=run(new World(c,42),6);
 const events=w.events.filter(e=>e.actor==='police');
 const cut=events.find(e=>e.choice==='intercept');assert.ok(cut);
 assert.ok(!events.some(e=>e.t>cut.t&&['wait','fake','follow'].includes(e.choice)));
});
test('visible player recovery distinguishes cancellation and arrival after reaction delay',()=>{
 for(const action of ['cancel-recovery','arrival-recovery']){
  const w=new World(presetConfig('mirror-ai-mixed'),42),mind=w.mirror.minds.police;
  w.config.mirror.ai.jitter=0;
  if(action==='cancel-recovery'){startMirror(w,'player',0);cancelMirror(w,'player','input');}
  else{Object.assign(w.player,w.config.mirror.points[1]);w.mirror.player={phase:'landing',from:0,until:1};}
  Object.assign(w.police,{x:w.player.x-2,y:w.player.y,dir:0});
  mind.ingest(w);assert.equal(mind.observation,null);
  w.time=.21;mind.ingest(w);
  assert.equal(mind.memory.mirrorAction,action);
  assert.equal(!!mind.transitEvidence,action==='arrival-recovery');
  if(mind.transitEvidence)assert.equal(mind.transitEvidence.to,1);
 }
});
test('exit interception permits timely return with sufficient lead but catches a closer start',()=>{
 const w=run(duel('intercept-return'));
 assert.equal(w.mirror.used[1],true);assert.ok(gap(w)>10);
 const c=presetConfig('mirror-landing-intercept-return');c.mirror.policeStart.x=0;
 const close=run(new World(c,42));assert.equal(close.result,'caught');assert.equal(close.mirror.used[1],false);
});
test('timely reverse crosses a committed follow while delayed reverse is sealed and interrupted',()=>{
 const early=run(duel('follow-return')),late=run(duel('follow-late'));
 assert.ok(early.mirror.sealed&&early.mirror.used[1]);assert.ok(gap(early)>14);
 assert.ok(late.mirror.sealed&&!late.mirror.used[1]);
 assert.ok(late.events.some(e=>e.phase==='cancel'&&e.reason==='sealed'));
 assert.ok(gap(late)<gap(early));
});
test('fake follow catches returning landing recovery but concedes distance to forward departure',()=>{
 const back=run(duel('fake-return')),leave=duel('fake-leave');run(leave,4);
 assert.equal(back.result,'caught');
 const arrival=back.events.find(e=>e.phase==='teleport'&&e.actor==='player');
 assert.ok(back.time-arrival.t<back.config.mirror.playerRecovery);
 assert.equal(leave.result,null);assert.ok(gap(leave)>10);assert.ok(leave.mirror.sealed);
 assert.ok(leave.events.some(e=>e.phase==='stop-waiting'));
});
test('interceptor turns toward a completed return after its notification delay',()=>{
 const w=run(duel('intercept-return'),2.7),notice=w.events.find(e=>e.phase==='turn-to-arrival');
 const arrival=w.events.find(e=>e.phase==='teleport'&&e.actor==='player');
 assert.ok(notice.t-arrival.t>=.249);assert.equal(notice.x,w.config.mirror.points[0].x);
 const before=w.police.x;run(w,3.6);assert.ok(w.police.x<before);
});
test('sealed interruption holds AI movement for configured reaction delay',()=>{
 for(const delay of [.2,.35,.5]){
  const c=presetConfig('mirror-landing-follow-late');c.mirror.restartDelay=delay;
  const w=run(new World(c,42),2.6),position={x:w.player.x,y:w.player.y};
  assert.ok(w.mirror.restartUntil>=2.6+delay-1e-6);
  run(w,2.6+delay-.02);assert.equal(w.player.x,position.x);assert.equal(w.player.y,position.y);
  run(w,2.6+delay+.1);assert.ok(w.player.x>position.x);
 }
});
test('leaving triggers follow or movement; visible moving pursuit permits a return attempt',()=>{
 const worlds=['follow','move','return'].map(s=>run(new World(presetConfig('mirror-landing-counter-'+s),42),6));
 assert.ok(worlds[0].mirror.sealed);assert.equal(worlds[1].mirror.sealed,false);
 assert.ok(worlds[2].events.some(e=>e.phase==='windup'&&e.actor==='player'&&e.from===1));
 for(const w of worlds)assert.ok(w.events.some(e=>e.phase==='stop-waiting'));
});
test('committed follow and fake waiting keep identical public position and facing before teleport',()=>{
 const follow=duel('follow-return'),fake=duel('fake-return');
 while(follow.time<2){follow.step(mirrorInput(follow));fake.step(mirrorInput(fake));
  for(const k of ['x','y','dir','speed'])assert.equal(follow.police[k],fake.police[k]);
 }
 assert.equal(follow.mirror.police.phase,'windup');assert.equal(fake.mirror.police,null);
});
test('current mirror defaults are player 1+1 and police 2+1; landing locks position and facing for one second',()=>{
 const c=presetConfig('mirror-landing-follow-return');
 assert.deepEqual([c.mirror.playerWindup,c.mirror.playerRecovery,c.mirror.policeWindup,c.mirror.policeRecovery],[1,1,2,1]);
 const w=run(new World(c,42),2.6);
 const transit=w.events.find(e=>e.actor==='police'&&e.phase==='teleport');assert.equal(transit.t,2.6);
 const pose={x:w.police.x,y:w.police.y,dir:w.police.dir};
 while(w.time<3.59){w.step({x:1,y:0});assert.deepEqual({x:w.police.x,y:w.police.y,dir:w.police.dir},pose);assert.equal(w.police.visible,false);}
 run(w,3.61);assert.equal(w.mirror.police,null);
});
