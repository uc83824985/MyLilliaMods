import {readFile,writeFile} from 'node:fs/promises';
import {World,RNG} from './dist/core.mjs';
import {Bot} from './dist/bots.mjs';
import {presetConfig} from './dist/presets.mjs';
import {configureOpenDuel,HUMAN_STRATEGIES} from './dist/open-duel-config.mjs';
import {dispersedSeed} from './dist/mirror-game.mjs';
const root='../../artifacts/chase-lab/open-duel',report=JSON.parse(await readFile(root+'/report.json','utf8')),rows=[];
const draw=(names,weights,rng)=>{let r=rng.next();return names[weights.findIndex((v,i)=>(r-=v)<=0)]??names.at(-1);};
for(const context of report.contexts)for(let i=0;i<24;i++){
  const seed=dispersedSeed(1410000,i),human=draw(report.humans,context.solved.playerMixture,new RNG(seed^0x123)),hunter=draw(report.hunters,context.solved.policeMixture,new RNG(seed^0x456));
  for(const regen of [10,20]){
    const c=configureOpenDuel(presetConfig('rhythm-mixed'),{profile:context.profile,exposure:context.exposure,human,hunter,regen,duration:90});
    const w=new World(c,seed),bot=new Bot(c,seed,HUMAN_STRATEGIES[human].policy);let minStamina=100;
    while(!w.result){w.step(bot.action(w));minStamina=Math.min(minStamina,w.player.stamina);}
    rows.push({profile:context.profile,exposure:context.exposure,regen,seed,human,hunter,...w.summary(),minStamina,endStamina:w.player.stamina});
  }
}
const summary=report.contexts.flatMap(c=>[10,20].map(regen=>{
  const selected=rows.filter(r=>r.profile===c.profile&&r.exposure===c.exposure&&r.regen===regen),mean=key=>selected.reduce((s,r)=>s+r[key],0)/selected.length;
  return {profile:c.profile,exposure:c.exposure,regen,n:selected.length,seconds:mean('seconds'),attacks:mean('attacks'),perfect:mean('perfect'),walkSeconds:mean('walkSeconds'),endStamina:mean('endStamina'),timeout:selected.filter(r=>r.result==='timeout').length,escaped:selected.filter(r=>r.result==='escaped').length};
}));
await writeFile(root+'/regen.json',JSON.stringify({scope:'Frozen policies trained at regen20; paired new seeds; 90s horizon, not retrained GTO at regen10',summary,rows},null,2));console.log(JSON.stringify(summary));
