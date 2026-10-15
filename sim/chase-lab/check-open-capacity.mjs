import {writeFile} from 'node:fs/promises';
import {World} from './dist/core.mjs';
import {Bot} from './dist/bots.mjs';
import {presetConfig} from './dist/presets.mjs';
import {dispersedSeed} from './dist/mirror-game.mjs';
const rows=[],summary=[];
for(const profile of ['fast','typical','unstable'])for(const capacity of [100,125,150,175,200]){
 for(let i=0;i<96;i++){
  const c=presetConfig('open-equilibrium-'+profile);c.player.staminaMax=capacity;
  const seed=dispersedSeed(7210000,i),w=new World(c,seed),b=new Bot(c,seed);
  while(!w.result)w.step(b.action(w));
  rows.push({profile,capacity,human:w.config.duel.human,hunter:w.config.duel.hunter,...w.summary(),stamina:w.player.stamina});
 }
 const a=rows.filter(r=>r.profile===profile&&r.capacity===capacity),v=a.map(r=>r.seconds).sort((a,b)=>a-b),q=p=>v[Math.floor((v.length-1)*p)];
 summary.push({profile,capacity,n:a.length,min:v[0],p10:q(.1),median:q(.5),p90:q(.9),mean:v.reduce((a,b)=>a+b,0)/v.length,survive30:a.filter(r=>r.seconds>=30).length/a.length,survive40:a.filter(r=>r.result==='timeout').length/a.length,caughtWithStamina:a.filter(r=>r.result==='caught'&&r.stamina>=25).length/a.length});
}
await writeFile('../../artifacts/chase-lab/open-duel/capacity.json',JSON.stringify({scope:'Frozen 100-stamina trained mixtures, regen20; 96 paired seeds/profile/capacity; horizon40; no capacity-specific retraining; min is sample minimum, not guarantee',summary,rows},null,2));console.log(JSON.stringify(summary));
