import {readFile,writeFile} from 'node:fs/promises';
import {matrixBounds} from './dist/mirror-game.mjs';
const root=new URL('../../artifacts/chase-lab/mirror-game/',import.meta.url);
const report=JSON.parse(await readFile(new URL('report.json',root),'utf8'));
const held=report.samples.filter(s=>s.stage==='holdout'),seeds=[...new Set(held.map(s=>s.seed))];
const blockMatrices=seeds.map(seed=>report.police.map(police=>report.players.map(player=>{
 const rows=held.filter(s=>s.seed===seed&&s.police===police&&s.player===player);return rows.reduce((sum,s)=>sum+s.score,0)/rows.length;
})));
const gainBlocks=seeds.map(seed=>{const list=report.design.pairs.filter(p=>p.seed===seed);return list.reduce((sum,p)=>sum+p.gain,0)/list.length;});
let state=92453;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
const bootstrap=[];
for(let b=0;b<800;b++){
 const chosen=seeds.map(()=>Math.floor(random()*seeds.length));
 const matrix=report.police.map((_,i)=>report.players.map((_,j)=>chosen.reduce((sum,k)=>sum+blockMatrices[k][i][j],0)/chosen.length));
 const bounds=matrixBounds(matrix,report.solved.policeMixture,report.solved.playerMixture);
 bootstrap.push({gap:bounds.gap,gain:chosen.reduce((sum,k)=>sum+gainBlocks[k],0)/chosen.length});
}
const interval=key=>{const values=bootstrap.map(r=>r[key]).sort((a,b)=>a-b);return [values[Math.floor(values.length*.025)],values[Math.floor(values.length*.975)]];};
report.design.approximate95CI=interval('gain');
report.uncertainty={method:'800 paired seed-block bootstrap resamples; all six scenarios and all policies stay together within each held-out seed. Descriptive uncertainty, not a full-strategy GTO guarantee.',heldoutGap95:interval('gap'),pairedGain95:interval('gain')};
const contrast=[];
for(const scenario of report.scenarios){let delta=0,catchDifference=0;
 for(let i=0;i<report.police.length;i++)for(const seed of seeds){
  const get=id=>held.find(r=>r.seed===seed&&r.scenario===scenario.id&&r.police===report.police[i]&&r.player===id);
  const risk=get('gamble_return'),safe=get('safe_leave'),weight=report.solved.policeMixture[i]/seeds.length;
  delta+=weight*(risk.score-safe.score);catchDifference+=weight*(+(risk.outcome==='caught')-+(safe.outcome==='caught'));
 }
 contrast.push({scenario:scenario.id,blindReturnMinusSafeLeave:delta,captureDifference:catchDifference});
}
report.failureContrast=contrast;
for(const scenario of report.design.byScenario){let staminaGain=0,teleports=0;
 for(let i=0;i<report.police.length;i++)for(let j=0;j<report.players.length;j++)for(const seed of seeds){
  const actual=held.find(r=>r.seed===seed&&r.scenario===scenario.scenario&&r.police===report.police[i]&&r.player===report.players[j]);
  const baseline=held.find(r=>r.seed===seed&&r.scenario===scenario.scenario&&r.police===report.police[i]&&r.player==='bypass');
  const weight=report.solved.policeMixture[i]*report.solved.playerMixture[j]/seeds.length;
  staminaGain+=weight*(actual.stamina-baseline.stamina);teleports+=weight*actual.teleports;
 }
 scenario.staminaGain=staminaGain;scenario.meanTeleports=teleports;
}
await writeFile(new URL('report.json',root),JSON.stringify(report,null,2));
console.log(JSON.stringify({uncertainty:report.uncertainty,design:{...report.design,pairs:undefined},failureContrast:contrast},null,2));
