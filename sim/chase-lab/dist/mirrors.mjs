import {actionLedger} from './ai-action-feedback.mjs';
import { metres as M } from './units.mjs';
import {validateIntegration,issueMirrorCommand} from './mirror-decisions.mjs';
import {initStrategyMixture,PLAYER_STRATEGIES,POLICE_STRATEGIES} from './mirror-strategies.mjs';
import { initMirrorAI, sampleMirrorAI, playerMirrorAI, policeMirrorAI, MIRROR_AI_DEFAULTS } from './mirror-ai.mjs';
// Fixed fixtures remain separate from optional observation-driven AI.
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
export function validateMirrors(c) {
  const m=c.mirror;if(!m)return [];
  const errors=validateIntegration(c);
  const integration=m.ai?.integration;
  const groups=integration?.mixtureByExposure;
  if(groups!==undefined&&(!groups||!groups.low||!groups.high))errors.push('mixtureByExposure requires low and high mixtures');
  for(const mix of [integration?.mixture,groups?.low,groups?.high].filter(v=>v!==undefined)){
    for(const [actor,library] of [['player',PLAYER_STRATEGIES],['police',POLICE_STRATEGIES]]){
      const weights=mix?.[actor];
      if(!weights||typeof weights!=='object'||Array.isArray(weights)||!Object.keys(weights).length||Object.entries(weights).some(([id,weight])=>!library[id]||!Number.isFinite(weight)||weight<0)||Object.values(weights).reduce((s,v)=>s+v,0)<=0)errors.push('Invalid equilibrium mixture: '+actor);
    }
  }
  for(const k of ['observeDelay','restartDelay','returnDelay','leaveThreshold'])if(m[k]!==undefined&&(!Number.isFinite(m[k])||m[k]<0||m[k]>10))errors.push(`mirror.${k} 无效`);
  if(m.fakeResponse!==undefined&&!['follow','move','wait'].includes(m.fakeResponse))errors.push('mirror.fakeResponse 无效');
  if(m.landingDuel!==undefined&&!['intercept-return','follow-return','follow-late','fake-return','fake-leave'].includes(m.landingDuel))errors.push('mirror.landingDuel 无效');
  if(m.landingDuel&&(m.ai||m.initialCast))errors.push('落地单元不能同时启用自由AI或入口施法起手');
  if(m.cancelMode!==undefined&&!['recovery','disabled'].includes(m.cancelMode))errors.push('mirror.cancelMode 无效');
  if(m.initialCast!==undefined&&typeof m.initialCast!=='boolean')errors.push('mirror.initialCast 无效');
  if(m.initialStamina!==undefined&&(!Number.isFinite(m.initialStamina)||m.initialStamina<0||m.initialStamina>c.player.staminaMax))errors.push('mirror.initialStamina 无效');
  if(m.ai?.castResponse!==undefined&&!['adaptive','pressure','intercept','feint'].includes(m.ai.castResponse))errors.push('mirror.ai.castResponse 无效');
  if(m.ai?.checkOtherMirror!==undefined&&typeof m.ai.checkOtherMirror!=='boolean')errors.push('mirror.ai.checkOtherMirror 无效');
  if(m.ai){for(const k of Object.keys(MIRROR_AI_DEFAULTS))if(!Number.isFinite(m.ai[k])||m.ai[k]<0||m.ai[k]>20)errors.push(`mirror.ai.${k}: 参数无效`);
    if(m.ai.decisionInterval<.025||m.ai.followWeight+m.ai.interceptWeight+m.ai.waitWeight+m.ai.fakeWeight<=0)errors.push('mirror.ai: 决策间隔或权重无效');}
  for(const k of ['playerWindup','playerRecovery','policeWindup','policeRecovery','delay'])if(!Number.isFinite(m[k])||m[k]<0||m[k]>10)errors.push(`mirror.${k}: 需在0–10秒`);
  if(!Number.isFinite(m.range)||m.range<.1||m.range>2)errors.push('mirror.range: 需在0.1–2米');
  if(!Array.isArray(m.points)||m.points.length!==2||m.points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))errors.push('mirror.points: 需要两个有效落点');
  if(!['follow','wait','intercept','delayed','idle'].includes(m.policePolicy))errors.push('mirror.policePolicy 无效');
  if(!['return','leave','walk','run'].includes(m.playerPolicy))errors.push('mirror.playerPolicy 无效');
  if(!m.policeStart||!Number.isFinite(m.policeStart.x)||!Number.isFinite(m.policeStart.y))errors.push('mirror.policeStart 无效');
  if(c.drill||c.practice)errors.push('镜子单元不能与其他单元/练习同时启用');
  return errors;
}
export function initMirrors(w){
  const c=w.config.mirror;if(!c)return;
  for(const p of [...c.points,...c.points.flatMap(p=>[M(-.8),M(.8)].map(offset=>({x:p.x,y:p.y+offset}))),c.policeStart])if(!w.map.free(p,Math.max(w.config.player.radius,w.config.police.radius)+M(.1)))throw Error('镜子落点或出生点不可通行');
  w.mirror={used:[false,false],sealed:false,player:null,police:null,last:null};
  Object.assign(w.player,c.points[0],{dir:0});Object.assign(w.police,c.policeStart,{dir:0,moveDir:0,lastSeen:{...c.points[0]}});
  initStrategyMixture(w);initMirrorAI(w);
  if(c.initialStamina!==undefined)w.player.stamina=c.initialStamina;
  if(c.initialCast)startMirror(w,'player',0);
  if(c.landingDuel){
    Object.assign(w.player,c.points[1],{y:c.points[1].y+M(.8)});
    w.mirror.used[0]=true;w.mirror.first=w.mirror.last={from:0,t:0};
    w.mirror.player={phase:'landing',from:0,until:c.playerRecovery};
    w.emit('mirror',{phase:'fixture-arrival',actor:'player',from:0,to:1});
  }
}
function mirrorFeedback(w,who,state,status,phase,reason=null){
  if(state?.request)actionLedger(w,who).publish(state.request,status,phase,reason);
}
export function cancelMirror(w,who,reason){
  const s=w.mirror?.[who];if(!s)return false;
  if(reason==='input'){
    if(who!=='player'||s.phase!=='windup'||w.config.mirror.cancelMode==='disabled')return false;
    w.mirror.player={...s,phase:'landing',cancelled:true,until:w.time+w.config.mirror.playerRecovery};
    mirrorFeedback(w,who,s,'running','cancel-recovery','input');
    w.emit('mirror',{phase:'cancel',actor:who,reason,recovery:w.config.mirror.playerRecovery,from:s.from,stamina:w.player.stamina});return true;
  }
  if(!['caught','sealed','occupied'].includes(reason))return false;
  if(s.phase!=='windup'&&reason!=='caught')return false;
  w.mirror[who]=null;
  mirrorFeedback(w,who,s,'interrupted',null,reason);
  if(who==='player'&&reason==='sealed'){
    w.mirror.restartUntil=w.time+(w.config.mirror.restartDelay??.35);
    w.emit('mirror',{phase:'reaction',actor:who,until:w.mirror.restartUntil});
  }
  w.emit('mirror',{phase:'cancel',actor:who,reason});return true;
}
export function startMirror(w,who,index){
  const m=w.mirror,c=w.config.mirror,a=w[who];
  if(!m)return false;
  const ledger=actionLedger(w,who),request=ledger.request('mirror');
  const reject=reason=>{ledger.publish(request,'rejected',null,reason);return false;};
  if(!m||m.sealed||m[who]||![0,1].includes(index)||distance(a,c.points[index])>c.range||!w.map.clear(a,c.points[index],a===w.player?w.config.player.radius:w.config.police.radius))return reject('unavailable-or-out-of-range');
  if(who==='player'&&(m.used[index]||w.player.dodge))return reject('used-or-dodge-locked');
  if(who==='police'&&(a.attack||a.cooldown>0))return reject('attack-locked');
  m[who]={phase:'windup',from:index,until:w.time+c[`${who}Windup`],request};
  ledger.publish(request,'accepted','windup');
  if(who==='police'){a.speed=0;a.plan=null;}
  w.emit('mirror',{phase:'windup',actor:who,from:index});return true;
}
export function mirrorTick(w,input){
  if(!w.mirror)return;
  for(const request of input.mirrorCommands??[])issueMirrorCommand(w,request.action,request.options);
  sampleMirrorAI(w);
  const m=w.mirror,c=w.config.mirror;
  // Police sealing wins exact timestamp ties; already completed teleports are not undone.
  for(const who of ['police','player']){
    const s=m[who];if(!s||w.time+1e-9<s.until)continue;
    if(s.phase==='landing'){mirrorFeedback(w,who,s,s.cancelled?'interrupted':'succeeded',null,s.cancelled?'cancelled':null);m[who]=null;w.emit('mirror',{phase:'ready',actor:who});continue;}
    if(m.sealed&&who==='player'){cancelMirror(w,who,'sealed');continue;}
    const point=c.points[1-s.from],target={x:point.x,y:point.y+(who==='player'?M(.8):M(-.8))},other=w[who==='player'?'police':'player'];
    // Never overlap a waiting actor or teleport through invalid geometry.
    if(!w.map.free(target,w.config[who].radius)||distance(target,other)<w.config.player.radius+w.config.police.radius){cancelMirror(w,who,'occupied');continue;}
    Object.assign(w[who],target);w[who].dir=Math.atan2(target.y-c.points[s.from].y,target.x-c.points[s.from].x);
    if(who==='player'){m.used[s.from]=true;m.last={from:s.from,t:w.time};m.first??={...m.last};
      if(c.landingDuel)m.turnNotice={at:w.time+(c.observeDelay??.25),target:{...target}};
    }
    else {m.sealed=true;w.police.moveDir=w.police.dir;w.police.path=null;cancelMirror(w,'player','sealed');w.emit('mirror',{phase:'sealed',actor:who});}
    m[who]={...s,phase:'landing',until:w.time+c[`${who}Recovery`]};
    mirrorFeedback(w,who,s,'running','landing');
    w.emit('mirror',{phase:'teleport',actor:who,from:s.from,to:1-s.from,stamina:w[who].stamina,gap:distance(w.player,w.police)});
  }
  if(input.cancelMirror)cancelMirror(w,'player','input');
  if(input.mirror&&!input.cancelMirror&&!m.player){const index=c.points.findIndex(p=>distance(p,w.player)<=c.range);startMirror(w,'player',index);}
}
export function mirrorInput(w){
  if(w.time<(w.mirror?.restartUntil??0))return {x:0,y:0};
  if(w.mirror?.minds)return playerMirrorAI(w);
  return mirrorScriptInput(w);
}
export function mirrorScriptInput(w){
  const m=w.mirror,c=w.config.mirror,p=w.player;
  if(m.player)return {x:0,y:0};
  if(c.landingDuel&&!m.used[1]&&!m.sealed){
    if(c.landingDuel==='fake-leave'){
      if(c.retreatReturn&&w.police.speed>M(.2)&&w.map.clear(p,w.police))m.moveSeenAt??=w.time;
      if(c.retreatReturn&&m.moveSeenAt!==undefined&&w.time>=m.moveSeenAt+(c.observeDelay??.25)){
        const point=c.points[1],d=distance(p,point);
        return d<=c.range?{x:0,y:0,mirror:true}:{x:(point.x-p.x)/d,y:(point.y-p.y)/d};
      }
      return {x:1,y:0};
    }
    const ready=c.playerRecovery+(c.returnDelay??(c.landingDuel==='follow-late'?1.2:0));
    return {x:0,y:0,mirror:w.time+1e-9>=ready};
  }
  if(c.landingDuel)return {x:m.used[1]?-1:1,y:0};
  if(c.playerPolicy!=='run'&&!m.sealed&&(!m.used[0]||c.playerPolicy==='return'&&!m.used[1]))return {x:0,y:0,mirror:true};
  if(c.playerPolicy==='run'&&!m.used[0]){const b=c.points[1],d=distance(p,b);if(d>M(.2))return {x:(b.x-p.x)/d,y:(b.y-p.y)/d};}
  return {x:1,y:0,walk:c.playerPolicy==='walk'};
}
export function mirrorPoliceStep(w,dt,run){
  if(!w.mirror)return false;
  const m=w.mirror,c=w.config.mirror,e=w.police;
  if(m.police){e.speed=0;return true;}
  if(m.minds)return policeMirrorAI(w,dt,run,startMirror);
  if(m.sealed)return false;
  if(c.landingDuel&&m.turnNotice&&w.time>=m.turnNotice.at){
    m.duelTarget=m.turnNotice.target;m.turnNotice=null;m.seenTarget=null;
    w.emit('mirror',{actor:'police',phase:'turn-to-arrival',x:m.duelTarget.x,y:m.duelTarget.y});
  }
  // Fixed fixture policies intentionally know the two map endpoints, not hidden player motion.
  const evidence=c.landingDuel||c.policePolicy==='delayed'?m.first:m.last,departure=evidence?.t;
  let target=c.policePolicy==='intercept'?c.points[1]:c.points[c.policePolicy==='wait'?0:evidence?.from??0];
  if(c.landingDuel&&m.duelTarget)target=m.duelTarget;
  if(c.landingDuel&&(c.policePolicy==='intercept'||m.stopWaiting&&c.fakeResponse==='move')){
    if(m.seenTarget&&w.time>=m.seenTarget.at){m.duelTarget=m.seenTarget.point;target=m.duelTarget;m.seenTarget=null;}
    if(e.visible&&!m.seenTarget)m.seenTarget={at:w.time+(c.observeDelay??.25),point:{x:w.player.x,y:w.player.y}};
  }
  const waiting=c.policePolicy==='wait'||c.policePolicy==='idle';
  if(c.policePolicy==='idle'){e.speed=0;return true;}
  if(c.landingDuel&&c.policePolicy==='wait'){
    if(c.landingDuel==='fake-leave'&&!m.stopWaiting){
      const visible=w.map.clear(e,w.player)&&Math.abs(Math.atan2(Math.sin(Math.atan2(w.player.y-e.y,w.player.x-e.x)-e.dir),Math.cos(Math.atan2(w.player.y-e.y,w.player.x-e.x)-e.dir)))<Math.PI/3;
      if(visible&&distance(w.player,c.points[1])>(c.leaveThreshold??M(3)))m.leaveSeenAt??=w.time;
      if(m.leaveSeenAt!==undefined&&w.time>=m.leaveSeenAt+(c.observeDelay??.25)&&c.fakeResponse!=='wait'){
        m.stopWaiting=true;w.emit('mirror',{actor:'police',phase:'stop-waiting',reason:c.fakeResponse??'follow'});
      }
    }
    if(m.stopWaiting&&(c.fakeResponse??'follow')==='follow'){startMirror(w,'police',0);return true;}
    if(!m.stopWaiting){
      e.speed=0;const goal=m.duelTarget??c.points[1],aim=Math.atan2(goal.y-e.y,goal.x-e.x),delta=Math.atan2(Math.sin(aim-e.dir),Math.cos(aim-e.dir)),limit=w.config.police.turnRate*Math.PI/180*dt;
      e.dir+=Math.max(-limit,Math.min(limit,delta));e.moveDir=e.dir;
      if(m.duelTarget&&e.visible&&e.cooldown<=0&&distance(e,w.player)<=w.config.capture.stand.trigger&&Math.abs(delta)<Math.PI/3)w.startAttack('stand');
      return true;
    }
    target=m.duelTarget??c.points[1];
  }
  if(c.landingDuel&&c.policePolicy==='delayed'){
    e.speed=0;const goal=c.points[1],aim=Math.atan2(goal.y-e.y,goal.x-e.x),delta=Math.atan2(Math.sin(aim-e.dir),Math.cos(aim-e.dir)),limit=w.config.police.turnRate*Math.PI/180*dt;
    e.dir+=Math.max(-limit,Math.min(limit,delta));e.moveDir=e.dir;
    if(w.time+1e-9>=c.delay)startMirror(w,'police',0);
    return true;
  }
  if(!waiting&&c.policePolicy!=='intercept'&&departure!==undefined&&w.time>=departure+(c.policePolicy==='delayed'?c.delay:0)&&distance(e,target)<=c.range){startMirror(w,'police',evidence.from);return true;}
  const waypoint=w.map.waypoint(e,target,w.config.police.radius),d=distance(e,waypoint);
  if(d>M(.15)){
    const aim=Math.atan2(waypoint.y-e.y,waypoint.x-e.x),diff=Math.atan2(Math.sin(aim-e.moveDir),Math.cos(aim-e.moveDir)),limit=w.config.police.turnRate*Math.PI/180*dt;
    e.dir=e.moveDir+=Math.max(-limit,Math.min(limit,diff));
    const speed=run*w.config.police.speedScale*(e.tired?w.config.police.tiredScale:1);
    e.speed=Math.min(speed,e.speed+w.config.police.acceleration*dt);
    w.moveActor(e,Math.cos(e.dir)*Math.min(d,e.speed*dt),Math.sin(e.dir)*Math.min(d,e.speed*dt),w.config.police.radius,w.player,w.config.player.radius);
  }else e.speed=0;
  const mode='stand',a=w.config.capture[mode],aim=Math.atan2(w.player.y-e.y,w.player.x-e.x);
  if(e.visible&&e.cooldown<=0&&distance(e,w.player)<=a.trigger){e.dir=aim;w.startAttack(mode);}
  return true;
}
