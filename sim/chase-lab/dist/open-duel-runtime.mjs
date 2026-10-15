import {RNG,clone} from './ai-rules.mjs';
import {HUMAN_STRATEGIES,applyHunter} from './open-duel-config.mjs';
import {OPEN_TRAINED} from './open-duel-trained.mjs';
export function resolveOpenDuel(config,seed){
 if(!config.duel?.selection)return config;
 const c=clone(config),s=c.duel.selection,t=c.duel.mixtures??OPEN_TRAINED[c.duel.profile];
 const sample=(names,weights,salt)=>{let v=new RNG(seed^salt).next()*weights.reduce((a,b)=>a+b,0);for(let i=0;i<names.length;i++){v-=weights[i];if(v<=0)return names[i];}return names.at(-1);};
 if((s.human==='equilibrium'||s.hunter==='equilibrium')&&!t)throw Error('Missing trained open duel profile');
 if(t)c.duel.mixtures=clone(t); // Freeze weights into exports/replays; later training must not change old sessions.
 const human=s.human==='equilibrium'?sample(t.humans,t.playerMixture,0x28f13):s.human;
 const hunter=s.hunter==='equilibrium'?sample(t.hunters,t.policeMixture,0x79aa5):s.hunter;
 if(!HUMAN_STRATEGIES[human])throw Error('Unknown human');
 if(!c.duel.baseSearch&&c.search)c.duel.baseSearch=clone(c.search);
 if(c.duel.baseSearch)c.search=clone(c.duel.baseSearch);
 Object.assign(c.duel,{human,walkMode:HUMAN_STRATEGIES[human].walkMode,resolved:true});applyHunter(c,hunter);return c;
}
