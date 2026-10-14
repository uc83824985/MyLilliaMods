import test from 'node:test';
import assert from 'node:assert/strict';
import {World,RUN,BASE,validate} from '../dist/core.mjs';
import {presetConfig} from '../dist/presets.mjs';

test('current candidate drains ten stamina per running second and supports zero drain',()=>{
  for(const drain of [0,10,17]) {
    const c=presetConfig('rhythm');c.practice=true;c.player.runDrain=drain;
    const w=new World(c,7);for(let i=0;i<120;i++)w.step({x:1});
    assert.ok(Math.abs(w.player.stamina-(100-drain))<1e-8);
  }
});

test('empty stamina forces sustained walking until one dodge worth has recovered',()=>{
  const c=presetConfig('rhythm');c.practice=true;const w=new World(c,7);w.player.stamina=0;
  for(let i=0;i<120;i++){w.step({x:1});assert.equal(w.player.locomotion,'walk');}
  assert.ok(Math.abs(w.player.stamina-20)<1e-8);
  for(let i=0;i<32;i++)w.step({x:1});
  assert.equal(w.player.locomotion,'run');assert.equal(w.player.exhausted,false);
});

test('search movement uses candidate 0.8 scale with legacy fallback and validation',()=>{
  for(const scale of [.8,undefined]) {
    const c=presetConfig('rhythm');c.mapLayout='grid';c.search.moveScale=scale;
    const w=new World(c,7);Object.assign(w.police,{x:0,y:0,dir:0,moveDir:0,lastSeen:{x:5,y:0}});
    w.beginSearch();w.searchStep(BASE.dt);
    assert.equal(w.police.speed,RUN*(scale??.6));
  }
  const c=presetConfig('rhythm');c.search.moveScale=-1;assert.ok(validate(c).length);
});
