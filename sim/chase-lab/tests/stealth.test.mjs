import test from 'node:test';
import assert from 'node:assert/strict';
import {World,dist} from '../dist/core.mjs';
import {presetConfig} from './geometry-fixture.mjs';
import {perceptionCue} from '../dist/perception.mjs';
function fixture(){const c=presetConfig('stealth-search');c.stealth.duration=4;const w=new World(c,17);Object.assign(w.police,{x:0,y:0,dir:0,moveDir:0,lastSeen:{x:3,y:0}});Object.assign(w.player,{x:3,y:0});return w;}
test('invisibility blocks sight, not real running sounds, and has deterministic cooldown',()=>{
 const w=fixture();w.step({stealth:true,x:1});assert.ok(w.invisible());assert.equal(w.police.visible,false);assert.equal(perceptionCue(w).ear,'heard');
 const expiry=w.player.invisibleUntil,ready=w.player.stealthReadyAt;
 w.step({stealth:true,walk:true});assert.equal(w.player.invisibleUntil,expiry);assert.equal(w.player.stealthReadyAt,ready);
 w.player.x=20;
 while(w.time<expiry&&!w.result)w.step({walk:true});assert.ok(!w.result);assert.equal(w.invisible(),false);
 w.step({stealth:true});assert.equal(w.invisible(),false);assert.equal(w.events.filter(e=>e.type==='stealth'&&e.phase==='start').length,1);
});
test('hidden quiet target relocation cannot redirect last-evidence search or probe aim',()=>{
 const a=fixture(),b=fixture();for(const w of [a,b]){w.step({stealth:true,walk:true});w.player.x=10;}
 a.player.y=2;b.player.y=-2;
 for(let i=0;i<360;i++){a.step({walk:true});b.step({walk:true});assert.deepEqual(a.police,b.police);}
 assert.ok(a.events.some(e=>e.type==='probe'));assert.equal(a.metrics.soundsHeard,0);
});
test('blind search attacks can catch an invisible stationary target without reacquiring vision',()=>{
 const w=fixture();while(!w.result&&w.time<3)w.step({stealth:w.tick===0,walk:true});
 assert.equal(w.result,'caught');assert.equal(w.police.visible,false);assert.ok(w.invisible());assert.ok(w.events.some(e=>e.type==='probe'));
 assert.ok(dist(w.player,w.police)>=.62-1e-6);
});
test('blind probe recovery preserves the existing search budget',()=>{
 const w=fixture();w.step({stealth:true,walk:true});w.player.x=15;
 const deadline=w.police.search.deadline;
 while(w.time<3.5&&!w.result)w.step({walk:true});
 assert.equal(w.police.search.deadline,deadline);assert.ok(w.events.filter(e=>e.type==='probe').length<=2);
});
