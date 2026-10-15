// Complete local policies; sampling a policy per episode preserves conditional
// decisions. Averaging their node weights would define a different game.
const prefer=(action,priority=30)=>({[action]:{priority}});
export const PLAYER_STRATEGIES={
 balanced:{riskAware:false,rules:{}},
 safe_leave:{riskAware:true,rules:{approach:prefer('teleport'),landing:prefer('forward'),departure:prefer('forward')}},
 safe_return:{riskAware:true,rules:{approach:prefer('teleport'),landing:prefer('return'),departure:prefer('turn-back')}},
 safe_feint:{riskAware:true,rules:{approach:prefer('teleport'),landing:prefer('feint'),departure:prefer('turn-back')}},
 run_first:{riskAware:true,rules:{approach:prefer('run-exit'),landing:prefer('forward')}},
 gamble_return:{riskAware:false,rules:{approach:prefer('teleport'),landing:prefer('return'),departure:prefer('turn-back')}},
 cancel_read:{riskAware:true,rules:{approach:prefer('teleport'),casting:{cancel:{priority:40,probability:.8}},landing:prefer('forward')}},
 bypass:{riskAware:true,rules:{approach:prefer('evade')}},
 // Held out from the initial strategy library, then used as response probes.
 probe_feint:{riskAware:true,rules:{approach:{teleport:{weight:4},'run-exit':{weight:2}},casting:{cancel:{priority:40,probability:.5}},landing:{return:{weight:2},feint:{weight:4},forward:{weight:1}},departure:{'turn-back':{weight:4}}}},
 probe_leave:{riskAware:true,rules:{approach:prefer('teleport'),casting:{cancel:{priority:40}},landing:{forward:{weight:8},feint:{weight:1},return:{weight:1}},departure:prefer('forward')}},
 probe_run:{riskAware:false,rules:{approach:prefer('run-exit'),landing:prefer('return')}},
 probe_commit:{riskAware:true,rules:{approach:prefer('teleport'),casting:{cancel:{weight:0}},landing:prefer('forward')}}
};
export const POLICE_STRATEGIES={
 balanced:{response:'adaptive',weights:[1,1,1,1],wait:1.15},
 pressure_follow:{response:'pressure',weights:[8,1,.2,.2],wait:.6},
 pressure_intercept:{response:'pressure',weights:[1,8,.2,.2],wait:.6},
 cut_follow:{response:'intercept',weights:[8,1,.2,.2],wait:.6},
 cut_intercept:{response:'intercept',weights:[1,8,.2,.2],wait:.6},
 feint_guard:{response:'feint',weights:[1,1,8,3],wait:1.2},
 fake_follow:{response:'adaptive',weights:[1,1,1,8],wait:1.2},
 guard:{response:'pressure',weights:[1,1,8,1],wait:2},
 probe_fast:{response:'feint',weights:[6,4,.1,.1],wait:.2},
 probe_mix:{response:'adaptive',weights:[4,4,1,1],wait:.5},
 probe_cut_guard:{response:'intercept',weights:[1,1,8,1],wait:1.6},
 probe_short_guard:{response:'pressure',weights:[2,2,8,1],wait:.35}
};
export function applyMirrorStrategies(config,playerId,policeId){
 const player=PLAYER_STRATEGIES[playerId],police=POLICE_STRATEGIES[policeId];
 if(!player||!police)throw Error('Unknown mirror strategy');
 const ai=config.mirror.ai;
 ai.integration={...ai.integration,riskAware:player.riskAware,rules:structuredClone(player.rules)};
 ai.castResponse=police.response;ai.waitSeconds=police.wait;
 ['follow','intercept','wait','fake'].forEach((name,i)=>ai[name+'Weight']=police.weights[i]);
}
export function sampleStrategy(weights,seed,salt){
 let x=(seed^salt)>>>0;x=Math.imul(x^(x>>>16),0x7feb352d);x=Math.imul(x^(x>>>15),0x846ca68b);x=(x^(x>>>16))>>>0;
 const entries=Object.entries(weights),total=entries.reduce((s,[,v])=>s+v,0);let draw=x/4294967296*total;
 return entries.find(([,v])=>(draw-=v)<0)?.[0]??entries.at(-1)[0];
}
export function initStrategyMixture(w){
 const integration=w.config.mirror?.ai?.integration;
 const mix=integration?.mixtureByExposure?.[w.config.exposure<.5?'low':'high']??integration?.mixture;if(!mix)return;
 const player=sampleStrategy(mix.player,w.seed,0x72051),police=sampleStrategy(mix.police,w.seed,0x6a230);
 applyMirrorStrategies(w.config,player,police);
 w.mirror.sampledStrategies={player,police};
 // White-box audit only; the minds never read these IDs.
 w.emit('mirror-ai',{actor:'audit',choice:'strategy-sample',player,police,reason:`白盒抽样：${player} / ${police}`});
}
