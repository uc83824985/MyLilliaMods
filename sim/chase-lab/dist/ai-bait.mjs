// Script-owned process. Only visible animation, distance and time enter the decision.
export function advanceBait(spec,state,observation,rng){
 if(!spec)return {allowed:true,state};
 const s=state??{enteredAt:null,observedDodgeAt:null};
 const {now,visible,distance,phase,inReach}=observation;
 let started=false,noticed=false;
 if(visible&&distance<=spec.observeRange&&['startup','dash'].includes(phase)&&s.observedDodgeAt===null){
  s.observedDodgeAt=now;s.reactAt=now+Math.max(.05,rng.normal(spec.reaction,spec.jitter));noticed=true;
 }
 if(inReach&&s.enteredAt===null){s.enteredAt=now;s.until=now+rng.range(spec.min,spec.max);started=true;}
 return {state:s,started,noticed,allowed:inReach&&((s.until!==undefined&&now>=s.until)||(s.reactAt!==undefined&&now>=s.reactAt))};
}
