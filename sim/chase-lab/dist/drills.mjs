import { metres as M } from './units.mjs';
import { angleDiff, dist, attackWindup } from './core.mjs';
// Scripted white-box fixture, deliberately separate from reaction-limited chase bots.
export function drillInput(w) {
  const d=w.config.drill,p=w.player,e=w.police,first=w.events.find(ev=>ev.type==='miss'&&ev.id===1);
  if (!first) {
    if(d.response==='spiral') {
      const t=Math.atan2(p.y-e.y,p.x-e.x),radial=dist(p,e)>M(.85)?-.4:0;
      return {x:Math.cos(t)*radial-Math.sin(t)*d.side,y:Math.sin(t)*radial+Math.cos(t)*d.side,dodge:false,walk:false};
    }
    const windup=attackWindup(w.config,d.mode);
    const press = d.response==='early' ? 0 : d.response==='perfect' ? windup-w.config.dodge.startup-w.config.dodge.perfectDelay-w.config.dodge.perfectDuration/2 : windup-.025;
    const dodge=d.response!=='none'&&w.metrics.dodges===0&&w.time+1e-8>=press;
    return {x:d.response==='early'?1:0,y:d.response==='early'?0:d.side,dodge,walk:false};
  }
  // Follow a bounded arc about the police; never select an escape waypoint.
  const theta=Math.atan2(p.y-e.y,p.x-e.x), target=d.side*({same:.75,cross:1.25,circle:1.85}[d.exit])*Math.PI;
  const remaining=((d.side*(target-theta))%(Math.PI*2)+Math.PI*2)%(Math.PI*2),radius=M(1.7);
  if (Math.abs(angleDiff(target,theta))<.1&&Math.abs(dist(p,e)-radius)<M(.2)) return {x:0,y:0,walk:true};
  const radial=Math.max(-1,Math.min(1,(radius-dist(p,e))/M(1)*1.5));
  const tangential=remaining<.1?0:1;
  return {x:Math.cos(theta)*radial-Math.sin(theta)*d.side*tangential,y:Math.sin(theta)*radial+Math.cos(theta)*d.side*tangential,walk:d.walk,dodge:false};
}
export function drillSummary(w) {
  const miss=w.events.find(e=>e.type==='miss'&&e.id===1), perfect=w.events.find(e=>e.type==='perfect'&&e.id===1);
  const search=w.events.find(e=>e.type==='search'), reacquired=w.events.find(e=>e.type==='search'&&e.phase==='reacquire');
  return { ...w.summary(), conditionedOnMiss:w.config.drill.entry==='recovery', response:w.config.drill.response, exit:w.config.drill.exit, walk:w.config.drill.walk, mode:w.config.drill.mode,
    firstResponse: w.config.drill.entry==='recovery'?'fixture':perfect?'perfect':miss?'evaded':w.result==='caught'?'caught':'unfinished',
    missCause:miss?.cause??null, missAngleDegrees:miss?.angleDegrees??null,
    searchStarted:search?.t??null, reacquiredAt:reacquired?.t??null, searchDelay:reacquired&&search?+(reacquired.t-search.t).toFixed(3):null,
    endedWithoutReacquisition:!!search&&!reacquired, endTick:w.tick };
}
