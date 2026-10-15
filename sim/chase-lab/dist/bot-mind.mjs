import { metres as M } from './units.mjs';
import {resolveOpenDuel} from './open-duel-runtime.mjs';
import {HUMAN_STRATEGIES} from './open-duel-config.mjs';
import {operationParameters} from './ai-operation.mjs';
import { BASE, RUN, RNG, MODES, dist, facing, angleDiff, clamp, attackWindup } from './ai-rules.mjs';
export const POLICIES = { retreat: '无资源后撤', footwork: '无资源绕身', reactive: '见红后撤闪避', anticipate: '提前预判闪避', perfect: '目押完美', adaptive: '玩家倾向 / 学习', oracle: '已知偏科（对照）' };
export class Bot {
  constructor(config, seed = 1, policy = 'adaptive', knownMode = null) {
    config=resolveOpenDuel(config,seed);if(config.duel?.selection)policy=HUMAN_STRATEGIES[config.duel.human].policy;
    this.config = config; this.policy = policy; this.knownMode = knownMode;
    this.rng = new RNG(seed ^ 0xa3bc91); this.delay = config.reaction.mean;
    this.history = []; this.lastObservation = null; this.delays = []; this.counts = Object.fromEntries(MODES.map(m => [m, 1]));
    this.seenAttacks = new Set(); this.handled = new Set(); this.nextDecision = 0; this.route = null; this.side = this.rng.next() < .5 ? -1 : 1;
    this.lastDodgeAt = -10; this.lastKnown = null; this.input = { x: 1, y: 0, dodge: false }; this.nextRouteAt = 0; this.intent = '选择路线';
    this.timingPlans=[];
  }
  dominant() { return this.knownMode || MODES.reduce((a, b) => this.counts[a] > this.counts[b] ? a : b); }
  chooseRoute(o, map) {
    const p = o.player, e = o.police || this.lastKnown;
    if(map.layout==='open'){const direction=e?facing(e,p):p.dir;this.route={x:p.x+Math.cos(direction)*20,y:p.y+Math.sin(direction)*20};this.nextRouteAt=o.time+1.5;return;}
    const candidates = map.nodes.filter(n => dist(n, p) > map.width * .6);
    let best = null, score = -Infinity;
    for (const n of candidates) {
      const path = map.route(p, n, this.config.player.radius + M(.35));
      if (!path.length) continue;
      const wp = path[0];
      const pathLength = path.reduce((sum, point, i) => sum + dist(i ? path[i - 1] : p, point), 0);
      const travel = dist(p, wp), separation = e ? dist(n, e) : 0;
      const toward = e ? Math.cos(angleDiff(facing(p, wp), facing(p, e))) : 0;
      const hidden = e && !map.clear(e, n) ? 1 : 0;
      const s = separation * .15 - pathLength * .55 - Math.max(0, toward) * M(10) + hidden * M(14 - this.config.exposure * 7) + Math.min(M(2), travel);
      if (s > score) { best = n; score = s; }
    }
    this.route = best || { x: -p.x, y: -p.y }; this.nextRouteAt = o.time + 1.5;
  }
  step(context) {
    this.actionFeedback=context.feedback;
    // Only this adapter reads current world. The decision method receives delayed public observations.
    const interval = Math.max(1, Math.round(1 / (BASE.dt * this.config.reaction.decisionHz)));
    if (context.tick % interval === 0) {
      const operation=operationParameters(this.config);
      const delay = clamp(this.rng.normal(operation.mean, operation.jitter), .025, 1);
      this.delays.push(delay); this.delay = delay;
      this.history.push({ ready: context.tick + Math.ceil(delay / BASE.dt), observation: {tick:context.tick,time:context.time,player:context.player,police:context.perception.enemy} });
    }
    for (const packet of this.history) if (packet.ready <= context.tick && (!this.lastObservation || packet.observation.tick > this.lastObservation.tick)) this.lastObservation = packet.observation;
    this.history = this.history.filter(p => p.ready > context.tick);
    if (!this.lastObservation) return { x: 0, y: 0, dodge: false };
    const o = this.lastObservation;
    if (context.tick < this.nextDecision) return { ...this.input, dodge: false };
    this.nextDecision = context.tick + interval;
    // Proprioception is current; visual reaction delay applies only to external observations.
    const p = context.player;
    const observed = { ...o, player: { x: p.x, y: p.y, dir: p.dir, stamina: p.stamina, phase: context.phase() } };
    this.input = this.decide(observed, context.map, context.time); return this.input;
  }
  decide(o, map, now = o.time) {
    const p = o.player, e = o.police ? { ...o.police } : null;
    // Extrapolate only publicly observed motion, never the real current enemy position.
    if (e && !e.attack) {
      const age = clamp(now - o.time, 0, .35);
      map.move(e, Math.cos(e.moveDir) * e.speed * age, Math.sin(e.moveDir) * e.speed * age, this.config.police.radius);
    }
    if (e) this.lastKnown = { x: e.x, y: e.y };
    if (!this.route || dist(p, this.route) < M(1) || now >= this.nextRouteAt) this.chooseRoute({ ...o, time: now, police: e }, map);
    const wp = map.waypoint(p, this.route, this.config.player.radius + M(.35));
    this.waypoint = wp;
    this.intent = e && !map.clear(e, this.route) ? '借转角遮挡，争取断线' : '沿可通行路线拉开距离';
    let direction = facing(p, wp), dodge = false, recoveryWalk = false;
    if (e?.attack && !this.seenAttacks.has(e.attack.id)) {
      this.seenAttacks.add(e.attack.id); this.counts[e.attack.mode]++;
      if(this.config.duel){
        const operation=operationParameters(this.config);
        this.timingError=this.rng.normal(0,operation.timingSigma);this.inputLapse=this.rng.next()<operation.lapseProbability;
        if(this.inputLapse)this.handled.add(e.attack.id);
        const windup=attackWindup(this.config,e.attack.mode),lead=HUMAN_STRATEGIES[this.config.duel.human]?.safetyLead??0;
        this.timingPlan={id:e.attack.id,mode:e.attack.mode,observedAt:now,observedElapsed:e.attack.elapsed+now-o.time,
          pressure:operation.pressure,safetyLead:lead,plannedElapsed:windup-this.config.dodge.startup-this.config.dodge.perfectDelay-this.config.dodge.perfectDuration/2-lead,
          timingError:this.timingError,lapse:this.inputLapse,windup};
        this.timingPlan.targetElapsed=this.timingPlan.plannedElapsed+this.timingError;
        this.timingPlans.push(this.timingPlan);
      }
    }
    if (e) {
      const away = facing(e, p), d = dist(e, p), a = e.attack;
      if (d < M(1.2) && !a && Math.cos(angleDiff(direction, away)) < -.2) direction = away + this.side * .7;
      if (this.policy === 'retreat') direction = away;
      if (this.policy === 'footwork' && d < M(4)) direction = away + this.side * (Math.PI / 2 + clamp((d / M(1) - .9) * .5, -.3, .5));
      const cooldown = this.config.dodge.startup + this.config.dodge.duration + this.config.dodge.recovery + .15;
      const can = p.phase === 'ready' && p.stamina >= this.config.dodge.cost && now - this.lastDodgeAt > cooldown;
      const fresh = a && !this.handled.has(a.id) && ['windup', 'committed'].includes(a.phase);
      // Commit from delayed visible information; do not switch to a guaranteed dodge at the last instant.
      const closeTactic=HUMAN_STRATEGIES[this.config.duel?.human]?.tactic??this.config.duel?.human;
      const spinEnabled=['spin','close_mix'].includes(closeTactic);
      if(spinEnabled&&fresh&&a.mode==='lunge'&&d<1.65&&!this.inputLapse&&this.spinAttack!==a.id){this.spinAttack=a.id;this.handled.add(a.id);if(this.timingPlan?.id===a.id)this.timingPlan.choice='spin';}
      const spinning=spinEnabled&&a&&a.id===this.spinAttack&&['windup','committed'].includes(a.phase);
      const anticipation = ['anticipate', 'adaptive', 'oracle'].includes(this.policy);
      const dominant = this.dominant(), seen = this.seenAttacks.size;
      const confident = this.policy === 'oracle' || (seen >= 3 && (this.counts[dominant] - 1) / seen >= 1 - this.config.behavior.learning * .55);
      const nervous=HUMAN_STRATEGIES[this.config.duel?.human]?.falseStart;
      const precision = !nervous&&(this.policy === 'perfect' || (this.policy === 'adaptive' && this.config.reaction.mean < .19 && this.config.behavior.perfectPreference >= .5));
      if (precision && !a && d < M(3)) direction = away + this.side * .5;
      const elapsed = a ? a.elapsed + now - o.time : 0;
      const windup=a?attackWindup(this.config,a.mode):this.config.capture.windup;
      const safetyLead=HUMAN_STRATEGIES[this.config.duel?.human]?.safetyLead??0;
      const perfectPress = windup - this.config.dodge.startup - this.config.dodge.perfectDelay - this.config.dodge.perfectDuration / 2-safetyLead+(this.config.duel?this.timingError??0:0);
      const waitPerfect = precision && fresh && elapsed < perfectPress;
      const trigger = this.config.duel?.human==='predict'?Math.max(...['stand','lunge'].map(m=>this.config.capture[m].trigger)): confident ? this.config.capture[dominant].trigger : Math.min(...MODES.map(m => this.config.capture[m].trigger));
      const closing = Math.max(0, e.speed * Math.cos(angleDiff(e.moveDir, away)) - RUN * Math.cos(angleDiff(direction, away)));
      const contactSoon = d <= trigger + closing * .18;
      let preempt = !nervous&&anticipation && !precision && !a && contactSoon && (this.policy !== 'adaptive' || this.rng.next() < this.config.behavior.anticipation);
      if(nervous){
        if(!a&&d<1.6&&can){
          if(this.falseStartAt===undefined)this.falseStartAt=now-Math.log(Math.max(1e-9,1-this.rng.next()))/(.3+1.5*(this.config.duel.pressure??0));
          preempt=now>=this.falseStartAt;
        }else if(a||d>2.2)this.falseStartAt=undefined;
        if(preempt)this.falseStartAt=undefined;
      }
      if (anticipation && !a && d < M(3)) this.intent = contactSoon ? '接近威胁距离，尝试预判' : '尚未接近出手距离，保留闪避';
      if (waitPerfect) this.intent = '等待短完美窗口';
      if (can && !spinning && !['runner', 'retreat', 'footwork'].includes(this.policy) && !waitPerfect && (fresh || preempt)) {
        dodge = true; if (a) this.handled.add(a.id); this.lastDodgeAt = now;
        if(a&&this.timingPlan?.id===a.id){this.timingPlan.pressedAt=now;this.timingPlan.pressedElapsed=elapsed;}
        if (this.policy === 'reactive') direction = away;
        else if (this.policy === 'sidestep') direction = away + Math.PI / 2 * this.side;
        else {
          // No hidden next mode or instantaneous position. Estimate opponent from delayed visible state.
          const guessed = a?.mode || (confident ? dominant : 'stand');
          const mode = this.config.capture[guessed];
          const remaining = Math.max(.02, attackWindup(this.config,guessed) - elapsed);
          const movingTime=Math.max(0,attackWindup(this.config,guessed)-Math.max(elapsed,mode.moveFrom??(guessed==='lunge'?mode.trackUntil:0)));
          const advance = Math.min(mode.moveScale * RUN * this.config.police.speedScale * movingTime,mode.stopGap!==undefined?Math.max(0,dist(e,p)-mode.stopGap):Infinity);
          const origin = { x: e.x + Math.cos(e.moveDir) * advance, y: e.y + Math.sin(e.moveDir) * advance };
          let best = -Infinity;
          for (let k = 0; k < 16; k++) {
            const angle = k * Math.PI / 8, end = { x: p.x, y: p.y };
            const length = RUN * this.config.dodge.multiplier * Math.min(this.config.dodge.duration, Math.max(.02, remaining - this.config.dodge.startup));
            map.move(end, Math.cos(angle) * length, Math.sin(angle) * length, this.config.player.radius);
            const aligned = Math.abs(angleDiff(facing(origin, end), a?.dir ?? e.dir));
            const lateral = Math.abs(Math.sin(angleDiff(angle, e.moveDir)));
            let s = dist(origin, end) + (guessed === 'sweep' ? 0 : aligned * M(.8)) + (guessed === 'stride' || guessed === 'lunge' ? lateral * M(.9) : 0);
            s -= dist(end, wp) * .04;
            if (dist(end, p) < length * .7) s -= M(5);
            if (s > best) { best = s; direction = angle; }
          }
          // Precision specialists commit tangentially; success must be a real contact in the short window.
          if (precision && fresh && elapsed <= windup - this.config.dodge.startup) direction = away + this.side * Math.PI / 2;
        }
        if(['reverse','close_mix'].includes(closeTactic)&&d<1.65){
          // Diagonal approach skirts the collision body; no phasing or forced search bonus.
          direction=away+this.side*Math.PI*.68;
          this.exitDirection=direction;this.exitUntil=now+this.config.dodge.duration+this.config.dodge.recovery;
          this.intent='近身斜向反闪绕后，争取回身时间';
        }
      }
      if(spinning){direction=away+this.side*(Math.PI/2+.25);this.intent='近身蓄力刀绕身，承担转向追踪风险';}
      if (this.policy === 'adaptive' && !dodge && !a && d < M(2.5) && this.config.behavior.footwork > .5 && confident && ['stride', 'lunge'].includes(dominant)) direction = away + this.side * Math.PI / 2;
    }
    if (this.config.search && ['adaptive', 'anticipate', 'oracle', 'perfect', 'reactive'].includes(this.policy) && !dodge) {
      const remaining = (e?.attack?.recoveryRemaining || 0) - (now - o.time);
      if (e?.attack?.phase === 'recovery' && remaining > 0) {
        // Full chases escape after a miss. Deliberate behind-the-back arcs belong to drills.
        const away = facing(e, p);
        if (Math.cos(angleDiff(direction, away)) < 0) {
          direction = Number.isFinite(p.dir) && Math.cos(angleDiff(p.dir, away)) > .1 ? p.dir : away;
        }
        recoveryWalk = remaining > .35 && p.phase === 'ready' && dist(p, e) > M(5) && p.stamina < 2 * this.config.dodge.cost;
        this.intent = recoveryWalk ? '安全距离沿逃跑路线步行回体' : '利用落空后摇，继续拉开距离';
      } else if (!e && p.stamina < this.config.player.staminaMax - 2) { recoveryWalk = true; this.intent = '目标不可见，安静步行转移回体'; }
    }
    if(this.config.duel&&!dodge){
      if(now<this.exitUntil){direction=this.exitDirection;this.intent='沿反闪方向离开，利用回身窗口';}
      const mode=this.config.duel.walkMode,remaining=(e?.attack?.recoveryRemaining||0)-(now-o.time);
      if(mode==='recovery')recoveryWalk=p.phase==='recovery'||(remaining>.25&&p.stamina<this.config.player.staminaMax*.95);
      if(mode==='conserve'||mode==='guard'){
        const walkClosing=e?Math.max(.1,e.speed-RUN*this.config.player.walkScale):Infinity;
        const threat=Math.max(...['stand','lunge'].map(m=>this.config.capture[m].trigger));
        const walkBudget=e?(dist(p,e)-threat)/walkClosing:0;
        recoveryWalk=p.phase==='recovery'||(remaining>.15&&p.stamina<this.config.player.staminaMax*.98)||(!e?.attack&&e&&walkBudget>this.config.reaction.mean+.18&&p.stamina<this.config.player.staminaMax*.85);
      }
      if(mode==='guard'&&e&&dist(p,e)<2.2&&p.phase==='ready'&&(!e.attack||['windup','committed'].includes(e.attack.phase))){
        recoveryWalk=true;this.intent='贴身持闪走动回体，等待可见出刀后按计划应对';
      }
      if(mode==='distance')recoveryWalk=false;
    }
    // Local wall avoidance; no access to unobserved police coordinates.
    if (!dodge) {
      // Keep sufficient room for the next decision; slide along a feasible direction instead of
      // falling back to the same blocked vector. This also handles street boundaries.
      const horizon = RUN * .25, margin = this.config.player.radius + M(.15);
      const ahead = { x: p.x + Math.cos(direction) * horizon, y: p.y + Math.sin(direction) * horizon };
      if (!map.clear(p, ahead, margin)) {
        let best = -Infinity, selected = direction;
        for (let k = 0; k < 24; k++) {
          const angle = k * Math.PI / 12, end = { x: p.x, y: p.y };
          map.move(end, Math.cos(angle) * horizon, Math.sin(angle) * horizon, this.config.player.radius);
          const travelled = dist(p, end);
          const score = travelled * 3 - dist(end, wp) + Math.cos(angleDiff(angle, direction)) * M(.4) - (map.free(end, margin) ? 0 : M(3));
          if (score > best) { best = score; selected = angle; }
        }
        direction = selected;
      }
    }
    if (dodge || this.policy === 'footwork') direction += this.rng.normal(0, this.config.behavior.motorErrorDegrees * Math.PI / 180);
    const walk = recoveryWalk || p.stamina < this.config.dodge.cost && (!e || dist(p, e) > M(5));
    return { x: Math.cos(direction), y: Math.sin(direction), dir: direction, dodge, walk };
  }
}
