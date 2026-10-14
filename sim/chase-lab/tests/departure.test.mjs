import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../dist/core.mjs';
import { presetConfig } from './geometry-fixture.mjs';
import { perfectCue } from '../dist/effects.mjs';

test('initial scan follows stored exit side, independently of current hidden player side',()=>{
  for(const side of [-1,1]) {
    const c=presetConfig('rhythm');c.search.departureBias=1;
    const a=new World(c,4),b=new World(c,4);
    for(const w of [a,b]) {w.police.lastBearing=side*.8;w.police.dir=0;}
    a.player.y=-10;b.player.y=10;
    a.beginSearch('scan');b.beginSearch('scan');
    assert.equal(a.police.search.scanSign,side);assert.deepEqual(a.police.search,b.police.search);
    a.searchStep(1/120); assert.equal(Math.sign(a.police.dir),side);
  }
});
test('counter-check preference can choose the opposite side without hidden information',()=>{
  const c=presetConfig('rhythm');c.search.departureBias=0;const w=new World(c,4);
  w.police.lastBearing=.8;w.beginSearch('scan');assert.equal(w.police.search.scanSign,-1);
});
test('perfect animation requires real successful contact and expires with replay time',()=>{
  const w=new World(presetConfig('rhythm-perfect'),7);
  Object.assign(w.police,{x:0,y:0,dir:0,moveDir:0});Object.assign(w.player,{x:.85,y:0,stamina:50});
  w.startAttack('stand');
  while(w.time<.28&&!w.result)w.step({x:0,y:w.tick>=25?1:0,dodge:w.tick===25});
  assert.ok(w.perfect());assert.equal(perfectCue(w),null);
  while(w.time<.31&&!w.result)w.step({x:0,y:1});
  const cue=perfectCue(w);assert.ok(cue);assert.equal(cue.refund,25);
  while(w.time<1.25&&!w.result)w.step({x:0,y:1,walk:true});
  assert.equal(perfectCue(w),null);
});
