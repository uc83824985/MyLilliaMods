import {mkdir,writeFile} from 'node:fs/promises';
import {presetConfig} from './dist/presets.mjs';
import {episode,solveGame} from './dist/experiments.mjs';
import {configureOpenDuel,HUMAN_PROFILES,HUMAN_STRATEGIES,HUNTER_STRATEGIES} from './dist/open-duel-config.mjs';
import {matrixBounds,dispersedSeed} from './dist/mirror-game.mjs';
import {OPEN_TRAINED as previous} from './dist/open-duel-trained.mjs';
const humans=Object.keys(HUMAN_STRATEGIES),hunters=Object.keys(HUNTER_STRATEGIES),contexts=[],trained={};
const root='../../artifacts/chase-lab/open-duel';await mkdir(root,{recursive:true});
for(const profile of Object.keys(HUMAN_PROFILES)){
 const samples=[];
 for(const hunter of hunters)for(const human of humans){
  const c=configureOpenDuel(presetConfig('rhythm-mixed'),{profile,human,hunter,duration:40});c.duel.objective='endurance';
  for(const [stage,count,base] of [['train',24,8210000],['audit',32,9210000]])for(let i=0;i<count;i++)samples.push({stage,human,hunter,...episode(c,dispersedSeed(base,i),HUMAN_STRATEGIES[human].policy)});
 }
 const matrix=stage=>hunters.map(hunter=>humans.map(human=>{const a=samples.filter(r=>r.stage===stage&&r.human===human&&r.hunter===hunter);return a.reduce((s,r)=>s+r.score/100,0)/a.length;}));
 const train=matrix('train'),audit=matrix('audit'),initial=solveGame(train.slice(0,6).map(r=>r.slice(0,6)),40000);
 const expanded=matrixBounds(train,[...initial.policeMixture,...Array(hunters.length-6).fill(0)],[...initial.playerMixture,...Array(humans.length-6).fill(0)]);
 const solved=solveGame(train,60000),bounds=matrixBounds(audit,solved.policeMixture,solved.playerMixture);
 const weighted=(hw,pw)=>samples.filter(r=>r.stage==='audit').reduce((s,r)=>{const w=hw[humans.indexOf(r.human)]*pw[hunters.indexOf(r.hunter)]/32;s.seconds+=w*r.seconds;s.survive30+=w*(r.seconds>=30);s.perfect+=w*r.perfect;s.caughtWithoutInput+=w*r.timingAudit.caughtWithoutInput;s.latePlans+=w*r.timingAudit.latePlans;return s;},{seconds:0,survive30:0,perfect:0,caughtWithoutInput:0,latePlans:0});
 const old=previous[profile],oldH=humans.map(n=>old.playerMixture[old.humans.indexOf(n)]??0),oldP=hunters.map(n=>old.policeMixture[old.hunters.indexOf(n)]??0);
 const comparison={oldBoth:weighted(oldH,oldP),newHumanOldPolice:weighted(solved.playerMixture,oldP),newBoth:weighted(solved.playerMixture,solved.policeMixture)};
 const againstHunters=hunters.map((hunter,i)=>({hunter,score:audit[i].reduce((s,x,j)=>s+x*solved.playerMixture[j],0),bestFixedScore:Math.max(...audit[i])}));
 const againstHumans=humans.map((human,j)=>({human,score:audit.reduce((s,r,i)=>s+r[j]*solved.policeMixture[i],0),bestPoliceScore:Math.min(...audit.map(r=>r[j]))}));
 contexts.push({profile,train,audit,initialGap:initial.gap,expandedGap:expanded.gap,solved,bounds,comparison,againstHunters,againstHumans,samples});
 trained[profile]={humans,hunters,playerMixture:solved.playerMixture,policeMixture:solved.policeMixture};
 console.log(JSON.stringify({profile,expandedGap:expanded.gap,trainGap:solved.gap,auditGap:bounds.gap,comparison}));
 await writeFile(root+'/endurance-game.json',JSON.stringify({scope:'Timing plan iteration; pressure0; 100 stamina, regen20, exposure0.85, horizon40; payoff 80% time +20% evades; no escape; train24 audit32 paired seed blocks; bases8210000/9210000',humans,hunters,previous,contexts},null,2));
}
await writeFile('./dist/open-duel-trained.mjs','// Generated from train seeds only by train-open-endurance.mjs\nexport const OPEN_TRAINED='+JSON.stringify(trained,null,2)+';\n');
