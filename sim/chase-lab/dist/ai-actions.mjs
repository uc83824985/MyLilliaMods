// Shared action processes. Inputs are owned actor/action state and lawful observations.
// No World, Unity, clock, rendering, collision queries or opponent truth dependencies.
import {RUN,metres as M} from './units.mjs';
import {clamp,turn,facing,dist,attackWindup,clone} from './ai-rules.mjs';
const rad=value=>value*Math.PI/180;
export function dodgePhase(config,dodge){
  return !dodge?'ready':dodge.elapsed<config.dodge.startup?'startup':dodge.elapsed<config.dodge.startup+config.dodge.duration?'dash':'recovery';
}
export function recoveryScale(config,dodge){
  const c=config.dodge;
  if(c.recoveryCurve!=='linear'||!dodge)return c.recoveryScale;
  const duration=c.recovery*(dodge.used?config.perfectBonus.playerRecoveryScale:1);
  const progress=duration>0?clamp((dodge.elapsed-c.startup-c.duration)/duration,0,1):1;
  return c.recoveryScale+(1-c.recoveryScale)*progress;
}
export function requestDodge(config,self,locked,x,y){
  if(self.dodge||locked)return {accepted:false,reason:'action-locked'};
  if(self.stamina<config.dodge.cost)return {accepted:false,reason:'stamina'};
  const dir=Math.hypot(x,y)>.01?Math.atan2(y,x):self.dir;
  return {accepted:true,state:{dir,elapsed:0,used:false},cost:config.dodge.cost};
}
export function advanceDodge(config,state,dt){
  state.elapsed+=dt;
  const end=config.dodge.startup+config.dodge.duration+config.dodge.recovery*(state.used?config.perfectBonus.playerRecoveryScale:1);
  return {finished:state.elapsed+1e-9>=end,phase:dodgePhase(config,state)};
}
export function playerMotion(config,self,input,phase,dt){
  let dx=input.x||0,dy=input.y||0;const length=Math.hypot(dx,dy);
  if(length>1){dx/=length;dy/=length;}
  let exhausted=self.exhausted;
  if(config.player.runDrain>0&&self.stamina<=0)exhausted=true;
  if(exhausted&&self.stamina>=Math.min(config.player.staminaMax,Math.max(1,config.dodge.cost)))exhausted=false;
  const walking=!!(input.walk||self.stamina<=0||exhausted);
  let speed=walking?RUN*config.player.walkScale:RUN,stamina=self.stamina,dir=self.dir,recovered=0;
  if(['startup','mirrorWindup','mirrorLanding'].includes(phase))speed=0;
  else if(phase==='dash'){speed=RUN*config.dodge.multiplier;dx=Math.cos(self.dodge.dir);dy=Math.sin(self.dodge.dir);}
  else if(phase==='recovery')speed*=recoveryScale(config,self.dodge);
  if(phase==='ready'||phase==='recovery'){
    if(length>.01&&!walking)stamina=Math.max(0,stamina-config.player.runDrain*dt);
    else {stamina=Math.min(config.player.staminaMax,stamina+config.player.walkRegen*dt);recovered=stamina-self.stamina;}
    if(length>.01)dir=Math.atan2(dy,dx);
  }
  return {dx:dx*speed*dt,dy:dy*speed*dt,dir,stamina,exhausted,walking,length,recovered,walkSeconds:walking&&length>.01&&['ready','recovery'].includes(phase)?dt:0};
}
export function createCapture(config,self,mode,id,random){
  const snapshot=clone(config.capture[mode]);snapshot.windup=attackWindup(config,mode);
  snapshot.moveFrom??=mode==='lunge'?snapshot.trackUntil:0;
  return {id,mode,elapsed:0,dir:self.dir,moveDir:self.moveDir,sign:random()<.5?-1:1,phase:'windup',hitDir:self.dir,snapshot,origin:{x:self.x,y:self.y}};
}
export function captureRecovery(config,state,reason){
  state.phase='recovery';state.recovery=0;state.outcome=reason;
  state.recoveryScale=reason==='perfect'?config.perfectBonus.policeRecoveryScale:1;
}
export function advanceCapture(config,self,state,observation,dt){
  const m=state.snapshot;
  if(state.phase==='recovery'){
    state.recovery+=dt;
    return {finished:state.recovery+1e-9>=config.capture.missRecovery*state.recoveryScale,dx:0,dy:0,judge:false};
  }
  const old=state.elapsed;state.elapsed+=dt;
  const tracking=Math.max(0,Math.min(state.elapsed,m.trackUntil)-Math.min(old,m.trackUntil));
  if((state.mode!=='sweep'||m.sweep===0)&&tracking>0&&observation.target&&(observation.visible||state.mode==='lunge'))state.dir=turn(state.dir,facing(self,observation.target),rad(m.turnRate)*tracking);
  const committed=state.elapsed>=m.trackUntil&&state.phase==='windup';
  if(committed)state.phase='committed';
  let dx=0,dy=0;
  if(m.moveScale){
    const dir=state.mode==='lunge'||m.followAim?state.dir:state.moveDir;
    const moveDt=Math.max(0,state.elapsed-Math.max(old,m.moveFrom));
    if(state.mode==='lunge'&&m.stopGap!==undefined&&state.travelLeft===undefined&&moveDt>0&&observation.lastSeen){state.travelLeft=Math.max(0,dist(self,observation.lastSeen)-m.stopGap);state.advanceTarget={...observation.lastSeen};}
    const speed=RUN*config.police.speedScale*m.moveScale*(self.tired?config.police.tiredScale:1),travel=Math.min(speed*moveDt,state.travelLeft??Infinity);
    dx=Math.cos(dir)*travel;dy=Math.sin(dir)*travel;
  }
  const judge=state.elapsed+1e-9>=m.windup;
  if(judge){const progress=m.active>0?clamp((state.elapsed-m.windup)/m.active,0,1):.5;state.hitDir=state.dir+rad(m.sweep)*state.sign*(progress-.5);}
  return {finished:false,committed,dx,dy,judge,lastJudgement:state.elapsed+1e-9>=m.windup+m.active,dir:state.dir};
}
// Normal pursuit owns path memory, not the host navigation implementation.
export function pursuitMotion(config,self,memory,target,geometry,now,dt){
  if(!memory.path||now>=memory.nextPath||dist(self,memory.path)<M(.4)){memory.path=geometry.waypoint(self,target,config.police.radius);memory.nextPath=now+.12;}
  let dir=self.moveDir;
  if(dist(self,memory.path)>M(.08))dir=turn(dir,facing(self,memory.path),rad(config.police.turnRate)*dt);
  const desired=dist(self,target)>M(.2)?RUN*config.police.speedScale*(self.tired?config.police.tiredScale:1):0;
  const speed=self.speed+clamp(desired-self.speed,-config.police.acceleration*dt,config.police.acceleration*dt);
  return {dir,moveDir:dir,speed,dx:Math.cos(dir)*speed*dt,dy:Math.sin(dir)*speed*dt};
}
