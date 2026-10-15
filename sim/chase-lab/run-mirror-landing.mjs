import {mkdir,writeFile} from 'node:fs/promises';
import {World} from './dist/core.mjs';
import {presetConfig,PRESETS} from './dist/presets.mjs';
import {mirrorInput} from './dist/mirrors.mjs';
const rows=[];
for(const preset of PRESETS.filter(p=>p.id.startsWith('mirror-landing-'))){
 const config=presetConfig(preset.id),w=new World(config,42),snapshots=[];
 for(const target of [.8,2.3,2.6,3.5,6]){
  while(!w.result&&w.time<target)w.step(mirrorInput(w));
  snapshots.push({target,time:w.time,result:w.result,gap:Math.hypot(w.player.x-w.police.x,w.player.y-w.police.y),stamina:w.player.stamina,used:[...w.mirror.used],sealed:w.mirror.sealed});
 }
 rows.push({preset:preset.id,config,snapshots,events:w.events});
}
const out=new URL('../../artifacts/chase-lab/mirror-landing/',import.meta.url);
await mkdir(out,{recursive:true});await writeFile(new URL('report.json',out),JSON.stringify({note:'Conditional fixed-policy landing drills, not reaction AI win rates. Compare event timing and gaps at 3.5s; timeout is not escape.',rows},null,2));
console.log(JSON.stringify(rows.map(r=>({preset:r.preset,at3_5:r.snapshots[3]})),null,2));
