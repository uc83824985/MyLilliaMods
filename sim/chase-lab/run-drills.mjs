import { mkdir,writeFile,readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { World,MODES,dist } from './dist/core.mjs';
import { presetConfig } from './dist/presets.mjs';
import { drillInput,drillSummary } from './dist/drills.mjs';
const out=new URL('../../artifacts/chase-lab/drills/',import.meta.url);await mkdir(out,{recursive:true});
const rows=[];
for(const entry of ['attack','recovery']) for(const mode of MODES) for(const response of entry==='attack'?['early','perfect','late','none','spiral']:['none']) for(const exit of ['same','cross','circle']) for(const walk of [true,false]) for(const side of [-1,1]) for(const seed of [101,102,103,104]) {
  const c=presetConfig('drill-cross');c.drill={entry,mode,response,exit,walk,side};c.weights=Object.fromEntries(MODES.map(m=>[m,+(m===mode)]));
  const w=new World(c,seed);let firstLostAt=null,maxDistance=0;
  while(!w.result){w.step(drillInput(w));if(!w.police.visible&&firstLostAt===null)firstLostAt=w.time;maxDistance=Math.max(maxDistance,dist(w.player,w.police));}
  rows.push({...drillSummary(w),entry,side,firstLostAt,maxDistance});
}
const hash=createHash('sha256');for(const f of ['core.mjs','drills.mjs','presets.mjs'])hash.update(await readFile(new URL('./dist/'+f,import.meta.url)));
await writeFile(new URL('report.json',out),JSON.stringify({version:1,kind:'scripted-unit-matrix',codeHash:hash.digest('hex'),baseConfig:presetConfig('drill-cross'),note:'固定时序与位置，不是追逐胜率。recovery入口条件化；未重获为6秒观察窗内未发生，不等于脱身。',rows},null,2));
const columns=['entry','mode','response','exit','walk','side','seed','firstResponse','missCause','missAngleDegrees','firstLostAt','searchStarted','reacquiredAt','searchDelay','endedWithoutReacquisition','walkSeconds','staminaRecovered','maxDistance','result'];
await writeFile(new URL('summary.csv',out),'\uFEFF'+[columns.join(','),...rows.map(r=>columns.map(k=>r[k]??'').join(','))].join('\n'));
console.log(JSON.stringify({episodes:rows.length,attackFixtures:rows.filter(r=>r.entry==='attack').length,recoveryFixtures:rows.filter(r=>r.entry==='recovery').length,firstResponse:rows.reduce((a,r)=>(a[r.firstResponse]=(a[r.firstResponse]||0)+1,a),{}),output:out.href}));
