import {RUN, metres as M} from './units.mjs';
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
export const MIRROR_BRANCHES={
  approach:['run-exit','teleport','evade'], casting:['continue','cancel'],
  landing:['return','forward','feint'], departure:['forward','turn-back','evade'],
  recovering:['wait'], sealed:['forward','evade'], 'police-followup':['follow','intercept','wait','fake']
};
export const COMMAND_LABELS={'run-exit':'直跑另一镜点',teleport:'发起传送',evade:'应对追击',continue:'维持施法',cancel:'取消并收招',return:'准备反传',forward:'前走转点',feint:'假前走', 'turn-back':'折返回镜',wait:'等待／守入口',follow:'跟传封镜',intercept:'截出口',fake:'假跟传守候'};
export function corridorPosition(point,points,width=M(2)){
  const [a,b]=points,dx=b.x-a.x,dy=b.y-a.y,len2=dx*dx+dy*dy;
  const along=((point.x-a.x)*dx+(point.y-a.y)*dy)/len2;
  const lateral=Math.abs((point.x-a.x)*dy-(point.y-a.y)*dx)/Math.sqrt(len2);
  return {along,lateral,inside:along>=0&&along<=1&&lateral<=width};
}
// Reusable arbitration: legal gates -> per-offer probability -> highest priority
// -> weighted draw. A command survives lower-priority proposals until expiry.
export class CommandDirector {
  constructor(random,actor='player'){this.random=random;this.actor=actor;this.current=null;this.pending=[];this.next=0;this.node=null;}
  issue(action,{priority=50,probability=1,weight=1,duration=.6}={}){
    if(!Object.values(MIRROR_BRANCHES).flat().includes(action))throw Error('Unknown mirror command: '+action);
    if(![priority,probability,weight,duration].every(Number.isFinite)||probability<0||probability>1||weight<0||duration<0||duration>10)throw Error('Invalid command options');
    this.pending.push({action,priority,probability,weight,duration});
  }
  decide(w,node,offers,context={}){
    const changed=this.node!==node;
    if(!changed&&w.time<this.next&&!this.pending.length)return this.current;
    this.node=node;this.next=w.time+(node==='casting'?.1:.4);
    const configured=w.config.mirror.ai.integration.rules?.[node]??{};
    const candidates=offers.map(o=>({priority:10,weight:1,probability:1,duration:.65,...o,...configured[o.action],allowed:o.allowed}));
    const external=this.pending.splice(0).map(o=>({...o,allowed:offers.some(x=>x.action===o.action&&x.allowed),source:'issued'}));
    const all=[...candidates,...external];
    const eligible=all.filter(o=>o.allowed&&o.weight>0&&this.random()<o.probability);
    const previous=this.current;
    if(!changed&&previous&&previous.until>w.time&&offers.some(o=>o.action===previous.action&&o.allowed))eligible.push({...previous,weight:1,source:'current'});
    let chosen=null;
    if(eligible.length){const priority=Math.max(...eligible.map(o=>o.priority));
      // Equal-priority offers cannot churn an unexpired current instruction.
      chosen=eligible.find(o=>o.source==='current'&&o.priority===priority);
      if(!chosen){const group=eligible.filter(o=>o.priority===priority);let draw=this.random()*group.reduce((sum,o)=>sum+o.weight,0);chosen=group.find(o=>(draw-=o.weight)<=0)??group.at(-1);}
    }
    this.current=chosen?{action:chosen.action,priority:chosen.priority,until:chosen.source==='current'?chosen.until:w.time+chosen.duration}:null;
    const stats=w.mirror.branchStats??={nodes:{},transitions:{}};
    const row=stats.nodes[node]??={visits:0,evaluations:0,actions:{}};row.visits+=+changed;row.evaluations++;
    for(const o of candidates){const a=row.actions[o.action]??={offered:0,eligible:0,selected:0};a.offered++;a.eligible+=+o.allowed;}
    if(chosen){row.actions[chosen.action]??={offered:0,eligible:0,selected:0};row.actions[chosen.action].selected++;}
    const identity=node+':'+(chosen?.action??'none');
    if(this.lastIdentity!==identity){if(this.lastIdentity){const key=this.lastIdentity+' -> '+identity;stats.transitions[key]=(stats.transitions[key]??0)+1;}this.lastIdentity=identity;}
    w.emit('mirror-decision',{actor:this.actor,node,action:chosen?.action??null,previous:previous?.action??null,
      candidates:all.map(o=>({action:o.action,allowed:o.allowed,reason:o.reason??'issued',priority:o.priority,weight:o.weight,probability:o.probability})),context});
    return this.current;
  }
}
export function getCommandDirector(w,mind){
  if(!mind.director){let state=(w.seed^(mind.who==='police'?0x5e9471:0x6e5471))>>>0;
    mind.director=new CommandDirector(()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;},mind.who);
  }
  return mind.director;
}
export function issueMirrorCommand(w,action,options={}){
  const actor=options.actor??'player';if(!['player','police'].includes(actor))throw Error('Invalid actor');
  const mind=w.mirror?.minds?.[actor];
  if(!w.config.mirror?.ai?.integration||!mind)throw Error('Mirror integration is not enabled');
  getCommandDirector(w,mind).issue(action,options);
}
function routeLength(w,from,to,radius){const route=w.map.route(from,to,radius);return route.length?route.reduce((s,p,i)=>s+distance(i?route[i-1]:from,p),0):Infinity;}
export function integrationPlayerInput(w,mind,fallback){
  const c=w.config.mirror,m=w.mirror,p=w.player,e=mind.enemy(w),state=m.player;
  const director=getCommandDirector(w,mind),plan=mind.integrationPlan??={endpoint:0,departed:false};
  const fresh=!!mind.observation?.enemy&&e&&w.time-e.seenAt<.6;
  const nearest=c.points.reduce((best,point,i)=>distance(p,point)<distance(p,c.points[best])?i:best,0);
  const near=distance(p,c.points[nearest])<=c.range;
  const speed=RUN*w.config.police.speedScale;
  const hitETA=point=>e?Math.min(...['stand','lunge'].map(mode=>Math.max(0,routeLength(w,e,point,w.config.police.radius)-w.config.capture[mode].trigger)/speed+w.config.capture[mode].windup)):0;
  const recovery=fresh&&e.attack?.phase==='recovery'?Math.max(0,e.attack.recoveryRemaining-(w.time-e.seenAt)):0;
  const safe=fresh&&hitETA(p)+recovery>c.playerWindup+c.ai.castMargin;
  const entryTravel=routeLength(w,p,c.points[nearest],w.config.player.radius)/(RUN*(p.exhausted?w.config.player.walkScale:1));
  const entrySafe=fresh&&hitETA(c.points[nearest])+recovery>entryTravel+c.playerWindup+c.ai.castMargin;
  const corridor=fresh?corridorPosition(e,c.points,c.ai.integration.corridorWidth??M(2)):null;
  if(state?.phase==='landing'&&!state.cancelled){
    const token=state.from+':'+state.until;
    if(plan.arrival!==token){plan.arrival=token;plan.endpoint=1-state.from;plan.departed=false;plan.feintAt=null;plan.routeDone=false;director.node=null;}
  }
  if(state?.cancelled)plan.cancelUntil=state.until+c.playerWindup;
  let node=state?.phase==='windup'?'casting':state?.cancelled?'recovering':m.sealed?'sealed':m.used.some(Boolean)?(plan.departed?'departure':'landing'):'approach';
  const origin=state?.from??plan.endpoint,exit=c.points[1-origin];
  const cutting=fresh&&e.speed>M(.2)&&Math.cos(e.moveDir-Math.atan2(exit.y-e.y,exit.x-e.x))>.4;
  const cancelSafe=fresh&&hitETA(p)+recovery>c.playerRecovery+c.ai.castMargin;
  const exitRisk=fresh&&hitETA(exit)<Math.max(0,(state?.until??w.time)-w.time)+c.playerRecovery;
  const canReturn=!m.sealed&&!m.used[plan.endpoint];
  const runTime=routeLength(w,p,c.points[1-nearest],w.config.player.radius)/RUN;
  const runSafe=fresh&&!p.exhausted&&p.stamina>=w.config.player.runDrain*runTime&&hitETA(c.points[1-nearest])>runTime+.2;
  const guard=fresh&&distance(e,c.points[1-plan.endpoint])<M(4);
  const cautious=c.ai.integration.riskAware===true;
  const returnSafe=!cautious||safe&&!guard;
  const backTime=routeLength(w,p,c.points[plan.endpoint],w.config.player.radius)/RUN+c.playerWindup+c.ai.castMargin;
  const backSafe=!cautious||fresh&&!guard&&hitETA(c.points[plan.endpoint])+recovery>backTime;
  const candidate=(action,allowed,reason,weight=1)=>({action,allowed:!!allowed,reason,weight});
  let offers;
  if(node==='approach')offers=[candidate('run-exit',runSafe&&!plan.walkedAcross,'到另一镜点的跑动时间与敌方接近时间比较'),candidate('teleport',entrySafe&&!m.used[nearest]&&w.time>=(plan.cancelUntil??0),'接近镜点路程加施法时间、取消后再决策间隔与剩余次数'),candidate('evade',true,'保留普通追逐应对',.25)];
  if(node==='casting')offers=[candidate('continue',true,'保持已承诺施法'),candidate('cancel',c.cancelMode!=='disabled'&&corridor?.inside&&cutting&&cancelSafe&&exitRisk,'仅连线走廊内、轨迹斜切且取消收招可承受时考虑',2)];
  if(node==='landing')offers=[candidate('return',canReturn&&fresh&&returnSafe,'落地时规划反传；谨慎策略额外排除守候与入口时间不足',guard?.15:2),candidate('forward',true,'前走转点'),candidate('feint',canReturn&&fresh,'先前走再观察是否回镜',1.5)];
  if(node==='departure')offers=[candidate('forward',true,'继续拉距离'),candidate('turn-back',canReturn&&fresh&&backSafe&&e.speed>M(.2)&&distance(p,c.points[plan.endpoint])<M(8)&&(plan.returning||distance(p,c.points[plan.endpoint])>M(2)),'看到敌方移动，先离镜1.5m再考虑折返；谨慎策略核算回镜与施法耗时',plan.feintAt!==null?4:1),candidate('evade',true,'近身交锋优先保留应对',.2)];
  if(node==='recovering')offers=[candidate('wait',true,'取消收招不可行动')];
  if(node==='sealed')offers=[candidate('forward',true,'已封镜，继续追逐'),candidate('evade',true,'按普通追逐逻辑应对')];
  if(!state&&fresh&&e.attack&&e.attack.phase!=='recovery'){
    offers=offers.filter(o=>o.action!=='evade');offers.push({...candidate('evade',true,'已观察到攻击，紧急应对'),priority:100});
  }
  // Emergency remains a hard priority unless explicitly overridden by a legal issued command.
  const chosen=director.decide(w,node,offers,{seenAt:e?.seenAt??null,corridor,cancelSafe,exitRisk,entrySafe,entryTravel,guard,runSafe});
  let action=chosen?.action??'evade';
  mind.record(w,'command-'+action,`${node}：${COMMAND_LABELS[action]}`);
  const move=target=>{const waypoint=w.map.waypoint(p,target,w.config.player.radius),d=distance(p,waypoint);return d>.05?{x:(waypoint.x-p.x)/d,y:(waypoint.y-p.y)/d}:{x:0,y:0};};
  if(state)return action==='cancel'?{cancelMirror:true}:{x:0,y:0};
  if(w.phase()!=='ready')return fallback();
  if(action==='teleport')return near?{mirror:true}:move(c.points[nearest]);
  if(action==='run-exit'){
    plan.runTarget??=1-nearest;
    if(distance(p,c.points[plan.runTarget])<=c.range){plan.walkedAcross=true;plan.runTarget=null;director.current=null;director.next=0;return fallback();}
    return move(c.points[plan.runTarget]);
  }
  plan.runTarget=null;
  if(action==='return'||action==='turn-back'){
    if(action==='turn-back')plan.returning=true;
    if(!canReturn)return fallback();
    return distance(p,c.points[plan.endpoint])<=c.range?{mirror:true}:move(c.points[plan.endpoint]);
  }
  if(action==='forward'||action==='feint'){
    plan.returning=false;
    if(m.used.some(Boolean)){
      plan.departed=true;if(action==='feint')plan.feintAt??=w.time;
      const a=c.points[1-plan.endpoint],b=c.points[plan.endpoint],d=distance(a,b);
      const target={x:b.x+(b.x-a.x)/d*M(6),y:b.y+(b.y-a.y)/d*M(6)};
      if(distance(p,target)<=M(.5))plan.routeDone=true;
      if(!plan.routeDone&&w.map.free(target,w.config.player.radius))return move(target);
    }
    return fallback();
  }
  return fallback();
}
export function validateIntegration(c){
 const integration=c.mirror?.ai?.integration;if(integration===undefined)return [];
 if(!integration||typeof integration!=='object'||Array.isArray(integration))return ['mirror.ai.integration must be an object'];
 const errors=[];
 if(integration.riskAware!==undefined&&typeof integration.riskAware!=='boolean')errors.push('integration.riskAware invalid');
 if(integration.corridorWidth!==undefined&&(!Number.isFinite(integration.corridorWidth)||integration.corridorWidth<=0||integration.corridorWidth>M(10)))errors.push('integration.corridorWidth invalid');
 for(const [node,rules] of Object.entries(integration.rules??{})){
  if(!MIRROR_BRANCHES[node]||!rules||typeof rules!=='object'){errors.push('integration node invalid: '+node);continue;}
  for(const [action,rule] of Object.entries(rules)){
   if(!MIRROR_BRANCHES[node].includes(action)||!rule||typeof rule!=='object'){errors.push('integration action invalid: '+action);continue;}
   for(const [key,value] of Object.entries(rule))if(!['priority','probability','weight','duration'].includes(key)||!Number.isFinite(value)||value<0||(key==='probability'&&value>1)||(key==='duration'&&value>10))errors.push('integration rule invalid: '+key);
  }
 }
 return errors;
}
