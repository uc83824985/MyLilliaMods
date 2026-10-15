import test from 'node:test';
import assert from 'node:assert/strict';
import {World} from '../dist/core.mjs';
import {presetConfig} from '../dist/presets.mjs';
import {buildMirrorContext} from '../dist/ai-context.mjs';
import {MirrorMind} from '../dist/mirror-mind.mjs';
import {ActionFeedback} from '../dist/ai-action-feedback.mjs';
import {startMirror,cancelMirror,mirrorTick} from '../dist/mirrors.mjs';
const world=()=>new World(presetConfig('mirror-integration-mixed'),42);
test('restricted context has no opponent entity, hidden follow state or minds',()=>{
  const w=world();w.mirror.police={phase:'windup',until:100,from:0};
  const c=buildMirrorContext(w,'player');
  assert.equal(c.police,undefined);assert.equal(c.mirror.police,undefined);assert.equal(c.mirror.minds,undefined);
  assert.equal(c.config.mirror.ai.castResponse,undefined);
  assert.equal(c.config.mirror.ai.integration.mixtureByExposure,undefined);
  c.player.x+=100;assert.notEqual(c.player.x,w.player.x);
  const p=buildMirrorContext(w,'police');assert.equal(p.player,undefined);assert.equal(p.mirror.used,undefined);
});
test('unseen opponent relocation and hidden preparation do not alter script decisions',()=>{
  const a=world(),b=world();
  for(const w of [a,b]){w.police.x=0;w.police.y=0;}
  b.police.x=1;b.mirror.police={phase:'windup',until:99,from:0};
  const ma=new MirrorMind(a,'player'),mb=new MirrorMind(b,'player');
  for(const t of [0,.2,.4]){
    a.time=b.time=t;
    const ca=buildMirrorContext(a,'player'),cb=buildMirrorContext(b,'player');
    assert.equal(ca.perception.enemy,null);assert.deepEqual(ca.perception,cb.perception);
    ma.ingest(ca);mb.ingest(cb);assert.deepEqual(ma.player(ca),mb.player(cb));
  }
});
test('action ledger preserves active action when a second request is rejected',()=>{
  const ledger=new ActionFeedback('player'),a=ledger.request('mirror'),b=ledger.request('dodge');
  ledger.publish(a,'accepted','windup');ledger.publish(b,'rejected',null,'locked');
  assert.equal(ledger.current.requestId,a.requestId);
  ledger.publish(a,'running','landing');ledger.publish(a,'interrupted',null,'caught');
  assert.equal(ledger.current,null);assert.equal(ledger.events.at(-1).status,'interrupted');
  const snapshot=ledger.snapshot();snapshot.events[0].status='failed';assert.equal(ledger.events[0].status,'accepted');
});
test('mirror execution reports acceptance, landing and confirmed completion',()=>{
  const w=world();assert.equal(startMirror(w,'player',0),true);
  const id=w.mirror.player.request.requestId;
  assert.equal(buildMirrorContext(w,'player').feedback.actions.current.phase,'windup');
  w.time=w.mirror.player.until;mirrorTick(w,{});
  assert.equal(buildMirrorContext(w,'player').feedback.actions.current.phase,'landing');
  w.time=w.mirror.player.until;mirrorTick(w,{});
  const result=buildMirrorContext(w,'player').feedback.actions.events.at(-1);
  assert.equal(result.requestId,id);assert.equal(result.status,'succeeded');
});
test('rejected and interrupted mirror actions are not reported as success',()=>{
  const w=world();assert.equal(startMirror(w,'player',-1),false);
  assert.equal(buildMirrorContext(w,'player').feedback.actions.events.at(-1).status,'rejected');
  assert.equal(startMirror(w,'player',0),true);cancelMirror(w,'player','sealed');
  assert.equal(buildMirrorContext(w,'player').feedback.actions.events.at(-1).status,'interrupted');
  assert.equal(buildMirrorContext(w,'player').feedback.actions.events.at(-1).reason,'sealed');
});
