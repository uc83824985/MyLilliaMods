import test from 'node:test';
import assert from 'node:assert/strict';
import {World,dist} from '../dist/core.mjs';
import {presetConfig} from '../dist/presets.mjs';
import {drillInput,drillSummary} from '../dist/drills.mjs';
test('perfect reward demonstration attacks immediately and confirms an actual perfect',()=>{
 const w=new World(presetConfig('rhythm-perfect'),42);assert.equal(w.metrics.attacks,1);assert.equal(w.events[0].t,0);
 while(w.time<.4&&!w.result)w.step(drillInput(w));assert.equal(w.metrics.perfect,1);
});
test('recovery fixtures stay near police instead of selecting distant escape routes',()=>{
 for(const exit of ['same','cross','circle']){const c=presetConfig('drill-'+exit),w=new World(c,42);while(w.time<1.4&&!w.result){w.step(drillInput(w));assert.ok(dist(w.player,w.police)<2.2);}assert.equal(drillSummary(w).firstResponse,'fixture');}
});
test('script inputs replay exactly with fixture initialization preserved',()=>{
 const c=presetConfig('drill-response'),w=new World(c,42),r=new World(c,42);
 while(!w.result){const input=drillInput(w);w.step(input);r.step(input);}assert.deepEqual(w.events,r.events);assert.deepEqual(w.summary(),r.summary());
});
