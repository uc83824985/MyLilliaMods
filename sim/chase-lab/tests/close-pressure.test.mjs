import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceClosePressure } from '../dist/ai-close-pressure.mjs';
import { World, RNG, validate } from '../dist/core.mjs';
import { Bot } from '../dist/bots.mjs';
import { presetConfig } from '../dist/presets.mjs';
import { configureOpenDuel, HUNTER_STRATEGIES } from '../dist/open-duel-config.mjs';

const spec={...HUNTER_STRATEGIES.pressure_adaptive.closePressure,min:4,max:4,jitter:0};
const visible={now:0,visible:true,distance:.7,phase:'ready',speed:4.7,walkSpeed:2.46,inReach:true};
test('long pressure starts only when close, waits while running, and has a finite deadline',()=>{
  const rng=new RNG(9);
  let r=advanceClosePressure(spec,null,{...visible,distance:1.5},rng);
  assert.equal(r.state.enteredAt,null);assert.equal(r.allowed,false);
  r=advanceClosePressure(spec,r.state,{...visible,now:1},rng);
  assert.equal(r.state.until,5);assert.equal(r.started,true);
  assert.equal(advanceClosePressure(spec,r.state,{...visible,now:4.99},rng).allowed,false);
  r=advanceClosePressure(spec,r.state,{...visible,now:5},rng);
  assert.equal(r.allowed,true);assert.equal(r.reason,'deadline');
});
test('visible walking needs confirmation and reaction; unseen movement and recovery do not trigger it',()=>{
  const rng=new RNG(9),r=advanceClosePressure(spec,null,visible,rng);
  for(const o of [{visible:false,phase:'ready'},{visible:true,phase:'recovery'}]){
    const a=advanceClosePressure(spec,structuredClone(r.state),{...visible,...o,speed:0,now:1},rng);
    assert.equal(a.state.walkReactAt,undefined);
  }
  let a=advanceClosePressure(spec,r.state,{...visible,now:1,speed:2.46},rng);
  assert.equal(a.noticedWalk,false);
  a=advanceClosePressure(spec,a.state,{...visible,now:1.21,speed:2.46},rng);
  assert.equal(a.noticedWalk,true);assert.equal(a.state.walkReactAt,1.41);
  assert.equal(advanceClosePressure(spec,a.state,{...visible,now:1.4,speed:2.46},rng).allowed,false);
  a=advanceClosePressure(spec,a.state,{...visible,now:1.42,speed:2.46},rng);
  assert.equal(a.allowed,true);assert.equal(a.reason,'walking');
  const blind={...spec,respondToWalk:false};
  a=advanceClosePressure(blind,null,{...visible,speed:0},rng);
  assert.equal(advanceClosePressure(blind,a.state,{...visible,now:2,speed:0},rng).allowed,false);
});
test('seeing a dodge never bypasses reaction or reach and does not force a capture',()=>{
  const rng=new RNG(9);let a=advanceClosePressure(spec,null,{...visible,phase:'dash'},rng);
  assert.equal(a.noticedDodge,true);assert.equal(a.allowed,false);
  assert.equal(advanceClosePressure(spec,a.state,{...visible,now:.19},rng).allowed,false);
  assert.equal(advanceClosePressure(spec,a.state,{...visible,now:.2,inReach:false,distance:3},rng).allowed,false);
  assert.equal(advanceClosePressure(spec,a.state,{...visible,now:1.1,inReach:true,phase:'ready'},rng).allowed,true);
});
test('guard walks using observed proximity, retains stamina checks, and responds to visible attacks',()=>{
  const c=configureOpenDuel(presetConfig('rhythm-mixed'),{profile:'fast',human:'guard_walk',hunter:'pressure'});
  c.duel.lapseProbability=0;c.duel.timingSigma=0;
  const w=new World(c,12),b=new Bot(c,12,'perfect');
  Object.assign(w.police,{x:0,y:0,dir:0,moveDir:0,speed:0});Object.assign(w.player,{x:.7,y:0,stamina:50});
  let o=w.observation();o.player.phase='ready';
  assert.equal(b.decide(o,w.map,0).walk,true);assert.equal(b.lastDodgeAt,-10);
  w.startAttack('stand');o=w.observation();o.player.phase='ready';o.police.attack.elapsed=.23;
  assert.equal(b.decide(o,w.map,.23).dodge,true);
  const b2=new Bot(c,12,'perfect');o.player.stamina=24;
  assert.equal(b2.decide(o,w.map,.23).dodge,false);
  c.duel.police.closePressure.max=Infinity;assert.ok(validate(c).length);
});
test('pressure world logs resource cost without feeding opponent stamina to the decision',()=>{
  const c=configureOpenDuel(presetConfig('rhythm-mixed'),{profile:'fast',human:'guard_walk',hunter:'pressure'});
  const w=new World(c,12);Object.assign(w.police,{x:0,y:0,dir:0,moveDir:0,lastSeen:{x:.7,y:0}});Object.assign(w.player,{x:.7,y:0,stamina:50});
  for(let i=0;i<120&&!w.result;i++)w.step({x:1,y:0,walk:true});
  assert.equal(w.metrics.attacks,0);assert.ok(w.metrics.pressureSeconds>.5);
  assert.ok(w.metrics.pressurePlayerStaminaChange>10);assert.ok(w.metrics.pressurePoliceStaminaChange<0);
  assert.ok(w.events.some(e=>e.type==='close-pressure'&&e.phase==='hold'));
});
test('reselecting an attack after a brief sight loss does not restart the pressure deadline',()=>{
  const c=configureOpenDuel(presetConfig('rhythm-mixed'),{hunter:'pressure'}),w=new World(c,12);
  Object.assign(w.police,{x:0,y:0,dir:0,moveDir:0,lastSeen:{x:.7,y:0},plan:null,closePressure:{enteredAt:0,until:3,dodgeAt:null,walkSince:null}});
  Object.assign(w.player,{x:.7,y:0});w.step({x:1});
  assert.equal(w.police.closePressure.until,3);assert.equal(w.police.closePressure.enteredAt,0);
  c.duel.police.closePressure.max=1;assert.equal(HUNTER_STRATEGIES.pressure.closePressure.max,5);
});
