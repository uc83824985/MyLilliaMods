import { metres as M } from './units.mjs';
import { mirrorInput } from './mirrors.mjs';
import {COMMAND_LABELS} from './mirror-decisions.mjs';
import { World, DEFAULT, legacyConfig, BASE, RUN, MODES, LABELS, clone, validate, dist, recoveryMoveScale } from './core.mjs';
import { Bot, POLICIES } from './bots.mjs';
import { PRESETS, presetConfig, playerReadout } from './presets.mjs';
import { perfectCue } from './effects.mjs';
import { perceptionCue, playerCue } from './perception.mjs';
import { drillInput, drillSummary } from './drills.mjs';
import {HUMAN_STRATEGIES,HUNTER_STRATEGIES} from './open-duel-config.mjs';
import {operationParameters} from './ai-operation.mjs';
const $ = id => document.getElementById(id), canvas = $('arena'), ctx = canvas.getContext('2d');
const humanLabels={equilibrium:'均衡候选（按种子混合）',precision:'目押 / 仅后摇恢复',precision_conserve:'目押 / 安全窗口恢复',predict:'提前预判',adaptive:'学习混合',distance:'缺陷：持续拉距、很少恢复',retreat:'缺陷：只后撤、不闪避',reverse:'近身反闪（剥削搜索弱点）',spin:'近身重刀人皇步',close_mix:'反闪＋重刀人皇步'};
const hunterLabels={equilibrium:'均衡候选（按种子混合）',fixed:'固定出刀节奏',light:'偏科：仅轻刀',charge:'偏科：仅蓄力刀',mixed:'轻重混合',patient:'耐心近身',aggressive:'激进重刀',slow_scan:'缺陷：慢扫视45°/s、扫视5s',fixed_light:'缺陷：固定距离轻刀、无等待',overreach:'缺陷：高估距离0.55m、频繁扑空'};
humanLabels.nervous='焦躁预判（近身久等可能先闪）';hunterLabels.bait='近身压迫 / 等闪后抓后摇';
Object.assign(hunterLabels,{pressure_attack:'压迫对照：正常出刀',pressure:'贴身长压迫：等闪 / 消耗跑动',pressure_adaptive:'贴身长压迫：观察走动后出刀'});
for(const [name,s] of Object.entries(HUMAN_STRATEGIES))if(s.safetyLead)humanLabels[name]=`${humanLabels[s.tactic]} / 计划提前${Math.round(s.safetyLead*1000)}ms`;
humanLabels.guard_walk='贴身持闪走动 / 提前30ms目押';
for(const [id,labels] of [['open-human',humanLabels],['open-hunter',hunterLabels]])$(id).replaceChildren(...Object.entries(labels).map(([value,label])=>{const o=document.createElement('option');o.value=value;o.textContent=label;return o;}));
function syncOpenChoices(){
 $('open-ai-controls').hidden=!draft.duel;
 if(!draft.duel)return;
 $('open-human').value=draft.duel.selection?.human??draft.duel.human;
 $('open-hunter').value=draft.duel.selection?.hunter??draft.duel.hunter;
 $('open-defects').textContent='缺陷模板不会使对手自动识别弱点。反闪须靠真实转向/视野获利；均衡策略不保证最强剥削。贴身持闪与长压迫为新增对照，尚未纳入均衡训练。选择修改后应用，保持种子与接管状态。';
}
for(const id of ['open-human','open-hunter'])$(id).onchange=()=>{draft.duel.selection={human:$('open-human').value,hunter:$('open-hunter').value};syncJSON();$('dirty').textContent='待应用';};
$('apply-open-ai').onclick=()=>reset();
$('native-speed').textContent = `${BASE.nativeRunSpeed} m/s`;
$('global-scale').textContent = `×${BASE.globalScale} 固定`;
$('street-width').textContent = `${(RUN*2).toFixed(2)} m`;
let draft = clone(DEFAULT), world, bot, paused = true, accumulator = 0, previousTime = 0, keys = new Set(), dodgePending = false, stealthPending = false, replay = null, replayIndex = 0, replayInput = {}, inputs = [], lastInput = '', report = null, worker = null, frames = [];
const commandPanel=document.createElement('div');commandPanel.id='mirror-command-panel';commandPanel.hidden=true;
let pendingMirrorCommands=[];
commandPanel.innerHTML='<label>集成测试：发起一次指令<select id="mirror-command-actor"><option value="player">玩家</option><option value="police">警察（确认传送后）</option></select><select id="mirror-command"></select></label><button id="issue-mirror-command">发起指令（优先级50，持续1s）</button><p id="mirror-branch-summary" class="hint"></p>';
$('ai-intent').after(commandPanel);
for(const [value,label] of Object.entries(COMMAND_LABELS))$('mirror-command').add(new Option(label,value));
$('issue-mirror-command').onclick=()=>{if(replay||$('policy').value==='manual'){message('请在AI集成场景中发起指令。',true);return;}pendingMirrorCommands.push({action:$('mirror-command').value,options:{actor:$('mirror-command-actor').value,priority:50,duration:1}});message('已提交；下一决策点检查合法条件，非法指令会被拒绝。');};
const fields = [
  ['player.staminaMax','主角体力上限',100,200,5],
  ['player.runDrain', '跑动体力消耗 / 秒', 0, 30, 1],
  ['exposure', '暴露度', 0, 1, .05], ['reaction.mean', 'AI 反应基准延迟 / 秒', .06, .4, .01], ['reaction.jitter', '逐次反应标准差 / 秒', 0, .12, .005], ['reaction.decisionHz', '操作决策频率 / Hz', 10, 120, 5],
  ['behavior.anticipation', '预判倾向', 0, 1, .05], ['behavior.perfectPreference', '完美倾向', 0, 1, .05], ['behavior.footwork', '绕身倾向', 0, 1, .05], ['behavior.retreat', '后撤倾向', 0, 1, .05], ['behavior.learning', '频率学习敏感度', 0, 1, .05], ['behavior.motorErrorDegrees', '方向操作误差标准差 / °', 0, 25, 1],
  ['police.speedScale', '警察移速 / 缩放后跑速', .7, 1.5, .01], ['police.turnRate', '警察移动转向 / °每秒', 60, 540, 10], ['police.drain', '警察体力消耗 / 秒', 0, 20, 1],
  ['dodge.multiplier', '闪避移速 / 缩放后跑速', .5, 3, .05], ['dodge.duration', '突进时间 / 秒', .08, .5, .01], ['dodge.cost', '闪避体力成本', 0, 60, 1],
  ['dodge.recovery', '闪避恢复 / 秒', .1, 1, .01], ['dodge.recoveryScale', '恢复最低移动倍率', 0, 1, .05], ['dodge.perfectDuration', '完美窗口 / 秒', 0, .3, .01],
  ['perfectBonus.refund', '完美返还体力', 0, 25, 1], ['perfectBonus.playerRecoveryScale', '完美后自身恢复时长倍率', 0, 1, .05], ['perfectBonus.policeRecoveryScale', '完美后警察恢复时长倍率', 1, 2.5, .1],
  ['capture.windup', '抓捕前摇 / 秒', .16, .6, .01], ['capture.missRecovery', '扑空恢复 / 秒', .1, 3, .05],
  ['capture.recoveryFov', '后摇固定视野角 / °', 30, 360, 10], ['player.walkRegen', '步行 / 停止回体 / 秒', 0, 50, 1], ['player.walkScale', '步速 / 跑速（游戏步行×3）', .1, 1, 'any'],
  ...MODES.map(m => [`weights.${m}`, `${LABELS[m]}权重`, 0, 10, .5])
];
function get(o, path) { const value=path.split('.').reduce((a,k)=>a[k],o);if(value!==undefined)return value;return path.endsWith('.windup')?o.capture.windup:path.endsWith('.moveFrom')?(path.includes('.lunge.')?o.capture.lunge.trackUntil:0):path==='capture.recoveryFov'?360:undefined; }
function set(o, path, value) { const parts = path.split('.'), k = parts.pop(); parts.reduce((a, k) => a[k], o)[k] = value; }
function parameter(spec, parent) {
  const [path, label, rawMin, rawMax, rawStep] = spec, div = document.createElement('div'); div.className = 'parameter';
  const spatial = /\.(trigger|radius)$/.test(path) || path === 'mirror.ai.returnMargin';
  const min = spatial ? M(rawMin) : rawMin, max = spatial ? M(rawMax) : rawMax, step = spatial ? .005 : rawStep;
  const id = `p-${path}`;
  const digits = step === 'any' ? 4 : step < .01 ? 3 : 2;
  div.innerHTML = `<label for="${id}">${label}<output>${get(draft, path).toFixed(digits)}</output></label><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${get(draft, path)}">`;
  div.querySelector('input').addEventListener('input', e => { set(draft, path, +e.target.value); div.querySelector('output').textContent = (+e.target.value).toFixed(digits); syncJSON(); $('dirty').textContent = '待应用'; }); parent.append(div);
}
function controls() {
  syncOpenChoices();
  $('parameters').replaceChildren(); $('attacks').replaceChildren();
  if(draft.duel){draft.duel.pressure??=0;parameter(['duel.pressure','给定压力（0无附加压力 / 1高压）',0,1,.05],$('parameters'));}
  fields.forEach(f => parameter(f, $('parameters')));
  if(draft.mirror)for(const [k,label] of [['playerWindup','玩家镜子施法'],['playerRecovery','玩家落地恢复'],['policeWindup','警察跟随前摇'],['policeRecovery','警察落地锁视角'],['delay','延迟跟随等待']])parameter([`mirror.${k}`,`${label} / 秒`,0,5,.05],$('parameters'));
  if(draft.mirror?.landingDuel)for(const [k,label,max] of [['observeDelay','镜子应对反应延迟',.6],['restartDelay','封镜打断起步延迟',.5],['returnDelay','落地后等待反传',3]])parameter([`mirror.${k}`,`${label} / 秒`,k==='restartDelay'?.2:0,max,.05],$('parameters'));
  if(draft.mirror?.ai)for(const [k,label,max] of [['playerDelay','镜子人类反应 / 秒',.6],['policeDelay','镜子警察反应 / 秒',.6],['observeSeconds','出口观察上限 / 秒',2],['returnMargin','反传额外收益门槛 / 米',6],['followWeight','跟随权重',10],['interceptWeight','截出口权重',10],['waitWeight','守入口权重',10],['fakeWeight','假跟随等待权重',10]])parameter([`mirror.ai.${k}`,label,0,max,k==='returnMargin'?.005:.05],$('parameters'));
  for (const m of MODES) {
    const h = document.createElement('h3'); h.textContent = `${draft.capture[m].moveScale===0?'轻刀':'带位移'} · ${LABELS[m]}`; $('attacks').append(h);
    parameter([`capture.${m}.windup`,'本动作前摇 / 秒',.1,1.2,.01],$('attacks'));
    parameter([`capture.${m}.moveFrom`,'前冲启动时刻 / 秒',0,1.2,.01],$('attacks'));
    for (const [key, name, min, max, step] of [['trigger', '出手距离 / m', .3, 4, .05], ['radius', '命中半径 / m', .5, 4, .05], ['angle', '命中完整角 / °', 30, 180, 5], ['moveScale', '动作移动倍率', 0, 2.5, .05], ['trackUntil', '跟踪结束时刻 / s', 0, 1.2, .005], ['turnRate', '动作跟踪角速度 / °每秒', 0, 1080, 30], ['active', '有效判定时段 / s', 0, .3, .01], ['sweep', '横扫总角 / °', 0, 180, 5]]) parameter([`capture.${m}.${key}`, name, min, max, step], $('attacks'));
  }
  $('spawn').value = draft.spawn;
  $('map-layout').value=draft.mapLayout??'grid';
  $('drill-controls').hidden = !draft.drill;
  if (draft.drill) for(const key of ['entry','mode','response','exit','side','walk']) $('drill-'+key).value=String(draft.drill[key]);
  syncJSON();
}
function syncJSON() { $('json').value = JSON.stringify(draft, null, 2); $('player-readout').textContent = playerReadout(draft); }
function message(text, error = false) { $('message').textContent = text; $('message').style.color = error ? '#ff6374' : ''; }
function reset(config = draft, seed = +$('seed').value) {
  if (!Number.isInteger(seed)||seed<0||seed>4294967295||$('seed').value==='') {message('种子需要0–4294967295范围内的整数',true);return false;}
  const errors = validate(config); if (errors.length) { message(errors.join('；'), true); return false; }
  world = new World(config, seed); bot = new Bot(config, seed, $('policy').value === 'manual' ? 'adaptive' : $('policy').value);
  $('duration').value=String(world.config.duration);
  const operation=operationParameters(world.config);
  $('open-pressure-readout').textContent=world.config.duel?`操作模型：反应${Math.round(operation.mean*1000)}±${Math.round(operation.jitter*1000)}ms；按键时机误差σ${Math.round(operation.timingSigma*1000)}ms；每刀漏输入${(operation.lapseProbability*100).toFixed(1)}%。压力为手动给定值；系数尚未真人校准。`:'';
  $('open-active').textContent=world.config.duel?`本局：人类 ${humanLabels[world.config.duel.human]} / 警察 ${hunterLabels[world.config.duel.hunter]}；压力 ${world.config.duel.pressure??0}。均衡权重在压力0训练，修改压力为固定策略压力测试。空地AI选择优先于下方通用AI，玩家接管仍有效。`:'';
  $('seed').value=String(world.seed);canvas.dataset.seed=String(world.seed);
  $('map-label').textContent=world.map.layout==='open'?'俯视 · 米制 · 无障碍空地':world.map.layout==='ring'?'俯视 · 米制 · 回字单街区':'俯视 · 米制 · 田字四街区';
  syncZoom();
  inputs = []; lastInput = ''; replay = null; frames = []; accumulator = 0; paused = true; keys.clear(); dodgePending = false; stealthPending = false;pendingMirrorCommands=[];
  $('dirty').textContent = '已应用'; $('run-label').textContent = `${config.name} · 种子 ${world.seed}`; syncControlState(); message('参数已应用。点击开始，或玩家接管后开始。'); return true;
}
function record(input) { const str = JSON.stringify(input); if (str !== lastInput) { inputs.push({ tick: world.tick + 1, input: clone(input) }); lastInput = str; } }
function step() {
  if (world.result) { paused = true; return; }
  let input;
  if (replay) {
    if (world.tick >= replay.endTick) { paused = true; return; }
    while (replayIndex < replay.inputs.length && replay.inputs[replayIndex].tick <= world.tick + 1) replayInput = replay.inputs[replayIndex++].input;
    input = replayInput;
  } else if ($('policy').value === 'manual') {
    input = { x: +(keys.has('KeyD') || keys.has('ArrowRight')) - +(keys.has('KeyA') || keys.has('ArrowLeft')), y: +(keys.has('KeyS') || keys.has('ArrowDown')) - +(keys.has('KeyW') || keys.has('ArrowUp')), dodge: dodgePending, stealth: stealthPending, mirror: keys.has('KeyF'), cancelMirror: keys.has('KeyG'), walk: keys.has('ShiftLeft') || keys.has('ShiftRight') }; dodgePending = false; stealthPending = false;
  } else input = world.config.mirror ? mirrorInput(world) : world.config.drill ? drillInput(world) : bot.action(world);
  if(!replay&&pendingMirrorCommands.length)input={...input,mirrorCommands:pendingMirrorCommands.splice(0)};
  record(input); world.step(input);
  if (world.tick % 6 === 0) { frames.push({ p: { x: world.player.x, y: world.player.y }, e: { x: world.police.x, y: world.police.y } }); if (frames.length > 180) frames.shift(); }
}
function syncControlState() {
  const manual=$('policy').value==='manual'&&!replay;
  $('takeover').classList.toggle('accent',manual);$('takeover').setAttribute('aria-pressed',String(manual));
  $('takeover').textContent=manual?'玩家接管中 · 交还 AI':'玩家接管';
  $('start').textContent = world?.tick ? '↻ 重开并开始' : '▶ 开始';
  $('pause').textContent = paused ? '▶ 继续' : 'Ⅱ 暂停';
  $('pause').disabled = !!world?.result || (!world?.tick && paused);
}
let previousPolicy='adaptive';
$('takeover').onclick=()=>{
  if($('policy').value==='manual'&&!replay)$('policy').value=previousPolicy;
  else {if($('policy').value!=='manual')previousPolicy=$('policy').value;$('policy').value='manual';}
  $('policy').dispatchEvent(new Event('change'));canvas.focus();
};
function download(name, data) { const a = document.createElement('a'), url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function line(a, b, color, width = .06) { ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
function circle(p, r, color) { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill(); }
function sector(p, radius, dir, angle, fill, stroke) {
  ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.arc(p.x, p.y, radius, dir - angle / 2, dir + angle / 2); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = stroke; ctx.lineWidth = .06; ctx.stroke();
}
let uiTime = 0, zoom = true;
function syncZoom() { $('zoom').classList.toggle('accent',zoom);$('zoom').setAttribute('aria-pressed',String(zoom)); }
$('zoom').onclick = () => { zoom = !zoom; syncZoom(); };
function drawPerception(e,scale,ratio) {
  const cue=perceptionCue(world),point=ctx.getTransform().transformPoint({x:e.x,y:e.y});
  const playerPoint=ctx.getTransform().transformPoint(world.player);
  const avoidPlayer=Math.abs(point.x-playerPoint.x)<180*ratio&&Math.abs(point.y-playerPoint.y)<85*ratio;
  canvas.dataset.policeEye=cue.eye;canvas.dataset.policeEar=cue.ear;
  canvas.dataset.policeFatigue=e.tired?'tired':'normal';
  ctx.save();ctx.setTransform(ratio,0,0,ratio,point.x,point.y-(world.config.police.radius+M(.12))*scale-(avoidPlayer?125:52)*ratio);
  ctx.fillStyle='#0c141eee';ctx.fillRect(-76,-14,152,29);ctx.lineWidth=1.6;
  ctx.strokeStyle=cue.eye==='visible'?'#ffcc77':cue.eye==='searching'?'#82bfff':'#8197aa';
  ctx.beginPath();ctx.ellipse(-62,0,9,5,0,0,Math.PI*2);ctx.stroke();ctx.fillStyle=ctx.strokeStyle;
  ctx.beginPath();ctx.arc(-62,0,2.5,0,Math.PI*2);ctx.fill();
  if(cue.eye==='lost'||cue.eye==='inactive'){ctx.beginPath();ctx.moveTo(-71,7);ctx.lineTo(-53,-7);ctx.stroke();}
  ctx.font='11px system-ui';ctx.textAlign='left';ctx.fillText(({visible:'目视',searching:'搜索',lost:'丢视',inactive:'停用'})[cue.eye],-48,4);
  ctx.strokeStyle=cue.ear==='heard'?'#67ddcf':'#8197aa';ctx.beginPath();ctx.moveTo(11,-2);ctx.bezierCurveTo(9,-13,27,-12,25,-1);ctx.bezierCurveTo(25,3,20,3,20,7);ctx.bezierCurveTo(20,12,13,10,13,6);ctx.moveTo(15,-1);ctx.bezierCurveTo(15,-7,22,-6,20,0);ctx.stroke();
  ctx.fillStyle=ctx.strokeStyle;ctx.fillText(cue.ear==='heard'?'听见':'无声',31,4);
  ctx.fillStyle='#0c141eee';ctx.fillRect(-76,16,152,23);
  ctx.fillStyle=e.tired?'#ffb075':'#92aaae';ctx.textAlign='center';ctx.font='bold 11px system-ui';
  ctx.fillText(e.tired?`疲劳 ×${world.config.police.tiredScale} · 体力 ${Math.round(e.stamina)}`:`正常 · 体力 ${Math.round(e.stamina)}`,0,31);
  ctx.restore();
}
function drawPlayerStatus(p,scale,ratio) {
  const cue=playerCue(world),point=ctx.getTransform().transformPoint(p);
  canvas.dataset.playerMovement=cue.movement;canvas.dataset.playerStealth=cue.stealth;canvas.dataset.playerStealthUses=String(cue.uses);
  ctx.save();ctx.setTransform(ratio,0,0,ratio,point.x,point.y-(world.config.player.radius+M(.12))*scale-45*ratio);
  ctx.fillStyle='#0c141eee';ctx.fillRect(-88,-14,176,49);ctx.textAlign='center';ctx.font='bold 12px system-ui';
  ctx.fillStyle=cue.movement==='walk'?'#9be8dc':cue.movement==='run'?'#fff09c':'#c7e4e1';
  ctx.fillText(({mirrorWindup:'镜子施法',mirrorLanding:world.mirror?.player?.cancelled?'取消收招':'镜子落地恢复',idle:'静止',blocked:'受阻停步',walk:'步行 · 静步',run:'跑动 · 有声',startup:'闪避起手',dash:world.perfect()?'闪避 · 完美窗口':'闪避突进',recovery:`闪避恢复 · ${Math.round(recoveryMoveScale(world.config,p.dodge)*100)}%移速`})[cue.movement],0,2);
  ctx.font='11px system-ui';ctx.fillStyle=cue.stealth==='active'?'#c1b0ff':cue.stealth==='cooldown'?'#ffcb8c':'#92aaae';
  const skill=cue.stealth==='unavailable'?'未装备隐身':cue.stealth==='active'?`隐身中 ${cue.remaining.toFixed(1)}s`:cue.stealth==='cooldown'?`隐身冷却 ${cue.remaining.toFixed(1)}s`:'E 隐身就绪';
  ctx.fillText(`${skill}${cue.stealth==='unavailable'?'':` · 已用${cue.uses}次`}`,0,22);ctx.restore();
}
function draw(now) {
  const box = canvas.getBoundingClientRect(), ratio = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(box.width * ratio) || canvas.height !== Math.round(box.height * ratio)) { canvas.width = Math.round(box.width * ratio); canvas.height = Math.round(box.height * ratio); }
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#131e29'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const edge = world.map.edge, viewEdge=world.map.layout==='open'?22:edge, scale = Math.min(canvas.width / (viewEdge * 2 + M(8)), canvas.height / (viewEdge * 2 + M(10))) * (zoom ? 3 : 1);
  ctx.setTransform(scale, 0, 0, scale, canvas.width / 2 - (zoom ? world.player.x * scale : 0), canvas.height / 2 - (zoom ? world.player.y * scale : 0));
  ctx.fillStyle = '#1b2a37'; ctx.fillRect(-edge, -edge, edge * 2, edge * 2);
  for (let n = -Math.floor(edge); n <= edge; n += 2) { line({ x: n, y: -edge }, { x: n, y: edge }, '#213241', .025); line({ x: -edge, y: n }, { x: edge, y: n }, '#213241', .025); }
  ctx.setLineDash([.5, .65]);
  if(world.map.layout==='ring'){const c=world.map.cell;for(const side of [-1,1]){line({x:-c,y:side*c},{x:c,y:side*c},'#3b4950',.05);line({x:side*c,y:-c},{x:side*c,y:c},'#3b4950',.05);}}
  else for (const n of [-world.map.cell, 0, world.map.cell]) { line({ x: n, y: -edge }, { x: n, y: edge }, '#3b4950', .05); line({ x: -edge, y: n }, { x: edge, y: n }, '#3b4950', .05); }
  ctx.setLineDash([]);
  world.map.blocks.forEach((b, i) => { ctx.fillStyle = '#0c141e'; ctx.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0); ctx.strokeStyle = '#354554'; ctx.lineWidth = .1; ctx.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0); ctx.fillStyle = '#354554'; ctx.font = '1px system-ui'; ctx.textAlign = 'center'; ctx.fillText(`BLOCK 0${i + 1}`, (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2); });
  for (let i = 1; i < frames.length; i++) { line(frames[i - 1].p, frames[i].p, '#67ddcf40', .11); line(frames[i - 1].e, frames[i].e, '#ffa06c30', .1); }
  const p = world.player, e = world.police, a = e.attack, c = world.config;
  if(world.mirror){
    ctx.save();ctx.font='.55px system-ui';ctx.textAlign='center';
    c.mirror.points.forEach((point,i)=>{circle(point,c.mirror.range,world.mirror.sealed?'#555777':'#aa77dd');ctx.fillStyle='white';ctx.fillText(`${i?'B':'A'} ${world.mirror.sealed?'已封':world.mirror.used[i]?'玩家已用':'可交互'}`,point.x,point.y-M(1.4));});
    if(world.mirror.player){ctx.fillStyle='white';ctx.fillText(`${world.mirror.player.phase==='windup'?'施法':world.mirror.player.cancelled?'取消收招':'落地'} ${Math.max(0,world.mirror.player.until-world.time).toFixed(2)}s`,p.x,p.y+1.5);}
    if(world.time<(world.mirror.restartUntil??0)){ctx.fillStyle='white';ctx.fillText(`打断反应 ${(world.mirror.restartUntil-world.time).toFixed(2)}s`,p.x,p.y+1.5);}
    ctx.restore();
  }
  {
    const ms=world.mirror?.police;
    const label=ms?`${ms.phase==='windup'?'跟传前摇〔调试〕':'跟传落地锁向'} ${Math.max(0,ms.until-world.time).toFixed(2)}s`:a?`${a.phase==='recovery'?'抓捕后摇':'抓捕前摇'} ${Math.max(0,a.phase==='recovery'?c.capture.missRecovery*a.recoveryScale-a.recovery:a.snapshot.windup-a.elapsed).toFixed(2)}s`:'';
    canvas.dataset.policeAction=label;
    // White-box observer overlay; the player AI cannot read this hidden timer.
    if(label){ctx.save();ctx.font='.55px system-ui';ctx.textAlign='center';ctx.fillStyle='#ffd3ad';ctx.fillText(label,e.x,e.y+1.5);ctx.restore();}
  }
  if (c.search || a?.phase === 'recovery' && c.capture.recoveryFov) sector(e, c.visionRange, e.dir, (a?.phase === 'recovery' ? c.capture.recoveryFov ?? 360 : c.search.fov) * Math.PI / 180, '#ffa06c08', '#ffa06c30');
  if (!a && e.plan) { ctx.save();ctx.setLineDash([.12,.12]);ctx.strokeStyle='#ffa06c99';ctx.lineWidth=.05;ctx.beginPath();ctx.arc(e.x,e.y,c.capture[e.plan].trigger,0,Math.PI*2);ctx.stroke();ctx.restore(); }
  if ($('policy').value !== 'manual' && !replay && bot.waypoint) {
    ctx.setLineDash([.25, .25]); line(p, bot.waypoint, '#67ddcf99', .06); ctx.setLineDash([]);
    circle(bot.waypoint, .18, '#67ddcf');
  }
  line(e, e.visible ? p : e.lastSeen, e.visible ? '#ffcc773a' : '#8197aa44', .04);
  if (!e.visible) { circle(e.lastSeen, .25, '#8197aa'); ctx.strokeStyle = '#8197aa'; ctx.lineWidth = .06; ctx.beginPath(); ctx.arc(e.lastSeen.x, e.lastSeen.y, 1.2, 0, Math.PI * 2); ctx.stroke(); }
  if (a) {
    const m = a.snapshot, dir = a.phase === 'active' ? a.hitDir : a.dir;
    const charging=m.moveScale>0&&m.moveFrom>0&&a.elapsed<m.moveFrom&&a.phase!=='recovery';
    sector(e, m.radius, dir, m.angle * Math.PI / 180, a.phase === 'recovery' ? '#75809112' : charging?'#ffc45c28':'#ff637430', a.phase === 'recovery' ? '#75809150' : charging?'#ffc45c':'#ff6374');
    if (a.mode === 'sweep') sector(e, m.radius, a.dir, (m.angle + m.sweep) * Math.PI / 180, '#ff637408', '#ff637444');
    line(e, { x: e.x + Math.cos(a.moveDir) * 2, y: e.y + Math.sin(a.moveDir) * 2 }, '#67ddcf', .1);
  }
  if (p.dodge) { ctx.strokeStyle = world.perfect() ? '#ffffff' : '#9fddd9'; ctx.lineWidth = world.perfect() ? .22 : .08; ctx.beginPath(); ctx.arc(p.x, p.y, .8, 0, Math.PI * 2); ctx.stroke(); line(p, { x: p.x + Math.cos(p.dodge.dir) * 2, y: p.y + Math.sin(p.dodge.dir) * 2 }, '#e1fff2', .09); }
  circle(p, c.player.radius + M(.12), world.invisible()?'#67ddcf55':'#67ddcf'); circle(e, c.police.radius + M(.12), a && a.phase !== 'recovery' ? a.snapshot.moveScale>0&&a.elapsed<a.snapshot.moveFrom?'#ffc45c':'#ff6374' : '#ffa06c');
  drawPerception(e,scale,ratio);
  drawPlayerStatus(p,scale,ratio);
  const cue = perfectCue(world);
  canvas.dataset.perfectCue = cue ? 'active' : 'inactive';
  if (cue) {
    ctx.save(); ctx.globalAlpha = 1-cue.progress;
    ctx.strokeStyle='#fff1a8'; ctx.lineWidth=.12*(1-cue.progress)+.03;
    ctx.beginPath(); ctx.arc(cue.x,cue.y,.6+cue.progress*2.4,0,Math.PI*2); ctx.stroke();
    for(let i=0;i<8;i++) { const t=i*Math.PI/4,r=.8+cue.progress*2.5; line({x:cue.x+Math.cos(t)*r,y:cue.y+Math.sin(t)*r},{x:cue.x+Math.cos(t)*(r+.3),y:cue.y+Math.sin(t)*(r+.3)},'#fff1a8',.07); }
    ctx.setTransform(ratio,0,0,ratio,0,0); ctx.textAlign='center'; ctx.fillStyle='#fff1a8';
    ctx.font='bold 25px system-ui'; ctx.fillText('完美闪避',box.width/2,55-cue.progress*8);
    ctx.font='14px system-ui'; ctx.fillText(`体力 +${cue.refund} · 快速恢复`,box.width/2,80-cue.progress*8);
    ctx.restore();
  }
  for (const [v, color] of [[p, '#d9fff9'], [e, '#ffe2c9']]) line(v, { x: v.x + Math.cos(v.dir) * 1, y: v.y + Math.sin(v.dir) * 1 }, color, .1);
  line({ x: -edge + 2, y: edge - 2 }, { x: -edge + 7, y: edge - 2 }, '#8197aa', .1); ctx.fillStyle = '#8197aa'; ctx.font = '.8px system-ui'; ctx.fillText('5 m', -edge + 4.5, edge - 2.7);
  if (now - uiTime > 90) { uiTime = now; updateUI(); }
}
const names = { mirrorWindup:'镜子施法', mirrorLanding:'镜子后摇', ready: '正常', startup: '启动', dash: '突进', recovery: '恢复', windup: '前摇', committed: '锁向', active: '横扫判定', caught: '被抓捕', escaped: '成功脱身', timeout: '到达观察时限', reacquired:'单元结束：重新锁定' };
function updateUI() {
  $('map-label').textContent=world.map.layout==='open'?'俯视 · 米制 · 无障碍空地':world.map.layout==='ring'?'俯视 · 米制 · 回字单街区':'俯视 · 米制 · 田字四街区';
  const p = world.player, e = world.police, a = e.attack, summary = world.summary();
  syncControlState();
  $('overlay').style.display = paused || world.result ? 'block' : 'none';
  $('overlay').innerHTML = `<b>${world.result ? names[world.result] : world.tick ? '已暂停' : '准备开始'}</b><span>${world.result ? `得分 ${summary.score} · 躲过 ${summary.evades} 次 · 重开开始下一局` : $('policy').value === 'manual' ? 'WASD 移动 · Space 闪避 · Shift 步行' : '观察 AI，或在控制方式中选择玩家'}</span>`;
  $('state').textContent = world.result ? names[world.result] : names[world.phase()]; $('time').textContent = `${world.time.toFixed(2)} s`; $('distance').textContent = `${dist(p, e).toFixed(2)} m`; $('evades').textContent = `${summary.evades} / ${summary.perfect}`; $('score').textContent = world.config.practice ? '练习不计分' : summary.score.toFixed(1);
  $('p-stamina').textContent = p.stamina.toFixed(0); $('e-stamina').textContent = e.stamina.toFixed(0); $('p-meter').max = world.config.player.staminaMax; $('p-meter').value = p.stamina; $('e-meter').max = world.config.police.staminaMax; $('e-meter').value = e.stamina;
  $('memory').textContent = e.visible ? '视线内' : `${e.lost.toFixed(1)} / ${world.escapeDelay().toFixed(1)} s`; $('memory-meter').value = e.visible ? 1 : 1 - e.lost / world.escapeDelay();
  $('timeline').innerHTML = `<div class="phase-line"><span>主角 · ${names[world.phase()]}</span><b>${(p.dodge?.elapsed || 0).toFixed(3)} s</b></div><div class="phase-line"><span>警察 · ${a ? LABELS[a.mode] : e.visible ? '接近' : '最后位置调查'}</span><b>${a ? names[a.phase] : ''}</b></div><div class="phase-line"><span>前摇 / 跟踪结束</span><b>${(a?.snapshot.windup ?? world.config.capture.windup).toFixed(2)} / ${(a?.snapshot.trackUntil ?? world.config.capture.stand.trackUntil).toFixed(2)}</b></div><div class="phase-line"><span>AI 本次反应采样</span><b>${Math.round(bot.delay * 1000)} ms</b></div>`;
  const total = Math.max(1, bot.seenAttacks.size);
  $('frequencies').innerHTML = MODES.map(m => `<div class="freq-line"><span>${LABELS[m]}</span><b>${bot.counts[m] - 1} 次</b></div><div class="bar"><i style="width:${(bot.counts[m] - 1) / total * 100}%"></i></div>`).join('') + '<p class="hint">接管后停止更新 AI 观察记忆。</p>';
  $('ai-intent').textContent = replay ? '输入回放中' : $('policy').value === 'manual' ? '玩家控制中' : world.config.drill ? '单元脚本：已知时序＋近身固定绕行，不使用逃跑寻路' : bot.intent;
  const tp=bot.timingPlan;
  $('open-timing').textContent=world.config.duel&&tp&&!replay&&$('policy').value!=='manual'?`本刀计划：前摇${Math.round(tp.plannedElapsed*1000)}ms按键；操作误差${Math.round(tp.timingError*1000)}ms；${tp.lapse?'漏输入':tp.choice==='spin'?'选择无资源绕身':tp.pressedAt!==undefined?`已在${Math.round(tp.pressedElapsed*1000)}ms按键`:'尚未按键'}。`:'';
  if(world.result==='caught'&&world.config.duel){const caught=world.events.findLast(e=>e.type==='caught');$('open-timing').textContent+=` 判定时体力${caught.stamina?.toFixed(1)}；${caught.staminaEnough?'足够闪避':'不足闪避'}；状态${caught.playerPhase}；${caught.dodgeSinceAttack?'本刀已闪避':'本刀未闪避'}${caught.afterPreemptiveDodge?'；提前空闪后摇被抓':''}。`;}
  if(world.mirror?.minds){const minds=world.mirror.minds;$('timeline').lastElementChild.innerHTML=`<span>镜子反应 · 人类 / 警察</span><b>${Math.round((minds.player.lastDelay??0)*1000)} / ${Math.round((minds.police.lastDelay??0)*1000)} ms</b>`;}
  if(world.config.mirror){$('ai-intent').textContent=`镜子固定脚本：${world.config.mirror.playerPolicy} / ${world.config.mirror.policePolicy}；F交互 G取消；无反应延迟假设`;$('score').textContent='镜子单元不计分';}
  if(world.mirror?.minds){$('ai-intent').textContent=`人类：${world.mirror.minds.player.intent}；警察：${world.mirror.minds.police.intent}`;}
  if(world.mirror?.sampledStrategies){const s=world.mirror.sampledStrategies;$('ai-intent').textContent+=`；白盒策略抽样 ${s.player} / ${s.police}（AI不读取对方策略名）`;}
  commandPanel.hidden=!world.config.mirror?.ai?.integration;
  if(!commandPanel.hidden){const d=world.mirror.minds.player.director,s=world.mirror.branchStats;
    $('mirror-branch-summary').textContent=`当前 ${d?.node??'等待观测'} → ${COMMAND_LABELS[d?.current?.action]??'无指令'}；节点进入 ${Object.values(s?.nodes??{}).reduce((n,r)=>n+r.visits,0)} 次，决策评估 ${Object.values(s?.nodes??{}).reduce((n,r)=>n+r.evaluations,0)} 次。详细候选与拒绝原因见导出回放中的 mirror-decision。`;
  }
  $('attack-gate').textContent = a ? `抓捕已启动：${LABELS[a.mode]}` : e.plan ? `准备${LABELS[e.plan]}：当前${dist(p,e).toFixed(2)}m / 启动≤${world.config.capture[e.plan].trigger.toFixed(2)}m；${e.visible?'目标可见':'目标不可见'}；还需朝向差≤60°与冷却结束` : '尚未选择出刀／正在搜索';
  if(a) $('attack-gate').textContent=`${a.mode==='lunge'?'蓄力刀':a.snapshot.followAim?'行进轻刀':LABELS[a.mode]} · 前摇 ${a.snapshot.windup.toFixed(2)}s · 移动倍率 ${a.snapshot.moveScale} · 移动启动 ${a.snapshot.moveFrom.toFixed(2)}s · 已经过 ${a.elapsed.toFixed(2)}s`;
  $('attack-gate').textContent+=` · 警察 ${e.speed.toFixed(2)}m/s · ${a?.phase==='recovery'?'落空后摇停步':e.search?'搜索移动／环视':e.tired?`疲劳：速度×${world.config.police.tiredScale}，体力恢复至${Math.round(world.config.police.resumeAt*100)}%解除`:a?'出刀移动':'正常追逐'}`;
  if(!a&&e.bait?.enteredAt!==null&&e.bait?.until!==undefined)$('attack-gate').textContent+=` · 近身压迫：${e.bait.reactAt!==undefined?'已观察闪避，等待反应后出刀':`暂不出刀 ${Math.max(0,e.bait.until-world.time).toFixed(2)}s`}`;
  if(!a&&e.closePressure)$('attack-gate').textContent+=` · 贴身长压迫：${e.closePressure.walkReactAt!==undefined?'已识别慢走，准备恢复攻击':e.closePressure.dodgeReactAt!==undefined?'已看到闪避，尝试抓后摇':e.closePressure.until!==undefined?`继续逼近，等待 ${Math.max(0,e.closePressure.until-world.time).toFixed(2)}s`:'尚未贴身，继续逼近'}`;
  if(world.metrics.pressureSeconds)$('attack-gate').textContent+=` · 压迫累计${world.metrics.pressureSeconds.toFixed(1)}s，人类体力净变${(world.metrics.pressurePlayerStaminaChange??0).toFixed(1)}`;
  if(world.config.drill) {
    $('score').textContent='单元不计分';const d=drillSummary(world);
    $('attack-gate').textContent+=` · 首次应对：${({fixture:'已预置落空',perfect:'完美成功',evaded:'位置避开',caught:'失败',unfinished:'进行中'})[d.firstResponse]} · 重获时间：${d.reacquiredAt??'尚未发生'}s`;
  }
  const searchNames = { hold:'近身暂不出刀','noticed-dodge':'观察到闪避，等待反应','noticed-walk':'识别慢走，等待反应后出刀',release:'结束等待，寻找出刀机会',investigate: '调查最后证据', scan: '原地环视', wait: '短暂守候', sound: '调查实际声音', branch: '搜索可达分支', reacquire: '重新发现目标', giveup: '搜索结束' };
  $('search-state').textContent = a?.phase === 'recovery' ? `锁向后摇剩余 ${Math.max(0,world.config.capture.missRecovery*a.recoveryScale-a.recovery).toFixed(2)}s` : e.search ? `${searchNames[e.search.phase]} · 预算 ${Math.max(0,e.search.deadline-world.time).toFixed(1)}s` : e.visible ? '视觉追踪' : '目标不明';
  $('events').innerHTML = world.events.filter(ev=>ev.type!=='mirror-decision'&&!(ev.type==='mirror'&&ev.actor==='police'&&ev.phase==='windup')).slice(-18).reverse().map(ev => `<div class="event ${ev.type === 'perfect' || ev.type === 'escaped' ? 'good' : ev.type === 'caught' ? 'bad' : ''}">${ev.t.toFixed(2)}s <b>${({ 'open-strategy':'空地策略抽样', 'range-estimate':'出刀估距', 'mirror-ai':'镜子决策', mirror: '镜子', attack: '出手', dodge: '闪避', commit: '跟踪结束', fatigue: '疲劳切换', stealth: '隐身', probe: '证据试探', miss: '扑空', perfect: '完美', caught: '抓捕', escaped: '脱身', timeout: '时限', search: '搜索', heard: '听见跑动', fixture:'预置单元条件', reacquired:'单元结束：重新锁定' })[ev.type]??ev.type}</b> ${ev.phase ? searchNames[ev.phase] || ev.phase : ''}${ev.mode ? LABELS[ev.mode] : ''}${ev.reason ? ({ position: '位置 / 角度避开', wall: '墙体遮挡', perfect: '完美保护', contact:'真实接触', 'last-evidence':'最后证据位置' })[ev.reason] || ev.reason : ''}${ev.distance != null ? ` ${ev.distance.toFixed(2)}m` : ''}</div>`).join('');
}
function animate(time) {
  const elapsed = Math.min(.1, (time - previousTime) / 1000 || 0); previousTime = time;
  if (!paused) { accumulator += elapsed * +$('speed').value; let n = 0; while (accumulator >= BASE.dt && n++ < 60 && !paused) { step(); accumulator -= BASE.dt; } } else accumulator = 0;
  draw(time); requestAnimationFrame(animate);
}
function selectPreset(id) {
  const p = PRESETS.find(p => p.id === id); draft = presetConfig(id); $('preset').value = id;
  $('preset-evidence').textContent = p.evidence; $('preset-check').textContent = p.check;
  controls(); $('dirty').textContent = '待应用';
}
$('preset').replaceChildren(...PRESETS.map(p => { const o = document.createElement('option'); o.value = p.id; o.textContent = p.title; return o; }));
$('preset').onchange = () => selectPreset($('preset').value);
for(const key of ['entry','mode','response','exit','side','walk']) $('drill-'+key).onchange=e=>{
  draft.drill[key]=key==='side'?Number(e.target.value):key==='walk'?e.target.value==='true':e.target.value;
  if(key==='mode') draft.weights=Object.fromEntries(MODES.map(m=>[m,+(m===draft.drill.mode)]));
  controls();$('dirty').textContent='待应用';
};
$('try-preset').onclick = () => { const p = PRESETS.find(p => p.id === $('preset').value); selectPreset(p.id); reset(); message('预设已应用并暂停；种子、控制方式和视角已保留。'); };
$('spawn').onchange = () => { draft.spawn = $('spawn').value; syncJSON(); $('dirty').textContent = '待应用'; };
$('map-layout').onchange=()=>{draft.mapLayout=$('map-layout').value;syncJSON();$('dirty').textContent='待应用';};
$('apply').onclick = () => reset();
$('start').onclick = () => { if(!applyObservationLimit())return;if (world.tick || world.result || +$('seed').value!==world.seed || $('seed').value==='') {if(!reset(world.config))return;} paused = false; syncControlState(); canvas.focus(); };
$('seed').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();$('start').click();}};
function applyObservationLimit(){
  const duration=Number($('duration').value);
  if($('duration').value===''||!Number.isFinite(duration)||duration<1||duration>300){message('观察时限需要1–300秒。',true);return false;}
  if(duration===world.config.duration)return true;
  const config=clone(world.config);config.duration=duration;
  if(!reset(config))return false;
  draft.duration=duration;syncJSON();return true;
}
$('duration').oninput=()=>{paused=true;syncControlState();message('观察时限待生效，确认输入后重建对局。');};
$('duration').onchange=()=>{if(applyObservationLimit())message(`观察时限已设为${world.config.duration}秒，点击开始。`);};
$('duration').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();$('start').click();}};
function applySeedIfChanged(){return applyObservationLimit()&&(+$('seed').value===world.seed&&$('seed').value!==''||reset(world.config));}
$('seed').oninput=()=>{paused=true;syncControlState();message(`当前对局种子 ${world.seed}；修改待生效，确认输入后重开。`);};
$('seed').onchange=()=>{if(applySeedIfChanged()){syncControlState();draw(performance.now());message(`已按种子 ${world.seed} 重建对局，点击开始或单步。`);}};
$('pause').onclick = () => { if(!applySeedIfChanged())return;if (!world.result) paused = !paused; syncControlState(); canvas.focus(); }; $('step').onclick = () => { if(!applySeedIfChanged())return;paused = true; step(); syncControlState(); draw(performance.now()); };
$('policy').onchange = () => { paused = true; replay = null; bot = new Bot(world.config, world.seed, $('policy').value === 'manual' ? 'adaptive' : $('policy').value); keys.clear(); dodgePending = false; stealthPending = false; syncControlState(); };
$('read-json').onclick = () => { try { const c = JSON.parse($('json').value), errors = validate(c); if (errors.length) throw new Error(errors.join('；')); draft = c; controls(); $('dirty').textContent = '待应用'; message('JSON 已读取，点击应用。'); } catch (e) { message(e.message, true); } };
$('export-config').onclick = () => download('chase-parameters.json', draft);
$('import-config').onchange = async e => { try { const c = JSON.parse(await e.target.files[0].text()), errors = validate(c); if (errors.length) throw new Error(errors.join('；')); draft = c; controls(); $('dirty').textContent = '待应用'; } catch (err) { message(err.message, true); } e.target.value = ''; };
$('export-replay').onclick = () => download(`chase-replay-${world.seed}-${world.tick}.json`, { version: 1, config: world.config, seed: world.seed, endTick: world.tick, control: $('policy').value, inputs, events: world.events, branchStats:world.mirror?.branchStats, policeBranches:world.mirror?.policeBranches, summary: world.summary() });
$('import-replay').onchange = async e => {
  try { const r = JSON.parse(await e.target.files[0].text()); if (r.version !== 1 || !Array.isArray(r.inputs) || !Number.isInteger(r.endTick) || r.endTick < 0 || r.inputs.some(v => !Number.isInteger(v.tick) || !v.input || !Number.isFinite(v.input.x) || !Number.isFinite(v.input.y))) throw new Error('回放格式不合法'); if (!reset(r.config, r.seed)) return; replay = r; replayIndex = 0; replayInput = {}; message('回放已载入；点击开始。接管可从当前时间继续。'); } catch (err) { message(err.message, true); } e.target.value = '';
};
window.addEventListener('keydown', e => { if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) return; if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault(); if (!e.repeat && e.code === 'KeyP') paused = !paused; if (!e.repeat && e.code === 'Space' && !paused) dodgePending = true; if (!e.repeat && e.code === 'KeyE' && !paused) stealthPending = true; keys.add(e.code); });
window.addEventListener('keyup', e => keys.delete(e.code)); window.addEventListener('blur', () => { paused = true; keys.clear(); dodgePending = false; stealthPending = false; });
function startJob(kind) {
  if (draft.mirror) { message('镜子单元请运行 node run-mirrors.mjs，不计完整追逐胜率。',true); return; }
  if (draft.drill) { message('这是单元场景；使用 node run-drills.mjs 运行应对×绕后矩阵，不计完整追逐胜率。', true); return; }
  if (draft.practice) { message('无追兵练习只确认玩家手感；请选择单策略或混合对照后运行实验。', true); return; }
  if (worker) return; const errors = validate(draft); if (errors.length) { message(errors.join('；'), true); return; }
  paused = true; worker = new Worker('worker.mjs', { type: 'module' }); $('batch').disabled = $('train').disabled = true; $('cancel').disabled = false; $('progress').value = 0; $('progress-label').textContent = '运行中…';
  worker.onmessage = ({ data }) => { if (data.type === 'progress') { $('progress').value = data.progress; $('progress-label').textContent = data.label; } else { if (data.type === 'done') { report = data.report; $('progress').value = 1; $('progress-label').textContent = '实验完成；请结合样本数与置信区间判断。'; renderReport(); } else $('progress-label').textContent = data.message; stopJob(); } };
  worker.onerror = e => { $('progress-label').textContent = e.message; stopJob(); };
  const seeds = Math.max(2, Math.min(128, +$('samples').value || 12)), candidates = Math.max(2, Math.min(64, +$('candidates').value || 8));
  worker.postMessage({ kind, config: clone(draft), options: kind === 'train' ? { seeds: Math.min(seeds, 8), candidates, seedBase: +$('seed').value + 2000, holdoutSeeds: seeds } : { seeds, seedBase: +$('seed').value + 1000, ...(!$('full-matrix').checked ? { distributions: { current: clone(draft.weights) }, exposures: [draft.exposure], profiles: ['configured'] } : {}) } });
}
function stopJob() { worker?.terminate(); worker = null; $('batch').disabled = $('train').disabled = false; $('cancel').disabled = true; }
$('batch').onclick = () => startJob('bench'); $('train').onclick = () => startJob('train'); $('cancel').onclick = () => { stopJob(); $('progress-label').textContent = '实验已停止；不将未完成结果视为报告。'; };
function renderReport() {
  const r = report.validation || report, percent = x => `${Math.round(x * 100)}%`;
  let html = report.kind === 'training' ? `<p class="report-note">${report.hypothesisMet ? '样本点估计达到设置的目标' : '尚未达到预期收敛目标'}。独立种子目标差距 ${report.validationObjective.loss.toFixed(3)}；最佳参数只进入草稿，不自动覆盖。训练 ${report.seeds} / 验证 ${report.holdoutSeeds} 种子。</p>` : '';
  for (const profile of [...new Set(r.cells.map(c => c.profile))]) for (const exposure of [...new Set(r.cells.map(c => c.exposure))]) {
    html += `<h3>${({ configured: '当前玩家参数', fast: '快速稳定 120±15ms', slow: '慢速波动 280±60ms' })[profile]} · ${exposure < .5 ? '低' : '高'}暴露 ${exposure} · 抓捕率 / 平均躲过次数</h3><div class="report-scroll"><table><thead><tr><th>警察策略</th>${[...new Set(r.cells.map(c => c.policy))].map(p => `<th>${POLICIES[p]}</th>`).join('')}</tr></thead><tbody>`;
    for (const d of [...new Set(r.cells.map(c => c.distribution))]) {
      html += `<tr><td>${d === 'current' ? '当前草稿权重' : d === 'mixed' ? '均匀混合' : LABELS[d.replace('80', '')] + ' 80%'}</td>`;
      for (const p of [...new Set(r.cells.map(c => c.policy))]) {
        const c = r.cells.find(c => c.profile === profile && c.exposure === exposure && c.distribution === d && c.policy === p);
        html += `<td class="report-cell" title="n=${c.n}；抓捕率95%区间 ${percent(c.caughtCI[0])}–${percent(c.caughtCI[1])}；未交锋 ${percent(c.noEngagement)}；脱身 ${percent(c.escaped)}；超时 ${percent(c.timeout)}；均时 ${c.seconds.toFixed(1)}s；得分 ${c.score.toFixed(1)}">${percent(c.caught)} / ${c.evades.toFixed(1)}</td>`;
      } html += '</tr>';
    } html += '</tbody></table></div>';
  }
  for (const g of report.games || []) html += `<p class="hint">${g.profile} / 暴露 ${g.exposure}：有限策略博弈的玩家收益区间 ${g.lower.toFixed(3)}–${g.upper.toFixed(3)}，数值间隙 ${g.gap.toFixed(4)}。这是经验矩阵上的求解结果，不是真实游戏 GTO。悬停表格查看置信区间，完整数据可导出。</p>`;
  $('report').innerHTML = html; $('export-report').disabled = false; $('use-trained').disabled = report.kind !== 'training';
}
$('export-report').onclick = () => report && download('chase-experiment-report.json', report);
$('use-trained').onclick = () => { draft = clone(report.best.config); draft.name = '搜索候选（待真人验证）'; controls(); $('dirty').textContent = '待应用'; message('最佳候选已载入草稿，尚未应用。'); };
const query = new URLSearchParams(location.search);
selectPreset(PRESETS.some(p => p.id === query.get('preset')) ? query.get('preset') : 'practice');
$('policy').value = PRESETS.find(p => p.id === $('preset').value).policy;
if($('policy').value==='manual')$('policy').value='adaptive';
if (Number.isFinite(Number(query.get('seed'))) && query.has('seed')) $('seed').value = Number(query.get('seed'));
if (query.has('policy') && (POLICIES[query.get('policy')] || query.get('policy') === 'manual')) $('policy').value = query.get('policy');
controls(); reset();
if (query.has('steps')) { const count = Math.max(0, Math.min(36000, Number(query.get('steps')) || 0)); for (let i = 0; i < count && !world.result; i++) step(); paused = true; }
draw(performance.now() + 100); document.documentElement.dataset.labReady = 'true';
requestAnimationFrame(animate);
