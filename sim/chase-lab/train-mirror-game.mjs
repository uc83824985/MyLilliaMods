import {mkdir,writeFile} from 'node:fs/promises';
import {PLAYER_STRATEGIES,POLICE_STRATEGIES} from './dist/mirror-strategies.mjs';
import {GAME_SCENARIOS,gameEpisode,matrixBounds} from './dist/mirror-game.mjs';
import {solveGame} from './dist/experiments.mjs';
const players=Object.keys(PLAYER_STRATEGIES),police=Object.keys(POLICE_STRATEGIES),samples=[];
const trainSeeds=6,testSeeds=12;
async function evaluate(seedBase,count,label){
 const matrix=[];
 for(let i=0;i<police.length;i++){
  const row=[];
  for(let j=0;j<players.length;j++){
   let sum=0;
   for(const scenario of GAME_SCENARIOS)for(let s=0;s<count;s++){
    const result=gameEpisode(players[j],police[i],scenario,seedBase+s);
    sum+=result.score;samples.push({stage:label,police:police[i],player:players[j],scenario:scenario.id,seed:seedBase+s,...result});
   }
   row.push(sum/(GAME_SCENARIOS.length*count));
  }
  matrix.push(row);console.log(JSON.stringify({stage:label,row:i+1,total:police.length}));
 }
 return matrix;
}
const training=await evaluate(1000,trainSeeds,'train');
const restricted=solveGame(training.slice(0,8).map(row=>row.slice(0,8)),30000);
const expandedBefore=matrixBounds(training,[...restricted.policeMixture,0,0,0,0],[...restricted.playerMixture,0,0,0,0]);
const solved=solveGame(training,40000);
const holdout=await evaluate(100000,testSeeds,'holdout');
const held=matrixBounds(holdout,solved.policeMixture,solved.playerMixture);
const baseline=players.indexOf('bypass');
const pairs=[];
for(const scenario of GAME_SCENARIOS)for(let s=0;s<testSeeds;s++){
 const subset=samples.filter(r=>r.stage==='holdout'&&r.scenario===scenario.id&&r.seed===100000+s);
 let score=0,base=0,seconds=0,baseSeconds=0,escape=0,baseEscape=0,evades=0,baseEvades=0;
 for(let i=0;i<police.length;i++)for(let j=0;j<players.length;j++){
  const actual=subset.find(r=>r.police===police[i]&&r.player===players[j]);
  const control=subset.find(r=>r.police===police[i]&&r.player===players[baseline]);
  const weight=solved.policeMixture[i]*solved.playerMixture[j];
  score+=weight*actual.score;base+=weight*control.score;seconds+=weight*actual.seconds;baseSeconds+=weight*control.seconds;
  escape+=weight*+(actual.outcome==='disengaged');baseEscape+=weight*+(control.outcome==='disengaged');evades+=weight*actual.evades;baseEvades+=weight*control.evades;
 }
 pairs.push({scenario:scenario.id,seed:100000+s,gain:score-base,secondsGain:seconds-baseSeconds,escapeGain:escape-baseEscape,evadesGain:evades-baseEvades});
}
const mean=xs=>xs.reduce((s,x)=>s+x,0)/xs.length;
const byScenario=GAME_SCENARIOS.map(s=>{const list=pairs.filter(p=>p.scenario===s.id);return {scenario:s.id,gain:mean(list.map(p=>p.gain)),positivePairs:list.filter(p=>p.gain>1e-5).length,total:list.length,secondsGain:mean(list.map(p=>p.secondsGain)),escapeGain:mean(list.map(p=>p.escapeGain)),evadesGain:mean(list.map(p=>p.evadesGain))};});
const pairMean=mean(pairs.map(p=>p.gain)),pairSE=Math.sqrt(pairs.reduce((s,p)=>s+(p.gain-pairMean)**2,0)/(pairs.length-1)/pairs.length);
const mixture={player:Object.fromEntries(players.map((id,j)=>[id,solved.playerMixture[j]])),police:Object.fromEntries(police.map((id,i)=>[id,solved.policeMixture[i]]))};
const report={scope:'Finite complete-policy local mirror game, empirical approximation, not full-game GTO. Fixed equal scenario weighting. Holdout is not used to re-fit.',players,police,scenarios:GAME_SCENARIOS,trainSeeds,testSeeds,episodes:samples.length,training,holdout,restricted,expandedBefore,solved,held,mixture,
 design:{pairedMeanGain:pairMean,approximate95CI:[pairMean-1.96*pairSE,pairMean+1.96*pairSE],positiveScenarioCount:byScenario.filter(s=>s.gain>1e-5).length,scenarioCount:byScenario.length,byScenario,pairs},samples};
const out=new URL('../../artifacts/chase-lab/mirror-game/',import.meta.url);await mkdir(out,{recursive:true});
await writeFile(new URL('report.json',out),JSON.stringify(report,null,2));
await writeFile(new URL('mixture.json',out),JSON.stringify(mixture,null,2));
console.log(JSON.stringify({episodes:report.episodes,trainGap:solved.gap,holdout:held,mixture,design:{...report.design,pairs:undefined}},null,2));
