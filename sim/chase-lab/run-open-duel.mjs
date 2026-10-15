import {mkdir,writeFile} from 'node:fs/promises';
import {presetConfig} from './dist/presets.mjs';
import {episode,solveGame} from './dist/experiments.mjs';
import {configureOpenDuel,HUMAN_PROFILES,HUMAN_STRATEGIES,HUNTER_STRATEGIES} from './dist/open-duel-config.mjs';
import {matrixBounds,dispersedSeed} from './dist/mirror-game.mjs';
const humans=Object.keys(HUMAN_STRATEGIES),hunters=Object.keys(HUNTER_STRATEGIES),contexts=[];
const trainCount=6,auditCount=12,trainingBase=710000,auditBase=1010000;
const root='../../artifacts/chase-lab/open-duel';await mkdir(root,{recursive:true});
for(const profile of Object.keys(HUMAN_PROFILES))for(const exposure of [.15,.85]){
  const samples=[];
  for(const hunter of hunters)for(const human of humans){
    const config=configureOpenDuel(presetConfig('rhythm-mixed'),{profile,human,hunter,exposure});
    for(const [stage,count,base] of [['train',trainCount,trainingBase],['audit',auditCount,auditBase]])for(let i=0;i<count;i++){
      const seed=dispersedSeed(base,i),row=episode(config,seed,HUMAN_STRATEGIES[human].policy);
      samples.push({stage,hunter,human,seed,...row});
    }
  }
  const matrix=stage=>hunters.map(hunter=>humans.map(human=>{const rows=samples.filter(r=>r.stage===stage&&r.hunter===hunter&&r.human===human);return rows.reduce((s,r)=>s+r.score/100,0)/rows.length;}));
  const train=matrix('train'),audit=matrix('audit');
  // Restricted initial library, then add both sides' response probes and refit training only.
  const restricted=solveGame(train.slice(0,4).map(r=>r.slice(0,4)),20000);
  const expanded=matrixBounds(train,[...restricted.policeMixture,...Array(hunters.length-4).fill(0)],[...restricted.playerMixture,...Array(humans.length-4).fill(0)]);
  const solved=solveGame(train,30000),bounds=matrixBounds(audit,solved.policeMixture,solved.playerMixture);
  const weighted={};for(const key of ['seconds','perfect','evades','attacks','walkSeconds','staminaRecovered','positionMiss'])weighted[key]=samples.filter(r=>r.stage==='audit').reduce((s,r)=>s+r[key]*solved.policeMixture[hunters.indexOf(r.hunter)]*solved.playerMixture[humans.indexOf(r.human)]/auditCount,0);
  const result={profile,exposure,train,audit,restrictedGap:restricted.gap,expandedGap:expanded.gap,solved,bounds,weighted,samples};contexts.push(result);
  console.log(JSON.stringify({profile,exposure,trainGap:solved.gap,auditGap:bounds.gap,weighted}));
  await writeFile(root+'/report.json',JSON.stringify({humans,hunters,profiles:HUMAN_PROFILES,trainCount,auditCount,trainingBase,auditBase,contexts},null,2));
}
console.log(JSON.stringify({report:root+'/report.json',episodes:contexts.length*humans.length*hunters.length*(trainCount+auditCount)}));
