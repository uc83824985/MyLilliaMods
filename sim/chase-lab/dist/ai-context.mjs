// Simulator adapter. Only this module samples raw entities for the shared mirror mind.
// Geometry capabilities are the temporary bridge to the existing navigation API.
import {BASE, RUN} from './units.mjs';
const copy=value=>value==null?value:JSON.parse(JSON.stringify(value));
const gap=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const delta=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
const pick=(value,keys)=>Object.fromEntries(keys.filter(k=>value[k]!==undefined).map(k=>[k,copy(value[k])]));
const geometryCache=new WeakMap();
function geometryFor(map){
  if(!geometryCache.has(map)){
    const geometry={layout:map.layout,width:map.width,nodes:map.nodes.map(p=>Object.freeze({...p}))};
    for(const key of ['clear','route','waypoint','free','move'])geometry[key]=(...args)=>map[key](...args);
    Object.freeze(geometry.nodes);geometryCache.set(map,Object.freeze(geometry));
  }
  return geometryCache.get(map);
}

export function selfActionFeedback(world,actor){
  const self=world[actor],mirror=world.mirror?.[actor];
  const last=world.actionFeedback?.[actor]?.events.at(-1);
  if(world.result&&last&&!world.actionFeedback[actor].current)return pick(last,['kind','status','phase','reason','requestId']);
  if(mirror)return {kind:'mirror',status:'running',phase:mirror.cancelled?'cancel-recovery':mirror.phase,remaining:Math.max(0,mirror.until-world.time)};
  if(self.attack)return {kind:'capture',status:'running',phase:self.attack.phase,id:self.attack.id};
  if(self.dodge)return {kind:'dodge',status:'running',phase:world.phase(),elapsed:self.dodge.elapsed};
  // No running action does not imply success: terminal results need an explicit event.
  return {kind:null,status:'idle',phase:'ready'};
}

export function buildAIContext(world,actor,{sample=true,previousTick=false}={}){
  const interaction=world.mirror??{};
  if(!['player','police'].includes(actor))throw Error('Unknown AI actor');
  const self=world[actor],other=world[actor==='player'?'police':'player'];
  const visible=sample&&world.map.clear(self,other)&&gap(self,other)<=world.config.visionRange&&
    (actor==='player'||interaction.police?.phase!=='landing'&&!world.invisible()&&Math.abs(delta(Math.atan2(other.y-self.y,other.x-self.x),self.dir))<=Math.PI/3);
  // Visible attack fields only. Never spread the actual attack object into perception.
  const attack=other.attack?{...pick(other.attack,['id','mode','elapsed','phase','dir','hitDir','sign']),recoveryRemaining:other.attack.phase==='recovery'?Math.max(0,world.config.capture.missRecovery*other.attack.recoveryScale-other.attack.recovery):0}:null;
  const enemy=visible?{
    x:other.x,y:other.y,dir:other.dir,moveDir:other.moveDir??other.dir,
    speed:actor==='player'?other.speed:other.locomotion==='run'?RUN:other.locomotion==='walk'?RUN*world.config.player.walkScale:0,
    attack,castRemaining:actor==='police'&&interaction.player?.phase==='windup'?Math.max(0,interaction.player.until-world.time):0,
    casting:actor==='police'&&interaction.player?.phase==='windup',landing:actor==='police'&&interaction.player?.phase==='landing'
  }:null;
  if(enemy&&actor==='police')enemy.mirrorAction=!interaction.player?null:interaction.player.phase==='windup'?'casting':interaction.player.cancelled?'cancel-recovery':'arrival-recovery';
  const mirror={sealed:interaction.sealed};
  if(actor==='player'){mirror.player=copy(interaction.player);mirror.used=[...(interaction.used??[])];}
  else mirror.police=copy(interaction.police);
  // Diagnostics are write-through counters, never opponent mind/intent references.
  mirror.branchStats=interaction.branchStats??={nodes:{},transitions:{}};
  mirror.policeBranches=interaction.policeBranches??={choices:{},transitions:{}};
  const events=[];
  const geometry=geometryFor(world.map);
  const phase=actor==='player'?world.phase():'ready';
  const ai={...world.config.mirror?.ai};
  if(ai.integration){ai.integration={...ai.integration};delete ai.integration.mixture;delete ai.integration.mixtureByExposure;}
  // These profiles are private to the police; a human estimates actions from observations.
  if(actor==='player')for(const key of ['castResponse','followWeight','interceptWeight','waitWeight','fakeWeight'])delete ai[key];
  const config={...world.config,mirror:{...world.config.mirror,ai}};
  if(actor==='player')delete config.weights;
  return {
    schemaVersion:1,actor,time:world.time,tick:world.tick,seed:world.seed,config,mirror,
    [actor]:pick(self,['x','y','dir','moveDir','speed','stamina','exhausted','tired','cooldown']),
    perception:{observedAt:world.time-(previousTick&&world.tick>0?BASE.dt:0),enemy,heard:actor==='police'?copy(self.lastHeard??null):null},
    feedback:{...selfActionFeedback(world,actor),actions:world.actionFeedback?.[actor]?.snapshot()??{current:null,events:[]}},map:geometry,phase:()=>phase,events,
    emit(type,data){world.emit(type,data);events.push(world.events.at(-1));}
  };
}

export const buildMirrorContext=(world,actor,options={})=>buildAIContext(world,actor,{previousTick:true,...options});
