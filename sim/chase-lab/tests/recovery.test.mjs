import test from 'node:test';
import assert from 'node:assert/strict';
import {World,RUN,recoveryMoveScale,validate} from '../dist/core.mjs';
import {presetConfig} from './geometry-fixture.mjs';
test('normal recovery increases from zero to full speed over 600ms',()=>{
 const c=presetConfig('practice'),start=c.dodge.startup+c.dodge.duration;
 for(const [elapsed,expected] of [[start,0],[start+.3,.5],[start+.6,1]])assert.ok(Math.abs(recoveryMoveScale(c,{elapsed,used:false})-expected)<1e-8);
 const w=new World(c,1);w.player.x=-10;w.player.y=0;w.police.x=20;w.police.y=0;w.dodge(1,0);
 let previous=0,frames=0;
 while(w.player.dodge){const before=w.player.x;w.step({x:1});if(w.phase()==='recovery'){const speed=(w.player.x-before)*120;assert.ok(speed+1e-8>=previous);previous=speed;frames++;assert.equal(w.dodge(1,0),false);}}
 assert.ok(frames>=71&&frames<=73);assert.ok(previous>RUN*.98);
});
test('perfect window is 100ms inside fixed 300ms dash; legacy constant recovery remains valid',()=>{
 const c=presetConfig('rhythm'),w=new World(c,1);w.player.dodge={elapsed:0,used:false};assert.equal(w.perfect(),true);
 w.player.dodge.elapsed=.099;assert.equal(w.perfect(),true);w.player.dodge.elapsed=.1;assert.equal(w.perfect(),false);
 assert.equal(c.dodge.duration,.3);assert.equal(c.dodge.multiplier,2);assert.equal(c.perfectBonus.playerRecoveryScale,0);
 const old=presetConfig('rhythm-flat-recovery');assert.equal(recoveryMoveScale(old,{elapsed:.6,used:false}),.35);
 c.dodge.recoveryCurve='invalid';assert.ok(validate(c).length>0);
});
test('full ordinary forward dodge cycle gives no sustained running speed gain including startup',()=>{
 const c=presetConfig('practice'),d=c.dodge;
 const area=d.multiplier*d.duration+(d.recoveryScale+1)*d.recovery/2;
 assert.ok(Math.abs(area/(d.duration+d.recovery)-1)<1e-10);
 const ideal=area/(d.startup+d.duration+d.recovery);assert.ok(Math.abs(ideal-1)<1e-10);
 const w=new World(c,1);w.player.x=-10;w.player.y=0;w.police.x=20;w.police.y=0;
 const start=w.player.x;w.step({x:1,dodge:true});while(w.player.dodge)w.step({x:1});
 const measured=(w.player.x-start)/(w.time*RUN);
 assert.ok(measured<1);assert.ok(Math.abs(measured-ideal)<.015,`${measured} vs ${ideal}`);
});
test('recovery multiplies the selected locomotion speed: half recovery means half walking speed too',()=>{
 const c=presetConfig('practice');
 for(const progress of [.25,.5,.75])for(const walk of [false,true]){
  const w=new World(c,1);w.player.x=-10;w.player.y=0;w.police.x=20;w.police.y=0;
  w.player.dodge={dir:0,used:false,elapsed:c.dodge.startup+c.dodge.duration+progress*c.dodge.recovery-1/120};
  const before=w.player.x;w.step({x:1,walk});
  const speed=(w.player.x-before)*120,base=RUN*(walk?c.player.walkScale:1);
  assert.ok(Math.abs(speed-base*progress)<1e-8,`walk=${walk} progress=${progress}`);
  assert.equal(w.phase(),'recovery');assert.equal(w.dodge(1,0),false);
 }
});
test('accepted dodge moves immediately on its first simulation tick without a startup stop',()=>{
 const c=presetConfig('practice'),w=new World(c,1);w.player.x=-10;w.player.y=0;w.police.x=20;w.police.y=0;
 const before=w.player.x;w.step({x:1,dodge:true});assert.equal(c.dodge.startup,0);assert.equal(w.phase(),'dash');
 assert.ok(Math.abs(w.player.x-before-RUN*2/120)<1e-8);assert.equal(w.perfect(),true);
});
