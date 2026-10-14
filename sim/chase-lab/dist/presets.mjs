import { DEFAULT, clone, legacyConfig, MODES, RUN } from './core.mjs';

const baseline = () => clone(DEFAULT);
function single(mode, style = null) {
  const c = baseline(); c.weights = Object.fromEntries(MODES.map(m => [m, +(m === mode)]));
  if (style === 'anticipate') Object.assign(c.behavior, { anticipation: 1, perfectPreference: 0 });
  if (style === 'perfect') {
    Object.assign(c.reaction, { mean: .12, jitter: .015 });
    Object.assign(c.behavior, { perfectPreference: 1, motorErrorDegrees: 2 });
  }
  return c;
}
export const PRESETS = [
  {id:'rhythm-charge-long-range',title:'对照 · 上版长判定蓄力刀',policy:'adaptive',make:()=>{const c=presetConfig('rhythm-charge');Object.assign(c.capture.lunge,{trigger:3.1,radius:2.1,angle:65,turnRate:540});return c;},evidence:'保留上版0.60s、540°/s、2.1m判定与3.1m出手距离。',check:'与当前360°/s、1.5m判定、2.6m出手对照，检查近身绕行手感。'},
  {id:'rhythm-charge-slow-turn',title:'对照 · 蓄力刀慢转向',policy:'adaptive',make:()=>{const c=presetConfig('rhythm-charge');c.capture.lunge.turnRate=180;return c;},evidence:'与当前仅蓄力刀只差转向：旧180°/s，对照当前360°/s。',check:'比较侧移、晚绕身与提前紧贴螺旋；其余参数相同。'},
  {id:'rhythm-flat-recovery',title:'对照 · 上版固定后摇',policy:'adaptive',make:()=>{const c=presetConfig('rhythm-mixed');Object.assign(c.dodge,{startup:.04,multiplier:2.2,duration:.3,recovery:.4,recoveryScale:.35,recoveryCurve:'constant',perfectDelay:.04,perfectDuration:.06});c.perfectBonus.playerRecoveryScale=.5;return c;},evidence:'完整保留上一版闪避：2.2倍突进0.30s、35%固定移速后摇0.40s、完美窗口0.06s。',check:'其余双方参数与当前混合压力一致，便于比较完整的新旧手感。'},
  {id:'rhythm-short-dodge',title:'对照 · 旧短闪避',policy:'adaptive',make:()=>{const c=presetConfig('rhythm-mixed');Object.assign(c.dodge,{multiplier:1.6,duration:.22});return c;},evidence:'与当前混合压力只差闪避前冲：1.6倍、0.22s、约2.21m。',check:'对照提前闪后过早进入减速恢复的问题；其他双方性能与当前候选一致。'},
  {id:'stealth-search',title:'实验 · 隐身与证据搜索',policy:'manual',make:()=>{const c=presetConfig('rhythm-mixed');c.stealth={duration:2,cooldown:8};c.search.blindProbes=true;return c;},evidence:'独立技能实验：E隐身2秒，结束后冷却8秒；隐身不消音、不取消实体碰撞或受击。',check:'接管后尝试隐身反走、静止或Shift步行。警察按最后证据搜索，每轮最多两次试探轻刀；真实碰撞可触发试探。AI尚未学习使用隐身，不用于技能胜率结论。'},
  {id:'rhythm-light',title:'攻防节奏 · 仅轻刀',policy:'adaptive',make:()=>{const c=presetConfig('rhythm-mixed');c.weights={stand:1,stride:0,sweep:0,lunge:0};return c;},evidence:'与混合压力共用参数，仅将出刀权重设为100%轻刀。',check:'完整追逐对照；近身应对单元仍使用“出刀应对后绕后”入口。'},
  {id:'rhythm-charge',title:'攻防节奏 · 仅蓄力刀',policy:'adaptive',make:()=>{const c=presetConfig('rhythm-mixed');c.weights={stand:0,stride:0,sweep:0,lunge:1};return c;},evidence:'与混合压力共用参数，仅将出刀权重设为100%蓄力刀。',check:'观察突进期间的有限转向、弯曲轨迹与螺旋绕行的朝向误差；无硬锁向保证。'},
  {id:'drill-charge',title:'单元 · 蓄力前冲刀',policy:'adaptive',make:()=>{const c=presetConfig('drill-response');c.drill.mode='lunge';c.weights={stand:0,stride:0,sweep:0,lunge:1};return c;},evidence:'蓄力0.60秒，全程以正常警察跑速1.2倍前进；360°/s跟踪至结束判定。',check:'近身角速度超过转向能力时会跟丢；失去视野只朝最后目击位置修正。可切换应对脚本或接管螺旋绕行，观察最终朝向误差。'},
  ...['same','cross','circle'].map(exit=>({id:`drill-${exit}`,title:`单元 · 落空后${{same:'同侧绕后',cross:'背后换侧',circle:'近身绕一圈'}[exit]}`,policy:'adaptive',make:()=>{
    const c=presetConfig('rhythm');c.duration=6;c.weights={stand:1,stride:0,sweep:0,lunge:0};c.drill={entry:'recovery',mode:'stand',response:'perfect',exit,side:1,walk:true};return c;
  },evidence:'条件化单元场景：直接从已落空后摇开始，不计接近成功率或闪避胜率。',check:'固定位置、近身绕行、不选逃跑路线。可切换出刀入口、应对时机、绕后方式、步行/跑动；用于测重新发现时间，可手动接管。'})),
  {id:'drill-response',title:'单元 · 出刀应对后绕后',policy:'adaptive',make:()=>{
    const c=presetConfig('drill-cross');c.drill.entry='attack';return c;
  },evidence:'固定近距离直接出刀，脚本按已知时序测试；不代表真人反应。',check:'先核对早闪/完美/迟闪/不闪是否通过，再看后摇绕后。失败样本保留，不能与直接后摇场景混算。'},
  { id: 'rhythm-perfect', title: '③ 攻防节奏 · 完美奖励对照', policy: 'perfect', make: () => {
    const c=presetConfig('rhythm'); c.weights={stand:1,stride:0,sweep:0,lunge:0}; c.reaction.mean=.12; c.reaction.jitter=.015;
    c.duration=6;c.drill={entry:'attack',mode:'stand',response:'perfect',exit:'cross',side:1,walk:true};return c;
  }, evidence: '改为单元演示：直接近距出刀，固定完美时序，再步行背后换侧，排除接近绕圈。', check: '先看行进轻刀完美接触后的体力、无减速后摇和1.5s警察后摇；可接管。此处脚本知道时序，不使用反应参数，不计真人成功率。' },
  { id: 'rhythm-mixed', title: '④ 攻防节奏 · 混合压力对照', policy: 'adaptive', make: () => {
    const c=presetConfig('rhythm'); c.weights={stand:1,stride:0,sweep:0,lunge:1}; return c;
  }, evidence: '沿用长后摇、有限视野及搜索循环，混合平衡待验证。', check: '用于检查单一动作下成立的后撤或绕后策略是否仍是通解；不自动替换旧版混合基线。' },
  { id: 'rhythm', title: '③ 攻防节奏 · 后摇绕后回体', policy: 'adaptive', make: () => {
    const c = single('stand'); c.spawn = 'corner'; c.exposure = .15;
    c.mapLayout='ring';
    Object.assign(c.dodge,{startup:0,multiplier:2,duration:.3,perfectDelay:0,perfectDuration:.1,recovery:.6,recoveryScale:0,recoveryCurve:'linear'});
    c.capture.missRecovery = 1.5; c.capture.recoveryFov = 120;
    c.player.solidPolice=true;
    c.player.runDrain=10;
    // Legacy mode keys remain loadable, but rhythm light attacks use one coherent rule.
    for(const mode of ['stand','stride','sweep']) Object.assign(c.capture[mode],{trigger:1.4,radius:1.5,angle:100,moveScale:1,followAim:true,windup:.3,moveFrom:0,trackUntil:.295,turnRate:900,sweep:0,active:0});
    Object.assign(c.capture.lunge,{trigger:2.6,radius:1.5,angle:100,windup:.6,trackUntil:.6,turnRate:360,moveFrom:0,moveScale:1.2});
    c.search = { moveScale: .8, fov: 120, scanSeconds: 2.4, scanTurnRate: 150, budgetSeconds: 8, hearingRange: 8, soundInterval: .6, maxPoints: 2, departureBias: .8 };
    Object.assign(c.perfectBonus, { refund: c.dodge.cost, playerRecoveryScale: 0, policeRecoveryScale: 1 });
    return c;
  }, evidence: '阶段候选：普通与完美落空均1.5s；锁定最终出刀方向，后摇视野120°。',
    check: '完美全额返25体力、自身无减速后摇；步行和停下均20体力/s。Shift绕后或转角回体。丢失目标后80%先查最后目击的离开侧，20%反查；真实新声音可改变调查方向。' },
  { id: 'practice', title: '① 玩家性能 · 无追兵练习', policy: 'manual', make: () => ({ ...presetConfig('rhythm'), practice: true, duration: 120 }),
    evidence: '移动、碰撞、闪避时序和体力规则回归通过；真人手感待确认。',
    check: '先检查直线、转角、连续闪避与恢复减速是否自然。警察冻结，不计脱身；本场不用于胜率或平衡搜索。' },
  { id: 'anticipate', title: '② 玩家倾向 · 提前预判', policy: 'anticipate', make: () => single('stand', 'anticipate'),
    evidence: '已验证：贴身出刀开始时立即后撤闪避可出圈；不代表整场预判策略占优。',
    check: '与完美流共用闪避性能；本预设AI为220±40ms，完美预设为120±15ms，比较策略时请统一反应档。当前重点观察是否过早消耗，以及能否诱导出刀后反制。' },
  { id: 'perfect', title: '② 玩家倾向 · 快速稳定完美', policy: 'perfect', make: () => single('stand', 'perfect'),
    evidence: '已验证：短窗口真实接触保护一次，返还体力并缩短恢复；真人目押难度待确认。',
    check: 'AI 反应120±15ms。接管后反应参数不延迟真人输入。检查窗口与奖励是否值得冒险，失败后是否仍有选择。' },
  ...MODES.map(mode => ({ id: `single-${mode}`, title: `③ 单策略 · ${{ stand: '贴身跟踪', stride: '直线行进', sweep: '定向横扫', lunge: '承诺扑抓' }[mode]}`, policy: 'adaptive', make: () => single(mode),
    evidence: mode === 'stand' ? '已验证：已启动的贴身跟踪反制普通后撤和紧绕身。持续追逐平衡未确认。' : mode === 'stride' ? '已验证：身体直线运动与朝向跟踪独立。各类玩家反制成功率待确认。' : '动作可以运行；流派平衡待验证，尚非推荐数值。',
    check: '以下为寻路修正前的8种子历史基线，当前AI需重新对照：' + ({ stand: '绕身62.5%无交锋；其他对照均被抓。需要分别检查接近能力与资源反制，不能仅扩大命中范围。', stride: '后撤被抓100%，绕身12.5%，预判87.5%。已有方向差异，优先真人检查绕身操作与闪避收益。', sweep: '绕身50%无交锋，其余对照均被抓。接近与反制都待调整。', lunge: '绕身被抓37.5%，其他常规对照100%。需检查闪避方向、时机与锁向后位移。' })[mode] + ' 小样本仅用于排查，非稳定胜率。' })),
  { id: 'candidate', title: '④ 混合压力 · 未收敛对照', policy: 'adaptive', make: baseline,
    evidence: '基础规则通过；混合与偏科的完整平衡目标尚未通过。', check: '仅在玩家手感与单策略可反制性确认后使用。不以一味提高警察胜率作为目标。' },
  { id: 'corner-stride', title: '③ 转角对照 · 直线行进', policy: 'anticipate', make: () => ({ ...single('stride'), spawn: 'corner', exposure: .15 }),
    evidence: '路径分段可通行与即时自身定位通过回归；尚未验证完整转角诱导博弈。',
    check: '青色虚线显示下一路点。观察连续绕街区、转角遮挡与恢复期被追近；断线不足时只算存活，不算脱身。可接管尝试转角骗出手。' },
  { id: 'legacy', title: '历史对照 · 0.1.3几何基线', policy: 'reactive', make: legacyConfig,
    evidence: '已复现看红200ms后后撤闪避仍出圈。', check: '用于对照旧版问题，不作为推荐流派。' }
];
export function presetConfig(id) {
  const p = PRESETS.find(p => p.id === id); if (!p) throw new Error(`Unknown preset: ${id}`);
  const c = p.make(); c.name = p.title; return c;
}
export function playerReadout(c) {
  return `普通跑速 ${RUN.toFixed(3)}m/s · 闪避突进 ${(RUN * c.dodge.multiplier * c.dodge.duration).toFixed(2)}m（无墙） · 启动 ${c.dodge.startup}s / 突进 ${c.dodge.duration}s / 恢复 ${c.dodge.recovery}s · 成本 ${c.dodge.cost} · 完美窗口 ${(1000 * (c.dodge.startup + c.dodge.perfectDelay)).toFixed(0)}–${(1000 * (c.dodge.startup + c.dodge.perfectDelay + c.dodge.perfectDuration)).toFixed(0)}ms`;
}
