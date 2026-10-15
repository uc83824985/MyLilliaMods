// Pure rules shared by AI and execution. No simulator or Unity dependencies.
import {RUN, metres as M} from './units.mjs';
export {BASE, RUN} from './units.mjs';
export const MODES = ['stand', 'stride', 'sweep', 'lunge'];
export const LABELS = { stand: '贴身站定', stride: '行进直线', sweep: '定向横扫', lunge: '蓄力扑抓' };
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const angleDiff = (a, b) => {
  const delta = Math.atan2(Math.sin(a - b), Math.cos(a - b));
  // An exactly rearward target has two equally short turns. Pick one consistently
  // instead of letting floating-point unit conversions choose opposite sides.
  return Math.abs(Math.abs(delta) - Math.PI) < 1e-10 ? Math.PI : delta;
};
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const facing = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
export const turn = (a, b, amount) => a + clamp(angleDiff(b, a), -amount, amount);
export const clone = x => JSON.parse(JSON.stringify(x));
export const attackWindup = (c,mode) => c.capture[mode]?.windup ?? c.capture.windup;
export function attackStartReach(c, mode, tired, awaySpeed = RUN) {
  const a=c.capture[mode], windup=attackWindup(c,mode);
  const onset=a.moveFrom??(mode==='lunge'?a.trackUntil:0);
  const advance=RUN*c.police.speedScale*a.moveScale*(tired?c.police.tiredScale:1)*Math.max(0,windup-onset);
  // Configured trigger is an upper bound, not a promise of reach at every speed.
  const reach=Math.max(0,Math.min(a.trigger,a.radius+advance-Math.max(0,awaySpeed)*windup-M(.04)));
  return c.player.solidPolice&&reach<c.player.radius+c.police.radius?0:reach;
}
export class RNG {
  constructor(seed = 1) { this.state = seed >>> 0; }
  next() { let t = this.state += 0x6D2B79F5; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }
  range(a, b) { return a + (b - a) * this.next(); }
  normal(mean, std) { return mean + std * Math.sqrt(-2 * Math.log(Math.max(1e-9, this.next()))) * Math.cos(2 * Math.PI * this.next()); }
}
