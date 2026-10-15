import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { episode } from './dist/experiments.mjs';
import { presetConfig } from './dist/presets.mjs';
import { configureOpenDuel } from './dist/open-duel-config.mjs';
import { dispersedSeed } from './dist/mirror-game.mjs';

const output=fileURLToPath(new URL('../../artifacts/chase-lab/close-pressure/',import.meta.url));
const seeds=Number(process.env.CLOSE_PRESSURE_SEEDS||32);
if(!Number.isInteger(seeds)||seeds<1||seeds>256)throw Error('CLOSE_PRESSURE_SEEDS requires 1..256');
const rows=[],cells=[],profiles=['fast','typical','unstable'],pressures=[0,.5];
const humans=['nervous','precision_conserve_early30','guard_walk'],hunters=['pressure_attack','pressure','pressure_adaptive'];
const avg=(a,fn)=>a.reduce((sum,r)=>sum+fn(r),0)/a.length;
const presentMean=(a,key)=>{const b=a.filter(r=>r[key]!==null);return b.length?avg(b,r=>r[key]):null;};
const summary=a=>({n:a.length,seconds:avg(a,r=>r.seconds),survive30:avg(a,r=>+(r.seconds>=30)),caught:avg(a,r=>+(r.result==='caught')),
  perfect:avg(a,r=>r.perfect),attacks:avg(a,r=>r.attacks),preemptiveDodges:avg(a,r=>r.preemptiveDodges??0),caughtAfterPreemptiveDodge:avg(a,r=>r.caughtAfterPreemptiveDodge??0),
  caughtLowStamina:avg(a,r=>+(r.caughtStamina!==null&&r.caughtStamina<25)),pressureSeconds:avg(a,r=>r.pressureSeconds??0),pressureWalkSeconds:avg(a,r=>r.pressureWalkSeconds??0),pressureRunSeconds:avg(a,r=>r.pressureRunSeconds??0),
  pressurePlayerStaminaChange:avg(a,r=>r.pressurePlayerStaminaChange??0),pressurePoliceStaminaChange:avg(a,r=>r.pressurePoliceStaminaChange??0),
  attackGames:a.filter(r=>r.firstAttackAt!==null).length,firstAttackAt:presentMean(a,'firstAttackAt'),firstAttackStamina:presentMean(a,'firstAttackStamina'),
  releases:{dodge:a.reduce((n,r)=>n+r.releases.dodge,0),walking:a.reduce((n,r)=>n+r.releases.walking,0),deadline:a.reduce((n,r)=>n+r.releases.deadline,0)}});
for(const profile of profiles)for(const pressure of pressures)for(const human of humans)for(const hunter of hunters){
  const group=[];
  for(let i=0;i<seeds;i++){
    const c=configureOpenDuel(presetConfig('rhythm-mixed'),{profile,human,hunter,duration:40});c.duel.pressure=pressure;c.duel.objective='endurance';
    const r=episode(c,dispersedSeed(11310000,i),'perfect',null,true),events=r.replay.events;
    const first=events.find(e=>e.type==='attack'),caught=events.find(e=>e.type==='caught');
    const releases=Object.fromEntries(['dodge','walking','deadline'].map(reason=>[reason,events.filter(e=>e.type==='close-pressure'&&e.phase==='release'&&e.reason===reason).length]));
    delete r.replay;
    const row={profile,pressure,human,hunter,...r,firstAttackAt:first?.t??null,firstAttackStamina:first?.playerStamina??null,caughtStamina:caught?.stamina??null,releases};
    rows.push(row);group.push(row);
  }
  cells.push({profile,pressure,human,hunter,...summary(group)});
  console.log(JSON.stringify(cells.at(-1)));
}
const pairs=cells.filter(c=>c.hunter!=='pressure_attack').map(c=>{const base=cells.find(b=>b.profile===c.profile&&b.pressure===c.pressure&&b.human===c.human&&b.hunter==='pressure_attack');return {profile:c.profile,pressure:c.pressure,human:c.human,hunter:c.hunter,deltaSeconds:c.seconds-base.seconds,deltaCaught:c.caught-base.caught,deltaFirstAttack:c.firstAttackAt===null||base.firstAttackAt===null?null:c.firstAttackAt-base.firstAttackAt,deltaFirstAttackStamina:c.firstAttackStamina===null||base.firstAttackStamina===null?null:c.firstAttackStamina-base.firstAttackStamina};});
const report={scope:`${rows.length} games; ${seeds} paired seeds/cell; horizon40,100 stamina,regen20,runDrain10; fixed candidate comparison, no retraining; existing equilibrium weights do not include these new candidates`,cells,pairs,rows};
await mkdir(output,{recursive:true});await writeFile(output+'report.json',JSON.stringify(report,null,2));
const label={nervous:'焦躁预判',precision_conserve_early30:'持续跑动目押',guard_walk:'持闪走动',pressure_attack:'正常出刀',pressure:'固定长压迫',pressure_adaptive:'识别慢走后出刀'};
const num=(v,n=1)=>v===null?'—':v.toFixed(n),pct=v=>num(v*100)+'%';
const table=cells.map(c=>`<tr><td>${c.profile}/${c.pressure}</td><td>${label[c.human]}</td><td>${label[c.hunter]}</td><td>${num(c.seconds)}</td><td>${pct(c.survive30)}</td><td>${num(c.firstAttackAt)}</td><td>${num(c.firstAttackStamina)}</td><td>${num(c.pressureSeconds)}</td><td>${num(c.pressurePlayerStaminaChange)}</td><td>${num(c.preemptiveDodges,2)}</td><td>${pct(c.caughtAfterPreemptiveDodge)}</td><td>${pct(c.caughtLowStamina)}</td></tr>`).join('');
await writeFile(output+'index.html',`<!doctype html><meta charset="utf-8"><title>贴身压迫对照</title><style>body{font:15px system-ui;background:#101c25;color:#d9e9ee;margin:24px}table{border-collapse:collapse}th,td{padding:9px;border:1px solid #405462;text-align:right}th{position:sticky;top:0;background:#193345}a{color:#72d6ce}</style><h1>贴身压迫：骗闪、耗体与延误攻击</h1><p>${report.scope}</p><p>体力净变仅统计贴身等待且仍在观察范围的时段；包含空闪消耗。抓后摇、低于25体力被抓均以全部对局为分母。三个警察模板使用相同刀型/距离估算参数；自适应只观察公开慢走和闪避。没有将恒定压力自动绑定局势。</p><p>正的追逐时长差表示警察拖延可能有代价，不能只凭首次出刀时体力下降认定剥削成功。JSON包含逐局配对种子与各项差值。</p><table><thead><tr>${['反应/压力','人类','警察','均时/s','≥30s','首刀/s','首刀体力','等待/s','人类体力净变','空闪/局','空闪后摇被抓','低体力被抓'].map(h=>'<th>'+h+'</th>').join('')}</tr></thead><tbody>${table}</tbody></table>`);
console.log('Report: '+output+'index.html');
