import { metres as M, BASE } from './dist/units.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {World} from './dist/core.mjs';
import {presetConfig} from './dist/presets.mjs';
const rows=[],configs={};
for(const rate of [180,300,360,420,540,720]){
 const c=presetConfig('rhythm-charge');c.mapLayout='grid';c.capture.lunge.turnRate=rate;configs[rate]=c;
 for(const gap of [M(.7),M(1.2),M(2),c.capture.lunge.trigger])for(const onset of [0,.1,.2,.3,.4])for(const style of ['side','orbit','spiral'])for(const side of [-1,1]){
  const w=new World(c,7);Object.assign(w.police,{x:0,y:0,dir:0,moveDir:0});Object.assign(w.player,{x:gap,y:0});w.startAttack('lunge');
  while(!w.result&&w.time<c.capture.lunge.windup){
   const t=Math.atan2(w.player.y-w.police.y,w.player.x-w.police.x),r=style==='spiral'?-.4:0;
   w.step(w.time<onset?{x:1}:style==='side'?{y:side}:{x:Math.cos(t)*r-Math.sin(t)*side,y:Math.sin(t)*r+Math.cos(t)*side});
  }
  const miss=w.events.find(e=>e.type==='miss');rows.push({rate,gap,onset,style,side,result:w.result??'evaded',cause:miss?.cause??null,angleDegrees:miss?.angleDegrees??null});
 }
}
const summary=Object.keys(configs).map(rate=>({rate:+rate,caught:rows.filter(r=>r.rate===+rate&&r.result==='caught').length,n:rows.filter(r=>r.rate===+rate).length}));
const out=new URL('../../artifacts/chase-lab/turn-comparison/',import.meta.url);await mkdir(out,{recursive:true});
await writeFile(new URL('report.json',out),JSON.stringify({description:'Deterministic forced first-strike fixtures, not human win rates. Run straight until onset, then change direction without dodge.',configs,summary,rows},null,2));
await writeFile(new URL('summary.csv',out),[Object.keys(rows[0]).join(','),...rows.map(r=>Object.values(r).map(v=>v??'').join(','))].join('\n'));
console.log(JSON.stringify({episodes:rows.length,summary}));
