import {mkdir,writeFile} from 'node:fs/promises';
import {World} from './dist/core.mjs';
import {presetConfig} from './dist/presets.mjs';
import {mirrorInput} from './dist/mirrors.mjs';
import {MIRROR_STREET_SHIFT} from './dist/units.mjs';
const rows=[];
for(const length of [1,1.5])for(const check of [false,true])for(const style of ['mixed','follow','wait','intercept','fake'])for(let seed=1;seed<=12;seed++){
 const c=presetConfig('mirror-ai-'+style);c.duration=20;c.mapLengthScale=length;c.mirror.ai.checkOtherMirror=check;
 if(length===1)for(const p of [...c.mirror.points,c.mirror.policeStart])p.y+=MIRROR_STREET_SHIFT;
 const w=new World(c,seed);while(!w.result)w.step(mirrorInput(w));
 rows.push({length,check,style,seed,...w.summary(),checks:w.events.filter(e=>e.choice==='suspect-exit').length,checkReacquired:w.events.filter(e=>e.choice==='exit-check-reacquired').length,config:seed===1?c:undefined,events:seed===1?w.events:undefined});
}
const groups=[];for(const length of [1,1.5])for(const check of [false,true]){
 const list=rows.filter(r=>r.length===length&&r.check===check),mean=k=>list.reduce((s,r)=>s+r[k],0)/list.length;
 groups.push({length,check,n:list.length,caught:list.filter(r=>r.result==='caught').length,attacks:mean('attacks'),evades:mean('evades'),checks:mean('checks'),reacquired:mean('checkReacquired')});
}
const out=new URL('../../artifacts/chase-lab/mirror-search/',import.meta.url);await mkdir(out,{recursive:true});await writeFile(new URL('report.json',out),JSON.stringify({note:'20s local mirror scenarios, timeout is not escape; factorial map length and endpoint-check comparison.',groups,rows},null,2));
console.log(JSON.stringify({episodes:rows.length,groups}));
