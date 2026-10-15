import {readFile,writeFile} from 'node:fs/promises';
import {matrixBounds} from './dist/mirror-game.mjs';
const root=new URL('../../artifacts/chase-lab/mirror-game/',import.meta.url),file=process.argv.includes('--fresh')?'context-v2-report.json':'context-report.json';
const report=JSON.parse(await readFile(new URL(file,root),'utf8'));
const seeds=[...new Set(report.samples.map(s=>s.seed))],keys=Object.keys(report.contexts);
const blocks=Object.fromEntries(keys.map(key=>[key,seeds.map(seed=>report.police.map(e=>report.players.map(p=>{
 const rows=report.samples.filter(s=>s.seed===seed&&s.police===e&&s.player===p&&s.scenario.endsWith(key));return rows.reduce((sum,r)=>sum+r.score,0)/rows.length;
})))]));
const gains=seeds.map(seed=>{const rows=report.design.pairs.filter(p=>p.seed===seed);return rows.reduce((sum,r)=>sum+r.gain,0)/rows.length;});
let state=871234;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
const bootstrap={gain:[],...Object.fromEntries(keys.map(k=>[k,[]]))};
for(let b=0;b<800;b++){
 const chosen=seeds.map(()=>Math.floor(random()*seeds.length));bootstrap.gain.push(chosen.reduce((sum,k)=>sum+gains[k],0)/chosen.length);
 for(const key of keys){const c=report.contexts[key],matrix=report.police.map((_,i)=>report.players.map((_,j)=>chosen.reduce((sum,k)=>sum+blocks[key][k][i][j],0)/chosen.length));
  bootstrap[key].push(matrixBounds(matrix,c.solved.policeMixture,c.solved.playerMixture).gap);
 }
}
const interval=values=>{values.sort((a,b)=>a-b);return [values[Math.floor(values.length*.025)],values[Math.floor(values.length*.975)]];};
report.uncertainty={method:'800 paired seed-block bootstrap resamples; all scenarios and policies retained per seed. Fixed trained mixtures, no refit.',pairedGain95:interval(bootstrap.gain),gap95:Object.fromEntries(keys.map(k=>[k,interval(bootstrap[k])]))};
await writeFile(new URL(file,root),JSON.stringify(report,null,2));console.log(JSON.stringify(report.uncertainty));
