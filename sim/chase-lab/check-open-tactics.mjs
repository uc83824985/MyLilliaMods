import {writeFile,mkdir} from 'node:fs/promises';
import {World} from './dist/core.mjs';
import {Bot} from './dist/bots.mjs';
import {presetConfig} from './dist/presets.mjs';
import {configureOpenDuel} from './dist/open-duel-config.mjs';
import {dispersedSeed} from './dist/mirror-game.mjs';
const rows=[];
for(const profile of ['fast','typical','unstable'])for(const human of ['precision_conserve','reverse','spin','close_mix'])for(const regen of [10,20])for(const hunter of ['mixed','charge','patient'])for(let i=0;i<24;i++){
 const c=configureOpenDuel(presetConfig('rhythm-mixed'),{profile,human,hunter,regen,duration:30});
 const seed=dispersedSeed(2210000,i),w=new World(c,seed),b=new Bot(c,seed,'perfect');
 while(!w.result)w.step(b.action(w));
 rows.push({profile,human,regen,hunter,seed,...w.summary()});
}
const summary=[];
for(const profile of ['fast','typical','unstable'])for(const human of ['precision_conserve','reverse','spin','close_mix'])for(const regen of [10,20]){
 const a=rows.filter(r=>r.profile===profile&&r.human===human&&r.regen===regen),mean=k=>a.reduce((s,r)=>s+r[k],0)/a.length;
 summary.push({profile,human,regen,n:a.length,survive30:a.filter(r=>r.result==='timeout').length/a.length,seconds:mean('seconds'),perfect:mean('perfect'),evades:mean('evades')});
}
await mkdir('../../artifacts/chase-lab/open-duel',{recursive:true});
await writeFile('../../artifacts/chase-lab/open-duel/tactics.json',JSON.stringify({scope:'Fixed policies, equal hunter weights, paired seeds, no escape; not GTO',summary,rows},null,2));
console.log(JSON.stringify(summary));
