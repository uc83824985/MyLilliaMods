import {World} from './core.mjs';
import {presetConfig} from './presets.mjs';
import {mirrorInput} from './mirrors.mjs';
import {applyMirrorStrategies} from './mirror-strategies.mjs';
import {metres as M,mirrorY} from './units.mjs';
export const GAME_SCENARIOS=['lead','close','diagonal'].flatMap(position=>[.15,.85].map(exposure=>({id:position+'-'+exposure,position,exposure})));
export function dispersedSeed(base,index){let x=(base+Math.imul(index+1,0x9e3779b9))>>>0;x=Math.imul(x^(x>>>16),0x7feb352d);x=Math.imul(x^(x>>>15),0x846ca68b);return (x^(x>>>16))>>>0;}
export function gameConfig(player,police,scenario){
 const c=presetConfig('mirror-integration-mixed');c.duration=20;c.exposure=scenario.exposure;
 c.mirror.policeStart=scenario.position==='lead'?{x:M(-26),y:mirrorY(-24)}:scenario.position==='close'?{x:M(-17),y:mirrorY(-24)}:{x:0,y:mirrorY(-24)};
 applyMirrorStrategies(c,player,police);return c;
}
export function gameEpisode(player,police,scenario,seed,record=false){
 const w=new World(gameConfig(player,police,scenario),seed);let lostAt=null,escaped=false;
 while(!w.result){w.step(mirrorInput(w));
  const silent=w.time-(w.police.lastHeard?.t??-100)>1.2;
  const gap=Math.hypot(w.player.x-w.police.x,w.player.y-w.police.y);
  if(!w.police.visible&&silent&&gap>M(8)){lostAt??=w.time;if(w.time-lostAt>=w.escapeDelay()){escaped=true;break;}}
  else lostAt=null;
 }
 const escapeWeight=.6-.45*scenario.exposure,evadeWeight=.25+.3*scenario.exposure,timeWeight=1-escapeWeight-evadeWeight;
 const score=escapeWeight*+escaped+evadeWeight*Math.min(1,w.metrics.evades/6)+timeWeight*Math.min(1,w.time/w.config.duration);
 return {score,outcome:escaped?'disengaged':w.result,seconds:w.time,evades:w.metrics.evades,stamina:w.player.stamina,
  teleports:w.events.filter(e=>e.type==='mirror'&&e.phase==='teleport'&&e.actor==='player').length,
  ...(record?{events:w.events,config:w.config}:{} )};
}
export function matrixBounds(matrix,policeMix,playerMix){
 const rowValues=matrix.map(row=>row.reduce((s,v,j)=>s+v*playerMix[j],0));
 const colValues=matrix[0].map((_,j)=>matrix.reduce((s,row,i)=>s+row[j]*policeMix[i],0));
 const value=rowValues.reduce((s,v,i)=>s+v*policeMix[i],0),lower=Math.min(...rowValues),upper=Math.max(...colValues);
 return {value,lower,upper,gap:upper-lower,playerDeviation:upper-value,policeDeviation:value-lower,rowValues,colValues};
}
