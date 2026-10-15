import test from 'node:test';
import assert from 'node:assert/strict';
import {World,validate} from '../dist/core.mjs';
import {presetConfig} from '../dist/presets.mjs';
import {applyMirrorStrategies,sampleStrategy,PLAYER_STRATEGIES,POLICE_STRATEGIES} from '../dist/mirror-strategies.mjs';
import {gameEpisode,GAME_SCENARIOS,matrixBounds,dispersedSeed} from '../dist/mirror-game.mjs';
import {integrationPlayerInput,getCommandDirector} from '../dist/mirror-decisions.mjs';
test('all policy pairs retain fixed mechanics and valid configurations',()=>{
 for(const p of Object.keys(PLAYER_STRATEGIES))for(const e of Object.keys(POLICE_STRATEGIES)){
  const c=presetConfig('mirror-integration-mixed');applyMirrorStrategies(c,p,e);assert.deepEqual(validate(c),[]);
  assert.deepEqual([c.mirror.playerWindup,c.mirror.playerRecovery,c.mirror.policeWindup,c.mirror.policeRecovery],[1,1,2,1]);
 }
});
test('mixture samples complete strategies reproducibly without coupling the opponent draw',()=>{
 const c=presetConfig('mirror-integration-mixed');c.mirror.ai.integration.mixture={player:{safe_leave:.5,safe_return:.5},police:{balanced:.5,guard:.5}};
 const a=new World(c,42),b=new World(c,42);assert.deepEqual(a.mirror.sampledStrategies,b.mirror.sampledStrategies);
 c.mirror.ai.integration.mixture.player={bypass:1};const other=new World(c,42);
 assert.equal(other.mirror.sampledStrategies.police,a.mirror.sampledStrategies.police);assert.equal(other.mirror.sampledStrategies.player,'bypass');
 assert.equal(sampleStrategy({safe_leave:1,safe_return:0},9,1),'safe_leave');
});
test('invalid mixture policy identifiers and zero total weights are rejected',()=>{
 const c=presetConfig('mirror-integration-mixed');c.mirror.ai.integration.mixture={player:{unknown:1},police:{guard:0}};assert.ok(validate(c).length>=2);
});
test('finite game bounds measure best-response incentive, not closeness to fifty percent',()=>{
 const r=matrixBounds([[.9,.9],[.9,.9]],[.5,.5],[.5,.5]);assert.equal(r.gap,0);assert.equal(r.value,.9);
 const exposed=matrixBounds([[0,1],[1,0]],[1,0],[1,0]);assert.equal(exposed.gap,1);assert.equal(exposed.playerDeviation,1);
});
test('no-interaction control does not teleport and reports timeout separately from disengagement',()=>{
 const r=gameEpisode('bypass','balanced',GAME_SCENARIOS[0],111);assert.equal(r.teleports,0);assert.ok(r.score>=0&&r.score<=1);assert.ok(['caught','timeout','disengaged'].includes(r.outcome));
});
test('forward command does not stop or pull back after reaching its local route target',()=>{
 const c=presetConfig('mirror-integration-mixed');applyMirrorStrategies(c,'safe_leave','balanced');const w=new World(c,42),mind=w.mirror.minds.player;
 w.mirror.used[0]=true;mind.integrationPlan={endpoint:1,departed:true,routeDone:true};mind.observation={time:0,enemy:null};
 let calls=0;const input=integrationPlayerInput(w,mind,()=>{calls++;return {x:1,y:0};});assert.ok(calls>0);assert.equal(input.x,1);
});
test('policy selection follows public exposure and retains deterministic replay configuration',()=>{
 const c=presetConfig('mirror-equilibrium-low');c.mirror.ai.integration.mixtureByExposure={low:{player:{run_first:1},police:{guard:1}},high:{player:{safe_leave:1},police:{cut_follow:1}}};
 const low=new World(c,42);assert.equal(low.mirror.sampledStrategies.player,'run_first');
 c.exposure=.85;const high=new World(c,42);assert.equal(high.mirror.sampledStrategies.player,'safe_leave');
 assert.deepEqual(new World(high.config,42).mirror.sampledStrategies,high.mirror.sampledStrategies);
});
test('command random draws do not change subsequent reaction-delay random draws',()=>{
 const c=presetConfig('mirror-integration-mixed'),a=new World(c,42),b=new World(c,42);
 const director=getCommandDirector(a,a.mirror.minds.player);for(let i=0;i<100;i++)director.random();
 for(let i=0;i<20;i++)assert.equal(a.mirror.minds.player.random(),b.mirror.minds.player.random());
});
test('entry safety includes travel back to the mirror rather than just current separation',()=>{
 const c=presetConfig('mirror-integration-mixed');applyMirrorStrategies(c,'safe_leave','balanced');const w=new World(c,42),mind=w.mirror.minds.player;
 const a=c.mirror.points[0];Object.assign(w.player,{x:a.x-5,y:a.y});
 mind.memory={x:a.x+2,y:a.y,seenAt:0,speed:0,moveDir:Math.PI,dir:Math.PI};mind.observation={time:0,enemy:{...mind.memory}};
 integrationPlayerInput(w,mind,()=>({x:-1,y:0}));
 const event=w.events.find(e=>e.type==='mirror-decision');assert.ok(event.context.entryTravel>1);assert.equal(event.context.entrySafe,false);
 assert.equal(event.candidates.find(c=>c.action==='teleport').allowed,false);
});
test('training and audit seeds are reproducible, dispersed and disjoint',()=>{
 const a=Array.from({length:12},(_,i)=>dispersedSeed(300000,i)),b=Array.from({length:12},(_,i)=>dispersedSeed(400000,i));
 assert.equal(new Set([...a,...b]).size,24);assert.ok(a.some((v,i)=>i&&Math.abs(v-a[i-1])>100000000));assert.equal(a[0],dispersedSeed(300000,0));
});
