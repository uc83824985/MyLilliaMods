import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {World,dist} from './dist/core.mjs';
import {presetConfig} from './dist/presets.mjs';
const configs={previous:presetConfig('rhythm-short-dodge'),candidate:presetConfig('rhythm-mixed')},rows=[];
for(const [variant,config] of Object.entries(configs))for(const mode of ['stand','lunge'])for(const fraction of [.5,.75,1])for(const direction of ['away','side','diagonal'])for(const press of [null,0,.1,.15,.2,.25,.35,.44,.5]){
 config.mapLayout='grid';const w=new World(config,7);Object.assign(w.police,{x:0,y:0,dir:0,moveDir:0});Object.assign(w.player,{x:config.capture[mode].trigger*fraction,y:0,stamina:70});w.startAttack(mode);
 while(!w.result&&w.time+1e-8<config.capture[mode].windup){
  const ready=press!==null&&w.time+1e-8>=press;
  const vector=!ready||direction==='away'?{x:1,y:0}:direction==='side'?{x:0,y:1}:{x:1,y:1};
  w.step({...vector,dodge:ready&&w.metrics.dodges===0});
 }
 rows.push({variant,mode,startDistance:config.capture[mode].trigger*fraction,direction,press,result:w.result??(w.metrics.perfect?'perfect':'position-evade'),distance:+dist(w.player,w.police).toFixed(4),stamina:w.player.stamina,missCause:w.events.find(e=>e.type==='miss')?.cause??null});
}
const out=new URL('../../artifacts/chase-lab/dodge-comparison/',import.meta.url);await mkdir(out,{recursive:true});
const hashes=Object.fromEntries(await Promise.all(['core','presets'].map(async file=>[file,createHash('sha256').update(await readFile(new URL(`./dist/${file}.mjs`,import.meta.url))).digest('hex')])));
await writeFile(new URL('report.json',out),JSON.stringify({description:'Deterministic first-strike geometry fixtures; not human success rates. Move straight before press, then use indicated direction.',hashes,configs,rows},null,2));
await writeFile(new URL('summary.csv',out),[Object.keys(rows[0]).join(','),...rows.map(row=>Object.values(row).map(v=>v??'').join(','))].join('\n'));
for(const [name,c] of Object.entries(configs))await writeFile(new URL(`${name}.json`,out),JSON.stringify(c,null,2));
console.log(JSON.stringify({episodes:rows.length,edgeAway:rows.filter(r=>r.direction==='away'&&r.startDistance===configs[r.variant].capture[r.mode].trigger),output:out.pathname}));
