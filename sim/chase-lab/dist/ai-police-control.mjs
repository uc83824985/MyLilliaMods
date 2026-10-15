// Pure control planning. Collision and actual action acceptance belong to the host.
import {RUN, metres as M} from './units.mjs';
import {attackStartReach} from './ai-rules.mjs';
const gap=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y),angle=(a,b)=>Math.atan2(b.y-a.y,b.x-a.x);
const diff=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
const limited=(value,limit)=>Math.max(-limit,Math.min(limit,value));
export function policeMotion(context,command,dt,run=RUN){
  const e=context.police,c=context.config.police,limit=c.turnRate*Math.PI/180*dt;
  if(command.kind==='look'){const dir=e.dir+limited(diff(angle(e,command.target),e.dir),limit);return {speed:0,dir,moveDir:dir,dx:0,dy:0};}
  if(command.kind==='scan'){const dir=e.dir+limit;return {speed:0,dir,moveDir:dir,dx:0,dy:0};}
  if(command.kind!=='move')return {speed:0,dir:e.dir,moveDir:e.moveDir,dx:0,dy:0};
  const goal=context.map.waypoint(e,command.target,c.radius),d=gap(e,goal);
  const dir=e.moveDir+limited(diff(angle(e,goal),e.moveDir),limit);
  const maximum=run*c.speedScale*(e.tired?c.tiredScale:1);
  const speed=d>M(.1)?Math.min(maximum,e.speed+c.acceleration*dt):0;
  return {speed,dir,moveDir:dir,dx:Math.cos(dir)*Math.min(d,speed*dt),dy:Math.sin(dir)*Math.min(d,speed*dt)};
}
export function policeCapture(context,mind){
  const e=context.police,target=mind.enemy(context);
  if(!target||context.time-target.seenAt>.5||!mind.observation?.enemy||!mind.motionConfirmed||e.cooldown>0)return null;
  const away=Math.max(0,target.speed*Math.cos(diff(target.moveDir,angle(e,target))));
  const mode=gap(e,target)<=attackStartReach(context.config,'stand',e.tired,away)?'stand':'lunge';
  return gap(e,target)<=attackStartReach(context.config,mode,e.tired,away)&&Math.abs(diff(angle(e,target),e.dir))<Math.PI/3?mode:null;
}
