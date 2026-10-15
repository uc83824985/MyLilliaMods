import { metres as M, mirrorY } from '../dist/units.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {World,BASE} from '../dist/core.mjs';
import {presetConfig} from '../dist/presets.mjs';
import {mirrorInput} from '../dist/mirrors.mjs';
const world=(style='mixed',seed=42)=>new World(presetConfig('mirror-ai-'+style),seed);
test('observed exit cut causes paid cancellation while pressure and brief feints retain the cast',()=>{
 for(const response of ['pressure','intercept','feint']){
  const c=presetConfig('mirror-cancel-'+response);Object.assign(c.mirror,{playerWindup:1.5,playerRecovery:.8,policeWindup:.8});
  const w=new World(c,42);
  while(!w.result&&w.time<2.4)w.step(mirrorInput(w));
  const cancel=w.events.find(e=>e.type==='mirror'&&e.phase==='cancel'&&e.reason==='input');
  assert.equal(!!cancel,response==='intercept');
  assert.equal(w.mirror.used[0],response!=='intercept');
  if(cancel){assert.equal(cancel.recovery,.8);assert.equal(cancel.stamina,60);assert.equal(w.mirror.sealed,false);}
 }
});
function run(w,seconds=12){while(!w.result&&w.time<seconds)w.step(mirrorInput(w));return w;}
test('mirror minds wait for delayed appearance and loss; hidden position cannot refresh memory',()=>{
 const w=world(),mind=w.mirror.minds.player;w.config.mirror.ai.jitter=0;
 mind.ingest(w);assert.equal(mind.observation,null);
 w.time=.17;mind.ingest(w);assert.ok(mind.observation.enemy);const x=mind.memory.x;
 Object.assign(w.police,{x:0,y:M(22)});w.time=.28;mind.ingest(w);assert.ok(mind.observation.enemy);
 w.time=.6;mind.ingest(w);assert.equal(mind.observation.enemy,null);assert.equal(mind.memory.x,x);
 Object.assign(w.police,{x:M(4),y:M(22)});w.time=.8;mind.ingest(w);assert.equal(mind.memory.x,x);
 Object.assign(w.police,{x:M(-24),y:mirrorY(-24)});w.time=.91;mind.ingest(w);assert.equal(mind.observation.enemy,null);
 w.time=1.2;mind.ingest(w);assert.equal(mind.memory.x,M(-24));
});
test('hidden follow preparation and identical waiting produce identical player observations and actions',()=>{
 const a=world(),b=world();b.mirror.police={phase:'windup',from:0,until:5};
 for(const w of [a,b]){w.police.speed=0;w.config.mirror.ai.jitter=0;w.mirror.minds.player.ingest(w);w.time=.2;w.mirror.minds.player.ingest(w);}
 assert.deepEqual(a.mirror.minds.player.observation,b.mirror.minds.player.observation);
 assert.deepEqual(mirrorInput(a),mirrorInput(b));
});
test('walking from one endpoint to another is not treated as a teleport',()=>{
 const w=world(),mind=w.mirror.minds.police;w.config.mirror.ai.jitter=0;
 Object.assign(w.police,{x:M(-26),y:mirrorY(-24),dir:0});mind.ingest(w);w.time=.3;mind.ingest(w);
 Object.assign(w.player,{x:M(10),y:mirrorY(-19)});w.time=5;mind.ingest(w);w.time=5.3;mind.ingest(w);
 assert.equal(mind.transitEvidence,undefined);
});
test('attack tracking cannot bypass delayed perception with the live player position',()=>{
 const worlds=[world(),world()];
 worlds.forEach((w,i)=>{Object.assign(w.police,{x:M(-12),y:mirrorY(-26),dir:0,moveDir:0,visible:true});Object.assign(w.player,{x:M(i?6:3),y:mirrorY(-20)});
   const mind=w.mirror.minds.police;mind.memory={x:M(-10),y:mirrorY(-26),moveDir:0,speed:0,seenAt:0};mind.observation={time:0,enemy:{...mind.memory}};w.startAttack('stand');w.attackStep(.1);});
 assert.equal(worlds[0].police.attack.dir,worlds[1].police.attack.dir);
});
test('AI keeps safe geometry and uses the mirror with a sufficient initial lead',()=>{
 const w=world();while(!w.result&&w.time<12){w.step(mirrorInput(w));assert.ok(w.map.free(w.player,w.config.player.radius-.01));assert.ok(w.map.free(w.police,w.config.police.radius-.01));}
 assert.ok(w.mirror.used[0]);assert.ok(w.events.some(e=>e.type==='mirror-ai'&&e.actor==='police'));
});
test('short initial lead makes the player evade instead of blindly casting',()=>{
 const c=presetConfig('mirror-ai-mixed');c.mirror.policeStart={x:M(-14),y:mirrorY(-24)};const w=run(new World(c,42),2);
 assert.equal(w.mirror.used[0],false);assert.ok(w.events.some(e=>e.type==='mirror-ai'&&e.choice==='evade'));
});
test('exit-side positioning denies a blind teleport and forces another route',()=>{
 const w=run(new World(presetConfig('mirror-ai-triangle'),42),3);
 assert.equal(w.mirror.used[0],false);assert.ok(w.events.some(e=>e.choice==='evade'));
});
test('historical 1.5s cast policy avoids a guard but returns against a biased interceptor',()=>{
 let guard=0,intercept=0;
 const previous=(style,seed)=>{const c=presetConfig('mirror-ai-'+style);Object.assign(c.mirror,{playerWindup:1.5,playerRecovery:.8,policeWindup:.8});return new World(c,seed);};
 for(let seed=1;seed<=12;seed++){guard+=+run(previous('wait',seed)).mirror.used[1];intercept+=+run(previous('intercept',seed)).mirror.used[1];}
 assert.equal(guard,0);assert.ok(intercept>=8,`return count ${intercept}`);
});
test('same seed and inputs reproduce AI decisions, movements and events',()=>{
 const a=world(),b=world();for(let i=0;i<1200&&!a.result;i++){const input=mirrorInput(a);a.step(input);b.step(input);}
 assert.deepEqual(a.events.filter(e=>e.actor==='police'),b.events.filter(e=>e.actor==='police'));assert.deepEqual(a.player,b.player);assert.deepEqual(a.police,b.police);
 const c=run(world(),10),d=run(world(),10);assert.deepEqual(c.events,d.events);
});
test('quiet reversal requires observed teleport, remaining lock time and feasible back-side position',()=>{
 const w=world(),mind=w.mirror.minds.player;w.time=1;w.mirror.sealed=true;
 Object.assign(w.police,{x:M(-10),y:mirrorY(-26),dir:0,moveDir:0,speed:0});Object.assign(w.player,{x:M(-11),y:mirrorY(-25)});
 mind.memory={x:M(-10),y:mirrorY(-26),dir:0,moveDir:0,speed:0,seenAt:.9};mind.observation={time:.9,enemy:{...mind.memory}};mind.transitEvidence={from:1,to:0,observedAt:.9,time:1};
 const input=mirrorInput(w);assert.equal(mind.choice,'quiet-reverse');assert.equal(input.walk,true);
 w.time=3;mirrorInput(w);assert.notEqual(mind.choice,'quiet-reverse');
});
