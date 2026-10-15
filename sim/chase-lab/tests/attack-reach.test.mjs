import test from 'node:test';
import assert from 'node:assert/strict';
import {World,RUN,attackStartReach} from '../dist/core.mjs';
import {presetConfig} from '../dist/presets.mjs';

test('delayed mirror AI catches uninterrupted straight running without starting beyond its trigger',()=>{
  for(const mode of ['stand','lunge'])for(const initialGap of [1,1.5,2])for(let seed=1;seed<=8;seed++){
    const c=presetConfig('mirror-ai-mixed');c.mapLayout='grid';c.duration=8;c.player.runDrain=0;
    c.mirror.points=[{x:0,y:0},{x:15,y:0}];c.mirror.policeStart={x:-3,y:0};
    if(mode==='stand')c.capture.lunge.trigger=.1;
    const w=new World(c,seed);
    // Open straight lane: a wall stop must not rescue an otherwise missed attack.
    w.map.blocks=[];w.map.edge=200;
    Object.assign(w.player,{x:initialGap,y:0,dir:0});
    Object.assign(w.police,{x:0,y:0,dir:0,moveDir:0,speed:RUN*1.1});
    while(!w.result)w.step({x:1});
    const attack=w.events.find(e=>e.type==='attack');
    assert.ok(attack,`${mode}/${initialGap}/${seed}: no attack`);
    assert.equal(attack.mode,mode);
    assert.ok(attack.distance<=c.capture[mode].trigger+1e-8,JSON.stringify(attack));
    assert.equal(w.metrics.positionMiss,0);
    assert.equal(w.result,'caught');
  }
});

test('fatigue and slower pursuit reduce reachable initiation distance without extending hit radius',()=>{
  for(const mode of ['stand','lunge'])for(const speedScale of [1,1.1]){
    const c=presetConfig('rhythm-mixed');c.mapLayout='grid';c.police.speedScale=speedScale;
    c.weights={stand:0,stride:0,sweep:0,lunge:0};c.weights[mode]=1;
    const reach=attackStartReach(c,mode,true);
    assert.ok(reach<c.capture[mode].trigger);
    const w=new World(c,42);Object.assign(w.police,{x:0,y:0,dir:0,moveDir:0,tired:true,stamina:1});
    Object.assign(w.player,{x:(reach+c.capture[mode].trigger)/2,y:0});
    w.step({x:1});assert.equal(w.metrics.attacks,0);
    if(reach===0)continue; // Slower charge cannot reach even from physical contact.
    // If an attack is deliberately started at the safe range, straight running is hit.
    Object.assign(w.player,{x:w.police.x+reach,y:0});w.startAttack(mode);
    while(!w.result&&w.police.attack?.phase!=='recovery')w.step({x:1});
    assert.equal(w.result,'caught');assert.equal(c.capture[mode].radius,1.125);
  }
});
