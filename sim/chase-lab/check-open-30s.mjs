import {writeFile} from 'node:fs/promises';
import {World} from './dist/core.mjs';
import {Bot} from './dist/bots.mjs';
import {presetConfig} from './dist/presets.mjs';
import {configureOpenDuel} from './dist/open-duel-config.mjs';
import {dispersedSeed} from './dist/mirror-game.mjs';
const rows=[];
for(const profile of ['fast','typical','unstable'])for(const regen of [10,15,20,25,30,40])for(const hunter of ['mixed','charge','patient'])for(let i=0;i<24;i++){
  const c=configureOpenDuel(presetConfig('rhythm-mixed'),{profile,human:'precision_conserve',hunter,regen,exposure:.85,duration:30});
  const seed=dispersedSeed(1810000,i),w=new World(c,seed),bot=new Bot(c,seed,'perfect');
  while(!w.result)w.step(bot.action(w));
  rows.push({profile,regen,hunter,seed,...w.summary(),endStamina:w.player.stamina,hasDodgeStamina:w.player.stamina>=25});
}
const summary=['fast','typical','unstable'].flatMap(profile=>[10,15,20,25,30,40].map(regen=>{
  const a=rows.filter(r=>r.profile===profile&&r.regen===regen),mean=k=>a.reduce((s,r)=>s+r[k],0)/a.length;
  return {profile,regen,n:a.length,survive30:a.filter(r=>r.result==='timeout').length/a.length,seconds:mean('seconds'),perfect:mean('perfect'),evades:mean('evades'),attacks:mean('attacks'),caughtWithStamina:a.filter(r=>r.result==='caught'&&r.hasDodgeStamina).length/a.length};
}));
await writeFile('../../artifacts/chase-lab/open-duel/thirty-seconds.json',JSON.stringify({scope:'Fixed precision-conserve policy vs three hunter policies equally weighted; paired seeds; no escape; not equilibrium retraining',summary,rows},null,2));console.log(JSON.stringify(summary));
