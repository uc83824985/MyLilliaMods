import test from 'node:test';
import assert from 'node:assert/strict';
import {World,RNG} from '../dist/core.mjs';
import {presetConfig} from '../dist/presets.mjs';
import {configureOpenDuel} from '../dist/open-duel-config.mjs';
import {advanceBait} from '../dist/ai-bait.mjs';
test('holding never reacts to unseen dodge and has a finite deadline',()=>{
 const spec={min:1,max:1,observeRange:2.5,reaction:.2,jitter:0},rng=new RNG(4);
 const a=advanceBait(spec,null,{now:0,inReach:true,visible:false,distance:.8,phase:'dash'},rng);
 assert.equal(a.allowed,false);assert.equal(a.state.observedDodgeAt,null);
 assert.equal(advanceBait(spec,a.state,{now:.9,inReach:true,visible:false,distance:.8,phase:'dash'},rng).allowed,false);
 assert.equal(advanceBait(spec,a.state,{now:1,inReach:true,visible:true,distance:.8,phase:'ready'},rng).allowed,true);
});
test('visible dodge recognition waits for hunter reaction and still requires attack range',()=>{
 const spec={min:2,max:2,observeRange:2.5,reaction:.2,jitter:0},rng=new RNG(4);
 const a=advanceBait(spec,null,{now:0,inReach:true,visible:true,distance:.8,phase:'dash'},rng);
 assert.equal(a.allowed,false);assert.equal(a.state.reactAt,.2);
 assert.equal(advanceBait(spec,a.state,{now:.19,inReach:true,visible:true,distance:.8,phase:'dash'},rng).allowed,false);
 assert.equal(advanceBait(spec,a.state,{now:.2,inReach:true,visible:true,distance:.8,phase:'dash'},rng).allowed,true);
 assert.equal(advanceBait(spec,a.state,{now:.3,inReach:false,visible:true,distance:4,phase:'recovery'},rng).allowed,false);
});
test('enough stamina without a dodge is counted separately from being ready to dodge',()=>{
 for(const locked of [false,true]){
  const c=configureOpenDuel(presetConfig('rhythm-mixed'),{hunter:'fixed_light'}),w=new World(c,42);
  Object.assign(w.police,{x:0,y:0,dir:0,moveDir:0});Object.assign(w.player,{x:.7,y:0,stamina:80});
  if(locked){w.dodge(0,1);w.player.dodge.elapsed=.31;Object.assign(w.player,{x:.7,y:0});w.tick=1;w.time=1/120;}
  w.startAttack('stand');w.police.attack.hitDir=0;w.resolve(w.police.attack);
  assert.equal(w.metrics.caughtWithStaminaNoDodge,1);assert.equal(w.metrics.caughtWithStaminaReadyNoDodge,locked?0:1);
  assert.equal(w.metrics.caughtAfterPreemptiveDodge,locked?1:0);
 }
});
