import {writeFile} from 'node:fs/promises';
import {episode} from './dist/experiments.mjs';
import {presetConfig} from './dist/presets.mjs';
import {configureOpenDuel} from './dist/open-duel-config.mjs';
import {dispersedSeed} from './dist/mirror-game.mjs';
import {OPEN_TRAINED} from './dist/open-duel-trained.mjs';
const rows=[],summary=[],profiles=['fast','typical','unstable'],pressures=[0,.5,1],humans=['reverse','reverse_early30','reverse_early60','equilibrium','nervous'],hunters=['light','mixed','patient','bait'];
const summarize=a=>{
 const mean=fn=>a.reduce((s,r)=>s+fn(r),0)/a.length,caught=a.filter(r=>r.result==='caught').length,causes={};
 for(const r of a)if(r.timingAudit.enoughStaminaNoDodge){const k=r.timingAudit.unpressedCause;causes[k]=(causes[k]??0)+1;}
 return {n:a.length,seconds:mean(r=>r.seconds),survive30:mean(r=>+(r.seconds>=30)),perfect:mean(r=>r.perfect),evades:mean(r=>r.evades),latePlans:mean(r=>r.timingAudit.latePlans),caughtWithoutDodge:mean(r=>+r.timingAudit.caughtWithoutInput),enoughStaminaNoDodge:mean(r=>+r.timingAudit.enoughStaminaNoDodge),enoughStaminaReadyNoDodge:mean(r=>+r.timingAudit.enoughStaminaReadyNoDodge),enoughStaminaNoDodgeAmongCaught:caught?a.filter(r=>r.timingAudit.enoughStaminaNoDodge).length/caught:null,preemptiveDodges:mean(r=>r.preemptiveDodges??0),caughtAfterPreemptiveDodge:mean(r=>r.caughtAfterPreemptiveDodge??0),intentionalSpinCaught:mean(r=>+(r.timingAudit.caughtWithoutInput&&r.timingAudit.finalPlan?.choice==='spin')),causes};
};
for(const profile of profiles)for(const pressure of pressures)for(const human of humans){
 for(const hunter of hunters)for(let i=0;i<24;i++){
  const c=human==='equilibrium'?presetConfig('open-equilibrium-'+profile):configureOpenDuel(presetConfig('rhythm-mixed'),{profile,human,hunter,duration:40});
  if(c.duel.selection)c.duel.selection.hunter=hunter;c.duel.pressure=pressure;c.duel.objective='endurance';
  rows.push({profile,pressure,human,hunter,...episode(c,dispersedSeed(10210000,i),'perfect')});
 }
 summary.push({profile,pressure,human,...summarize(rows.filter(r=>r.profile===profile&&r.pressure===pressure&&r.human===human))});
}
const byHunter=profiles.flatMap(profile=>pressures.flatMap(pressure=>humans.flatMap(human=>hunters.map(hunter=>({profile,pressure,human,hunter,...summarize(rows.filter(r=>r.profile===profile&&r.pressure===pressure&&r.human===human&&r.hunter===hunter))})))));
await writeFile('../../artifacts/chase-lab/open-duel/pressure.json',JSON.stringify({scope:'Given pressure0/.5/1;24 paired seed blocks x4 fixed hunters/cell;no pressure-specific retraining;100 stamina regen20 horizon40;4320 games;coefficients are model assumptions',trained:OPEN_TRAINED,summary,byHunter,rows},null,2));
console.log(JSON.stringify(summary.filter(r=>['fast','typical'].includes(r.profile)&&['equilibrium','nervous'].includes(r.human))));
