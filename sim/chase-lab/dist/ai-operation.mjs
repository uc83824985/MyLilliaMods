// Given pressure only: no automatic health/stamina/failure coupling.
// Coefficients are editable simulation assumptions, not measured human data.
export const PRESSURE_EFFECTS={reactionDelay:.08,reactionJitter:.025,timingSigma:.04,lapseProbability:.10};
export function operationParameters(c){
 const p=c.duel?.pressure??0,e={...PRESSURE_EFFECTS,...c.duel?.pressureEffects};
 return {pressure:p,mean:c.reaction.mean+p*e.reactionDelay,jitter:c.reaction.jitter+p*e.reactionJitter,
 timingSigma:(c.duel?.timingSigma??0)+p*e.timingSigma,
 lapseProbability:Math.min(1,(c.duel?.lapseProbability??0)+p*e.lapseProbability)};
}
