import { metres as M, mirrorY } from '../dist/units.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {World,BASE,dist,validate} from '../dist/core.mjs';
import {presetConfig} from '../dist/presets.mjs';
import {startMirror,cancelMirror,mirrorInput} from '../dist/mirrors.mjs';
// Preserve historical timing fixtures as compatibility coverage. Current defaults
// and their new timing/locking behavior are covered in mirror-landing.test.mjs.
const make=(id='mirror-idle-return')=>{const c=presetConfig(id);Object.assign(c.mirror,{playerWindup:1.5,playerRecovery:.8,policeWindup:.8});return new World(c,42);};
function advance(w,seconds,input={}){for(let i=0;i<Math.round(seconds/BASE.dt)&&!w.result;i++)w.step(input);}
function scenario(id){const w=make(id);while(!w.result)w.step(mirrorInput(w));return w;}
const teleports=w=>w.events.filter(e=>e.type==='mirror'&&e.phase==='teleport'&&e.actor==='player');

test('player cast 1.5s then instant teleport and 0.8s vulnerable landing; no stamina gifts',()=>{
 const w=make(),p=w.player;p.stamina=60;assert.equal(startMirror(w,'player',0),true);
 advance(w,1.49,{x:1,dodge:true});assert.equal(p.x,M(-10));assert.equal(p.stamina,60);assert.equal(w.dodge(1,0),false);
 advance(w,.01);assert.equal(p.x,M(10));assert.equal(w.phase(),'mirrorLanding');
 assert.equal(startMirror(w,'player',1),false);advance(w,.79,{x:1});assert.equal(p.x,M(10));
 advance(w,.02);assert.equal(w.phase(),'ready');assert.equal(w.mirror.used[0],true);
});
test('dodge recovery forbids casting; cancellation recovers in place and remains vulnerable without consuming charge',()=>{
 const w=make();w.player.dodge={dir:0,elapsed:.4,used:false};assert.equal(startMirror(w,'player',0),false);
 w.player.dodge=null;startMirror(w,'player',0);
 assert.equal(cancelMirror(w,'player','input'),true);const until=w.mirror.player.until;advance(w,.1,{cancelMirror:true,x:1,dodge:true});
 assert.equal(w.mirror.player.phase,'landing');assert.equal(w.mirror.player.cancelled,true);assert.equal(w.mirror.player.until,until);assert.equal(w.player.x,w.config.mirror.points[0].x);assert.deepEqual(w.mirror.used,[false,false]);
 startMirror(w,'player',0);Object.assign(w.police,{x:M(-11),y:mirrorY(-26),dir:0,moveDir:0});w.startAttack('stand');advance(w,.31);
 assert.equal(w.result,'caught');assert.deepEqual(w.mirror.used,[false,false]);assert.equal(w.mirror.player,null);
});
test('repeated cancellation shares landing recovery, freezes stamina and blocks movement, dodge and stealth',()=>{
 const w=make();w.config.stealth={duration:2,cooldown:8};w.player.stamina=40;
 const origin={x:w.player.x,y:w.player.y};
 for(let cycle=0;cycle<3;cycle++){
  assert.ok(startMirror(w,'player',0));advance(w,.2,{walk:true});assert.equal(w.player.stamina,40);
  const time=w.time;assert.ok(cancelMirror(w,'player','input'));assert.equal(w.mirror.player.until,time+w.config.mirror.playerRecovery);
  advance(w,.79,{x:1,walk:true,dodge:true,stealth:true,mirror:true,cancelMirror:true});
  assert.equal(w.player.stamina,40);assert.equal(w.invisible(),false);assert.equal(w.player.dodge,null);
  assert.deepEqual({x:w.player.x,y:w.player.y},origin);assert.deepEqual(w.mirror.used,[false,false]);
  assert.equal(startMirror(w,'player',0),false);
  // On the exact recovery-end tick, start another cast before locomotion/regeneration.
  advance(w,1/120,{mirror:true});assert.equal(w.player.stamina,40);
  if(cycle<2){assert.equal(w.mirror.player.phase,'windup');cancelMirror(w,'player','sealed');}
 }
 assert.equal(teleports(w).length,0);
});
test('follow seals at completion, cancels pending return, and locks police perception and motion',()=>{
 const w=make();startMirror(w,'player',0);advance(w,2.3);startMirror(w,'player',1);
 Object.assign(w.police,w.config.mirror.points[0]);startMirror(w,'police',0);
 advance(w,.79);assert.equal(w.mirror.sealed,false);advance(w,.01);
 assert.equal(w.mirror.sealed,true);assert.equal(w.mirror.player,null);assert.deepEqual(w.mirror.used,[true,false]);
 const pos={x:w.police.x,y:w.police.y,dir:w.police.dir};advance(w,.5,{x:1});
 assert.deepEqual({x:w.police.x,y:w.police.y,dir:w.police.dir},pos);assert.equal(w.police.visible,false);
});
test('both player directions can be used once and police may follow after exhaustion',()=>{
 const w=make();startMirror(w,'player',0);advance(w,2.3);startMirror(w,'player',1);advance(w,2.3);
 assert.deepEqual(w.mirror.used,[true,true]);assert.equal(startMirror(w,'player',0),false);
 Object.assign(w.police,w.config.mirror.points[1]);assert.equal(startMirror(w,'police',1),true);advance(w,.8);assert.equal(w.mirror.sealed,true);
});
test('exact completion tie seals before return; earlier completed return is not undone',()=>{
 for(const offset of [0,.02]){const w=make();startMirror(w,'player',0);advance(w,2.3);startMirror(w,'player',1);
 advance(w,.7+offset);Object.assign(w.police,w.config.mirror.points[0]);startMirror(w,'police',0);advance(w,.8);
 assert.equal(w.mirror.used[1],offset>0);assert.equal(w.mirror.sealed,true);}
});
test('guarding A punishes early return but loses time against direct departure',()=>{
 const a=scenario('mirror-wait-return'),b=scenario('mirror-wait-leave');
 assert.equal(a.result,'caught');assert.equal(teleports(a).length,2);assert.equal(b.result,'timeout');assert.equal(teleports(b).length,1);
});
test('intercepting midpoint reduces return separation; teleport saves time and running stamina',()=>{
 const w=scenario('mirror-intercept-return'),t=teleports(w);assert.equal(t.length,2);assert.ok(t[1].gap<t[0].gap-M(5));
 const run=make('mirror-idle-run'),jump=make();advance(jump,2.3,{mirror:true});
 for(let i=0;i<276;i++)run.step(mirrorInput(run));
 assert.ok(dist(run.player,run.config.mirror.points[1])>M(3));assert.ok(run.player.stamina<80);assert.equal(jump.player.stamina,100);
});
test('mirror fixture inputs replay deterministic state and events',()=>{
 const a=make('mirror-follow-return'),b=make('mirror-follow-return');
 while(!a.result){const input=mirrorInput(a);a.step(input);b.step(input);}
 assert.deepEqual(a.events,b.events);assert.deepEqual(a.mirror,b.mirror);assert.deepEqual(a.player,b.player);
});
test('invalid parameters and obstructed anchors are rejected',()=>{
 const c=presetConfig('mirror-idle-return');c.mirror.playerRecovery=-1;assert.ok(validate(c).length);
 c.mirror.playerRecovery=.8;c.mirror.points[0]={x:0,y:0};assert.throws(()=>new World(c),/不可通行/);
});
