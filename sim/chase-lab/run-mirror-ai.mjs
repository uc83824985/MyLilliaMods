import { metres as M, BASE, mirrorY } from './dist/units.mjs';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {World,dist} from './dist/core.mjs';
import {presetConfig} from './dist/presets.mjs';
import {mirrorInput,mirrorScriptInput} from './dist/mirrors.mjs';
const rows=[],examples=[];
const candidates=[{name:'short-observation',observe:.8,recovery:.8},{name:'candidate',observe:1.2,recovery:.8},{name:'long-landing',observe:1.2,recovery:1.2}];
for(const candidate of candidates)for(const style of ['mixed','follow','wait','intercept','fake'])for(const controller of ['adaptive','rush-return','run'])for(const position of ['lead','short','triangle'])for(let seed=1;seed<=8;seed++){
 const c=presetConfig('mirror-ai-'+style);c.duration=10;c.mirror.ai.observeSeconds=candidate.observe;c.mirror.playerRecovery=candidate.recovery;
 c.mirror.policeStart=position==='lead'?{x:M(-26),y:mirrorY(-24)}:position==='short'?{x:M(-17),y:mirrorY(-24)}:{x:M(3),y:mirrorY(-27)};
 if(controller!=='adaptive')c.mirror.playerPolicy=controller==='run'?'run':'return';
 const w=new World(c,seed);let at7=null;
 while(!w.result){w.step(controller==='adaptive'?mirrorInput(w):mirrorScriptInput(w));if(!at7&&w.time>=7)at7={gap:dist(w.player,w.police),stamina:w.player.stamina};}
 const choices=w.events.filter(e=>e.type==='mirror-ai'),teleports=w.events.filter(e=>e.type==='mirror'&&e.phase==='teleport'&&e.actor==='player');
 rows.push({candidate:candidate.name,style,controller,position,seed,result:w.result,seconds:w.time,first:+w.mirror.used[0],returned:+w.mirror.used[1],sealed:+w.mirror.sealed,casts:w.events.filter(e=>e.type==='mirror'&&e.actor==='player'&&e.phase==='windup').length,cancelled:w.events.filter(e=>e.type==='mirror'&&e.actor==='player'&&e.phase==='cancel').length,stamina:w.player.stamina,gap:dist(w.player,w.police),at7,choices:[...new Set(choices.map(e=>`${e.actor}:${e.choice}`))],teleports});
 if(seed===1&&position==='lead'&&controller==='adaptive')examples.push({candidate:candidate.name,style,config:c,events:w.events});
}
const out=new URL('../../artifacts/chase-lab/mirror-ai/',import.meta.url);await mkdir(out,{recursive:true});
const hash=createHash('sha256');for(const f of ['units.mjs','core.mjs','mirror-ai.mjs','mirrors.mjs','bots.mjs','presets.mjs'])hash.update(await readFile(new URL('./dist/'+f,import.meta.url)));
const groups=[];for(const candidate of candidates)for(const style of ['mixed','follow','wait','intercept','fake'])for(const controller of ['adaptive','rush-return','run'])for(const position of ['lead','short','triangle']){
 const list=rows.filter(r=>r.candidate===candidate.name&&r.style===style&&r.controller===controller&&r.position===position);
 groups.push({candidate:candidate.name,style,controller,position,n:list.length,first:list.reduce((s,r)=>s+r.first,0),returned:list.reduce((s,r)=>s+r.returned,0),caught:list.filter(r=>r.result==='caught').length,sealed:list.reduce((s,r)=>s+r.sealed,0),meanSeconds:list.reduce((s,r)=>s+r.seconds,0)/list.length,meanStamina:list.reduce((s,r)=>s+r.stamina,0)/list.length});
}
await writeFile(new URL('report.json',out),JSON.stringify({globalScale:BASE.globalScale,kind:'mirror-observation-ai-comparison',codeHash:hash.digest('hex'),note:'10秒局部观察窗、8个种子；超时不等于脱身，不证明GTO。比较条件和完整示例事件可复现。',candidates,groups,rows,examples},null,2));
const keys=['candidate','style','controller','position','n','first','returned','caught','sealed','meanSeconds','meanStamina'];await writeFile(new URL('summary.csv',out),'\uFEFF'+[keys.join(','),...groups.map(r=>keys.map(k=>r[k]).join(','))].join('\n'));
console.log(JSON.stringify({episodes:rows.length,groups:groups.length,output:out.href}));
