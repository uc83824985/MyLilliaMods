import { metres as M, mirrorY, STREET_LENGTH_SCALE, MIRROR_STREET_SHIFT } from './units.mjs';
import { DEFAULT, clone, legacyConfig, MODES, RUN } from './core.mjs';
import { MIRROR_AI_DEFAULTS } from './mirror-ai.mjs';
import {MIRROR_EQUILIBRIUM} from './mirror-equilibrium.mjs';
import {configureOpenDuel,HUMAN_PROFILES,HUMAN_STRATEGIES} from './open-duel-config.mjs';
import {OPEN_DUEL_CANDIDATES} from './open-duel-candidates.mjs';
import {OPEN_TRAINED} from './open-duel-trained.mjs';

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
  ...[['nervous','pressure','焦躁先闪 / 长压迫'],['precision_conserve_early30','pressure','持续跑动 / 长压迫'],['guard_walk','pressure','走动持闪 / 固定长压迫'],['guard_walk','pressure_adaptive','走动持闪 / 识别回体后出刀']].map(([human,hunter,title])=>({id:`open-pressure-${human}-${hunter}`,title:`贴身压迫 · ${title}`,policy:HUMAN_STRATEGIES[human].policy,make:()=>{const c=configureOpenDuel(presetConfig('rhythm-mixed'),{profile:'fast',human,hunter,duration:40});c.duel.pressure=.5;c.duel.objective='endurance';c.duel.selection={human,hunter};return c;},evidence:'0.9m内开始长压迫2.5—5s；看见闪避后经反应延迟尝试攻击。自适应版观察慢走0.2s再经200±40ms反应恢复攻击；不读取人类体力。',check:'持闪走动保留真实反应误差与漏输入，不保证完美。对比正常出刀、固定长压迫和识别走动；现有均衡权重尚未纳入这些新策略。'})),
  ...[['nervous','焦躁预判'],['precision_conserve_early30','提前计划 / 等见红']].map(([human,title])=>({id:`open-bait-${human}`,title:`骗闪对照 · ${title}`,policy:HUMAN_STRATEGIES[human].policy,make:()=>{const c=configureOpenDuel(presetConfig('rhythm-mixed'),{profile:'fast',human,hunter:'bait',duration:40});c.duel.pressure=.5;c.duel.objective='endurance';c.duel.selection={human,hunter:'bait'};return c;},evidence:'给定压力0.5；警察近身持续追踪但暂不出刀，看到闪避后经反应延迟尝试抓后摇。',check:'比较先闪与等见红；空闪方向正确仍可能拉开距离。抓捕日志区分体力足够、行动可用与前闪后摇被抓。'})),
  ...Object.keys(HUMAN_PROFILES).map(profile=>({id:`open-equilibrium-${profile}`,title:`空地均衡候选 · ${profile} · 双方可独立选`,policy:'adaptive',make:()=>{const c=configureOpenDuel(presetConfig('rhythm-mixed'),{profile,duration:40});c.duel.objective='endurance';c.duel.selection={human:'equilibrium',hunter:'equilibrium'};if(OPEN_TRAINED[profile])c.duel.mixtures=clone(OPEN_TRAINED[profile]);return c;},evidence:'100体力、20回体；按本局种子独立抽取双方完整条件策略。有限策略库候选，不是真人GTO。',check:'在人类/警察选择框单独切换均衡或缺陷模板，再应用双方AI。JSON duel.mixtures可独立编辑双方混合权重；白盒显示本局抽中策略。'})),
  ...OPEN_DUEL_CANDIDATES.flatMap(candidate=>[10,20].map(regen=>({id:`open-candidate-${candidate.profile}-${candidate.exposure}-${regen}`,title:`空地候选 · ${candidate.profile} / 暴露${candidate.exposure} / 回体${regen}`,policy:HUMAN_STRATEGIES[candidate.human].policy,make:()=>configureOpenDuel(presetConfig('rhythm-mixed'),{...candidate,regen}),evidence:'训练权重最高的双方策略代表，用于前台检查；不是完整混合均衡。',check:`人类 ${candidate.human}；警察 ${candidate.hunter}。10回体仅为固定策略对照，尚未重新训练。`}))),
  ...['precision_conserve','reverse','spin','close_mix'].flatMap(human=>[10,20].map(regen=>({id:`open-endurance-${human}-${regen}`,title:`空地30秒 · ${human} / 回体${regen}`,policy:'perfect',make:()=>configureOpenDuel(presetConfig('rhythm-mixed'),{profile:'fast',human,regen}),evidence:'固定策略对照，关闭脱身结算；不是GTO。',check:'reverse近身反闪；spin近身蓄力绕身；close_mix结合两者。沿用反应误差与真实碰撞。'}))),
  ...Object.keys(HUMAN_PROFILES).map(profile=>({id:`open-duel-${profile}`,title:`空地博弈 · ${profile}`,policy:'adaptive',make:()=>configureOpenDuel(presetConfig('rhythm-mixed'),{profile}),evidence:'反应延迟、按键时机误差与偶发漏操作；双方策略候选，未证明完整GTO。',check:'JSON duel可调整时机误差、漏操作、走动倾向及警察距离估计误差。无镜子、无建筑。'})),
  ...[['low',.15,'低暴露：转点脱身'],['high',.85,'高暴露：持续攻防']].map(([id,exposure,title])=>({
    id:`mirror-equilibrium-${id}`,title:`镜子均衡候选 · ${title}`,policy:'adaptive',
    make:()=>{const c=presetConfig('mirror-integration-mixed');c.duration=20;c.exposure=exposure;c.mirror.ai.integration.mixtureByExposure=clone(MIRROR_EQUILIBRIUM);return c;},
    evidence:'有限策略库的经验均衡候选；每局独立抽样双方完整条件策略，不代表完整游戏GTO或50%胜率。',
    check:'暴露度低于0.5使用低暴露混合，否则使用高暴露混合。采样策略与分支日志可导出；编辑普通节点权重前需移除JSON中的mixtureByExposure。'
  })),
  ...[['mixed','混合分支'],['run','直跑到另一镜点'],['return','落地准备反传'],['feint','假前走再折返'],['cancel','连线内斜切取消']].map(([style,title])=>({
    id:`mirror-integration-${style}`,title:`镜子集成 · ${title}`,policy:'adaptive',
    make:()=>{const c=presetConfig('mirror-ai-mixed');c.duration=15;c.mirror.ai.integration={corridorWidth:M(2),rules:{}};
      const r=c.mirror.ai.integration.rules;
      if(style==='run')r.approach={'run-exit':{priority:30}};
      if(['return','feint','cancel'].includes(style))r.approach={teleport:{priority:30}};
      if(style==='return')r.landing={return:{priority:30,duration:2}};
      if(style==='feint'){r.landing={feint:{priority:30}};r.departure={'turn-back':{priority:30,duration:2}};}
      if(style==='cancel'){r.casting={cancel:{priority:30}};c.mirror.policeStart={x:M(5.333333333333333),y:mirrorY(-24)};c.mirror.initialCast=true;c.mirror.ai.castResponse='intercept';}
      return c;},
    evidence:'集成候选：延迟观测驱动节点与指令，按合法条件、概率、优先级及权重仲裁；不是固定成功脚本。',
    check:'查看镜子决策日志与分支统计。JSON中mirror.ai.integration.rules可设置节点行动的priority/probability/weight/duration；不突破施法、后摇及封镜限制。'
  })),
  ...[['follow','前走逼出跟传'],['move','前走逼出普通移动追逐'],['return','识别移动追逐后回头反传']].map(([response,title])=>({
    id:`mirror-landing-counter-${response}`,title:`落地应对 · ${title}`,policy:'adaptive',
    make:()=>{const c=presetConfig('mirror-landing-fake-leave');c.mirror.fakeResponse=response==='follow'?'follow':'move';c.mirror.retreatReturn=response==='return';return c;},
    evidence:'条件化后续应对：观察玩家离开出口后止损；回头策略须等待看到警察开始移动。',check:'对照跟传与普通移动追逐；回头反传有接近出口与1秒施法成本，可能被追上打断。'
  })),
  ...[['intercept-return','截出口被反传拉扯'],['follow-return','跟传遇及时反传：双方交错'],['follow-late','跟传封镜打断迟反传'],['fake-return','假跟传守入口抓落地'],['fake-leave','假跟传被前走拉开']].map(([duel,title])=>({
    id:`mirror-landing-${duel}`,title:`落地单元 · ${title}`,policy:'adaptive',
    make:()=>{const c=presetConfig('mirror-follow-return');c.duration=6;c.mirror.landingDuel=duel;c.mirror.initialStamina=60;
      c.mirror.policePolicy=duel.startsWith('fake')?'wait':duel.startsWith('follow')?'delayed':'intercept';
      c.mirror.delay=.6;c.mirror.observeDelay=.25;c.mirror.restartDelay=.35;c.mirror.returnDelay=duel==='follow-late'?1.2:0;c.mirror.fakeResponse='follow';c.mirror.playerPolicy=duel==='fake-leave'?'leave':'return';
      c.mirror.policeStart=duel==='intercept-return'?{x:M(-6),y:mirrorY(-24)}:{...c.mirror.points[0],y:c.mirror.points[0].y-M(.4)};
      return c;},
    evidence:'条件化固定策略单元：从A已传到B、落地后摇开始。脚本时序公开，不代表反应AI或策略胜率。',
    check:'B落地1s；及时反传约2.01s完成，迟反传约3.21s完成。跟传0.6s启动、2.6s封镜，之后锁向1s。可接管改变选择；警察跟传前摇与原地等待外观相同。'
  })),
  {id:'mirror-search-old',title:'镜子对照 · 关闭另一镜点检查',policy:'adaptive',make:()=>{const c=presetConfig('mirror-ai-fake');c.mirror.ai.checkOtherMirror=false;return c;},evidence:'同样的长街与假跟随策略，仅关闭镜点失踪后的定向检查。',check:'与镜子AI偏科假跟随等待对照；观察另一镜点是否因警察朝向而长期丢失。'},
  {id:'mirror-short-street',title:'镜子对照 · 原短街道',policy:'adaptive',make:()=>{const c=presetConfig('mirror-ai-fake');c.mapLengthScale=1;for(const p of [...c.mirror.points,c.mirror.policeStart])p.y+=MIRROR_STREET_SHIFT;return c;},evidence:'保留短街道对照，街宽、镜间距离与检查另一镜点逻辑一致。',check:'对照出镜后到拐角的距离；不要把20秒超时视为成功脱身。'},
  ...[['pressure','压入口：维持施法'],['intercept','真截出口：观察后取消'],['feint','假截出口：识别短假动作']].map(([response,title])=>({
    id:`mirror-cancel-${response}`,title:`取消单元 · ${title}`,policy:'adaptive',
    make:()=>{const c=presetConfig('mirror-ai-mixed');c.duration=6;c.mirror.initialCast=true;c.mirror.initialStamina=60;c.mirror.cancelMode='recovery';c.mirror.ai.castResponse=response;c.mirror.policeStart={x:0,y:mirrorY(-24)};return c;},
    evidence:'条件化单元：从入口已经开始施法切入，双方后续仍使用延迟观测；不证明起手选择最优。',
    check:'F施法1s，G取消后原地收招1s；与出镜共用后摇参数，前后摇体力冻结。短施法可能先于AI识别威胁完成，需对照实际事件。'
  })),
  ...[['short-lead','距离不足先应对'],['triangle','警察斜切出口'],['short-observe','对照：短观察窗口'],['long-landing','对照：较长落地恢复']].map(([variant,title])=>({
    id:`mirror-ai-${variant}`,title:`镜子AI · ${title}`,policy:'adaptive',make:()=>{const c=presetConfig(variant==='short-observe'?'mirror-ai-intercept':'mirror-ai-mixed');
      if(variant==='short-lead')c.mirror.policeStart={x:M(-14),y:mirrorY(-24)};
      if(variant==='triangle')c.mirror.policeStart={x:M(3),y:mirrorY(-27)};
      if(variant==='short-observe')c.mirror.ai.observeSeconds=.8;
      if(variant==='long-landing')c.mirror.playerRecovery=1.2;
      return c;},evidence:'镜子AI条件对照；保留失败边界与未选用参数供实测。',check:'对照足够领先时进镜、近身先应对、出口被占时放弃交互；不是保证成功的脚本。'
  })),
  ...[['mixed','混合决策'],['follow','偏科：跟随封镜'],['wait','偏科：守入口'],['intercept','偏科：截出口'],['fake','偏科：假跟随等待']].map(([style,title])=>({
    id:`mirror-ai-${style}`,title:`镜子AI · ${title}`,policy:'adaptive',
    make:()=>{const c=presetConfig('mirror-follow-return');c.duration=20;c.search={...presetConfig('rhythm').search};c.mirror.policeStart={x:M(-26),y:mirrorY(-24)};c.mirror.ai={...MIRROR_AI_DEFAULTS};
      if(style!=='mixed')for(const key of ['follow','wait','intercept','fake'])c.mirror.ai[`${key}Weight`]=key===style?8:.2;
      return c;},evidence:'双方只使用延迟的合法观测；跟随准备不公开给人类AI。阶段候选，未证明均衡。',
    check:'观察入口安全判断、带代价取消、反传/转点及警察等待/截出口/封镜。F交互、G取消并原地收招；可手动接管。'
  })),
  ...[['follow','return','跟随封镜'],['wait','return','守入口抓反传'],['wait','leave','守入口对照直接转点'],['intercept','return','直奔出口与反传'],['delayed','return','延迟跟随'],['idle','run','纯跑路线基线'],['idle','return','往返时序基线']].map(([policePolicy,playerPolicy,title])=>({
    id:`mirror-${policePolicy}-${playerPolicy}`,title:`镜子单元 · ${title}`,policy:'adaptive',
    make:()=>{const c=presetConfig('rhythm');c.duration=12;c.spawn='street';delete c.search;c.visionRange=M(60);
      c.mirror={points:[{x:M(-10),y:mirrorY(-26)},{x:M(10),y:mirrorY(-19)}],policeStart:{x:M(-23),y:mirrorY(-24)},range:M(1),playerWindup:1,playerRecovery:1,policeWindup:2,policeRecovery:1,delay:2.5,policePolicy,playerPolicy};return c;},
    evidence:'独立已知策略单元；两镜斜向错位，单侧各一次。不是完整追逐胜率或反应型AI。',
    check:'F交互，G取消并原地收招；收招与出镜共用后摇参数。落地和闪避后摇禁止交互。警察跟随完成时封镜；双方镜子交互期间体力冻结。'
  })),
  {id:'rhythm-charge-long-range',title:'对照 · 上版长判定蓄力刀',policy:'adaptive',make:()=>{const c=presetConfig('rhythm-charge');Object.assign(c.capture.lunge,{trigger: M(3.1),radius: M(2.1),angle:65,turnRate:540});return c;},evidence:'保留上版0.60s、540°/s、1.575m判定与2.325m出手距离。',check:'与当前360°/s、1.125m判定、1.95m出手对照，检查近身绕行手感。'},
  {id:'rhythm-charge-slow-turn',title:'对照 · 蓄力刀慢转向',policy:'adaptive',make:()=>{const c=presetConfig('rhythm-charge');c.capture.lunge.turnRate=180;return c;},evidence:'与当前仅蓄力刀只差转向：旧180°/s，对照当前360°/s。',check:'比较侧移、晚绕身与提前紧贴螺旋；其余参数相同。'},
  {id:'rhythm-flat-recovery',title:'对照 · 上版固定后摇',policy:'adaptive',make:()=>{const c=presetConfig('rhythm-mixed');Object.assign(c.dodge,{startup:.04,multiplier:2.2,duration:.3,recovery:.4,recoveryScale:.35,recoveryCurve:'constant',perfectDelay:.04,perfectDuration:.06});c.perfectBonus.playerRecoveryScale=.5;return c;},evidence:'完整保留上一版闪避：2.2倍突进0.30s、35%固定移速后摇0.40s、完美窗口0.06s。',check:'其余双方参数与当前混合压力一致，便于比较完整的新旧手感。'},
  {id:'rhythm-short-dodge',title:'对照 · 旧短闪避',policy:'adaptive',make:()=>{const c=presetConfig('rhythm-mixed');Object.assign(c.dodge,{multiplier:1.6,duration:.22});return c;},evidence:'与当前混合压力只差闪避前冲：1.6倍、0.22s、约1.66m。',check:'对照提前闪后过早进入减速恢复的问题；其他双方性能与当前候选一致。'},
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
    c.mapLayout='ring';c.mapLengthScale=STREET_LENGTH_SCALE;
    Object.assign(c.dodge,{startup:0,multiplier:2,duration:.3,perfectDelay:0,perfectDuration:.1,recovery:.6,recoveryScale:0,recoveryCurve:'linear'});
    c.capture.missRecovery = 1.5; c.capture.recoveryFov = 120;
    c.player.solidPolice=true;
    c.player.runDrain=10;
    // Legacy mode keys remain loadable, but rhythm light attacks use one coherent rule.
    for(const mode of ['stand','stride','sweep']) Object.assign(c.capture[mode],{trigger: M(1.4),radius: M(1.5),angle:100,moveScale:1,followAim:true,windup:.3,moveFrom:0,trackUntil:.295,turnRate:900,sweep:0,active:0});
    Object.assign(c.capture.lunge,{trigger: M(2.6),radius: M(1.5),angle:100,windup:.6,trackUntil:.6,turnRate:360,moveFrom:0,moveScale:1.2});
    c.search = { moveScale: .8, fov: 120, scanSeconds: 2.4, scanTurnRate: 150, budgetSeconds: 8, hearingRange: M(8), soundInterval: .6, maxPoints: 2, departureBias: .8 };
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
  return `跑速 / 步速 ${RUN.toFixed(3)} / ${(RUN*c.player.walkScale).toFixed(3)}m/s（跑/走 ${(1/c.player.walkScale).toFixed(3)}倍） · 闪避突进 ${(RUN * c.dodge.multiplier * c.dodge.duration).toFixed(2)}m（无墙） · 启动 ${c.dodge.startup}s / 突进 ${c.dodge.duration}s / 恢复 ${c.dodge.recovery}s · 成本 ${c.dodge.cost} · 完美窗口 ${(1000 * (c.dodge.startup + c.dodge.perfectDelay)).toFixed(0)}–${(1000 * (c.dodge.startup + c.dodge.perfectDelay + c.dodge.perfectDuration)).toFixed(0)}ms`;
}
