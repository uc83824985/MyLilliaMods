import {PRESSURE_EFFECTS} from './ai-operation.mjs';
import {clone} from './ai-rules.mjs';
export const HUMAN_PROFILES={fast:{mean:.14,jitter:.025,timingSigma:.025,lapseProbability:.02},typical:{mean:.23,jitter:.045,timingSigma:.045,lapseProbability:.05},unstable:{mean:.23,jitter:.085,timingSigma:.075,lapseProbability:.10}};
export const HUMAN_STRATEGIES={precision:{policy:'perfect',walkMode:'recovery'},precision_conserve:{policy:'perfect',walkMode:'conserve'},predict:{policy:'anticipate',walkMode:'recovery'},adaptive:{policy:'adaptive',walkMode:'conserve'},distance:{policy:'reactive',walkMode:'distance'},retreat:{policy:'retreat',walkMode:'conserve'}};
export const HUNTER_STRATEGIES={fixed:{heavy:.5,bias:0,sigma:.12,delayMax:0,misjudgeProbability:.04},light:{heavy:0,bias:-.12,sigma:.12,delayMax:.12,misjudgeProbability:.04},charge:{heavy:1,bias:.05,sigma:.23,delayMax:.12,misjudgeProbability:.08},mixed:{heavy:.65,bias:-.05,sigma:.20,delayMax:.25,misjudgeProbability:.06},patient:{heavy:.4,bias:-.28,sigma:.16,delayMax:.35,misjudgeProbability:.04},aggressive:{heavy:.85,bias:.15,sigma:.32,delayMax:.08,misjudgeProbability:.12}};
for(const human of ['reverse','spin','close_mix'])HUMAN_STRATEGIES[human]={policy:'perfect',walkMode:'conserve'};
for(const base of ['precision_conserve','reverse','close_mix'])for(const ms of [30,60,90])HUMAN_STRATEGIES[`${base}_early${ms}`]={...HUMAN_STRATEGIES[base],tactic:base,safetyLead:ms/1000};
HUMAN_STRATEGIES.nervous={policy:'adaptive',walkMode:'conserve',falseStart:true};
HUMAN_STRATEGIES.guard_walk={policy:'perfect',walkMode:'guard',safetyLead:.03,tactic:'precision_conserve'};
HUNTER_STRATEGIES.slow_scan={...HUNTER_STRATEGIES.mixed,search:{scanTurnRate:45,scanSeconds:5}};
HUNTER_STRATEGIES.fixed_light={heavy:0,bias:0,sigma:0,delayMax:0,misjudgeProbability:0};
HUNTER_STRATEGIES.overreach={...HUNTER_STRATEGIES.aggressive,bias:.55,sigma:.15,misjudgeProbability:.25};
HUNTER_STRATEGIES.bait={...HUNTER_STRATEGIES.mixed,heavy:.2,hold:{min:.75,max:1.6,observeRange:2.5,reaction:.2,jitter:.04}};
HUNTER_STRATEGIES.pressure_attack={...HUNTER_STRATEGIES.light,heavy:.2};
HUNTER_STRATEGIES.pressure={...HUNTER_STRATEGIES.pressure_attack,closePressure:{min:2.5,max:5,closeRange:.9,observeRange:2.5,reaction:.2,jitter:.04,walkConfirm:.2,respondToWalk:false}};
HUNTER_STRATEGIES.pressure_adaptive={...HUNTER_STRATEGIES.pressure,closePressure:{...HUNTER_STRATEGIES.pressure.closePressure,respondToWalk:true}};
export function configureOpenDuel(c,{profile='typical',human='adaptive',hunter='mixed',exposure=.85,regen=20,duration=30}={}){
  const p=HUMAN_PROFILES[profile],h=HUMAN_STRATEGIES[human],e=HUNTER_STRATEGIES[hunter];
  if(!p||!h||!e)throw Error('Unknown open duel strategy');
  delete c.mirror;delete c.drill;delete c.stealth;c.practice=false;c.mapLayout='open';c.spawn='street';c.duration=duration;c.exposure=exposure;c.escapeSeconds=10000;
  c.player.walkRegen=regen;c.reaction={...c.reaction,mean:p.mean,jitter:p.jitter};c.behavior.motorErrorDegrees=profile==='fast'?3:6;
  c.duel={timingSigma:p.timingSigma,lapseProbability:p.lapseProbability,pressure:0,pressureEffects:{...PRESSURE_EFFECTS},walkMode:h.walkMode,police:{...e,misjudgeExtra:.65},profile,human,hunter};
  c.weights={stand:1-e.heavy,stride:0,sweep:0,lunge:e.heavy};return applyHunter(c,hunter);
}
export function applyHunter(c,hunter){
 const h=HUNTER_STRATEGIES[hunter];if(!h)throw Error('Unknown hunter');
 c.duel.hunter=hunter;c.duel.police={...clone(h),misjudgeExtra:.65};c.weights={stand:1-h.heavy,stride:0,sweep:0,lunge:h.heavy};
 if(h.search&&c.search)Object.assign(c.search,h.search);return c;
}
