import { metres as M, BASE, mirrorY } from './dist/units.mjs';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {World,dist} from './dist/core.mjs';
import {presetConfig} from './dist/presets.mjs';
import {mirrorInput} from './dist/mirrors.mjs';
const rows=[];
for(const policePolicy of ['follow','wait','intercept','delayed'])for(const playerPolicy of ['return','leave','walk','run'])for(const recovery of [.4,.8,1.2])for(const startX of [-26,-23,-17].map(M)){
 const c=presetConfig('mirror-follow-return');Object.assign(c.mirror,{policePolicy,playerPolicy,playerRecovery:recovery,policeStart:{x:startX,y:mirrorY(-24)}});
 const w=new World(c,42);let readyGap=null;
 while(!w.result){w.step(mirrorInput(w));if(readyGap===null&&w.mirror.used[0]&&!w.mirror.player)readyGap=dist(w.player,w.police);}
 rows.push({policePolicy,playerPolicy,recovery,startX,result:w.result,seconds:w.time,readyGap,finalGap:dist(w.player,w.police),playerStamina:w.player.stamina,policeStamina:w.police.stamina,used:w.mirror.used,sealed:w.mirror.sealed,events:w.events,config:c});
}
const out=new URL('../../artifacts/chase-lab/mirrors/',import.meta.url);await mkdir(out,{recursive:true});
const hash=createHash('sha256');for(const f of ['units.mjs','core.mjs','mirrors.mjs','presets.mjs'])hash.update(await readFile(new URL('./dist/'+f,import.meta.url)));
await writeFile(new URL('report.json',out),JSON.stringify({globalScale:BASE.globalScale,kind:'scripted-mirror-unit-matrix',codeHash:hash.digest('hex'),note:'固定已知策略，非反应AI；超时不是脱身，不报告完整追逐胜率。',rows},null,2));
const columns=['policePolicy','playerPolicy','recovery','startX','result','seconds','readyGap','finalGap','playerStamina','policeStamina','sealed'];
await writeFile(new URL('summary.csv',out),'\uFEFF'+[columns.join(','),...rows.map(r=>columns.map(k=>r[k]??'').join(','))].join('\n'));
console.log(JSON.stringify({episodes:rows.length,results:rows.reduce((a,r)=>(a[r.result]=(a[r.result]??0)+1,a),{}),output:out.href}));
