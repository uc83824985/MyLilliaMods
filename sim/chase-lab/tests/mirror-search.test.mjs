import test from 'node:test';
import assert from 'node:assert/strict';
import {World,StreetMap,BASE,dist,angleDiff,facing} from '../dist/core.mjs';
import {presetConfig} from '../dist/presets.mjs';
import {MIRROR_STREET_SHIFT} from '../dist/units.mjs';

function loss(){
 const w=new World(presetConfig('mirror-ai-mixed'),42),mind=w.mirror.minds.police;
 const [a,b]=w.config.mirror.points;Object.assign(w.police,{x:a.x+2,y:a.y,dir:Math.PI,moveDir:Math.PI});Object.assign(w.player,b);
 mind.memory={...a,seenAt:0,speed:0,moveDir:0};mind.observation={time:0,enemy:{...mind.memory}};
 mind.nextSample=100;mind.queue=[{ready:.2,time:.1,enemy:null}];w.time=.2;w.tick=24;mind.ingest(w);return w;
}
test('losing a target near a mirror checks the other endpoint without querying hidden location or charges',()=>{
 const a=loss(),b=loss();Object.assign(b.player,{x:0,y:28});b.mirror.used=[true,true];
 const ca=a.mirror.minds.police.police(a),cb=b.mirror.minds.police.police(b);
 assert.equal(ca.kind,'look');assert.deepEqual(ca.target,a.config.mirror.points[1]);assert.deepEqual(ca,cb);
 assert.equal(a.mirror.minds.police.transitEvidence,undefined);
});
test('attack recovery completes before targeted mirror turn, with no generic scan inserted',()=>{
 const w=loss(),e=w.police;w.startAttack('stand');w.miss(e.attack,'position');
 e.attack.recovery=w.config.capture.missRecovery-BASE.dt;const before=e.dir;
 w.step({});assert.equal(e.attack,null);assert.equal(e.dir,before);assert.equal(e.search,undefined);
 w.step({});assert.ok(Math.abs(angleDiff(facing(e,w.config.mirror.points[1]),e.dir))<Math.abs(angleDiff(facing(e,w.config.mirror.points[1]),before)));
 assert.equal(w.events.some(e=>e.type==='search'&&e.phase==='scan'),false);
});
test('new visible evidence interrupts the endpoint hypothesis; failed checks have a finite budget',()=>{
 const w=loss(),m=w.mirror.minds.police;m.police(w);
 m.queue=[{ready:.3,time:.25,enemy:{x:w.config.mirror.points[0].x,y:w.config.mirror.points[0].y,speed:0,moveDir:0}}];w.time=.3;m.ingest(w);
 assert.equal(m.exitCheck,null);assert.notEqual(m.police(w).kind,'look');
 const other=loss();other.time=5;assert.notEqual(other.mirror.minds.police.police(other).kind,'look');assert.equal(other.mirror.minds.police.exitCheck,null);
});
test('longer ring retains road width and mirror span, increases both straight sections and corner clearance',()=>{
 const c=presetConfig('mirror-ai-mixed'),w=new World(c),old=new StreetMap('ring');
 assert.equal(w.map.width,old.width);assert.equal(w.map.cell,old.cell*1.5);
 for(const b of w.map.blocks){assert.equal(w.map.edge-b.x1,w.map.width);assert.equal(w.map.edge-b.y1,w.map.width);}
 assert.ok(Math.abs(dist(...c.mirror.points)-Math.hypot(15,5.25))<1e-8);
 assert.ok(Math.abs(c.mirror.points[0].y+19.5+MIRROR_STREET_SHIFT)<1e-8);
 assert.ok(w.map.cell-c.mirror.points[1].x>old.cell-c.mirror.points[1].x);
 for(const p of [...c.mirror.points,c.mirror.policeStart,...w.map.nodes])assert.ok(w.map.free(p,c.player.radius));
});
