import test from 'node:test';
import assert from 'node:assert/strict';
import {World,StreetMap,dist,validate} from '../dist/core.mjs';
import {presetConfig} from '../dist/presets.mjs';
import {Bot} from '../dist/bots.mjs';
import {drillInput} from '../dist/drills.mjs';
test('ring keeps outer dimensions and road width while removing central cross streets',()=>{
 const old=new StreetMap('grid'),ring=new StreetMap('ring'),b=ring.blocks[0];
 assert.equal(ring.edge,old.edge);assert.equal(ring.width,old.width);assert.equal(ring.blocks.length,1);
 assert.equal(ring.edge-b.x1,ring.width);assert.equal(ring.free({x:0,y:0}),false);
 assert.equal(ring.free({x:0,y:-ring.cell},.65),true);
 const p={x:-ring.cell,y:0};ring.move(p,100,0,.3);assert.ok(p.x<b.x0);assert.ok(ring.free(p,.3));
});
test('ring paths and all navigation nodes are reachable around the single block',()=>{
 const m=new StreetMap('ring'),start={x:-m.cell,y:0},goal={x:m.cell,y:0};
 assert.equal(m.clear(start,goal),false);assert.ok(m.route(start,goal,.65).length>=3);
 for(const target of [...m.nodes,goal]){
  const route=m.route(start,target,.65);assert.ok(route.length);assert.deepEqual(route.at(-1),target);
  for(let i=0;i<route.length;i++)assert.ok(m.clear(i?route[i-1]:start,route[i],.65));
 }
});
test('all ring spawn variants and scripted fixtures start and move outside buildings',()=>{
 for(const id of ['rhythm','practice','drill-response','drill-charge','drill-cross'])for(const spawn of ['street','junction','corner','random'])for(const seed of [1,2,42]){
  const c=presetConfig(id);c.spawn=spawn;const w=new World(c,seed);
  assert.equal(w.map.layout,'ring');assert.ok(w.map.free(w.player,c.player.radius));assert.ok(w.map.free(w.police,c.police.radius));
  if(c.drill)while(!w.result){w.step(drillInput(w));assert.ok(w.map.free(w.player,c.player.radius));assert.ok(w.map.free(w.police,c.police.radius));}
 }
});
test('ring chase bots navigate without entering the block or leaving bounds',()=>{
 for(const policy of ['adaptive','retreat','anticipate','footwork'])for(const seed of [1,2,42]){
  const c=presetConfig('rhythm-mixed');c.duration=12;const w=new World(c,seed),b=new Bot(c,seed,policy),start={...w.player};
  while(!w.result){w.step(b.action(w));assert.ok(w.map.free(w.player,c.player.radius));assert.ok(w.map.free(w.police,c.police.radius));}
  assert.ok(dist(start,w.player)>1);assert.ok(w.metrics.attacks>0||w.metrics.searches>0);
 }
});
test('legacy missing map layout remains grid and unknown layouts are rejected',()=>{
 const c=presetConfig('rhythm');delete c.mapLayout;assert.equal(new World(c,1).map.layout,'grid');
 c.mapLayout='unknown';assert.ok(validate(c).length>0);
});
