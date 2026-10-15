import {Bot} from './bot-mind.mjs';
import {integrationPlayerInput,getCommandDirector} from './mirror-decisions.mjs';
import {RUN, metres as M} from './units.mjs';
const gap=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y),angle=(a,b)=>Math.atan2(b.y-a.y,b.x-a.x);
const diff=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
function rng(seed){let x=seed>>>0;return()=>{x=(Math.imul(x,1664525)+1013904223)>>>0;return x/4294967296;};}
export class MirrorMind {
  constructor(w,who){this.who=who;this.random=rng(w.seed^(who==='player'?0x91632:0x15761));this.queue=[];this.nextSample=0;this.nextDecision=0;this.observation=null;this.memory=null;this.choice=null;this.intent='等待观测';this.input={x:0,y:0};this.bot=who==='player'?new Bot({...w.config,reaction:{...w.config.reaction,mean:w.config.mirror.ai.playerDelay}},w.seed,'adaptive'):null;}
  ingest(w){
    this.actionFeedback=w.feedback;
    const c=w.config.mirror.ai;
    if(w.time+1e-9>=this.nextSample){
      this.nextSample=w.time+c.decisionInterval;
      const delay=Math.max(.025,c[`${this.who}Delay`]+(this.random()*2-1)*c.jitter);
      this.lastDelay=delay;
      this.queue.push({ready:w.time+delay,time:w.perception.observedAt,enemy:w.perception.enemy,heard:w.perception.heard});
    }
    for(const packet of this.queue)if(packet.ready<=w.time&&(!this.observation||packet.time>this.observation.time)){
      const lost=this.who==='police'&&this.observation?.enemy&&!packet.enemy;
      if(lost&&this.memory){
        const from=w.config.mirror.points.findIndex(point=>gap(point,this.memory)<M(3));
        if(from>=0&&w.config.mirror.ai.checkOtherMirror!==false){
          this.exitCheck={from,to:1-from,target:{...w.config.mirror.points[1-from]},started:w.time,notBefore:w.time+Math.max(0,(this.memory.castRemaining??0)-(w.time-this.memory.seenAt)),deadline:w.time+4,aimedAt:null};
          this.command=null;this.nextDecision=0;
          w.emit('mirror-ai',{actor:'police',choice:'suspect-exit',from,to:1-from,seenAt:this.memory.seenAt});
        }
      }
      this.observation=packet;if(packet.heard&&(!this.sound||packet.heard.t>this.sound.t))this.sound=packet.heard;
      if(packet.enemy){
        // Arrival and cancelled recovery have distinct visible animations.
        // Recognise only after a lawful sighting and the ordinary reaction delay.
        if(this.who==='police'&&packet.enemy.mirrorAction==='arrival-recovery'){
          const to=w.config.mirror.points.findIndex(point=>gap(point,packet.enemy)<M(3));
          if(to>=0&&this.transitEvidence?.to!==to)this.transitEvidence={from:1-to,to,time:w.time,observedAt:packet.time};
        }
        if(this.exitCheck){w.emit('mirror-ai',{actor:'police',choice:'exit-check-reacquired',from:this.exitCheck.from,to:this.exitCheck.to});this.exitCheck=null;this.command=null;this.nextDecision=0;}
        this.motionConfirmed=!!this.memory&&packet.time-this.memory.seenAt<=c.decisionInterval*2.5;
        if(this.memory){const old=this.memory,points=w.config.mirror.points,from=points.findIndex(p=>gap(p,old)<M(3)),to=points.findIndex(p=>gap(p,packet.enemy)<M(3));
          if(from>=0&&to>=0&&from!==to&&gap(old,packet.enemy)>RUN*2*(packet.time-old.seenAt)+M(2))this.transitEvidence={from,to,time:w.time,observedAt:packet.time};}
        this.memory={...packet.enemy,seenAt:packet.time};
      }
    }
    this.queue=this.queue.filter(p=>p.ready>w.time);
  }
  record(w,choice,reason){if(this.choice!==choice){
    if(this.who==='police'&&w.config.mirror.ai.integration){
      const stats=w.mirror.policeBranches??={choices:{},transitions:{}};
      stats.choices[choice]=(stats.choices[choice]??0)+1;
      if(this.choice){const edge=this.choice+' -> '+choice;stats.transitions[edge]=(stats.transitions[edge]??0)+1;}
    }
    if(this.recordEvent?.tick===w.tick)Object.assign(this.recordEvent,{choice,reason});
    else{w.emit('mirror-ai',{actor:this.who,choice,reason,seenAt:this.memory?.seenAt??null});this.recordEvent=w.events.at(-1);}
    this.choice=choice;
  }this.intent=reason;}
  enemy(w){if(!this.memory||w.time-this.memory.seenAt>2)return null;const e={...this.memory};
    const dt=Math.min(this.who==='police'?.5:.3,Math.max(0,w.time-e.seenAt));if(!e.attack&&!e.casting&&!e.landing)w.map.move(e,Math.cos(e.moveDir)*e.speed*dt,Math.sin(e.moveDir)*e.speed*dt,w.config[this.who==='player'?'police':'player'].radius);return e;}
  player(w){
    if(w.time<this.nextDecision)return {...this.input,dodge:false};this.nextDecision=w.time+w.config.mirror.ai.decisionInterval;
    const p=w.player,m=w.mirror,c=w.config.mirror,a=c.ai,e=this.enemy(w),state=m.player;
    const fallback=()=>this.bot.decide({time:this.observation?.time??w.time,player:{...p,phase:w.phase()},police:this.observation?.enemy??null},w.map,w.time);
    let input={x:0,y:0};
    if(!this.observation){this.input=input;return input;}
    if(a.integration){this.input=integrationPlayerInput(w,this,fallback);return this.input;}
    const approaching=(enemy,point)=>{
      if(!enemy)return Infinity;
      const speed=RUN*w.config.police.speedScale;
      // Conservative charge reach: no oracle knowledge of next attack mode.
      return Math.min(...['stand','lunge'].map(mode=>Math.max(0,gap(enemy,point)-w.config.capture[mode].trigger)/speed+w.config.capture[mode].windup));
    };
    const exitThreat=(index,remaining)=>{
      if(!e)return true;
      const exit=c.points[1-index],near=gap(e,exit),toward=Math.cos(diff(e.moveDir,angle(e,exit)));
      // With an irrevocable cast, a currently stationary opponent can still
      // choose to cut to the exit. Evaluate that public geometric option first.
      const route=w.map.route(e,exit,w.config.police.radius);
      const travel=route.length?route.reduce((sum,p,i)=>sum+gap(i?route[i-1]:e,p),0):Infinity;
      if(e.speed<M(.2)&&travel/(RUN*w.config.police.speedScale)<remaining+c.playerRecovery+a.castMargin)return true;
      return near<M(3)||(e.speed>M(2)&&toward>.75&&Math.max(0,near-M(2))/e.speed<remaining+c.playerRecovery+a.castMargin);
    };
    if(state){
      const cutting=e&&e.speed>M(.2)&&Math.cos(diff(e.moveDir,angle(e,c.points[1-state.from])))>.65;
      if(state.phase==='windup'&&c.cancelMode!=='disabled'&&cutting&&exitThreat(state.from,state.until-w.time)&&approaching(e,p)>c.playerRecovery+a.castMargin){
        input={cancelMirror:true};this.abortedAt=w.time;this.record(w,'cancel','出口受威胁且入口可承受收招，取消后留在原地恢复');
      }else this.record(w,state.phase==='windup'?'cast':state.cancelled?'cancel-recovery':'landing',state.phase==='windup'?'维持施法，比较完成与取消风险':state.cancelled?'取消收招中：不能行动，体力冻结':'等待落地恢复');
    }else{
      input=fallback();
      this.landedAt??=m.used.some(Boolean)?w.time:undefined;
      const nearest=c.points.findIndex(point=>gap(p,point)<=c.range);
      if(!m.sealed&&nearest>=0&&!m.used[nearest]&&w.phase()==='ready'&&w.time-(this.abortedAt??-100)>c.playerWindup+c.playerRecovery){
        const recovery=e?.attack?.phase==='recovery'?Math.max(0,e.attack.recoveryRemaining-(w.time-e.seenAt)):0;
        const safe=e&&approaching(e,p)+recovery>c.playerWindup+a.castMargin;
        if(!m.used.some(Boolean)&&safe&&!exitThreat(nearest,c.playerWindup)){input={x:0,y:0,mirror:true};this.record(w,'enter','入口距离足够，传送节省跑动体力');}
        else if(m.used.some(Boolean)&&safe&&e){
          const dest={...c.points[1-nearest],y:c.points[1-nearest].y+M(.8)};
          const predicted={x:e.x,y:e.y};
          w.map.move(predicted,Math.cos(e.moveDir)*e.speed*c.playerWindup,Math.sin(e.moveDir)*e.speed*c.playerWindup,w.config.police.radius);
          const returnGap=gap(predicted,dest)-RUN*w.config.police.speedScale*c.playerRecovery;
          // Escape route gains during the same interval; a return must exceed this opportunity cost.
          const escapeGap=gap(e,p)+(RUN-RUN*w.config.police.speedScale)*(c.playerWindup+c.playerRecovery);
          const guard=gap(e,c.points[1-nearest])<M(4);
          if(!guard&&!exitThreat(nearest,c.playerWindup)&&returnGap+a.staminaValue*w.config.player.runDrain*(c.playerWindup+c.playerRecovery)>escapeGap+a.returnMargin){input={x:0,y:0,mirror:true};this.record(w,'return','对手已接近出口，反传的距离与省体力收益更有利');}
          else if(w.time-(this.landedAt??0)<a.observeSeconds&&e.speed>M(2)&&Math.cos(diff(e.moveDir,angle(e,p)))>.8){input={x:0,y:0,walk:true};this.record(w,'observe','短暂观察是否截出口，保留反传选择');}
          else this.record(w,'leave',guard?'对手仍守另一端，拒绝贸然反传':'反传收益不足，提前转点');
        }else this.record(w,'evade','入口时间不足，先移动或闪避再找机会');
      }else this.record(w,input.dodge?'dodge':input.walk?'recover':'leave',input.dodge?'正常应对近身攻击':input.walk?'安全距离静步恢复':'沿可通行路线转点');
      // Recovery choice uses observed commitment, never private follow windup.
      if(m.sealed&&e&&!input.dodge&&p.stamina<75&&gap(e,p)>M(5)){input.walk=true;this.record(w,'recover','已封镜且间距安全，静步恢复');}
      if(m.sealed&&e&&!input.dodge&&w.phase()==='ready'&&this.transitEvidence&&e.speed<M(.2)){
        const remaining=c.policeRecovery-(w.time-this.transitEvidence.observedAt);
        const behind={x:e.x-Math.cos(e.dir)*M(2),y:e.y-Math.sin(e.dir)*M(2)};
        const alreadyBehind=Math.cos(diff(angle(e,p),e.dir))<-.4;
        if(remaining>.25&&gap(e,p)<M(5)&&(alreadyBehind||gap(p,behind)/(RUN*w.config.player.walkScale)+.2<remaining)&&w.map.clear(p,behind,w.config.player.radius+M(.1))){
          const dir=alreadyBehind?angle(e,p):angle(p,behind);input={x:Math.cos(dir),y:Math.sin(dir),walk:true};this.record(w,'quiet-reverse','已确认对手出镜锁向且时间足够，静步换到背侧');
        }
      }
    }
    this.input=input;return input;
  }
  police(w){
    const m=w.mirror,c=w.config.mirror,a=c.ai,e=w.police,p=this.enemy(w);
    if(w.time<this.nextDecision)return this.command??{kind:'wait'};
    this.nextDecision=w.time+a.decisionInterval;
    if(!this.observation)return this.command={kind:'wait'};
    const move=(target,choice,reason)=>{this.record(w,choice,reason);return this.command={kind:'move',target:{x:target.x,y:target.y},enemy:p};};
    const check=this.exitCheck;
    if(check&&w.time>=check.notBefore){
      if(w.time>=check.deadline){this.exitCheck=null;this.record(w,'exit-check-empty','另一镜点检查未确认目标，返回证据搜索');}
      else{
        const aligned=Math.abs(diff(angle(e,check.target),e.dir))<Math.PI/12;
        if(!aligned&&check.aimedAt===null){this.record(w,'check-exit','镜点附近丢失目标，优先转向另一镜点确认');return this.command={kind:'look',target:check.target};}
        check.aimedAt??=w.time;
        if(w.time-check.aimedAt<a.policeDelay+a.jitter+a.decisionInterval){this.record(w,'check-exit','等待另一镜点的延迟视觉确认');return this.command={kind:'look',target:check.target};}
        if(gap(e,check.target)>M(.8))return move(check.target,'investigate-exit','另一镜点尚未确认目标，接近检查出口');
        this.exitCheck=null;this.record(w,'exit-check-empty','已到另一镜点，转入普通证据搜索');
      }
    }
    if(p?.casting&&a.castResponse&&a.castResponse!=='adaptive'){
      const from=c.points.reduce((best,point,i)=>gap(p,point)<gap(p,c.points[best])?i:best,0);
      this.castSeenAt??=w.time;
      const cut=a.castResponse==='intercept'||a.castResponse==='feint'&&w.time-this.castSeenAt<.45;
      return move(cut?c.points[1-from]:p,cut?'cut-exit':'pressure-cast',cut?'看到施法，斜切出口':'压入口，惩罚取消收招');
    }else this.castSeenAt=null;
    if(!p&&this.sound&&w.time-this.sound.t<2&&gap(e,this.sound)>M(.6))return move(this.sound,'sound','调查延迟获知的实际脚步声位置');
    if(p&&gap(e,p)<w.config.capture.lunge.trigger+M(.5))return move(p,'pressure','基于已见位置逼近，优先抓施法或落地');
    if(m.sealed)return p?move(p,'chase','镜子已封，按最后目击继续追逐'):this.command={kind:'scan'};
    const near=p?c.points.reduce((best,point,i)=>gap(p,point)<gap(p,c.points[best])?i:best,0):null;
    // Infer endpoint usage only from actual delayed sightings; no m.last, m.first or player charges.
    if(this.transitEvidence&&this.departure!==this.transitEvidence){this.departure=this.transitEvidence;this.selected=null;this.holdUntil=null;}
    if(!this.departure){
      if(p?.casting&&gap(e,c.points[1-near])+M(2)<gap(e,c.points[near])+RUN*w.config.police.speedScale*c.policeWindup)return move(c.points[1-near],'intercept','看到施法且斜切出口更近，抢落地');
      return p?move(p,'approach','尚未确认传送，按目击接近入口'):this.command={kind:'scan'};
    }
    const origin=c.points[this.departure.from],exit=c.points[this.departure.to];
    if(p&&gap(p,exit)>M(5)&&gap(p,origin)>M(5)&&['wait','fake'].includes(this.selected)){
      const routeLength=(from,to)=>w.map.route(from,to,w.config.police.radius).reduce((sum,q,i,route)=>sum+gap(i?route[i-1]:from,q),0);
      const speed=RUN*w.config.police.speedScale;
      const direct=routeLength(e,p)/speed,via=routeLength(e,origin)/speed+c.policeWindup+c.policeRecovery+routeLength(exit,p)/speed;
      this.selected=via<direct?'follow':'intercept';this.holdUntil=null;
    }
    // Do not reroll a committed interception back into guarding an old entry.
    // A newly observed transit above invalidates that commitment immediately.
    if(!this.selected||this.selected!=='intercept'&&w.time>=this.reconsiderAt||this.director?.pending.length){
      const speed=RUN*w.config.police.speedScale,follow=gap(e,origin)/speed+c.policeWindup+c.policeRecovery,intercept=gap(e,exit)/speed;
      const canGuard=gap(e,origin)<=c.range+speed*(a.commitSeconds+a.waitSeconds);
      const candidates=[['follow',a.followWeight/(.5+follow)],['intercept',a.interceptWeight/(.5+intercept)],['wait',canGuard?a.waitWeight/(1+gap(e,origin)/speed):0],['fake',canGuard?a.fakeWeight/(1+gap(e,origin)/speed):0]];
      if(a.integration){
        getCommandDirector(w,this);
        const command=this.director.decide(w,'police-followup',candidates.map(([action,weight])=>({action,weight,allowed:weight>0,reason:['wait','fake'].includes(action)?'能及时回到入口守候':'已从延迟目击确认传送',duration:a.commitSeconds+a.waitSeconds})),{seenAt:p?.seenAt??null,followETA:follow,interceptETA:intercept});
        this.selected=command?.action??'intercept';
      }else{let r=this.random()*candidates.reduce((s,x)=>s+x[1],0);this.selected=candidates.find(x=>(r-=x[1])<=0)?.[0]??'follow';}
      this.reconsiderAt=w.time+a.commitSeconds+a.waitSeconds;this.holdUntil=null;
      w.emit('mirror-ai',{actor:'police',choice:'select',strategy:this.selected,followETA:follow,interceptETA:intercept});
    }
    if(this.selected==='intercept'){
      if(!p&&this.memory){if(gap(e,this.memory)<M(.8))return this.command={kind:'scan'};return move(this.memory,'investigate','目标已离开镜点，调查最后目击而非停守出口');}
      return move(p&&gap(p,exit)>M(3)?p:exit,'intercept','普通路线截出口，保留追踪和改线');
    }
    if(gap(e,origin)>c.range)return move(origin,this.selected,'前往已确认的镜子入口');
    if(this.selected==='follow'){this.record(w,'follow','支付固定代价跟随封镜');return this.command={kind:'follow',from:this.departure.from};}
    this.holdUntil??=w.time+(this.selected==='fake'?c.policeWindup:a.waitSeconds);
    if(w.time>=this.holdUntil){this.selected='follow';this.record(w,'follow','等待未获得抓反传机会，止损封镜');return this.command={kind:'follow',from:this.departure.from};}
    this.record(w,this.selected,this.selected==='fake'?'保持与跟随准备相同的静止外观，诱导反传':'守入口观察，等待反传机会');
    return this.command={kind:'wait',enemy:p};
  }
}
