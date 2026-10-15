import test from 'node:test';
import assert from 'node:assert/strict';
import {World,validate} from '../dist/core.mjs';
import {Bot} from '../dist/bots.mjs';
import {presetConfig} from '../dist/presets.mjs';
import {configureOpenDuel} from '../dist/open-duel-config.mjs';
import {operationParameters} from '../dist/ai-operation.mjs';
test('pressure zero preserves baseline; pressure broadens uncertainty without reading health or stamina',()=>{
 const c=configureOpenDuel(presetConfig('rhythm-mixed'),{profile:'fast'}),base=operationParameters(c);
 assert.equal(base.mean,.14);assert.equal(base.timingSigma,.025);assert.equal(base.lapseProbability,.02);
 c.duel.pressure=1;const stressed=operationParameters(c);
 assert.ok(Math.abs(stressed.mean-.22)<1e-12);assert.ok(Math.abs(stressed.timingSigma-.065)<1e-12);assert.ok(Math.abs(stressed.lapseProbability-.12)<1e-12);
 c.player.staminaMax=200;assert.deepEqual(operationParameters(c),stressed);
 c.duel.pressure=-.1;assert.ok(validate(c).length);c.duel.pressure=1.1;assert.ok(validate(c).length);
});
test('seed42 light attack: earlier plan retains same timing error and avoids the unpressed first hit',()=>{
 const runs=[];
 for(const human of ['reverse','reverse_early30']){
  const c=configureOpenDuel(presetConfig('rhythm-mixed'),{profile:'fast',human,hunter:'light',duration:60});
  const w=new World(c,42),b=new Bot(c,42,'perfect');while(!w.result&&w.time<5.1)w.step(b.action(w));runs.push({w,b});
 }
 assert.equal(runs[0].w.result,'caught');assert.equal(runs[0].w.metrics.dodges,0);
 assert.equal(runs[1].w.result,null);assert.equal(runs[1].w.metrics.perfect,1);
 assert.equal(runs[0].b.timingPlans[0].timingError,runs[1].b.timingPlans[0].timingError);
 assert.ok(runs[0].b.timingPlans[0].targetElapsed>.3);assert.ok(runs[1].b.timingPlans[0].targetElapsed<.3);
});
test('earlier plans do not clamp away pressure-induced errors or guaranteed lapses',()=>{
 const c=configureOpenDuel(presetConfig('rhythm-mixed'),{profile:'fast',human:'reverse_early90',hunter:'light'});
 c.duel.pressure=1;c.duel.pressureEffects.lapseProbability=1;
 const w=new World(c,42),b=new Bot(c,42,'perfect');while(!w.result&&w.time<6)w.step(b.action(w));
 assert.equal(b.timingPlans[0].lapse,true);assert.equal(w.metrics.dodges,0);assert.equal(w.result,'caught');
});
