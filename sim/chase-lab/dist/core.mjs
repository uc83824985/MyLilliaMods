// Metres, seconds, radians. This module is shared by the browser and Node.
export const BASE = Object.freeze({ nativeRunSpeed: 3.143, globalScale: 2, dt: 1 / 120 });
export const RUN = BASE.nativeRunSpeed * BASE.globalScale;
export const MODES = ['stand', 'stride', 'sweep', 'lunge'];
export const LABELS = { stand: '贴身站定', stride: '行进直线', sweep: '定向横扫', lunge: '蓄力扑抓' };
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const facing = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
export const turn = (a, b, amount) => a + clamp(angleDiff(b, a), -amount, amount);
export const clone = x => JSON.parse(JSON.stringify(x));
export const attackWindup = (c,mode) => c.capture[mode]?.windup ?? c.capture.windup;
export function recoveryMoveScale(c,d) {
  if(c.dodge.recoveryCurve!=='linear'||!d)return c.dodge.recoveryScale;
  const duration=c.dodge.recovery*(d.used?c.perfectBonus.playerRecoveryScale:1);
  const progress=duration>0?clamp((d.elapsed-c.dodge.startup-c.dodge.duration)/duration,0,1):1;
  return c.dodge.recoveryScale+(1-c.dodge.recoveryScale)*progress;
}
export class RNG {
  constructor(seed = 1) { this.state = seed >>> 0; }
  next() { let t = this.state += 0x6D2B79F5; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }
  range(a, b) { return a + (b - a) * this.next(); }
  normal(mean, std) { return mean + std * Math.sqrt(-2 * Math.log(Math.max(1e-9, this.next()))) * Math.cos(2 * Math.PI * this.next()); }
}
export const DEFAULT = {
  name: '候选起点（未收敛）', duration: 40, exposure: .2, escapeSeconds: 3, memoryScale: 4, visionRange: 45,
  player: { radius: .3, staminaMax: 100, runDrain: 0, walkRegen: 20, walkScale: .5 },
  behavior: { anticipation: .7, perfectPreference: .65, footwork: .6, retreat: .3, learning: .7, motorErrorDegrees: 4 },
  dodge: { cost: 25, startup: .04, duration: .22, multiplier: 1.6, recovery: .4, recoveryScale: .35, perfectDelay: .04, perfectDuration: .06 },
  perfectBonus: { refund: 12, playerRecoveryScale: .65, policeRecoveryScale: 1.4 },
  police: { radius: .32, speedScale: 1.1, acceleration: 24, turnRate: 260, staminaMax: 100, drain: 8, regen: 23, tiredScale: .62, resumeAt: .55 },
  capture: { windup: .3, missRecovery: .48, cooldown: .1,
    stand: { trigger: .85, radius: 3, angle: 100, moveScale: 0, active: 0, sweep: 0, trackUntil: .29, turnRate: 720 },
    stride: { trigger: 1.5, radius: 1.8, angle: 90, moveScale: 1, active: 0, sweep: 0, trackUntil: .15, turnRate: 240 },
    sweep: { trigger: 1.1, radius: 2.8, angle: 65, moveScale: .15, active: .12, sweep: 130, trackUntil: 0, turnRate: 0 },
    lunge: { trigger: 2.4, radius: 2.1, angle: 65, moveScale: 2.2, active: 0, sweep: 0, trackUntil: .15, turnRate: 180 }
  },
  weights: { stand: 1, stride: 1, sweep: 1, lunge: 1 },
  reaction: { mean: .22, jitter: .04, decisionHz: 30 }, spawn: 'street'
};
export function legacyConfig() {
  const c = clone(DEFAULT); c.name = '0.1.3 几何基线';
  Object.assign(c.dodge, { cost: 50, duration: .3, multiplier: 2, recovery: .6, recoveryScale: .1 });
  Object.assign(c.capture, { missRecovery: .85 });
  Object.assign(c.capture.stand, { trigger: 1.8, radius: 2, angle: 90, trackUntil: .15, turnRate: 180 });
  Object.assign(c.perfectBonus, { refund: 0, playerRecoveryScale: 1, policeRecoveryScale: 1 });
  c.weights = { stand: 1, stride: 0, sweep: 0, lunge: 0 }; return c;
}
export function validate(c) {
  const errors = [];
  if(c.search?.moveScale!==undefined&&(!Number.isFinite(c.search.moveScale)||c.search.moveScale<0||c.search.moveScale>3))errors.push('search.moveScale: 需在0–3之间');
  if(c.mapLayout!==undefined&&!['grid','ring'].includes(c.mapLayout))errors.push('地图布局必须为grid或ring');
  if(c.dodge?.recoveryCurve!==undefined&&!['constant','linear'].includes(c.dodge.recoveryCurve))errors.push('闪避恢复曲线须为constant或linear');
  if(c.stealth)for(const [key,min,max] of [['duration',.1,10],['cooldown',1,60]])if(!Number.isFinite(c.stealth[key])||c.stealth[key]<min||c.stealth[key]>max)errors.push(`stealth.${key}: 参数超出范围`);
  if(c.search?.blindProbes!==undefined&&typeof c.search.blindProbes!=='boolean')errors.push('blindProbes 必须为布尔值');
  if (c.player?.solidPolice!==undefined&&typeof c.player.solidPolice!=='boolean') errors.push('角色实体碰撞开关必须为布尔值');
  if (c.drill && (!['attack','recovery'].includes(c.drill.entry) || !MODES.includes(c.drill.mode) || !['early','perfect','late','none','spiral'].includes(c.drill.response) || !['same','cross','circle'].includes(c.drill.exit) || ![-1,1].includes(c.drill.side) || typeof c.drill.walk !== 'boolean')) errors.push('单元场景参数不合法');
  if (c.practice !== undefined && typeof c.practice !== 'boolean') errors.push('practice 必须为布尔值');
  if (c.capture?.recoveryFov !== undefined && (!Number.isFinite(c.capture.recoveryFov) || c.capture.recoveryFov < 30 || c.capture.recoveryFov > 360)) errors.push('后摇视野角需在30–360度');
  if (c.search) for (const [key, min, max] of [['fov',30,360],['scanSeconds',.2,10],['scanTurnRate',30,720],['budgetSeconds',1,60],['hearingRange',0,30],['soundInterval',.2,5],['maxPoints',0,8]]) {
    if (!Number.isFinite(c.search[key]) || c.search[key] < min || c.search[key] > max) errors.push(`search.${key}: 超出搜索参数范围`);
  }
  if (c.search?.departureBias !== undefined && (!Number.isFinite(c.search.departureBias) || c.search.departureBias < 0 || c.search.departureBias > 1)) errors.push('离开侧优先概率需在0–1');
  function walk(v, template, path = '') {
    for (const [k, ref] of Object.entries(template)) {
      const key = path ? `${path}.${k}` : k, value = v?.[k];
      if (typeof ref === 'object') walk(value, ref, key);
      else if (typeof ref === 'number' && (!Number.isFinite(value) || value < 0 || value > 10000)) errors.push(`${key}: 需要有限非负数`);
    }
  }
  walk(c, DEFAULT);
  if (errors.length) return errors;
  if (c.duration < 1 || c.duration > 300) errors.push('场次时长需在 1–300 秒');
  if (c.escapeSeconds < .5) errors.push('断追时间至少 0.5 秒');
  if (c.exposure > 1) errors.push('暴露度需在 0–1');
  for (const [key, value] of Object.entries(c.behavior)) if (value > (key === 'motorErrorDegrees' ? 45 : 1)) errors.push(`玩家倾向 ${key} 超出范围`);
  if (c.reaction.decisionHz < 5 || c.reaction.decisionHz > 120) errors.push('决策频率需在 5–120Hz');
  if (c.perfectBonus.playerRecoveryScale > 1 || c.perfectBonus.policeRecoveryScale > 3 || c.perfectBonus.refund > c.dodge.cost) errors.push('完美奖励：返还不超过成本，自身恢复倍率≤1，警察恢复倍率≤3');
  if (c.capture.windup < .05) errors.push('前摇至少 0.05 秒');
  if (c.dodge.duration < .02 || c.dodge.recovery < .02) errors.push('突进和恢复至少 0.02 秒');
  if (c.dodge.perfectDelay > c.dodge.duration) errors.push('完美窗口起点不能晚于突进结束');
  if (c.player.staminaMax < 1 || c.police.staminaMax < 1) errors.push('体力上限至少为 1');
  if (c.player.radius < .05 || c.police.radius < .05 || c.player.radius > 1 || c.police.radius > 1) errors.push('角色半径需在 0.05–1 米');
  if (c.police.resumeAt > 1 || c.police.tiredScale > 1 || c.dodge.recoveryScale > 1 || c.player.walkScale > 1) errors.push('恢复比例和减速倍率不得大于 1');
  if (c.dodge.multiplier > 5 || c.police.speedScale > 3 || c.police.acceleration > 100 || c.reaction.mean > 1 || c.reaction.jitter > 1) errors.push('速度或反应参数超出实验范围');
  for (const m of MODES) {
    const a = c.capture[m];
    if(a.followAim!==undefined&&typeof a.followAim!=='boolean') errors.push(`${m}: followAim 必须为布尔值`);
    const windup=attackWindup(c,m);
    if(a.stopGap!==undefined&&(!Number.isFinite(a.stopGap)||a.stopGap<0||a.stopGap>5)) errors.push(`${m}: 前冲停距不合法`);
    if (!Number.isFinite(windup)||windup<.05||windup>2||a.moveFrom!==undefined&&(!Number.isFinite(a.moveFrom)||a.moveFrom<0||a.moveFrom>windup)) errors.push(`${m}: 前摇或前冲启动时刻不合法`);
    if (a.trigger < .1 || a.trigger > 10 || a.radius < .1 || a.radius > 10 || a.angle < 1 || a.angle > 360 || a.sweep > 360 || a.active > 1 || a.moveScale > 3 || a.trackUntil > windup || a.turnRate > 1440) errors.push(`${m}: 抓捕参数超出实验范围（跟踪不能晚于判定时刻）`);
  }
  if (MODES.reduce((s, m) => s + c.weights[m], 0) <= 0) errors.push('至少一个出刀权重大于零');
  if (!['street', 'junction', 'corner', 'random'].includes(c.spawn)) errors.push('未知出生场景');
  return errors;
}
export class StreetMap {
  constructor(layout='grid') {
    this.layout=layout;
    this.width = RUN * 2; this.cell = this.width * 1.8; this.edge = this.cell + this.width / 2;
    const h = this.width / 2, c = this.cell;
    this.blocks = [];
    if(layout==='ring') {const inner=this.edge-this.width;this.blocks.push({x0:-inner,x1:inner,y0:-inner,y1:inner});}
    else for (const x of [-1, 1]) for (const y of [-1, 1]) this.blocks.push({ x0: x < 0 ? -c + h : h, x1: x < 0 ? -h : c - h, y0: y < 0 ? -c + h : h, y1: y < 0 ? -h : c - h });
    this.nodes = [];
    for (const x of [-c, 0, c]) for (const y of [-c, 0, c]) if(this.free({x,y}))this.nodes.push({ x, y });
    for (const b of this.blocks) for (const x of [b.x0 - 1.1, b.x1 + 1.1]) for (const y of [b.y0 - 1.1, b.y1 + 1.1]) this.nodes.push({ x, y });
  }
  free(p, radius = 0) {
    if (Math.abs(p.x) > this.edge - radius || Math.abs(p.y) > this.edge - radius) return false;
    return !this.blocks.some(b => Math.hypot(p.x - clamp(p.x, b.x0, b.x1), p.y - clamp(p.y, b.y0, b.y1)) < radius + 1e-7 || (p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1));
  }
  clear(a, b, radius = 0) {
    // Analytic segment / inflated rectangle test; never peek through a block.
    if (!this.free(a, radius) || !this.free(b, radius)) return false;
    for (const r of this.blocks) {
      let lo = 0, hi = 1;
      for (const [axis, min, max] of [['x', r.x0 - radius, r.x1 + radius], ['y', r.y0 - radius, r.y1 + radius]]) {
        const d = b[axis] - a[axis];
        if (Math.abs(d) < 1e-10) { if (a[axis] < min || a[axis] > max) { hi = -1; break; } }
        else { const p = (min - a[axis]) / d, q = (max - a[axis]) / d; lo = Math.max(lo, Math.min(p, q)); hi = Math.min(hi, Math.max(p, q)); }
      }
      if (lo <= hi && hi >= 0 && lo <= 1) return false;
    }
    return true;
  }
  move(p, dx, dy, radius) {
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / .12));
    for (let i = 0; i < n; i++) {
      const q = { x: p.x + dx / n, y: p.y + dy / n };
      if (this.free(q, radius)) Object.assign(p, q);
      else { if (this.free({ x: q.x, y: p.y }, radius)) p.x = q.x; if (this.free({ x: p.x, y: q.y }, radius)) p.y = q.y; }
    }
  }
  waypoint(from, goal, radius) {
    return this.route(from, goal, radius)[0] || from;
  }
  route(from, goal, radius) {
    if (this.clear(from, goal, radius)) return [goal];
    const nodes = [from, ...this.nodes, goal], n = nodes.length, costs = Array(n).fill(Infinity), prev = Array(n).fill(-1), done = new Set(); costs[0] = 0;
    for (let k = 0; k < n; k++) {
      let u = -1;
      for (let i = 0; i < n; i++) if (!done.has(i) && (u < 0 || costs[i] < costs[u])) u = i;
      if (u < 0 || !Number.isFinite(costs[u])) break;
      if (u === n - 1) break; done.add(u);
      for (let v = 1; v < n; v++) if (!done.has(v) && this.clear(nodes[u], nodes[v], radius)) {
        const d = costs[u] + dist(nodes[u], nodes[v]); if (d < costs[v]) { costs[v] = d; prev[v] = u; }
      }
    }
    let v = n - 1;
    if (prev[v] < 0) return [];
    const route = [];
    while (v > 0) { route.unshift(nodes[v]); v = prev[v]; }
    return route;
  }
}
const rad = d => d * Math.PI / 180;
export class World {
  constructor(config = DEFAULT, seed = 1) {
    const errors = validate(config); if (errors.length) throw new Error(errors.join('; '));
    this.config = clone(config); this.seed = seed >>> 0; this.rng = new RNG(seed); this.map = new StreetMap(config.mapLayout??'grid'); this.tick = 0; this.time = 0; this.result = null;
    this.events = []; this.metrics = { attacks: 0, dodges: 0, evades: 0, perfect: 0, positionMiss: 0, wallMiss: 0, rejected: 0, modes: Object.fromEntries(MODES.map(m => [m, 0])), missedByMode: Object.fromEntries(MODES.map(m => [m, 0])) };
    let scene = config.spawn === 'random' ? ['street', 'junction', 'corner'][Math.floor(this.rng.next() * 3)] : config.spawn;
    const positions = { street: [{ x: -12, y: 0 }, { x: -17, y: 0 }], junction: [{ x: 0, y: 0 }, { x: -5, y: 1 }], corner: [{ x: 3.8, y: 5 }, { x: 3.8, y: 0 }] };
    if(this.map.layout==='ring'){
      const c=this.map.cell,h=this.map.edge-this.map.width;
      Object.assign(positions,{street:[{x:-12,y:-c},{x:-17,y:-c}],junction:[{x:c,y:-c},{x:c-5,y:-c}],corner:[{x:h-2,y:-h-1.6},{x:h-7,y:-h-1.6}]});
    }
    const [p, e] = positions[scene]; const sign = this.rng.next() < .5 ? 1 : -1;
    this.player = { x: p.x * sign, y: p.y, dir: sign > 0 ? 0 : Math.PI, stamina: config.player.staminaMax, dodge: null };
    this.police = { x: e.x * sign, y: e.y, dir: facing(e, p), moveDir: facing(e, p), speed: 0, stamina: config.police.staminaMax, tired: false, attack: null, cooldown: 0, visible: true, lastSeen: { x: p.x * sign, y: p.y }, lost: 0, plan: null, path: null, nextPath: 0 };
    this.police.dir = this.police.moveDir = facing(this.police, this.player);
    Object.assign(this.metrics, { walkSeconds: 0, staminaRecovered: 0, recoverySeconds: 0, searches: 0, reacquired: 0, soundsHeard: 0 });
    this.nextAttack = 1;
    if (config.drill) {
      const d=config.drill;
      Object.assign(this.police,{x:0,y:0,dir:0,moveDir:0,lastSeen:{x:config.capture[d.mode].trigger-.03,y:0}});
      Object.assign(this.player,{x:config.capture[d.mode].trigger-.03,y:0,dir:0,stamina:70});
      this.startAttack(d.mode);
      if (d.entry==='recovery') { this.player.x=1.6;this.player.y=d.side*.8;this.police.lastSeen={x:this.player.x,y:this.player.y};this.police.lastBearing=facing(this.police,this.player);this.police.lastMotionDir=d.side*Math.PI/2;this.miss(this.police.attack,'position');this.emit('fixture',{entry:'recovery'}); }
      if(this.map.layout==='ring'){
        const offset=-this.map.cell;this.player.y+=offset;this.police.y+=offset;this.police.lastSeen.y+=offset;this.police.attack.origin.y+=offset;
      }
    }
  }
  emit(type, data = {}) { this.events.push({ tick: this.tick, t: +this.time.toFixed(4), type, ...data }); }
  invisible() { return this.time < (this.player.invisibleUntil ?? 0); }
  phase() {
    const d = this.player.dodge, c = this.config.dodge;
    if (!d) return 'ready';
    return d.elapsed < c.startup ? 'startup' : d.elapsed < c.startup + c.duration ? 'dash' : 'recovery';
  }
  perfect() {
    const d = this.player.dodge, c = this.config.dodge;
    return !!d && !d.used && this.phase() === 'dash' && d.elapsed >= c.startup + c.perfectDelay && d.elapsed < Math.min(c.startup + c.duration, c.startup + c.perfectDelay + c.perfectDuration);
  }
  dodge(x, y) {
    const p = this.player, c = this.config.dodge;
    if (p.dodge || p.stamina < c.cost) { this.metrics.rejected++; return false; }
    const dir = Math.hypot(x, y) > .01 ? Math.atan2(y, x) : p.dir;
    p.stamina -= c.cost; p.dodge = { dir, elapsed: 0, used: false }; p.dir = dir; this.metrics.dodges++; this.emit('dodge', { dir }); return true;
  }
  chooseMode() {
    const weights = this.config.weights, sum = MODES.reduce((n, m) => n + weights[m], 0); let r = this.rng.next() * sum;
    for (const m of MODES) { r -= weights[m]; if (r <= 0 && weights[m] > 0) return m; } return MODES.at(-1);
  }
  startAttack(mode) {
    const e = this.police;
    e.attack = { id: this.nextAttack++, mode, elapsed: 0, dir: e.dir, moveDir: e.moveDir, sign: this.rng.next() < .5 ? -1 : 1, phase: 'windup', hitDir: e.dir, snapshot: clone(this.config.capture[mode]), origin: { x: e.x, y: e.y } };
    e.attack.snapshot.windup=attackWindup(this.config,mode);
    e.attack.snapshot.moveFrom??=mode==='lunge'?e.attack.snapshot.trackUntil:0;
    e.plan = null; this.metrics.attacks++; this.metrics.modes[mode]++; this.emit('attack', { id: e.attack.id, mode, distance: dist(e, this.player) });
  }
  resolve(a) {
    const e = this.police, p = this.player, c = a.snapshot;
    const distance = dist(e, p), angle = Math.abs(angleDiff(facing(e, p), a.hitDir));
    // Match plugin root-position geometry, not a radius-expanded player capsule.
    const inside = distance <= c.radius && angle <= rad(c.angle / 2), clear = this.map.clear(e, p);
    if (!inside || !clear) {a.missDistance=distance;a.missAngle=angle*180/Math.PI;a.missCause=inside&&!clear?'wall':distance>c.radius?'range':'angle';return { hit: false, blocked: inside && !clear };}
    if (this.perfect()) { p.dodge.used = true; p.stamina = Math.min(this.config.player.staminaMax, p.stamina + this.config.perfectBonus.refund); this.metrics.perfect++; this.emit('perfect', { id: a.id, distance, refund: this.config.perfectBonus.refund, x:p.x, y:p.y }); this.miss(a, 'perfect'); return { hit: false, protected: true }; }
    this.result = 'caught'; this.emit('caught', { id: a.id, distance, angle }); return { hit: true };
  }
  miss(a, reason) {
    this.metrics.evades++;
    this.metrics.missedByMode[a.mode]++;
    if (reason === 'position') this.metrics.positionMiss++;
    if (reason === 'wall') this.metrics.wallMiss++;
    a.phase = 'recovery'; a.recovery = 0; a.recoveryScale = reason === 'perfect' ? this.config.perfectBonus.policeRecoveryScale : 1;
    // The final strike direction becomes the fixed recovery-facing direction.
    this.police.dir = a.hitDir; this.police.speed = 0;
    this.emit('miss', { id: a.id, reason, cause:reason==='perfect'?'perfect':a.missCause, distance:a.missDistance, angleDegrees:a.missAngle });
  }
  attackStep(dt) {
    const e = this.police, a = e.attack, c = this.config.capture, m = a.snapshot;
    if (a.phase === 'recovery') { a.recovery += dt; if (a.recovery + 1e-9 >= c.missRecovery * a.recoveryScale) { e.attack = null; e.cooldown = c.cooldown; if (this.config.search && !e.visible && !e.search) this.beginSearch('scan'); } return; }
    const old = a.elapsed; a.elapsed += dt;
    const tracking = Math.max(0, Math.min(a.elapsed, m.trackUntil) - Math.min(old, m.trackUntil));
    if ((a.mode !== 'sweep' || m.sweep===0) && tracking > 0 && (e.visible || a.mode==='lunge')) a.dir = turn(a.dir, facing(e, e.visible?this.player:e.lastSeen), rad(m.turnRate) * tracking);
    e.dir = a.dir;
    if (a.elapsed >= m.trackUntil && a.phase === 'windup') {
      a.phase = 'committed';
      this.emit('commit', { id: a.id });
    }
    // Straight-move legacy attacks separate body and aim. Lunges follow finite-rate aim.
    if (m.moveScale) {
      const dir = a.mode === 'lunge' || m.followAim ? a.dir : a.moveDir;
      // Movement onset and steering cutoff are independent clocks.
      const moveDt = Math.max(0,a.elapsed-Math.max(old,m.moveFrom));
      if(a.mode==='lunge'&&m.stopGap!==undefined&&a.travelLeft===undefined&&moveDt>0) {a.travelLeft=Math.max(0,dist(e,e.lastSeen)-m.stopGap);a.advanceTarget={...e.lastSeen};}
      const speed = RUN * this.config.police.speedScale * m.moveScale * (e.tired ? this.config.police.tiredScale : 1);
      const travel=Math.min(speed*moveDt,a.travelLeft??Infinity);
      const before={x:e.x,y:e.y};this.moveActor(e,Math.cos(dir)*travel,Math.sin(dir)*travel,this.config.police.radius,this.player,this.config.player.radius);
      e.speed=dist(before,e)/dt;
      if(a.travelLeft!==undefined)a.travelLeft=Math.max(0,a.travelLeft-dist(before,e));
    }
    if (a.elapsed + 1e-9 < m.windup) return;
    const progress = m.active > 0 ? clamp((a.elapsed - m.windup) / m.active, 0, 1) : .5;
    a.hitDir = a.dir + rad(m.sweep) * a.sign * (progress - .5);
    const r = this.resolve(a);
    if (r.hit || r.protected) return;
    a.blocked = a.blocked || r.blocked;
    if (a.elapsed + 1e-9 >= m.windup + m.active) this.miss(a, a.blocked ? 'wall' : 'position');
    else a.phase = 'active';
  }
  moveActor(actor,dx,dy,radius,other,otherRadius) {
    if(!this.config.player.solidPolice){this.map.move(actor,dx,dy,radius);return;}
    const steps=Math.max(1,Math.ceil(Math.hypot(dx,dy)/.06)),gap=radius+otherRadius;
    for(let i=0;i<steps;i++) {
      const before={x:actor.x,y:actor.y};this.map.move(actor,dx/steps,dy/steps,radius);
      const distance=dist(actor,other);
      if(distance<gap) {
        const direction=distance>1e-8?facing(other,actor):facing(other,before);
        const projected={x:other.x+Math.cos(direction)*gap,y:other.y+Math.sin(direction)*gap};
        if(this.map.free(projected,radius)&&this.map.clear(before,projected,radius))Object.assign(actor,projected);
        else Object.assign(actor,before);
      }
    }
  }
  beginSearch(phase = 'investigate') {
    const e = this.police, c = this.config.search;
    this.metrics.searches++;
    e.plan = null; e.path = null;
    // Only the last legal visual evidence decides which side to check. No hidden position query.
    const evidence = Math.abs(e.lastBearing ?? 0) > rad(5) ? e.lastBearing : Math.sin((e.lastMotionDir ?? e.dir) - e.dir);
    const departureSide = Math.abs(evidence) > .001 ? Math.sign(evidence) : (this.rng.next() < .5 ? -1 : 1);
    const scanSign = this.rng.next() < (c.departureBias ?? .8) ? departureSide : -departureSide;
    e.search = { phase, elapsed: 0, deadline: this.time + c.budgetSeconds * (1 + this.config.exposure), target: { ...e.lastSeen }, checked: [], heardAt: -1, needLast: phase === 'scan', scanSign };
    this.emit('search', { phase, scanSign, departureSide });
  }
  searchStep(dt) {
    const e = this.police, c = this.config.search;
    if (!e.search) this.beginSearch();
    const s = e.search;
    // A contact is real evidence, but does not restore visual tracking.
    if(c.blindProbes&&e.lastContact&&this.time-e.lastContact.t<.1&&this.tryProbe(e.lastContact,'contact'))return;
    if (e.lastHeard && e.lastHeard.t > s.heardAt && this.time - e.lastHeard.t < 1) {
      s.heardAt = e.lastHeard.t; s.target = { ...e.lastHeard }; s.phase = 'investigate'; s.elapsed = 0; e.path = null;
      this.emit('search', { phase: 'sound' });
    }
    if (this.time >= s.deadline && (!e.lastHeard || this.time - e.lastHeard.t > 1) && e.lost >= this.escapeDelay()) {
      this.result = 'escaped'; this.emit('search', { phase: 'giveup' }); this.emit('escaped'); return;
    }
    if (s.phase === 'scan') {
      e.speed = 0; e.dir += s.scanSign * rad(c.scanTurnRate) * dt; e.moveDir = e.dir; s.elapsed += dt;
      if (s.elapsed >= c.scanSeconds) {
        if (s.needLast && dist(e,e.lastSeen) > .5) { s.needLast = false; s.target = { ...e.lastSeen }; s.phase = 'investigate'; e.path = null; this.emit('search', { phase: 'investigate' }); return; }
        s.needLast = false;
        const candidates = this.map.nodes.filter(n => dist(n, e.lastSeen) < this.map.width * 1.5 && dist(n, e) > 1 && !s.checked.some(p => dist(p, n) < .1));
        // Rank routes using the last observed travel direction, not the unseen target.
        const routeCost = n => {
          const path = this.map.route(e,n,this.config.police.radius);
          if (!path.length) return Infinity;
          const travel = path.reduce((sum,p,i)=>sum+dist(i?path[i-1]:e,p),0);
          const continuation = Math.cos(angleDiff(facing(e.lastSeen,n),e.lastMotionDir ?? e.dir));
          return travel - continuation * this.map.width * .35;
        };
        const ranked = candidates.map(n=>({n,cost:routeCost(n)})).filter(v=>Number.isFinite(v.cost)).sort((a,b)=>a.cost-b.cost);
        candidates.splice(0,candidates.length,...ranked.map(v=>v.n));
        if (s.checked.length < c.maxPoints && candidates.length) {
          s.target = { ...candidates[0] }; s.checked.push(s.target); s.phase = 'investigate'; e.path = null;
          this.emit('search', { phase: 'branch' });
        } else { s.phase = 'wait'; this.emit('search', { phase: 'wait' }); }
      }
      return;
    }
    if (s.phase === 'wait') { e.speed = 0; return; }
    if (dist(e, s.target) < .5) { s.phase = 'scan'; s.elapsed = 0; e.speed = 0; this.emit('search', { phase: 'scan' }); if(c.blindProbes)this.tryProbe(s.target,'last-evidence'); return; }
    if (!e.path || this.time >= e.nextPath || dist(e,e.path) < .4) { e.path = this.map.waypoint(e,s.target,this.config.police.radius); e.nextPath = this.time + .12; }
    e.moveDir = turn(e.moveDir, facing(e,e.path), rad(this.config.police.turnRate) * dt); e.dir = e.moveDir;
    e.speed = RUN * (c.moveScale ?? .6);
    this.moveActor(e, Math.cos(e.moveDir)*e.speed*dt, Math.sin(e.moveDir)*e.speed*dt, this.config.police.radius,this.player,this.config.player.radius);
  }
  tryProbe(target,reason) {
    const e=this.police,s=e.search;
    if(!s||(s.probes??0)>=2||this.time<(e.nextProbe??0)||e.cooldown>0)return false;
    s.probes=(s.probes??0)+1;e.nextProbe=this.time+2;e.dir=facing(e,target);e.moveDir=e.dir;
    this.startAttack('stand');this.emit('probe',{reason,x:target.x,y:target.y});return true;
  }
  step(input = {}) {
    if (this.result) return;
    const dt = BASE.dt, c = this.config, p = this.player, e = this.police;
    this.tick++; this.time = this.tick * dt;
    if(input.stealth&&c.stealth&&!this.invisible()&&this.time>=(p.stealthReadyAt??0)){
      p.invisibleUntil=this.time+c.stealth.duration;p.stealthReadyAt=p.invisibleUntil+c.stealth.cooldown;p.stealthUses=(p.stealthUses??0)+1;this.emit('stealth',{phase:'start'});
    }
    if(p.invisibleUntil!==undefined&&!this.invisible()){delete p.invisibleUntil;this.emit('stealth',{phase:'end'});}
    if (p.dodge) { p.dodge.elapsed += dt; if (p.dodge.elapsed + 1e-9 >= c.dodge.startup + c.dodge.duration + c.dodge.recovery * (p.dodge.used ? c.perfectBonus.playerRecoveryScale : 1)) p.dodge = null; }
    if (input.dodge) this.dodge(input.x || 0, input.y || 0);
    const phase = this.phase(); let dx = input.x || 0, dy = input.y || 0, length = Math.hypot(dx, dy); if (length > 1) { dx /= length; dy /= length; }
    if (c.player.runDrain > 0 && p.stamina <= 0) p.exhausted = true;
    if (p.exhausted && p.stamina >= Math.min(c.player.staminaMax, Math.max(1, c.dodge.cost))) p.exhausted = false;
    const walking = input.walk || p.stamina <= 0 || p.exhausted;
    if (walking && length > .01 && (phase === 'ready' || phase === 'recovery')) this.metrics.walkSeconds += dt;
    if (e.attack?.phase === 'recovery') this.metrics.recoverySeconds += dt;
    let speed = walking ? RUN * c.player.walkScale : RUN;
    if (phase === 'startup') speed = 0;
    else if (phase === 'dash') { speed = RUN * c.dodge.multiplier; dx = Math.cos(p.dodge.dir); dy = Math.sin(p.dodge.dir); }
    else if (phase === 'recovery') speed *= recoveryMoveScale(c,p.dodge);
    if (phase === 'ready' || phase === 'recovery') {
      if (length > .01 && !walking) p.stamina = Math.max(0, p.stamina - c.player.runDrain * dt);
      else { const before = p.stamina; p.stamina = Math.min(c.player.staminaMax, p.stamina + c.player.walkRegen * dt); this.metrics.staminaRecovered += p.stamina - before; }
      if (length > .01) p.dir = Math.atan2(dy, dx);
    }
    const beforeMove = { x:p.x, y:p.y };
    this.moveActor(p, dx * speed * dt, dy * speed * dt, c.player.radius,e,c.police.radius);
    p.locomotion=dist(beforeMove,p)>.00001?(walking?'walk':'run'):length>.01?'blocked':'idle';
    if(c.search?.blindProbes&&dist(e,p)<=c.player.radius+c.police.radius+1e-6){e.lastContact={x:p.x,y:p.y,t:this.time};}
    if (c.practice) {
      if (this.time >= c.duration) { this.result = 'timeout'; this.emit('timeout'); }
      return;
    }
    const viewAngle = e.attack?.phase === 'recovery' ? (c.capture.recoveryFov ?? 360) : (c.search?.fov ?? 360);
    const inRecoveryView = Math.abs(angleDiff(facing(e, p), e.dir)) <= rad(viewAngle / 2);
    e.visible = !this.invisible() && inRecoveryView && dist(e, p) <= c.visionRange && this.map.clear(e, p);
    if (e.visible) {
      if (e.search) { this.metrics.reacquired++; this.emit('search', { phase: 'reacquire' }); }
      e.search = null;
      if (dist(e.lastSeen,p) > .002) e.lastMotionDir = facing(e.lastSeen,p);
      e.lastBearing = angleDiff(facing(e,p),e.dir);
      e.lastSeen = { x: p.x, y: p.y }; e.lost = 0;
    } else e.lost += dt;
    if (c.drill && this.metrics.reacquired > 0) { this.result='reacquired';this.emit('reacquired');return; }
    if (c.search && (phase === 'dash' || !walking) && dist(beforeMove,p) > .001 && phase !== 'startup' && this.time >= (e.nextSound ?? 0)) {
      e.nextSound = this.time + c.search.soundInterval;
      if (dist(e,p) <= c.search.hearingRange * (this.map.clear(e,p) ? 1 : .5)) {
        e.lastHeard = { x: p.x, y: p.y, t: this.time }; this.metrics.soundsHeard++; this.emit('heard', { x: p.x, y: p.y });
      }
    }
    const wasTired=e.tired;
    if (e.stamina <= 0) e.tired = true;
    if (e.tired && e.stamina >= c.police.staminaMax * c.police.resumeAt) e.tired = false;
    if(e.tired!==wasTired)this.emit('fatigue',{tired:e.tired,stamina:e.stamina,speedScale:e.tired?c.police.tiredScale:1});
    e.stamina = clamp(e.stamina + (e.tired || e.attack?.phase === 'recovery' ? c.police.regen : -c.police.drain) * dt, 0, c.police.staminaMax);
    if(!e.attack)e.cooldown=Math.max(0,e.cooldown-dt);
    if (e.attack) this.attackStep(dt);
    else if (c.search && !e.visible) this.searchStep(dt);
    else {
      if (!e.plan && e.visible && e.cooldown <= 0) e.plan = this.chooseMode();
      if (!e.path || this.time >= e.nextPath || dist(e, e.path) < .4) { e.path = this.map.waypoint(e, e.lastSeen, c.police.radius); e.nextPath = this.time + .12; }
      if (dist(e, e.path) > .08) e.moveDir = turn(e.moveDir, facing(e, e.path), rad(c.police.turnRate) * dt);
      e.dir = e.moveDir;
      const desired = dist(e, e.lastSeen) > .2 ? RUN * c.police.speedScale * (e.tired ? c.police.tiredScale : 1) : 0;
      e.speed += clamp(desired - e.speed, -c.police.acceleration * dt, c.police.acceleration * dt);
      this.moveActor(e, Math.cos(e.moveDir) * e.speed * dt, Math.sin(e.moveDir) * e.speed * dt, c.police.radius,p,c.player.radius);
      const a = e.plan && c.capture[e.plan];
      if (a && e.visible && e.cooldown <= 0 && dist(e, p) <= a.trigger && Math.abs(angleDiff(facing(e, p), e.dir)) <= rad(60)) this.startAttack(e.plan);
    }
    if (!c.search && !this.result && !e.visible && e.lost >= this.escapeDelay()) { this.result = 'escaped'; this.emit('escaped'); }
    if (!this.result && this.time >= c.duration) { this.result = 'timeout'; this.emit('timeout'); }
  }
  observation() {
    const p = this.player, e = this.police;
    // Player bot sees geometry + visible telegraph; no next mode, RNG, weights or hidden target position.
    const visible = this.map.clear(p, e) && dist(p, e) <= this.config.visionRange;
    return { tick: this.tick, time: this.time, player: { x: p.x, y: p.y, dir: p.dir, stamina: p.stamina, phase: this.phase() }, police: visible ? { x: e.x, y: e.y, dir: e.dir, moveDir: e.moveDir, speed: e.speed, attack: e.attack ? { id: e.attack.id, mode: e.attack.mode, elapsed: e.attack.elapsed, phase: e.attack.phase, recoveryRemaining: e.attack.phase === 'recovery' ? Math.max(0,this.config.capture.missRecovery * e.attack.recoveryScale - e.attack.recovery) : 0, dir: e.attack.dir, hitDir: e.attack.hitDir, sign: e.attack.sign } : null } : null };
  }
  escapeDelay() { return this.config.escapeSeconds * (1 + this.config.exposure * this.config.memoryScale); }
  summary() {
    const e = this.config.exposure, escapeWeight = .6 - .45 * e, evadeWeight = .25 + .3 * e, timeWeight = 1 - escapeWeight - evadeWeight;
    const score = 100 * (escapeWeight * (this.result === 'escaped' ? 1 : 0) + evadeWeight * Math.min(1, this.metrics.evades / 6) + timeWeight * Math.min(1, this.time / this.config.duration));
    return { seed: this.seed, result: this.result, seconds: +this.time.toFixed(3), score: this.config.practice || this.config.drill ? 0 : +score.toFixed(2), noEngagement: this.metrics.attacks === 0, ...clone(this.metrics) };
  }
}
