import test from 'node:test';
import assert from 'node:assert/strict';
import {World} from '../dist/core.mjs';
import {presetConfig} from '../dist/presets.mjs';
import {playerCue} from '../dist/perception.mjs';
test('player status distinguishes actual idle, walking, running, blocked movement and dodge',()=>{
 const w=new World(presetConfig('practice'),1);
 assert.equal(playerCue(w).movement,'idle');
 w.step({x:1,walk:true});assert.equal(playerCue(w).movement,'walk');
 w.step({x:1});assert.equal(playerCue(w).movement,'run');
 w.step({walk:true});assert.equal(playerCue(w).movement,'idle');
 w.player.x=w.map.edge-w.config.player.radius;w.step({x:1});assert.equal(playerCue(w).movement,'blocked');
 w.step({x:-1,dodge:true});assert.equal(playerCue(w).movement,'dash');
 for(let i=0;i<6;i++)w.step({});assert.equal(playerCue(w).movement,'dash');
 while(w.time<w.config.dodge.startup+w.config.dodge.duration+.1)w.step({});assert.equal(playerCue(w).movement,'recovery');
});
test('stealth status preserves successful use history across cooldown and replay',()=>{
 const c=presetConfig('stealth-search');c.practice=true;c.duration=30;
 const a=new World(c,1),b=new World(c,1);
 assert.equal(playerCue(a).stealth,'ready');assert.equal(playerCue(a).uses,0);
 for(const w of [a,b]){w.step({stealth:true});assert.equal(playerCue(w).stealth,'active');w.step({stealth:true});assert.equal(playerCue(w).uses,1);}
 for(let i=0;i<245;i++)for(const w of [a,b])w.step({});
 assert.equal(playerCue(a).stealth,'cooldown');assert.deepEqual(playerCue(a),playerCue(b));
 for(let i=0;i<960;i++)for(const w of [a,b])w.step({});
 assert.equal(playerCue(a).stealth,'ready');assert.equal(playerCue(a).uses,1);assert.deepEqual(playerCue(a),playerCue(b));
 assert.equal(playerCue(new World(presetConfig('rhythm'),1)).stealth,'unavailable');
});
