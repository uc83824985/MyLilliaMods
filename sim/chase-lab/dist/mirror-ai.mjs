import {MirrorMind as ScriptMirrorMind} from './mirror-mind.mjs';
import {buildMirrorContext} from './ai-context.mjs';
import {policeMotion,policeCapture} from './ai-police-control.mjs';
const angle=(a,b)=>Math.atan2(b.y-a.y,b.x-a.x);
import { metres as M } from './units.mjs';
export const MIRROR_AI_DEFAULTS={playerDelay:.16,policeDelay:.20,jitter:.035,decisionInterval:.10,commitSeconds:.65,waitSeconds:1.15,observeSeconds:1.2,staminaValue:M(.10),returnMargin:M(2.5),castMargin:.18,followWeight:1,interceptWeight:1,waitWeight:1,fakeWeight:1};
// Compatibility entry points for the simulator. The shared mind never receives World.
export class MirrorMind extends ScriptMirrorMind {
  ingest(world){return super.ingest(buildMirrorContext(world,this.who));}
  player(world){return super.player(buildMirrorContext(world,this.who,{sample:false}));}
  police(world){return super.police(buildMirrorContext(world,this.who,{sample:false}));}
}
export function initMirrorAI(w){if(!w.config.mirror?.ai)return;w.police.dir=w.police.moveDir=angle(w.police,w.player);w.mirror.minds={player:new MirrorMind(w,'player'),police:new MirrorMind(w,'police')};}
export function sampleMirrorAI(w){if(w.mirror?.minds)for(const mind of Object.values(w.mirror.minds))mind.ingest(w);}
export function playerMirrorAI(w){return w.mirror.minds.player.player(w);}
export function policeMirrorAI(w,dt,run,start){
  const mind=w.mirror.minds.police,command=mind.police(w),e=w.police;
  const context=buildMirrorContext(w,'police',{sample:false});
  const motion=policeMotion(context,command,dt,run);
  Object.assign(e,{speed:motion.speed,dir:motion.dir,moveDir:motion.moveDir});
  if(command.kind==='follow')start(w,'police',command.from);
  if(command.kind==='move'){
    w.moveActor(e,motion.dx,motion.dy,w.config.police.radius,w.player,w.config.player.radius);
    Object.assign(context.police,{x:e.x,y:e.y,dir:e.dir,moveDir:e.moveDir,speed:e.speed});
    const mode=policeCapture(context,mind);
    if(mode)w.startAttack(mode);
  }
  return true;
}
