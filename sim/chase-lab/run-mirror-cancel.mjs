import { mirrorY } from './dist/units.mjs';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {World,dist} from './dist/core.mjs';
import {presetConfig} from './dist/presets.mjs';
import {mirrorInput} from './dist/mirrors.mjs';

// Conditional first cast, not a claim that entering the mirror was optimal.
const rows=[],examples=[];
for(const recovery of [.4,.8,1.2])for(const response of ['pressure','intercept','feint'])
for(const player of ['commit','read','cancel-early','cancel-late','leave'])
for(const position of ['near-entry','middle','near-exit'])for(let seed=1;seed<=12;seed++){
  const c=presetConfig('mirror-ai-mixed');c.duration=6;c.mirror.playerRecovery=recovery;
  c.mirror.cancelMode=player==='commit'?'disabled':'recovery';c.mirror.ai.castResponse=response;
  c.mirror.policeStart={x:{'near-entry':-3,middle:0,'near-exit':3}[position],y:mirrorY(-24)};
  c.mirror.initialStamina=60;c.mirror.initialCast=player!=='leave';
  const w=new World(c,seed);
  let initialReady=null,at3=null;
  while(!w.result){
    let input=mirrorInput(w);
    // Isolate one interaction; no repeated cast or return masks its payoff.
    input.mirror=false;
    if(player!=='read')input.cancelMirror=false;
    if(w.mirror.player?.phase==='windup'&&((player==='cancel-early'&&w.time>=.4)||(player==='cancel-late'&&w.time>=1.2)))input.cancelMirror=true;
    w.step(input);
    if(initialReady===null&&!w.mirror.player)initialReady={time:w.time,gap:dist(w.player,w.police),stamina:w.player.stamina};
    if(at3===null&&w.time>=3)at3={gap:dist(w.player,w.police),stamina:w.player.stamina,dodges:w.metrics.dodges};
  }
  const cancelled=w.events.find(e=>e.type==='mirror'&&e.phase==='cancel'&&e.reason==='input');
  rows.push({recovery,response,player,position,seed,result:w.result,seconds:w.time,cancelled:!!cancelled,cancelAt:cancelled?.t??null,teleported:w.mirror.used[0],dodges:w.metrics.dodges,stamina:w.player.stamina,gap:dist(w.player,w.police),initialReady,at3});
  if(recovery===.8&&seed===1)examples.push({response,player,position,config:c,events:w.events});
}
const groups=[];
for(const row of rows){const key=[row.recovery,row.response,row.player,row.position].join('/');if(groups.some(g=>g.key===key))continue;
  const list=rows.filter(r=>[r.recovery,r.response,r.player,r.position].join('/')===key);
  groups.push({key,recovery:row.recovery,response:row.response,player:row.player,position:row.position,n:list.length,caught:list.filter(r=>r.result==='caught').length,cancelled:list.filter(r=>r.cancelled).length,teleported:list.filter(r=>r.teleported).length,meanSeconds:list.reduce((s,r)=>s+r.seconds,0)/list.length,meanDodges:list.reduce((s,r)=>s+r.dodges,0)/list.length,meanStamina:list.reduce((s,r)=>s+r.stamina,0)/list.length});
}
const out=new URL('../../artifacts/chase-lab/mirror-cancel/',import.meta.url);await mkdir(out,{recursive:true});
const hash=createHash('sha256');for(const f of ['units','core','mirrors','mirror-ai','bots','presets'])hash.update(await readFile(new URL(`./dist/${f}.mjs`,import.meta.url)));hash.update(await readFile(new URL(import.meta.url)));
await writeFile(new URL('report.json',out),JSON.stringify({kind:'conditional-mirror-cancel',note:'Forced first cast; observed police response; six-second local horizon, timeout is not escape. Cancel/teleport share recovery and freeze stamina.',codeHash:hash.digest('hex'),groups,rows,examples},null,2));
const keys=Object.keys(groups[0]);await writeFile(new URL('summary.csv',out),'\uFEFF'+[keys.join(','),...groups.map(g=>keys.map(k=>g[k]).join(','))].join('\n'));
console.log(JSON.stringify({episodes:rows.length,groups:groups.length,output:out.pathname}));
