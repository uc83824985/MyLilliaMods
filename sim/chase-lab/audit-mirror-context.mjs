import {readFile,writeFile} from 'node:fs/promises';
import {solveGame} from './dist/experiments.mjs';
import {GAME_SCENARIOS,gameEpisode,matrixBounds,dispersedSeed} from './dist/mirror-game.mjs';
const root=new URL('../../artifacts/chase-lab/mirror-game/',import.meta.url);
const source=JSON.parse(await readFile(new URL('report.json',root),'utf8'));
const {players,police}=source,contexts={},samples=[];
const fresh=process.argv.includes('--fresh'),freshTraining=[];
if(fresh)for(let i=0;i<police.length;i++){
 for(const player of players)for(const scenario of GAME_SCENARIOS)for(let s=0;s<12;s++){
  const seed=dispersedSeed(300000,s);freshTraining.push({player,police:police[i],scenario:scenario.id,seed,...gameEpisode(player,police[i],scenario,seed)});
 }
 console.log(JSON.stringify({stage:'dispersed-training',row:i+1,total:police.length}));
}
for(const exposure of [.15,.85]){
 const train=(fresh?freshTraining:source.samples.filter(s=>s.stage==='train')).filter(s=>s.scenario.endsWith(String(exposure)));
 const matrix=police.map(e=>players.map(p=>{const rows=train.filter(s=>s.police===e&&s.player===p);return rows.reduce((sum,r)=>sum+r.score,0)/rows.length;}));
 const solved=solveGame(matrix,40000);
 contexts[exposure]={training:matrix,solved,mixture:{player:Object.fromEntries(players.map((p,i)=>[p,solved.playerMixture[i]])),police:Object.fromEntries(police.map((p,i)=>[p,solved.policeMixture[i]]))}};
}
// Third seed set: never used for the first fit or the decision to condition on exposure.
const count=fresh?12:8,seedBase=fresh?400000:200000,seedAt=s=>fresh?dispersedSeed(seedBase,s):seedBase+s;
for(let i=0;i<police.length;i++){
 for(const player of players)for(const scenario of GAME_SCENARIOS)for(let s=0;s<count;s++){
  samples.push({player,police:police[i],scenario:scenario.id,seed:seedAt(s),...gameEpisode(player,police[i],scenario,seedAt(s))});
 }
 console.log(JSON.stringify({stage:'third-seed-audit',row:i+1,total:police.length}));
}
for(const exposure of [.15,.85]){
 const rows=samples.filter(s=>s.scenario.endsWith(String(exposure))),context=contexts[exposure];
 const matrix=police.map(e=>players.map(p=>{const group=rows.filter(s=>s.police===e&&s.player===p);return group.reduce((sum,r)=>sum+r.score,0)/group.length;}));
 context.audit=matrix;context.bounds=matrixBounds(matrix,context.solved.policeMixture,context.solved.playerMixture);
}
const pairs=[];
for(const scenario of GAME_SCENARIOS)for(let s=0;s<count;s++){
 const group=samples.filter(r=>r.scenario===scenario.id&&r.seed===seedAt(s)),mix=contexts[scenario.exposure].mixture;
 let gain=0,secondsGain=0,escapeGain=0,staminaGain=0,evadesGain=0,teleports=0,blindReturnPenalty=0,capturePenalty=0;
 for(const e of police){
  const base=group.find(r=>r.police===e&&r.player==='bypass');
  const gamble=group.find(r=>r.police===e&&r.player==='gamble_return'),safe=group.find(r=>r.police===e&&r.player==='safe_leave');
  blindReturnPenalty+=mix.police[e]*(gamble.score-safe.score);capturePenalty+=mix.police[e]*(+(gamble.outcome==='caught')-+(safe.outcome==='caught'));
  for(const p of players){const actual=group.find(r=>r.police===e&&r.player===p),weight=mix.police[e]*mix.player[p];
   gain+=weight*(actual.score-base.score);secondsGain+=weight*(actual.seconds-base.seconds);escapeGain+=weight*(+(actual.outcome==='disengaged')-+(base.outcome==='disengaged'));
   staminaGain+=weight*(actual.stamina-base.stamina);evadesGain+=weight*(actual.evades-base.evades);teleports+=weight*actual.teleports;
  }
 }
 pairs.push({scenario:scenario.id,seed:seedAt(s),gain,secondsGain,escapeGain,staminaGain,evadesGain,teleports,blindReturnPenalty,capturePenalty});
}
const byScenario=GAME_SCENARIOS.map(s=>{const group=pairs.filter(p=>p.scenario===s.id);return {scenario:s.id,positivePairs:group.filter(p=>p.gain>1e-5).length,total:group.length,...Object.fromEntries(['gain','secondsGain','escapeGain','staminaGain','evadesGain','teleports','blindReturnPenalty','capturePenalty'].map(k=>[k,group.reduce((sum,r)=>sum+r[k],0)/group.length]))};});
const gain=pairs.reduce((sum,r)=>sum+r.gain,0)/pairs.length;
const result={scope:fresh?'Exposure-conditioned finite game, 12 dispersed training seeds and 12 distinct dispersed audit seeds; no refit to audit.':'Exposure-conditioned finite strategy mixtures; trained on original training seeds only, audited on a new third seed set. No refit to audit.',seedBase,count,episodes:samples.length,trainingEpisodes:freshTraining.length,trainingSamples:freshTraining,players,police,contexts,design:{gain,positiveScenarios:byScenario.filter(s=>s.gain>1e-5).length,totalScenarios:6,byScenario,pairs},samples};
await writeFile(new URL(fresh?'context-v2-report.json':'context-report.json',root),JSON.stringify(result,null,2));
await writeFile(new URL(fresh?'context-v2-mixtures.json':'context-mixtures.json',root),JSON.stringify(Object.fromEntries(Object.entries(contexts).map(([e,c])=>[e,c.mixture])),null,2));
console.log(JSON.stringify({episodes:result.episodes,bounds:Object.fromEntries(Object.entries(contexts).map(([e,c])=>[e,c.bounds])),mixtures:Object.fromEntries(Object.entries(contexts).map(([e,c])=>[e,c.mixture])),design:{...result.design,pairs:undefined}},null,2));
