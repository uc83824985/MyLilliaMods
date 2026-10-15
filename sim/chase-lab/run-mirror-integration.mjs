import {mkdir,writeFile} from 'node:fs/promises';
import {World} from './dist/core.mjs';
import {presetConfig,PRESETS} from './dist/presets.mjs';
import {mirrorInput} from './dist/mirrors.mjs';
const args=process.argv.slice(2),option=k=>args[args.indexOf(k)+1];
const count=args.includes('--seeds')?Number(option('--seeds')):12;
if(!Number.isInteger(count)||count<1||count>1000)throw Error('--seeds must be 1..1000');
const presets=PRESETS.filter(p=>p.id.startsWith('mirror-integration-')&&(!args.includes('--preset')||p.id===option('--preset')));
if(!presets.length)throw Error('Unknown integration preset');
const rows=[],aggregate={},transitions={},policeChoices={};
for(const preset of presets)for(const style of ['mixed','follow','intercept','wait','fake'])for(let seed=1;seed<=count;seed++){
 const c=presetConfig(preset.id);
 if(style!=='mixed')for(const key of ['follow','intercept','wait','fake'])c.mirror.ai[key+'Weight']=key===style?8:.2;
 const w=new World(c,seed);while(!w.result)w.step(mirrorInput(w));
 const stats=w.mirror.branchStats??{nodes:{},transitions:{}};
 for(const [node,n] of Object.entries(stats.nodes)){
  const a=aggregate[node]??={episodes:0,visits:0,evaluations:0,actions:{}};a.episodes++;a.visits+=n.visits;a.evaluations+=n.evaluations;
  for(const [action,counts] of Object.entries(n.actions)){const b=a.actions[action]??={offered:0,eligible:0,selected:0};for(const key of Object.keys(b))b[key]+=counts[key];}
 }
 for(const [key,value] of Object.entries(stats.transitions))transitions[key]=(transitions[key]??0)+value;
 for(const [key,value] of Object.entries(w.mirror.policeBranches?.choices??{}))policeChoices[key]=(policeChoices[key]??0)+value;
 rows.push({preset:preset.id,style,seed,...w.summary(),stats,policeBranches:w.mirror.policeBranches,
  teleports:w.events.filter(e=>e.type==='mirror'&&e.phase==='teleport'&&e.actor==='player').length,
  cancellations:w.events.filter(e=>e.type==='mirror'&&e.phase==='cancel'&&e.reason==='input').length,
  config:seed===1?c:undefined,events:seed===1?w.events:undefined});
}
const out=new URL('../../artifacts/chase-lab/mirror-integration/',import.meta.url);await mkdir(out,{recursive:true});
await writeFile(new URL('report.json',out),JSON.stringify({note:'Closed-loop integration branch coverage, not GTO. Visits count node entries; selected counts evaluations including maintained commands; eligible is before probability. Police styles bias only post-transit choices; the cancel preset fixes castResponse=intercept.',episodes:rows.length,aggregate,transitions,policeChoices,rows},null,2));
const csv=['node,episodes,visits,evaluations,action,offered,eligible,selected'];
for(const [node,n] of Object.entries(aggregate))for(const [action,a] of Object.entries(n.actions))csv.push([node,n.episodes,n.visits,n.evaluations,action,a.offered,a.eligible,a.selected].join(','));
await writeFile(new URL('branches.csv',out),csv.join('\n'));
await writeFile(new URL('transitions.csv',out),'transition,count\n'+Object.entries(transitions).map(([k,v])=>`${k},${v}`).join('\n'));
const nodes=Object.fromEntries(Object.entries(aggregate).map(([key,value])=>[key,{
 episodes:value.episodes,visits:value.visits,
 selected:Object.fromEntries(Object.entries(value.actions).map(([action,counts])=>[action,counts.selected]))
}]));
console.log(JSON.stringify({episodes:rows.length,caught:rows.filter(r=>r.result==='caught').length,nodes,output:out.pathname},null,2));
