import {mkdir,writeFile} from 'node:fs/promises';
import {World} from './dist/core.mjs';
import {presetConfig} from './dist/presets.mjs';
import {mirrorInput} from './dist/mirrors.mjs';
const run=c=>{const w=new World(c,42);while(!w.result&&w.time<6)w.step(mirrorInput(w));return w;};
const timing=[],guard=[];
for(const followAt of [1,1.4,1.7,2,2.3,2.6])for(const returnWait of [0,.3,.6,1,1.2]){
 const c=presetConfig('mirror-landing-follow-return');c.mirror.delay=followAt;c.mirror.returnDelay=returnWait;
 const w=run(c),arrival=w.events.find(e=>e.phase==='teleport'&&e.actor==='player');
 timing.push({followAt,returnWait,returned:!!arrival,sealed:w.mirror.sealed,interrupted:w.events.some(e=>e.phase==='cancel'&&e.reason==='sealed'),returnAt:arrival?.t,events:w.events});
}
for(const recovery of [.4,.8,1.2])for(const reaction of [.2,.35,.5])for(const offset of [0,1,2,3]){
 const c=presetConfig('mirror-landing-fake-return');c.mirror.playerRecovery=recovery;c.mirror.observeDelay=reaction;c.mirror.policeStart.x-=offset;
 const w=run(c),arrival=w.events.find(e=>e.phase==='teleport'&&e.actor==='player');
 guard.push({recovery,reaction,offset,returned:!!arrival,caught:w.result==='caught',caughtInRecovery:!!arrival&&w.result==='caught'&&w.time<arrival.t+recovery,timeAfterArrival:arrival?w.time-arrival.t:null,events:w.events});
}
const out=new URL('../../artifacts/chase-lab/mirror-landing/',import.meta.url);await mkdir(out,{recursive:true});
await writeFile(new URL('boundaries.json',out),JSON.stringify({note:'Deterministic conditional timing/position grid, not win rates. Guard keeps its location; offset changes reach as well as turning.',timing,guard},null,2));
console.log(JSON.stringify({timing:timing.map(({events,...r})=>r),guard:[.4,.8,1.2].map(recovery=>({recovery,caughtInRecovery:guard.filter(r=>r.recovery===recovery&&r.caughtInRecovery).length,cases:12})),guardDefault:guard.filter(r=>r.recovery===.8&&r.offset===0).map(({events,...r})=>r)},null,2));
