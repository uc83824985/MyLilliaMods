import test from 'node:test';
import assert from 'node:assert/strict';
import {World,validate} from '../dist/core.mjs';
import {presetConfig} from '../dist/presets.mjs';
import {mirrorInput} from '../dist/mirrors.mjs';
import {CommandDirector,corridorPosition,issueMirrorCommand,integrationPlayerInput} from '../dist/mirror-decisions.mjs';
const world=(style='mixed',seed=42)=>new World(presetConfig('mirror-integration-'+style),seed);
const run=w=>{while(!w.result)w.step(mirrorInput(w));return w;};
test('corridor uses finite segment and lateral tolerance, not an infinite line',()=>{
 const points=[{x:0,y:0},{x:10,y:0}];
 assert.ok(corridorPosition({x:5,y:1},points,1.5).inside);
 for(const p of [{x:11,y:0},{x:-1,y:0},{x:5,y:2}])assert.equal(corridorPosition(p,points,1.5).inside,false);
});
test('higher priority preempts, lower priority preserves commitment, zero probability never fires',()=>{
 const w=world(),d=new CommandDirector(()=>.5),offers=[{action:'forward',allowed:true},{action:'return',allowed:true}];
 d.issue('forward',{priority:40,duration:2});assert.equal(d.decide(w,'landing',offers).action,'forward');
 w.time=.1;d.issue('return',{priority:30});assert.equal(d.decide(w,'landing',offers).action,'forward');
 w.time=.2;d.issue('return',{priority:80,probability:0});assert.equal(d.decide(w,'landing',offers).action,'forward');
 w.time=.3;d.issue('return',{priority:80});assert.equal(d.decide(w,'landing',offers).action,'return');
});
test('issued high priority command cannot bypass its legal gate',()=>{
 const w=world(),d=new CommandDirector(()=>0);d.issue('cancel',{priority:999});
 const choice=d.decide(w,'casting',[{action:'continue',allowed:true},{action:'cancel',allowed:false}]);
 assert.equal(choice.action,'continue');assert.ok(w.events.at(-1).candidates.some(c=>c.action==='cancel'&&!c.allowed));
});
test('integration emits complete candidate reasons and deterministic closed-loop state',()=>{
 const a=run(world()),b=run(world());assert.deepEqual(a.events,b.events);assert.deepEqual(a.player,b.player);
 const decisions=a.events.filter(e=>e.type==='mirror-decision');assert.ok(decisions.length>5);
 for(const event of decisions){assert.ok(event.candidates.every(c=>typeof c.allowed==='boolean'&&c.reason));if(event.action)assert.ok(event.candidates.some(c=>c.action===event.action&&c.allowed));}
 assert.ok(a.mirror.branchStats.nodes.approach);assert.ok(a.mirror.branchStats.nodes.landing);
});
test('corridor cancellation succeeds and pays recovery without consuming a charge',()=>{
 const w=world('cancel');while(w.time<1.1)w.step(mirrorInput(w));
 const cancel=w.events.find(e=>e.phase==='cancel'&&e.reason==='input');assert.ok(cancel);assert.equal(cancel.recovery,1);
 assert.equal(w.mirror.player.cancelled,true);assert.deepEqual(w.mirror.used,[false,false]);
 const decision=w.events.find(e=>e.type==='mirror-decision'&&e.action==='cancel');assert.ok(decision.context.corridor.inside&&decision.context.cancelSafe&&decision.context.exitRisk);
});
test('hidden follow preparation cannot change integration observations or decisions',()=>{
 const a=world(),b=world();b.mirror.police={phase:'windup',from:0,until:5};
 for(const w of [a,b]){w.police.speed=0;w.config.mirror.ai.jitter=0;const mind=w.mirror.minds.player;mind.ingest(w);w.time=.2;mind.ingest(w);}
 assert.deepEqual(a.mirror.minds.player.observation,b.mirror.minds.player.observation);
 assert.deepEqual(mirrorInput(a),mirrorInput(b));assert.deepEqual(a.mirror.branchStats,b.mirror.branchStats);
});
test('landing commands plan only; even issued return cannot move or cast before recovery ends',()=>{
 const w=world('return');while(!w.mirror.player||w.mirror.player.phase!=='landing')w.step(mirrorInput(w));
 const until=w.mirror.player.until,position={x:w.player.x,y:w.player.y};issueMirrorCommand(w,'return',{priority:90});
 while(w.time<until-.02){w.step(mirrorInput(w));assert.equal(w.player.x,position.x);assert.equal(w.player.y,position.y);assert.equal(w.mirror.player.phase,'landing');}
});
test('feint travels a meaningful distance before its turn-back decision',()=>{
 const w=run(world('feint')),events=w.events.filter(e=>e.type==='mirror-decision');
 assert.ok(events.some(e=>e.action==='feint'));assert.ok(events.some(e=>e.action==='turn-back'));
 const forward=w.events.find(e=>e.phase==='ready'&&e.actor==='player');const back=events.find(e=>e.action==='turn-back');
 assert.ok(back.t-forward.t>.3);
});
test('invalid integration weights, probabilities and action names are rejected',()=>{
 for(const rule of [{probability:1.1},{weight:-1},{duration:Infinity}]){const c=presetConfig('mirror-integration-mixed');c.mirror.ai.integration.rules={landing:{return:rule}};assert.ok(validate(c).length);}
 const c=presetConfig('mirror-integration-mixed');c.mirror.ai.integration.rules={landing:{fly:{weight:1}}};assert.ok(validate(c).length);
});
test('issued police commands recorded as inputs reproduce physical outcomes on input replay',()=>{
 const a=world(),b=world();
 while(!a.result){let input=mirrorInput(a);
  if(a.tick===180)input={...input,mirrorCommands:[{action:'intercept',options:{actor:'police',priority:90,duration:2}}]};
  a.step(input);b.step(input);
 }
 assert.deepEqual(a.player,b.player);assert.deepEqual(a.police,b.police);assert.equal(a.result,b.result);
 const physical=w=>w.events.filter(e=>!['mirror-ai','mirror-decision'].includes(e.type));assert.deepEqual(physical(a),physical(b));
});
