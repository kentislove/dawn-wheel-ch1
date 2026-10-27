/**
 * 《超級機器人大戰：破曉因果之輪》第一大關可玩版 ─ 遊戲引擎
 * 包含：關卡流程、地圖、移動、戰鬥（命中／傷害／反擊／防禦／迴避）、精神指令、
 *       敵方 AI、對話系統、說服指令、地圖事件、戰鬥演出播放器串接、存檔。
 * 關卡內容（地圖、對話、事件）寫在 stages.js。
 */
'use strict';

const CELL = 56;
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ==================== 遊戲狀態 ====================
const G = {
  stageIndex: 0, stage: null, map: [], cols: 0, rows: 0,
  units: [], turn: 0, phase: 'PLAYER', flags: {}, vars: {}, onceKeys: new Set(),
  sel: null, moveRange: [], atkRange: [], weapon: null, origPos: null, mode: 'idle',
  busy: false, ended: false, telegraph: null, markers: [], queue: [], hover: { x: -1, y: -1 },
  animOn: true, debug: false, flagsAtStageStart: {}, uidSeq: 0,
};

// ==================== 存檔（只存在瀏覽器裡；讀不到就當作沒有存檔） ====================
const SAVE_KEY = 'srw_dawn_chapter1_save';
function saveProgress(nextIndex) {
  if (G.practice) return;   // v14：開發者選關（練習）不存檔
  try { localStorage.setItem(SAVE_KEY, JSON.stringify({ next: nextIndex, flags: G.flags, roster: G.roster, wallet: G.wallet || 0 })); } catch (e) { /* 私密視窗等情況存不了，不影響遊玩 */ }
}

// ==================== v6：駕駛等級 ====================
// G.roster[pilotId] = { lv, exp }：跨關卡保留（存在存檔裡）；沒有 spiritsByLevel 的駕駛（敵方、客串）不升級
const hasLevel = (pid) => !!(PILOTS[pid] && PILOTS[pid].spiritsByLevel);
function rosterOf(pid) {
  if (!G.roster) G.roster = {};
  if (!G.roster[pid]) G.roster[pid] = { lv: 1, exp: 0 };
  const r = G.roster[pid];
  // v14：已學會的精神（開場 3 個＋買的）、提升精神次數。舊存檔沒有 learned → 沿用舊等級自動學會的那些
  if (!r.learned) r.learned = (PILOTS[pid].spiritsByLevel ? spiritsAt(pid, r.lv) : PILOTS[pid].spirits.slice()).slice(0, ECONOMY.slots);
  if (r.spUp === undefined) r.spUp = 0;
  return r;
}
const spiritsAt = (pid, lv) => PILOTS[pid].spiritsByLevel.filter(([l]) => lv >= l).map(([, id]) => id);
// 依等級套用 HP、SP 上限與精神指令（開場、升級時呼叫）
function applyLevel(u, keepRatio) {
  if (!hasLevel(u.pilotId)) return;
  const r = rosterOf(u.pilotId), L = LEVELING, T = UNIT_TYPES[u.type];
  const form = (T.forms && T.forms[u.form]) || { mult: 1 };
  const hpRatio = u.maxHp ? u.hp / u.maxHp : 1;
  u.baseHp = T.hp + (r.lv - 1) * L.hpPerLevel;            // 基數隨等級成長，再乘型態百分比（雲雀）
  u.maxHp = Math.round(u.baseHp * form.mult);
  u.hp = keepRatio ? Math.max(1, Math.round(u.maxHp * hpRatio)) : u.maxHp;
  u.maxSp = PILOTS[u.pilotId].sp + (r.lv - 1) * L.spPerLevel + r.spUp * ECONOMY.spUpAmount;   // v14：提升精神
  u.sp = Math.min(u.sp, u.maxSp);
  u.spirits = r.learned.slice();   // v14：只有學會（買到）的精神
  if (u.pilotId === 'NOAH' && G.flags && G.flags.meikyo) u.spirits.push('meikyo');   // 明鏡止水：劇情解鎖
  u.level = r.lv;
}
function gainExp(u, amount) {
  if (!hasLevel(u.pilotId) || u.team !== 'player' || amount <= 0) return;
  if (CHEAT.on('exp5')) amount *= 5;   // v13：金手指
  G.wallet = (G.wallet || 0) + amount;
  // v9：拿到經驗值時要看得到；v14：經驗進全隊錢包
  log(`✨ ${u.pilot} 經驗 +${amount}（全隊經驗 ${G.wallet}）`, 'player');
  floatText(u, `+${amount} EXP`, '#fde68a');
}
// v14：劇情發的經驗（說服、逼退、擊落 BOSS、過關獎勵）
function award(amount, reason) {
  if (CHEAT.on('exp5')) amount *= 5;
  G.wallet = (G.wallet || 0) + amount;
  log(`🎖️ ${reason}：經驗 +${amount}（全隊經驗 ${G.wallet}）`, 'player');
}
const killExp = (def) => ECONOMY.killExp[def.type] ?? ECONOMY.killDefault;
// v9：地圖上機體頭頂飄字（經驗值、升級）。不擋遊戲流程，自己跑完自己消失。
const floats = [];
function floatText(u, text, color, delay = 0) {
  floats.push({ x: u.x, y: u.y, text, color, t0: performance.now() + delay * 1000 });
  if (floats.length === 1) requestAnimationFrame(drawFloats);
}
let mapBattleRunning = false;   // 地圖戰鬥特效進行中：由它每格順便畫飄字，避免兩邊互相清畫布
function paintFloats(now) {
  const g = fxCtx;
  for (let i = floats.length - 1; i >= 0; i--) {
    const f = floats[i], lt = (now - f.t0) / 1000;
    if (lt > 1.6) { floats.splice(i, 1); continue; }
    if (lt < 0) continue;
    const c = isoCenter(f.x, f.y), y = c.y - 95 - 40 * Math.min(1, lt / 0.6);
    g.save(); g.globalAlpha = Math.min(1, 2 - lt * 1.25); g.font = '900 30px "Microsoft JhengHei", sans-serif'; g.textAlign = 'center';
    g.lineWidth = 6; g.strokeStyle = '#000'; g.strokeText(f.text, c.x, y); g.fillStyle = f.color; g.fillText(f.text, c.x, y); g.restore();
  }
}
function drawFloats(now) {
  if (!mapBattleRunning) { fxCtx.clearRect(0, 0, fxCv.width, fxCv.height); paintFloats(now); }
  if (floats.length) requestAnimationFrame(drawFloats); else if (!mapBattleRunning) fxCtx.clearRect(0, 0, fxCv.width, fxCv.height);
}
// v6：雲雀型態切換（normal 一般型 100%／golden 黃金雲雀 120%／complete 朱雀完全體 140%）
function setForm(u, form) {
  const T = UNIT_TYPES[u.type];
  if (!T.forms || !T.forms[form]) return;
  const ratio = u.maxHp ? u.hp / u.maxHp : 1;
  u.form = form;
  const m = T.forms[form].mult;
  u.maxEn = Math.round(T.en * m); u.armor = Math.round(T.armor * m); u.mobility = Math.round(T.mobility * m);
  u.move = T.move + (form === 'complete' ? 2 : 0);
  u.weapons.forEach((w, i) => {
    const base = T.weapons[i];
    w.power = Math.round(base.power * m);
    const fa = T.forms[form].anim; w.anim = (fa && fa[base.anim]) || base.anim;
  });
  if (hasLevel(u.pilotId)) applyLevel(u, true); else { u.maxHp = Math.round(T.hp * m); u.hp = Math.round(u.maxHp * ratio); }
  u.en = Math.min(u.en, u.maxEn);
  log(`🔆 ${u.name} → ${T.forms[form].name}（全能力 ${Math.round(m * 100)}%）`, 'player');
}
function loadProgress() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch (e) { return null; }
}
function loadSetting(key, def) { try { const v = localStorage.getItem(key); return v === null ? def : v === '1'; } catch (e) { return def; } }
function saveSetting(key, v) { try { localStorage.setItem(key, v ? '1' : '0'); } catch (e) { /* 忽略 */ } }

// ==================== 機體 ====================
function mkUnit(type, o = {}) {
  const T = UNIT_TYPES[type];
  const P = PILOTS[T.pilot];
  const u = {
    uid: o.uid || ('u' + (++G.uidSeq)), type, team: o.team || 'enemy', x: o.x, y: o.y,
    name: o.name || T.name, label: o.label || T.label, pilotId: T.pilot, pilot: P.short,
    kind: T.kind || 'unit', eid: T.eid || null, animUnit: T.animUnit || null,
    maxHp: o.hp || T.hp, hp: o.hp || T.hp, maxEn: T.en, en: T.en,
    armor: T.armor, mobility: T.mobility, move: T.move, evaBonus: o.evaBonus || 0,
    maxSp: P.sp, sp: P.sp, spirits: P.spirits.slice(), morale: o.morale || 100,
    weapons: (o.weapons || T.weapons).map((w) => Object.assign({}, w, { left: w.ammo })),
    acted: false, spirit: {}, flare: 0, boss: !!o.boss, protagonist: !!o.protagonist, guest: !!T.guest,
    untargetable: !!o.untargetable, noCounter: false, skipTurn: false, ai: Object.assign({}, T.aiDefault || {}, o.ai || {}),
    fly: o.fly !== undefined ? !!o.fly : !!T.fly,   // v4：會飛（戰鬥背景用）
    causalWarp: T.causalWarp || null,               // v5：E09【因果歪曲】
    debuff: {}, debuffTurns: 0,                     // v5：被武器降低的數值（mobility / move / armorPct）
    aegisField: T.aegisField || 0,                  // v6：神盾重力場（這個數字以下的傷害無效）
    form: 'normal', stunned: false, level: null,    // v6：雲雀型態、被擊暈、駕駛等級
  };
  if (u.team === 'player' && hasLevel(u.pilotId)) { applyLevel(u, false); u.sp = u.maxSp; }   // v6：我方套用等級
  return u;
}
// v5：加上 debuff 之後的實際數值
const effMobility = (u) => u.mobility + (u.debuff.mobility || 0);
const effMove = (u) => Math.max(0, u.move + (u.debuff.move || 0) + (u.team === 'player' && CHEAT.on('moveup') ? 3 : 0));   // v13：金手指 moveup   // v6：零度雷射可讓移動歸零
const effArmor = (u) => Math.max(0, u.armor * (1 + (u.debuff.armorPct || 0) / 100) + (u.debuff.armorFlat || 0));
// 命中後套用武器的 debuff：持續到「對方自己的下一個回合結束」
function applyDebuff(def, w) {
  if (!w.debuff || def.kind !== 'unit' || def.hp <= 0) return;
  const { turns = 1, ...stats } = w.debuff;
  Object.assign(def.debuff, stats);
  const ownPhase = def.team === 'player' ? 'PLAYER' : 'ENEMY';
  def.debuffTurns = Math.max(def.debuffTurns, turns + (G.phase === ownPhase ? 1 : 0));
  const txt = Object.entries(stats).map(([k, v]) => ({ mobility: '運動性', move: '移動力', armorPct: '裝甲%', armorFlat: '裝甲' }[k] + ' ' + (v <= -99 ? '歸零' : v))).join('、');
  log(`🌀 ${def.name} 被【${w.name}】影響：${txt}`, def.team === 'player' ? 'enemy' : 'player');
}
// 每個陣營的回合結束時，倒數自己身上的 debuff
function tickDebuffs(team) {
  for (const u of G.units) {
    if (u.team !== team || !u.debuffTurns) continue;
    u.debuffTurns -= 1;
    if (u.debuffTurns <= 0) { u.debuff = {}; u.debuffTurns = 0; }
  }
}
function spawn(type, o) { const u = mkUnit(type, o); G.units.push(u); return u; }
const unitById = (uid) => G.units.find((u) => u.uid === uid && u.hp > 0);
const unitAt = (x, y) => G.units.find((u) => u.hp > 0 && u.x === x && u.y === y);
const alive = (fn = () => true) => G.units.filter((u) => u.hp > 0 && fn(u));
const terrainAt = (x, y) => G.map[y][x];
const inMap = (x, y) => x >= 0 && y >= 0 && x < G.cols && y < G.rows;

function weaponUsable(u, w) {
  if (w.left === 0) return false;
  if (u.en < w.en) return false;
  if (u.morale < w.morale) return false;
  if (w.needForm && u.form !== w.needForm) return false;   // v6：雲雀 07、08 要先明鏡止水（黃金雲雀）
  if (w.oncePerStage && w.usedThisStage) return false;     // v6：雲雀 09 每關限一次
  return true;
}

// ==================== 移動範圍（依地形消耗的廣度搜尋） ====================
function calcMoveRange(u) {
  const mv = effMove(u) + (u.spirit.accel ? 3 : 0);
  const best = {}; const out = [];
  const q = [{ x: u.x, y: u.y, r: mv }]; best[u.x + ',' + u.y] = mv;
  while (q.length) {
    const c = q.shift();
    const occ = unitAt(c.x, c.y);
    if (!occ || occ === u) out.push({ x: c.x, y: c.y });
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = c.x + dx, ny = c.y + dy;
      if (!inMap(nx, ny)) continue;
      const o = unitAt(nx, ny);
      if (o && (o.team !== u.team || o.kind !== 'unit')) continue;   // 敵機、地圖物件、母艦都擋路
      const r = c.r - terrainAt(nx, ny).cost;
      if (r < 0) continue;
      const k = nx + ',' + ny;
      if (best[k] === undefined || best[k] < r) { best[k] = r; q.push({ x: nx, y: ny, r }); }
    }
  }
  // 去除重複
  const seen = new Set();
  return out.filter((c) => { const k = c.x + ',' + c.y; if (seen.has(k)) return false; seen.add(k); return true; });
}
// v14：精神【狙擊】本回合射擊武器（射程 2 以上）+2
const wMax = (u, w) => w.max + (u.spirit && u.spirit.snipe && w.max > 1 ? 2 : 0);
function calcAttackRange(u, w) {
  const out = [];
  for (let y = 0; y < G.rows; y++) for (let x = 0; x < G.cols; x++) {
    const d = Math.abs(u.x - x) + Math.abs(u.y - y);
    if (d >= w.min && d <= wMax(u, w)) out.push({ x, y });
  }
  return out;
}

// ==================== 命中與傷害公式 ====================
function calcHit(att, def, w, resp) {
  if (def.kind !== 'unit') return 100;
  if (def.spirit.flash) return 0;
  if (att.spirit.surehit || w.surehit) return 100;   // v5：武器本身必中（E09 時間停止）
  if (att.team === 'player' && CHEAT.on('surehit')) return 100;   // v13：金手指
  const t = terrainAt(def.x, def.y);
  // 機戰式：運動性差距直接影響命中（真實系很會閃、超級系很耐打）
  let h = 70 + w.hit + (effMobility(att) - effMobility(def)) - t.eva - def.evaBonus;
  if (att.spirit.focus) h += 30;   // v6：集中
  if (def.spirit.focus) h -= 30;
  if (att.flare > 0) h -= 30;
  if (resp === 'evade') h /= 2;
  return Math.round(clamp(h, 0, 100));
}
function calcDmg(att, def, w, resp) {
  const t = terrainAt(def.x, def.y);
  const skill = PILOTS[att.pilotId].atk || 1;   // 駕駛員攻擊補正（無人機較弱）
  const armor = w.ignoreArmor || att.spirit.direct ? 0 : effArmor(def) * (1 - (w.pierce || 0) / 100);   // v5：無視裝甲、裝甲 debuff；v6：pierce 無視部分裝甲
  let d = w.power * skill * (att.morale / 100) - armor * (1 + t.def / 100);
  if (att.spirit.soul) d *= 2.5;            // v6：魂（和熱血不疊加，魂優先）
  else if (att.spirit.hotblood) d *= 2;
  if (def.spirit.ironwall) d *= 0.25;
  if (resp === 'defend') d *= 0.5;
  // v5：E09【因果歪曲】傷害減半；v6「近身破法」：被 breakRange 格以內攻擊時減半失效
  if (def.causalWarp && def.causalWarp.halve && !(def.causalWarp.breakRange && dist(att, def) <= def.causalWarp.breakRange)) d *= 0.5;
  d = Math.max(10, Math.floor(d));
  if (def.aegisField && d <= def.aegisField) d = 0;   // v6：神盾重力場
  if (def.spirit.unyield && d > 10) d = 10;           // v6：不屈
  if (att.team === 'player' && def.team !== 'player' && CHEAT.on('oneshot')) d = Math.max(d, def.hp);   // v13：金手指（劇情不死的敵人仍由 strike 的 interceptDeath 保住）
  if (def.team === 'player' && CHEAT.on('godmode')) d = 0;                                             // v13：金手指
  return d;
}
function bestWeapon(u, target, d) {
  let best = null, score = -1;
  for (const w of u.weapons) {
    if (!weaponUsable(u, w) || d < w.min || d > wMax(u, w)) continue;
    const s = calcDmg(u, target, w) * calcHit(u, target, w) / 100;
    if (s > score) { score = s; best = w; }
  }
  return best;
}
const canCounter = (u) => u.hp > 0 && u.kind === 'unit' && u.team !== 'neutral' && !u.noCounter;

// ==================== 繪圖 ====================
const cv = $('mapCanvas'); const ctx = cv.getContext('2d');
const TEAM_COL = { player: ['rgba(37,99,235,.65)', '#60a5fa'], enemy: ['rgba(220,38,38,.6)', '#f87171'], npc: ['rgba(16,185,129,.55)', '#6ee7b7'], neutral: ['rgba(124,58,237,.6)', '#c4b5fd'] };

// ───────── v3：斜角 2.5D 地圖（A 矮地形）─────────
// 格子座標 (x, y) → 畫面上菱形頂點；地形方塊、棋子都是 5060 生成＋程式像素化的圖。
// 開發者要求「地形不能遮住棋子」：先畫完所有地形與範圍高亮，棋子最後統一畫在最上層。
const TW = 128, TH = 64, TILE_DEPTH = 14;   // 菱形寬、高，方塊側面厚度（與素材一致）
const MAP_TOP = 120;                         // 地圖上方留白（給最高的物件和棋子）
let ISO_OX = 0;
const iso = (x, y) => ({ x: ISO_OX + (x - y) * TW / 2, y: MAP_TOP + (x + y) * TH / 2 });       // 菱形頂點
const isoCenter = (x, y) => { const p = iso(x, y); return { x: p.x + TW / 2, y: p.y + TH / 2 }; };
function screenToCell(px, py) {
  const dx = px - (ISO_OX + TW / 2), dy = py - MAP_TOP;
  return { x: Math.floor((dy / (TH / 2) + dx / (TW / 2)) / 2), y: Math.floor((dy / (TH / 2) - dx / (TW / 2)) / 2) };
}
function layoutIso() {
  ISO_OX = (G.rows - 1) * TW / 2;
  cv.width = (G.cols + G.rows) * TW / 2;
  cv.height = MAP_TOP + (G.cols + G.rows) * TH / 2 + TILE_DEPTH + 10;
  fxCv.width = cv.width; fxCv.height = cv.height;
  applyZoom();
}

// ───────── v8：地圖鏡頭（大地圖 25～30 格，不能再整張縮進畫面） ─────────
// 為什麼：v7 以前把整張地圖縮到視窗寬度，10×14 還看得清楚；25×25 會縮到一格只剩 30 像素。
// 做法：畫布照原尺寸畫，外面包一個可捲動的視窗；縮放只改「顯示大小」（CSS），點擊換算本來就用比例，不受影響。
const fxCv = $('fxCanvas'), fxCtx = fxCv.getContext('2d');
const mapView = $('mapView');
const ZOOMS = [0.35, 0.45, 0.55, 0.7, 0.85, 1];
let zoomIdx = Math.min(ZOOMS.length - 1, Math.max(0, +(localStorage.getItem('srw_zoom') ?? 2)));
function applyZoom() {
  const z = ZOOMS[zoomIdx];
  for (const c of [cv, fxCv]) { c.style.width = cv.width * z + 'px'; c.style.height = cv.height * z + 'px'; }
}
function setZoom(d) {
  // 縮放時保持畫面中心不動
  const z0 = ZOOMS[zoomIdx], cx = (mapView.scrollLeft + mapView.clientWidth / 2) / z0, cy = (mapView.scrollTop + mapView.clientHeight / 2) / z0;
  zoomIdx = Math.min(ZOOMS.length - 1, Math.max(0, zoomIdx + d));
  try { localStorage.setItem('srw_zoom', zoomIdx); } catch (e) {}
  applyZoom(); hideMenu();
  const z = ZOOMS[zoomIdx];
  mapView.scrollLeft = cx * z - mapView.clientWidth / 2; mapView.scrollTop = cy * z - mapView.clientHeight / 2;
}
// 鏡頭移到某一格（smooth：平滑捲動；只有格子不在畫面中間區域時才移動，避免畫面一直晃）
function centerOn(x, y, smooth = true, force = false) {
  if (!G.stage || x == null) return;
  const z = ZOOMS[zoomIdx], c = isoCenter(x, y);
  const px = c.x * z, py = c.y * z, vw = mapView.clientWidth, vh = mapView.clientHeight;
  const inside = px > mapView.scrollLeft + vw * 0.2 && px < mapView.scrollLeft + vw * 0.8 && py > mapView.scrollTop + vh * 0.2 && py < mapView.scrollTop + vh * 0.8;
  if (inside && !force) return;
  mapView.scrollTo({ left: px - vw / 2, top: py - vh / 2, behavior: smooth ? 'smooth' : 'auto' });
}
// 拖曳捲動：按住左鍵拖動超過 6 像素才算拖曳，放開後那一次點擊不算選取
let dragInfo = null, justDragged = false;
mapView.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; justDragged = false; dragInfo = { x: e.clientX, y: e.clientY, sl: mapView.scrollLeft, st: mapView.scrollTop, moved: false }; });
window.addEventListener('pointermove', (e) => {
  if (!dragInfo) return;
  const dx = e.clientX - dragInfo.x, dy = e.clientY - dragInfo.y;
  if (!dragInfo.moved && Math.hypot(dx, dy) > 6) { dragInfo.moved = true; mapView.classList.add('dragging'); hideMenu(); }
  if (dragInfo.moved) { mapView.scrollLeft = dragInfo.sl - dx; mapView.scrollTop = dragInfo.st - dy; }
});
window.addEventListener('pointerup', () => { if (dragInfo && dragInfo.moved) justDragged = true; dragInfo = null; mapView.classList.remove('dragging'); });
mapView.addEventListener('wheel', (e) => { if (e.ctrlKey) { e.preventDefault(); setZoom(e.deltaY < 0 ? 1 : -1); } }, { passive: false });
$('btnZoomIn').onclick = () => setZoom(1);
$('btnZoomOut').onclick = () => setZoom(-1);
$('btnCenter').onclick = () => { const u = G.sel || alive((p) => p.team === 'player' && p.kind === 'unit')[0]; if (u) centerOn(u.x, u.y, true, true); };

// 圖片快取：載入完成就重畫；檔案不在就退回 v2 的色塊／圓形畫法
const IMG = {};
function img(path) {
  if (!(path in IMG)) {
    const im = new Image(); IMG[path] = null;
    im.onload = () => { IMG[path] = im; render(); };
    im.onerror = () => { IMG[path] = false; };
    im.src = path;
  }
  return IMG[path] || null;
}
const tileImg = (t) => img(`assets/map/tiles/${t.id}.png`);
function pieceImg(u) {
  const T = UNIT_TYPES[u.type] || {};
  if (u.kind !== 'unit') return T.mapObject ? img(`assets/map/objects/${T.mapObject}.png`) : null;
  if (!T.piece) return null;
  // 影蝠：敵方紅底座；若變成我方（入隊後）改用藍底座的鏡像版
  if (u.team === 'player' && T.pieceAlly) return img(`assets/map/pieces/${T.pieceAlly}.png`);
  return img(`assets/map/pieces/${T.piece}.png`);
}

function diamond(x, y, inset = 0) {
  const p = iso(x, y);
  ctx.beginPath();
  ctx.moveTo(p.x + TW / 2, p.y + inset); ctx.lineTo(p.x + TW - inset * 2, p.y + TH / 2);
  ctx.lineTo(p.x + TW / 2, p.y + TH - inset); ctx.lineTo(p.x + inset * 2, p.y + TH / 2); ctx.closePath();
}

function render() {
  if (!G.stage) return;
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.imageSmoothingEnabled = false;   // 像素風：放大縮小不要糊
  // ① 地形：由後往前（x+y 小的先畫）
  for (let s = 0; s < G.cols + G.rows - 1; s++) {
    for (let x = 0; x < G.cols; x++) {
      const y = s - x; if (y < 0 || y >= G.rows) continue;
      const t = G.map[y][x], p = iso(x, y), im = tileImg(t);
      if (im) ctx.drawImage(im, p.x, p.y - (im.height - (TH + TILE_DEPTH)));
      else { diamond(x, y); ctx.fillStyle = t.color; ctx.fill(); }
    }
  }
  // ② 地圖標記（例如 1-3 被丟棄的雲雀）
  for (const m of G.markers) {
    if (m.hidden) continue;
    const c = isoCenter(m.x, m.y);
    ctx.font = '30px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(m.icon, c.x, c.y - 6);
  }
  // ③ 範圍高亮：畫在菱形頂面上
  const fillCells = (cells, f, s) => { for (const c of cells) { diamond(c.x, c.y, 2); ctx.fillStyle = f; ctx.fill(); ctx.strokeStyle = s; ctx.lineWidth = 2; ctx.stroke(); } };
  if (G.telegraph) fillCells(G.telegraph.cells, (Math.floor(performance.now() / 300) % 2) ? 'rgba(239,68,68,.5)' : 'rgba(239,68,68,.28)', 'rgba(239,68,68,.8)');
  if (G.moveRange.length) fillCells(G.moveRange, 'rgba(74,222,128,.35)', '#4ade80');
  if (G.atkRange.length) fillCells(G.atkRange, 'rgba(239,68,68,.35)', '#ef4444');
  if (inMap(G.hover.x, G.hover.y)) { diamond(G.hover.x, G.hover.y, 1); ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 3; ctx.stroke(); }
  // ④ 棋子：最後畫、永遠在地形上面；前排（x+y 大）蓋後排
  const list = G.units.filter((u) => u.hp > 0 && !u.hidden).sort((a, b) => (a.x + a.y) - (b.x + b.y));
  for (const u of list) {
    const c = isoCenter(u.x, u.y), im = pieceImg(u);
    if (G.sel === u) { ctx.beginPath(); ctx.ellipse(c.x, c.y + 4, TW * 0.42, TH * 0.42, 0, 0, Math.PI * 2); ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.stroke(); }
    if (u.boss) { ctx.beginPath(); ctx.ellipse(c.x, c.y + 4, TW * 0.46, TH * 0.46, 0, 0, Math.PI * 2); ctx.strokeStyle = '#facc15'; ctx.lineWidth = 3; ctx.stroke(); }
    let top;
    if (im) {
      const sc = Math.min(1, (TW * 0.9) / im.width);
      const w = im.width * sc, h = im.height * sc;
      top = c.y + 14 - h;
      ctx.save();
      if (u.acted && u.team === 'player') ctx.filter = 'grayscale(1) brightness(.6)';   // 行動完畢變灰
      ctx.drawImage(im, c.x - w / 2, top, w, h);
      ctx.restore();
    } else {
      // 還沒有棋子圖的機體（雲雀、民用機、昭明號）：沿用 v2 的圓形／方塊標記
      const [fill, stroke] = TEAM_COL[u.team] || TEAM_COL.enemy;
      ctx.lineWidth = 2;
      if (u.kind === 'unit') { ctx.beginPath(); ctx.arc(c.x, c.y - 12, 22, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = u.acted ? '#64748b' : stroke; ctx.stroke(); }
      else { ctx.fillStyle = fill; ctx.fillRect(c.x - 30, c.y - 34, 60, 40); ctx.strokeStyle = stroke; ctx.strokeRect(c.x - 30, c.y - 34, 60, 40); }
      ctx.fillStyle = '#fff'; ctx.font = 'bold 14px "Microsoft JhengHei",sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(u.label, c.x, c.y - 13);
      if (u.acted && u.team === 'player') { ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.beginPath(); ctx.arc(c.x, c.y - 12, 22, 0, Math.PI * 2); ctx.fill(); }
      top = c.y - 36;
    }
    // 名牌＋HP 條（在棋子腳下）
    if (u.maxHp < 90000) {
      const p = Math.max(0, u.hp / u.maxHp), bw = 56;
      ctx.fillStyle = 'rgba(17,24,39,.9)'; ctx.fillRect(c.x - bw / 2, c.y + 18, bw, 6);
      ctx.fillStyle = u.team === 'player' ? '#22c55e' : u.team === 'npc' ? '#34d399' : '#ef4444';
      ctx.fillRect(c.x - bw / 2 + 1, c.y + 19, (bw - 2) * p, 4);
    }
    if (im) {
      ctx.font = 'bold 12px "Microsoft JhengHei",sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.85)'; ctx.strokeText(u.label, c.x, c.y + 26);
      ctx.fillStyle = '#fff'; ctx.fillText(u.label, c.x, c.y + 26);
    }
  }
}
setInterval(() => { if (G.telegraph) render(); }, 300);

// ==================== 右側面板 ====================
function showUnit(u) {
  if (!u) return;
  $('unitName').textContent = u.name;
  const P = PILOTS[u.pilotId];
  $('pilotName').textContent = `駕駛員：${u.pilotId === 'NONE' ? '－' : P.name}${u.level ? ` Lv ${u.level}` : ''}（${{ player: '我方', enemy: '敵方', npc: '友軍', neutral: '第三方' }[u.team]}${u.guest ? '・客串' : ''}）`;
  const lvOn = u.team === 'player' && hasLevel(u.pilotId) && u.level;   // v9：經驗值條
  $('expRow').style.display = lvOn ? 'flex' : 'none';
  if (lvOn) {   // v14：經驗條改成「距離下一級還差多少（全隊錢包）」
    const r = rosterOf(u.pilotId), need = ECONOMY.levelCost(r.lv);
    $('lvText').textContent = `Lv ${r.lv}`; $('expText').textContent = `全隊經驗 ${G.wallet || 0}／升級 ${need}`; $('expBar').style.width = Math.min(100, 100 * (G.wallet || 0) / need) + '%';
  }
  $('unitBadge').textContent = u.label; $('unitBadge').style.background = (TEAM_COL[u.team] || TEAM_COL.enemy)[0];
  $('hpText').textContent = `${u.hp} / ${u.maxHp}`; $('hpBar').style.width = (100 * u.hp / u.maxHp) + '%';
  $('enText').textContent = `${u.en} / ${u.maxEn}`; $('enBar').style.width = (u.maxEn ? 100 * u.en / u.maxEn : 0) + '%';
  $('moraleText').textContent = u.morale; $('armorText').textContent = u.armor;
  $('mobilityText').textContent = u.mobility + (u.evaBonus ? `（迴避+${u.evaBonus}%）` : '');
  $('moveText').textContent = u.move + (u.spirit.accel ? '（+3）' : '');
  $('spText').textContent = `${u.sp}/${u.maxSp}`;
  // 精神指令
  const sg = $('spiritsGrid'); sg.innerHTML = '';
  if (u.team !== 'player' || !u.spirits.length) sg.innerHTML = '<div class="muted">無精神指令</div>';
  else for (const id of u.spirits) {
    const S = SPIRITS[id]; const b = document.createElement('button');
    b.className = 'spirit-btn' + (u.spirit[id] ? ' active' : '');
    b.disabled = G.phase !== 'PLAYER' || G.busy || u.sp < S.cost || !!u.spirit[id] || (S.needMorale && u.morale < S.needMorale);
    b.innerHTML = `${S.name}<small>${S.cost}</small>`; b.title = S.desc;
    b.onclick = () => useSpirit(u, id);
    sg.appendChild(b);
  }
  // 武器
  const wl = $('weaponsList'); wl.innerHTML = '';
  for (const w of u.weapons) {
    const d = document.createElement('div');
    const ok = weaponUsable(u, w);
    d.className = 'weapon-card' + (G.weapon === w && G.sel === u ? ' selected' : '') + (ok ? '' : ' disabled');
    const cost = [w.en ? `EN ${w.en}` : '', w.ammo > 0 ? `彈 ${w.left}/${w.ammo}` : '', w.morale > 100 ? `氣力 ${w.morale}` : ''].filter(Boolean).join('・') || '無消耗';
    d.innerHTML = `<div class="weapon-name">${w.name}${w.anim ? ' <span class="anim-tag">演出</span>' : ''}</div><div class="weapon-meta"><span>射程 ${w.min}-${w.max}</span><span>威力 ${w.power}</span><span>${cost}</span></div>`;
    d.onclick = () => {
      if (G.mode !== 'attack' || G.sel !== u || !ok) return;
      G.weapon = w; G.atkRange = calcAttackRange(u, w); showUnit(u); render();
    };
    wl.appendChild(d);
  }
}
function useSpirit(u, id) {
  const S = SPIRITS[id];
  if (u.sp < S.cost || u.spirit[id]) return;
  if (S.needMorale && u.morale < S.needMorale) return;
  if (!(u.team === 'player' && CHEAT.on('infsp'))) u.sp -= S.cost;   // v13：金手指
  u.spirit[id] = true;
  if (SPIRIT_SND[id]) SND.se('ui/' + SPIRIT_SND[id]);   // v12
  log(`✨ ${u.pilot}：精神指令【${S.name}】（${S.desc}）`, 'player');
  if (id === 'guts') { const h = Math.floor(u.maxHp * 0.3); u.hp = Math.min(u.maxHp, u.hp + h); u.spirit.guts = false; log(`💚 ${u.name} 恢復 ${h} HP`, 'player'); }
  if (id === 'spirit') { u.morale = Math.min(150, u.morale + 10); u.spirit.spirit = false; }   // v6：氣合
  // v14：新精神（相鄰＝上下左右一格的我方機體）
  const near = () => alive((v) => v.team === 'player' && v.kind === 'unit' && v !== u && dist(v, u) === 1);
  if (id === 'valor') { u.morale = Math.min(150, u.morale + 30); u.spirit.valor = false; }
  if (id === 'trust') { for (const v of near()) { const h = Math.floor(v.maxHp * 0.3); v.hp = Math.min(v.maxHp, v.hp + h); log(`💚 ${v.name} 恢復 ${h} HP`, 'player'); } u.spirit.trust = false; }
  if (id === 'encourage') { for (const v of near()) { v.morale = Math.min(150, v.morale + 10); log(`🔥 ${v.name} 氣力 +10`, 'player'); } u.spirit.encourage = false; }
  if (id === 'supply') { for (const v of near()) { v.en = v.maxEn; v.weapons.forEach((x) => { if (x.ammo > 0) x.left = x.ammo; }); log(`🔧 ${v.name} 彈藥、EN 全滿`, 'player'); } u.spirit.supply = false; }
  if (id === 'snipe' && G.sel === u && G.mode === 'attack' && G.weapon) G.atkRange = calcAttackRange(u, G.weapon);
  if (id === 'meikyo') { u.morale -= 50; u.formBeforeGolden = u.form; setForm(u, 'golden'); u.spirit.meikyo = false; }   // v6：明鏡止水
  if (id === 'accel' && G.sel === u && G.mode === 'move') G.moveRange = calcMoveRange(u);
  showUnit(u); render();
}
function log(text, type = 'system') {
  const b = $('combatLog'); const e = document.createElement('div');
  e.className = 'log-entry ' + type; e.textContent = text; b.appendChild(e); b.scrollTop = b.scrollHeight;
}
function updateHud() {
  $('stageTitle').textContent = G.stage ? `${G.stage.id}「${G.stage.title}」` : '';
  $('turnNumber').textContent = G.turn;
  $('phaseIndicator').textContent = G.phase === 'PLAYER' ? '我方回合' : '敵方回合';
  $('phaseIndicator').className = 'phase-badge' + (G.phase === 'PLAYER' ? '' : ' enemy');
  $('winText').textContent = G.stage ? G.stage.win : '';
  $('loseText').textContent = G.stage ? G.stage.lose : '';
  $('btnEndTurn').disabled = G.phase !== 'PLAYER' || G.busy || G.ended;
  $('btnAnim').textContent = '戰鬥動畫：' + (G.animOn ? '開' : '關');
  $('debugFlags').textContent = G.debug ? '旗標：' + JSON.stringify(G.flags) : '';
}

// ==================== 對話系統 ====================
let dlgSkip = false;
function speakerColor(name) { return SPEAKER_COLORS[name] || '#64748b'; }
// v12：對話頭像。表情由 js/portrait_expr.json 逐句指定（「說話者|台詞」→ 檔名）；沒指定的句子用該角色的預設表情
const PORTRAIT_DEFAULT = { '蕾歐娜': 'LEONA_normal', '諾亞': 'NOAH_pilot_normal', '甲斐': 'KAI_normal', '瑪格麗特': 'MARGARET_normal', '席格': 'SIEG_normal',
  '通信士 遙': 'HARUKA_normal', '格雷少將': 'GRAY_smile', '神城 玄藏': 'GENZO_normal', '小米': 'MII_smile', '阿茲拉爾': 'AZRAEL_normal', '神城 剛': 'GO_determined' };
let PORTRAIT_EXPR = {};
fetch('js/portrait_expr.json').then((r) => r.json()).then((m) => { PORTRAIT_EXPR = m; }).catch(() => {});
function portraitOf(name, text) { return PORTRAIT_EXPR[name + '|' + text] || PORTRAIT_DEFAULT[name] || null; }
async function talk(lines) {
  if (!lines || !lines.length) return;
  const box = $('dialogue'); box.style.display = 'flex'; dlgSkip = false;
  const prevBusy = G.busy; G.busy = true; updateHud();
  for (const ln of lines) {
    if (dlgSkip) break;
    let name = '', text = '', cls = 'line';
    if (Array.isArray(ln)) { name = ln[0]; text = ln[1]; }
    else if (ln.n) { text = ln.n; cls = 'narr'; }
    else if (ln.place) { text = ln.place; cls = 'place'; }
    else if (ln.sys) { text = ln.sys; cls = 'sys'; }
    $('dlgName').textContent = name;
    $('dlgPortrait').style.display = name ? 'flex' : 'none';
    // v12：有正式頭像就顯示圖片（表情照 js/portrait_expr.json），沒有才用色塊＋名字第一個字
    const face = name ? portraitOf(name, text) : null;
    $('dlgPortrait').textContent = name && !face ? name.replace(/^.*\s/, '')[0] : '';
    $('dlgPortrait').style.background = face ? `#0b1020 url("assets/portraits/${face}.webp") center/cover` : speakerColor(name);
    $('dlgBox').className = 'dlg-box ' + cls;
    await typeText($('dlgText'), name ? `「${text}」` : text);
    await waitAdvance();
  }
  box.style.display = 'none'; G.busy = prevBusy; updateHud();
}
function typeText(el, text) {
  return new Promise((done) => {
    let i = 0; el.textContent = ''; let finished = false;
    const finish = () => { if (finished) return; finished = true; clearInterval(timer); el.textContent = text; $('dialogue').onclick = null; done(); };
    const timer = setInterval(() => { i += 1; el.textContent = text.slice(0, i); if (i >= text.length) finish(); }, 22);
    $('dialogue').onclick = (e) => { if (e.target.id === 'dlgSkip') return; finish(); };
    if (dlgSkip) finish();
  });
}
function waitAdvance() {
  return new Promise((done) => {
    const go = (e) => { if (e && e.target && e.target.id === 'dlgSkip') return; cleanup(); done(); };
    const key = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
    const cleanup = () => { $('dialogue').onclick = null; window.removeEventListener('keydown', key); };
    setTimeout(() => { $('dialogue').onclick = go; window.addEventListener('keydown', key); if (dlgSkip) go(); }, 60);
  });
}
$('dlgSkip').onclick = (e) => { e.stopPropagation(); dlgSkip = true; $('dialogue').click(); };

// 大字橫幅（作戰開始、勝利、回合）
async function banner(text, sub = '', ms = 1300) {
  const b = $('banner'); $('bannerText').textContent = text; $('bannerSub').textContent = sub;
  b.style.display = 'flex'; b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
  await sleep(ms); b.style.display = 'none';
}

// ==================== 戰鬥畫面 ====================
// 簡易戰鬥框（沒有演出的武器、反擊、敵方攻擊）
function quickBattle(att, def, w, res) {
  return new Promise((done) => {
    const m = $('quickBattle');
    $('qbAtt').textContent = `${att.name}（${att.pilot}）`; $('qbWeapon').textContent = w.name;
    $('qbDef').textContent = def.name;
    $('qbResult').textContent = res.hit ? `命中！ ${res.dmg} 傷害${res.killed ? '　擊墜！' : ''}` : '迴避！';
    $('qbResult').className = 'qb-result ' + (res.hit ? 'hit' : 'miss');
    m.className = 'quick-battle ' + (att.team === 'player' ? 'from-left' : 'from-right');
    m.style.display = 'flex';
    let closed = false;
    const close = () => { if (closed) return; closed = true; m.style.display = 'none'; m.onclick = null; done(); };
    m.onclick = close; setTimeout(close, 1100);
  });
}

// ───────── v8：地圖戰鬥（沒有演出時：地圖上的彈道／爆炸特效＋小型切入框） ─────────
// 為什麼：關掉戰鬥動畫、或客串機／砲台這類沒有演出的攻擊，以前只跳一個數字框，看不出誰打誰、打了什麼。
// 做法：在地圖上面疊一張透明畫布（fxCanvas）畫特效；左上角滑出小型切入框（攻擊方立繪＋招式名＋結果）。
let standData = null;
async function standOf(u) {
  // 切入框用的圖：我方／敵機用演出立繪（壓縮後的 webp），其他用地圖棋子
  try {
    if (!standData) {
      const [c, e] = await Promise.all([fetch(ANIM_BASE + 'data/characters.json').then((r) => r.json()), fetch(ANIM_BASE + 'data/enemies.json').then((r) => r.json())]);
      standData = { c: c.units, e: e.units };
    }
    const s = (u.animUnit && standData.c[u.animUnit] && standData.c[u.animUnit].stand) || (u.eid && standData.e[u.eid] && standData.e[u.eid].stand);
    if (s) return BattleAnimPlayer.src(ANIM_BASE + s);
  } catch (e) { /* 讀不到就用棋子 */ }
  const T = UNIT_TYPES[u.type] || {};
  if (T.piece) return `assets/map/pieces/${u.team === 'player' && T.pieceAlly ? T.pieceAlly : T.piece}.png`;
  return T.mapObject ? `assets/map/objects/${T.mapObject}.png` : '';
}
// 依武器名稱與射程，決定地圖上的攻擊外觀
function fxKind(w) {
  const n = w.name;
  if (w.max <= 1) return 'melee';
  if (/導彈|飛彈|火箭|榴彈|重砲|震盪彈|信號彈/.test(n)) return 'missile';
  if (/機槍|機砲|散射|鐵拳|飛拳/.test(n)) return 'bullet';
  if (/光束|雷射|射線|熱線|加農|等離子|黑洞|波|球|原質/.test(n) || w.en > 0) return 'beam';
  return 'bullet';
}
async function mapBattle(att, def, w, res) {
  const spd = animSpeed;                       // 2 倍速時地圖戰鬥也加快
  // 鏡頭：攻擊方或目標任一個不在畫面內，就移到兩者中間（等平滑捲動做完再開始畫特效）
  const z = ZOOMS[zoomIdx], vis = (u) => { const c = isoCenter(u.x, u.y), px = c.x * z, py = (c.y - 40) * z;
    return px > mapView.scrollLeft + 40 && px < mapView.scrollLeft + mapView.clientWidth - 40 && py > mapView.scrollTop + 60 && py < mapView.scrollTop + mapView.clientHeight - 40; };
  if (!vis(att) || !vis(def)) { const ca = isoCenter(att.x, att.y), cd = isoCenter(def.x, def.y);
    mapView.scrollTo({ left: (ca.x + cd.x) / 2 * z - mapView.clientWidth / 2, top: ((ca.y + cd.y) / 2 - 40) * z - mapView.clientHeight / 2, behavior: 'smooth' }); await sleep(350); }
  // 小型切入框
  const mc = $('miniCutin');
  mc.className = 'mini-cutin' + (att.team === 'player' ? '' : ' enemy');
  $('mcImg').src = await standOf(att);
  $('mcName').textContent = `${att.name}（${att.pilot}）`;
  $('mcWeapon').textContent = `【${w.name}】 → ${def.name}`;
  $('mcLine').textContent = '';
  mc.style.display = 'flex';
  const A = isoCenter(att.x, att.y), D = isoCenter(def.x, def.y);
  const a = { x: A.x, y: A.y - 40 }, d = { x: D.x, y: D.y - 40 };
  const kind = fxKind(w), col = att.team === 'player' ? [90, 210, 255] : [255, 110, 70];
  const rgb = (c, al) => `rgba(${c[0]},${c[1]},${c[2]},${al})`;
  const T_SHOT = 0.25, T_HIT = kind === 'melee' ? 0.45 : kind === 'missile' ? 0.75 : 0.6, T_END = T_HIT + 0.9;
  const rnd = (() => { let s = (att.x * 31 + def.y * 17 + w.power) >>> 0; return () => { s = (s * 1103515245 + 12345) >>> 0; return s / 4294967296; }; })();
  const sparks = Array.from({ length: 26 }, () => ({ a: rnd() * Math.PI * 2, v: 60 + rnd() * 160, r: 2 + rnd() * 4 }));
  const missiles = Array.from({ length: 4 }, (_, i) => ({ h: 40 + rnd() * 70, dt: i * 0.07, off: (rnd() - 0.5) * 30 }));
  const evadeDx = (d.x > a.x ? 1 : -1) * 28;
  const stack = $('mapStack');
  mapBattleRunning = true;
  await new Promise((done) => {
    const t0 = performance.now(); let resultShown = false;
    const frame = (now) => {
      const t = (now - t0) / 1000 * spd, g = fxCtx;
      g.clearRect(0, 0, fxCv.width, fxCv.height);
      g.save(); g.globalCompositeOperation = 'lighter'; g.lineCap = 'round';
      // 攻擊方蓄力光
      if (t < T_HIT) { const k = Math.min(1, t / T_SHOT); g.fillStyle = rgb(col, 0.35 * k); g.beginPath(); g.arc(a.x, a.y, 18 + 14 * k, 0, 7); g.fill(); }
      const target = res.hit ? d : { x: d.x + evadeDx * 1.6, y: d.y - 10 };   // 沒打中：彈道擦過
      if (kind === 'beam' && t > T_SHOT && t < T_HIT + 0.25) {
        const k = 1 - Math.max(0, (t - T_HIT) / 0.25);
        g.strokeStyle = rgb(col, 0.5 * k); g.lineWidth = 16; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(target.x, target.y); g.stroke();
        g.strokeStyle = rgb([255, 255, 255], 0.9 * k); g.lineWidth = 5; g.stroke();
      }
      if (kind === 'bullet' && t > T_SHOT && t < T_HIT + 0.1) {
        for (let i = 0; i < 7; i++) { const u = Math.min(1, ((t - T_SHOT) / (T_HIT - T_SHOT)) * 1.6 - i * 0.09); if (u <= 0 || u >= 1) continue;
          const x = a.x + (target.x - a.x) * u + (i % 2 ? 6 : -6), y = a.y + (target.y - a.y) * u;
          g.strokeStyle = rgb([255, 230, 140], 0.95); g.lineWidth = 3; g.beginPath(); g.moveTo(x, y); g.lineTo(x - (target.x - a.x) * 0.05, y - (target.y - a.y) * 0.05); g.stroke(); }
      }
      if (kind === 'missile' && t > T_SHOT) for (const m of missiles) {
        const u = Math.min(1, (t - T_SHOT - m.dt) / (T_HIT - T_SHOT)); if (u <= 0 || u >= 1) continue;
        const x = a.x + (target.x + m.off - a.x) * u, y = a.y + (target.y - a.y) * u - Math.sin(u * Math.PI) * m.h;
        g.fillStyle = rgb([255, 200, 120], 0.9); g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill();
        g.fillStyle = rgb([200, 200, 200], 0.25); for (let k = 1; k < 6; k++) { const uu = Math.max(0, u - k * 0.04); g.beginPath(); g.arc(a.x + (target.x + m.off - a.x) * uu, a.y + (target.y - a.y) * uu - Math.sin(uu * Math.PI) * m.h, 4 + k, 0, 7); g.fill(); }
      }
      if (kind === 'melee' && t > T_SHOT && t < T_HIT + 0.35) {
        // 衝刺殘影＋斬光
        const u = Math.min(1, (t - T_SHOT) / (T_HIT - T_SHOT));
        g.fillStyle = rgb(col, 0.25); for (let k = 0; k < 4; k++) { const uu = Math.max(0, u - k * 0.12); g.beginPath(); g.arc(a.x + (d.x - a.x) * uu * 0.8, a.y + (d.y - a.y) * uu * 0.8, 16, 0, 7); g.fill(); }
        if (t > T_HIT - 0.05) { const k = 1 - (t - T_HIT + 0.05) / 0.4; g.strokeStyle = rgb([255, 255, 255], k); g.lineWidth = 6;
          for (const ang of [-0.6, 0.5]) { g.beginPath(); g.arc(target.x, target.y, 34, ang - 1.1, ang + 1.1); g.stroke(); } }
      }
      // 命中：爆炸火花；沒打中：殘影＋MISS
      if (t >= T_HIT) {
        const lt = t - T_HIT;
        if (res.hit) {
          const k = Math.max(0, 1 - lt / 0.7);
          g.fillStyle = rgb([255, 240, 200], 0.9 * k); g.beginPath(); g.arc(d.x, d.y, 10 + 50 * Math.min(1, lt / 0.15), 0, 7); g.fill();
          g.fillStyle = rgb([255, 120, 40], 0.6 * k); g.beginPath(); g.arc(d.x, d.y, 20 + 60 * Math.min(1, lt / 0.3), 0, 7); g.fill();
          for (const s of sparks) { const r = s.v * lt; g.fillStyle = rgb([255, 210, 120], k); g.beginPath(); g.arc(d.x + Math.cos(s.a) * r, d.y + Math.sin(s.a) * r * 0.6, s.r * k, 0, 7); g.fill(); }
          stack.style.transform = lt < 0.3 ? `translate(${(rnd() - 0.5) * 10 * (1 - lt / 0.3)}px, ${(rnd() - 0.5) * 8 * (1 - lt / 0.3)}px)` : '';
        } else {
          const k = Math.max(0, 1 - lt / 0.8); g.fillStyle = rgb([200, 230, 255], 0.3 * k); g.beginPath(); g.arc(d.x + evadeDx, d.y, 22, 0, 7); g.fill();
        }
      }
      g.restore();
      // 傷害數字／MISS（不用加亮，才看得清楚）
      if (t >= T_HIT) {
        const lt = t - T_HIT, k = Math.min(1, lt / 0.12), y = d.y - 50 - 30 * Math.min(1, lt / 0.4);
        g.save(); g.globalAlpha = Math.min(1, 1.6 - lt); g.font = `900 ${Math.round(30 + 12 * k)}px "Microsoft JhengHei", sans-serif`; g.textAlign = 'center';
        g.lineWidth = 6; g.strokeStyle = '#000'; const txt = res.hit ? String(res.dmg) : 'MISS';
        g.fillStyle = res.hit ? (att.team === 'player' ? '#fde68a' : '#fca5a5') : '#93c5fd';
        g.strokeText(txt, d.x, y); g.fillText(txt, d.x, y);
        if (res.killed) { g.font = '900 24px "Microsoft JhengHei", sans-serif'; g.fillStyle = '#f87171'; g.strokeText('擊墜！', d.x, y + 30); g.fillText('擊墜！', d.x, y + 30); }
        g.restore();
        if (!resultShown) { resultShown = true; $('mcLine').textContent = res.hit ? `命中！ ${res.dmg} 傷害${res.killed ? '　擊墜！' : ''}` : `${def.name} 迴避了！`; }
      }
      paintFloats(now);   // v9：經驗值飄字
      if (t < T_END) requestAnimationFrame(frame);
      else { g.clearRect(0, 0, fxCv.width, fxCv.height); stack.style.transform = ''; mc.style.display = 'none'; mapBattleRunning = false; if (floats.length) requestAnimationFrame(drawFloats); done(); }
    };
    requestAnimationFrame(frame);
  });
}

// 演出播放器（只建立一次，之後每次攻擊只換招式）
// v8：我方出招用 BattleAnimPlayer；敵方出招用 BattleEnemyPlayer（敵機招式＋我方受擊／防禦／迴避），兩個共用同一張畫布。
let animPlayer = null, enemyAnimPlayer = null, animHandler = null;
async function getAnimPlayer() {
  if (animPlayer) return animPlayer;
  animPlayer = await BattleAnimPlayer.create($('animCanvas'), { base: ANIM_BASE });
  // 主角機改名（開發者 2026-10-19 決定），只改記憶體中的資料，不動演出素材資料夾
  animPlayer.chars.units.AURORA.name = '極光鋼姬';
  fixPilotPortraits(animPlayer.chars);   // v12
  animPlayer.on('event', (ev) => animHandler && animHandler(ev));
  return animPlayer;
}
async function getEnemyAnimPlayer() {
  if (enemyAnimPlayer) return enemyAnimPlayer;
  enemyAnimPlayer = await BattleEnemyPlayer.create($('animCanvas'), { base: ANIM_BASE });
  enemyAnimPlayer.chars.units.AURORA.name = '極光鋼姬';
  fixPilotPortraits(enemyAnimPlayer.chars);   // v12
  enemyAnimPlayer.on('event', (ev) => animHandler && animHandler(ev));
  return enemyAnimPlayer;
}
// v12：演出台詞框的駕駛員頭像改用正式頭像（characters.json 原本寫的 GO.png 等檔案不存在，會顯示佔位幅）
function fixPilotPortraits(chars) {
  const P = { GO: 'GO_determined', MARGARET: 'MARGARET_normal', NOAH: 'NOAH_pilot_determined' };
  for (const [k, f] of Object.entries(P)) if (chars.pilots[k]) chars.pilots[k].portrait = `assets/portraits/${f}.png`;
}
// v8：這一次攻擊能不能播演出（我方：有招式腳本；敵方：有招式腳本，而且被打的我方機體有受擊／防禦／迴避序列）
function canPlayAnim(att, def, w) {
  if (!G.animOn || !w.anim) return false;
  if (att.team === 'player') return !!att.animUnit;
  return !!def.animUnit && def.team === 'player';
}
// v8：演出 2 倍速（會記住）
let animSpeed = +(localStorage.getItem('srw_anim_speed') || 1) === 2 ? 2 : 1;
function updateSpeedBtn() {
  const b = $('animSpeed'); b.textContent = animSpeed === 2 ? '▶▶ 2倍速' : '▶ 1倍速'; b.classList.toggle('fast', animSpeed === 2);
  for (const p of [animPlayer, enemyAnimPlayer]) if (p) p.speed = animSpeed;
}
$('animSpeed').onclick = (e) => { e.stopPropagation(); animSpeed = animSpeed === 2 ? 1 : 2; try { localStorage.setItem('srw_anim_speed', animSpeed); } catch (er) {} updateSpeedBtn(); };
updateSpeedBtn();
/**
 * 播放招式演出。dmg 為 null 時不顯示傷害數字（劇情演出用）。
 * opt.line：換成劇情專屬台詞；opt.stopAt：播到第幾秒就停（例如 1-5 不播爆炸段）。
 * v8：opt.react＝被打的一方怎麼反應：DAMAGE 受擊（預設）／DEFEND 防禦／EVADE 迴避（沒打中）。
 *     攻擊方是敵機時，自動改用敵方出招播放器，被打的我方機體播反應動作。
 */
async function playAnim(att, def, w, dmg, opt = {}) {
  const ov = $('animOverlay'); ov.style.display = 'flex';
  $('animDamage').textContent = ''; $('animDamage').classList.remove('show');
  $('animLoading').style.display = 'block';
  const react = opt.react || 'DAMAGE';
  try {
    const t = terrainAt(def.x, def.y);
    let p;
    if (att.team === 'player') {
      p = await getAnimPlayer();
      // v4：戰鬥背景＝被攻擊機體所在地形 → 場景 → 該場景 10 張隨機抽 1 張（js/battle_bg.js）
      await BattleBG.init();
      const bg = BattleBG.pick(t, def, G.stage);
      if (G.debug) log(`🎞️ 戰鬥背景：${t.name} → ${bg.name}${bg.url ? ' 第 ' + bg.index + ' 張' : '（沒有圖，用舊背景）'}`);
      await p.load({ move: w.anim, attacker: att.animUnit, target: def.eid || 'PLACEHOLDER', terrain: t.bg, bgUrl: bg.url, targetReact: react });
    } else {
      p = await getEnemyAnimPlayer();
      await p.load({ move: w.anim, target: def.animUnit, reaction: react, terrain: t.bg });
    }
    p.speed = animSpeed;
    if (opt.line) p.line = opt.line;
    $('animLoading').style.display = 'none';
    const cues = battleCues(att, def, w, react, p); SND.setDuck(true); SND.se('ui/UI08_battle_transition', 0.6);   // v12
    await new Promise((done) => {
      let finished = false;
      const finish = () => { if (finished) return; finished = true; p.pause(); animHandler = null; $('animSkip').onclick = null; SND.stopBattle(); SND.setDuck(false); done(); };
      const tick = () => { if (finished) return; while (cues.length && p.t >= cues[0][0]) { const c = cues.shift(); SND.se(c[1], c[2], true); } requestAnimationFrame(tick); };   // v12：照時間點放音效
      requestAnimationFrame(tick);
      animHandler = (ev) => {
        if (ev.type === 'audio' && att.team !== 'player' && REACT_SND[ev.cue]) {   // v12：敵方命中音效＋我方受擊／防禦／迴避
          if (ev.cue !== 'se_evade') SND.se(`se/${sndMove(w.anim)}_hit`, 0.8, true);
          if (sndPrefix(def)) SND.se(`se/${sndPrefix(def)}_${REACT_SND[ev.cue]}`, 1, true);
        }
        if (ev.type === 'damage_popup' && dmg !== null && react !== 'EVADE') { $('animDamage').textContent = dmg; $('animDamage').classList.add('show'); }
        if (ev.type === 'end') finish();
      };
      $('animSkip').onclick = finish;
      if (opt.stopAt) { const chk = () => { if (finished) return; if (p.t >= opt.stopAt) finish(); else requestAnimationFrame(chk); }; requestAnimationFrame(chk); }
      p.seek(0); p.play();
    });
  } catch (e) {
    console.error(e); log('⚠️ 戰鬥動畫載入失敗，改用地圖戰鬥：' + e.message, 'enemy');
    ov.style.display = 'none'; return false;
  }
  if (dmg !== null) await sleep(250);
  ov.style.display = 'none';
  return true;
}

// v12：一招演出的音效時間表 [秒, 檔名, 音量]。音樂區的機體音效每招三段：start（出招前 1.0 秒）、main（動作 3.0 秒）、hit（命中 2.5 秒）
const REACT_SND = { se_hit_heavy: 'damage', se_guard: 'guard', se_evade: 'evade' };
function battleCues(att, def, w, react, p) {
  const S = (p.move && p.move.segments) || {}, mv = sndMove(w.anim), me = sndPrefix(att), them = sndPrefix(def);
  // 播放器 2026-10-25 起跳過首尾幀切入卡片，p.t 是「跳過後」的時間 → 招式檔的時間要用 p._disp 換算
  const disp = (t) => (p._disp ? p._disp(t) : t);
  const at = (seg, d) => disp(S[seg] ? S[seg][0] : d);
  const L = [];
  if (me) L.push([0.05, `se/${me}_deploy`, 0.8]);
  L.push([Math.max(0.3, at('action', 2.8) - 0.35), `se/${mv}_start`, 1], [at('action', 2.8), `se/${mv}_main`, 1]);
  const H = at('hit', 7.1) + 0.15;
  if (att.team === 'player') {        // 我方出招：敵機的反應在演出裡，音效由這裡放
    if (react === 'EVADE') L.push([H, them ? `se/${them}_evade` : null, 1]);
    else { L.push([H, `se/${mv}_hit`, 1]); if (react === 'DEFEND' && them) L.push([H + 0.1, `se/${them}_guard`, 0.9]); }
  }   // 敵方出招：命中音效和我方反應一起，由演出的 audio 事件觸發（見 playAnim）
  return L.filter((c) => c[1]).sort((a, b) => a[0] - b[0]);
}

// 攻擊預覽（玩家攻擊前）
function attackPreview(att, def, w) {
  return new Promise((done) => {
    const hit = calcHit(att, def, w), dmg = calcDmg(att, def, w);
    $('pvAtt').textContent = `${att.name}（${att.pilot}）`; $('pvWeapon').textContent = w.name;
    $('pvHit').textContent = hit + '%'; $('pvDmg').textContent = dmg;
    $('pvDef').textContent = def.name; $('pvDefHp').textContent = `${def.hp} / ${def.maxHp}`;
    const cw = canCounter(def) ? bestWeapon(def, att, dist(att, def)) : null;
    $('pvCounter').textContent = cw ? `反擊：${cw.name}（命中 ${calcHit(def, att, cw)}%・傷害 ${calcDmg(def, att, cw)}）` : '對方無法反擊';
    $('preview').style.display = 'flex';
    $('pvGo').onclick = () => { $('preview').style.display = 'none'; done(true); };
    $('pvCancel').onclick = () => { $('preview').style.display = 'none'; done(false); };
  });
}
// 被攻擊時的應對（反擊／防禦／迴避）
// v14：開發者 10-27「反擊沒有辦法讓我選擇對應的武器」→ 射程內每把可用的武器各一個按鈕，第一個是預估傷害最高的（建議）
const costText = (w) => [w.en ? `EN ${w.en}` : '', w.ammo > 0 ? `彈 ${w.left}/${w.ammo}` : ''].filter(Boolean).join('・');
function askResponse(att, def, w) {
  return new Promise((done) => {
    const d = dist(att, def);
    const cws = canCounter(def) ? def.weapons.filter((x) => weaponUsable(def, x) && d >= x.min && d <= wMax(def, x))
      .sort((a, b) => calcDmg(def, att, b) * calcHit(def, att, b) - calcDmg(def, att, a) * calcHit(def, att, a)) : [];
    $('rsTitle').textContent = `${att.name} 的【${w.name}】攻擊 ${def.name}！`;
    const hitMe = `被命中 ${calcHit(att, def, w)}%・${calcDmg(att, def, w)}`;
    const opts = cws.map((x, i) => [{ resp: 'counter', w: x }, i === 0 ? '反擊（建議）' : '反擊',
      `【${x.name}】${costText(x) ? '（' + costText(x) + '）' : ''}命中 ${calcHit(def, att, x)}%・傷害 ${calcDmg(def, att, x)}｜${hitMe}`]);
    if (!cws.length) opts.push([null, '反擊', '（射程內沒有可用武器，或彈藥／EN 不足）']);
    opts.push([{ resp: 'defend' }, '防禦', `傷害減半｜被命中 ${calcHit(att, def, w)}%・${calcDmg(att, def, w, 'defend')}`]);
    opts.push([{ resp: 'evade' }, '迴避', `命中減半｜被命中 ${calcHit(att, def, w, 'evade')}%・${calcDmg(att, def, w)}`]);
    const box = $('rsButtons'); box.innerHTML = '';
    for (const [k, label, sub] of opts) {
      const b = document.createElement('button'); b.className = 'rs-btn';
      b.disabled = !k;
      b.innerHTML = `<b>${label}</b><small>${sub}</small>`;
      b.onclick = () => { $('response').style.display = 'none'; done(k); };
      box.appendChild(b);
    }
    $('response').style.display = 'flex';
  });
}

// ==================== 戰鬥結算 ====================
async function strike(att, def, w, opt = {}) {
  const freeShot = att.team === 'player' && CHEAT.on('infammo');   // v13：金手指
  if (w.en && !freeShot) att.en -= w.en;
  if (w.left > 0 && !freeShot) w.left -= 1;
  const resp = opt.resp;
  const hitRate = calcHit(att, def, w, resp);
  const hit = Math.random() * 100 < hitRate;
  let dmg = 0, killed = false, saved = false;   // saved：v14 被劇情保住不死（這一下不給經驗）
  if (def.spirit.flash) def.spirit.flash = false;
  if (hit) {
    dmg = calcDmg(att, def, w, resp);
    if (def.hp - dmg <= 0) {
      const hook = G.stage.hooks.interceptDeath;
      if (def.immortal || (hook && hook(G, def, att))) { dmg = Math.max(0, def.hp - 1); saved = true; }
    }
    killed = def.hp - dmg <= 0;
  }
  const res = { hit, dmg, killed };
  // v8：演出 → 我方出招、敵方出招、反擊都播；沒打中就播「迴避」、對方選防禦就播「防禦」。
  //     沒有演出（關掉戰鬥動畫、客串機、砲台等）→ 地圖戰鬥特效＋小型切入框
  let shown = false;
  if (canPlayAnim(att, def, w)) shown = await playAnim(att, def, w, dmg, { react: !hit ? 'EVADE' : (resp === 'defend' && def.team === 'player' ? 'DEFEND' : 'DAMAGE') });
  if (!shown) await mapBattle(att, def, w, res);
  att.spirit.hotblood = false; att.spirit.soul = false; att.spirit.direct = false;
  if (w.oncePerStage) w.usedThisStage = true;
  if (hit) {
    if (def.spirit.unyield) def.spirit.unyield = false;   // v6：不屈用掉
    def.hp = Math.max(0, def.hp - dmg);
    att.morale = Math.min(150, att.morale + 2); def.morale = Math.min(150, def.morale + 1);
    if (w.effect === 'flare' && def.kind === 'unit') { def.flare = 1; log(`🎆 信號彈！${def.name} 下一次攻擊命中率 -30%`, 'player'); }
    applyDebuff(def, w);
    if (w.stun && def.kind === 'unit' && def.hp > 0) { def.stunned = true; log(`💫 ${def.name} 被擊暈，下一個回合不能行動`, 'player'); }
    log(`💥 ${att.name}【${w.name}】命中 ${def.name}，${dmg} 傷害`, att.team === 'player' ? 'damage' : 'enemy');
    // v6：經驗值（我方命中 +10、擊墜 +50、擊墜 BOSS +150）；v9：移到命中紀錄之後，順序比較好讀
    // v14：擊墜依敵機種類計價（幸運 2 倍）；命中不擊墜要傷害 ≥ 對方最大 HP 10% 才給；被劇情保住的那一下不給
    if (att.team === 'player' && def.team !== 'player') {
      if (def.hp <= 0) { gainExp(att, killExp(def) * (att.spirit.lucky ? 2 : 1)); att.spirit.lucky = false; }
      else if (!saved && dmg >= def.maxHp * ECONOMY.hitMinPct) gainExp(att, ECONOMY.hitExp);
    }
    if (G.stage.hooks.onDamage) await G.stage.hooks.onDamage(G, def, att, dmg, w);
    if (def.hp <= 0) {
      att.morale = Math.min(150, att.morale + 5);
      log(`🔥 ${def.name} 被擊墜！`, att.team === 'player' ? 'player' : 'enemy');
      SND.se(sndPrefix(def) ? `se/${sndPrefix(def)}_destroyed` : 'se/E01_destroyed');   // v12
      if (G.stage.hooks.onDefeat) await G.stage.hooks.onDefeat(G, def, att);
    }
  } else {
    log(`💨 ${def.name} 迴避了 ${att.name} 的【${w.name}】`, 'system');
    if (G.stage.hooks.onEvade) await G.stage.hooks.onEvade(G, def, att);
  }
  // v6：雲雀 09 涅槃 → 朱雀完全體到關卡結束（HP／EN／SP 全回、氣力 -50）；07、08 用完回到原本型態
  if (w.nirvana && att.hp > 0) {
    att.morale = Math.max(50, att.morale - 50); setForm(att, 'complete');
    att.hp = att.maxHp; att.en = att.maxEn; att.sp = att.maxSp;
    log(`🔥 ${att.name} 涅槃重生！HP、EN、SP 全部回復`, 'player');
  } else if (w.needForm === 'golden' && att.form === 'golden') setForm(att, att.formBeforeGolden || 'normal');
  if (att.flare > 0 && att.kind === 'unit') att.flare = 0;
  render(); showUnit(G.sel || att);
  return res;
}
async function engage(att, def, w, playerInitiated) {
  G.busy = true; updateHud();
  let resp = 'counter', pick = null;
  if (!playerInitiated && def.team === 'player' && def.kind === 'unit') { const r = await askResponse(att, def, w); resp = r.resp; pick = r.w || null; }
  await strike(att, def, w, { resp, animate: playerInitiated });
  if (def.hp > 0 && att.hp > 0 && resp === 'counter' && canCounter(def) && def.kind === 'unit') {
    // v14：玩家選的武器（打完一擊後還能用才用；例如被打掉氣力）；敵方仍自動挑最強
    const cw = pick && weaponUsable(def, pick) ? pick : bestWeapon(def, att, dist(att, def));
    if (cw) await strike(def, att, cw, { animate: true });   // v8：反擊也播演出
  }
  await flushQueue();
  G.busy = false; updateHud();
}
async function flushQueue() { while (G.queue.length) { const fn = G.queue.shift(); await fn(); } }

// 直接傷害（要塞重砲等地圖效果，不能反擊）
async function directDamage(u, dmg, source) {
  if (u.hp <= 0) return;
  if (u.team === 'player' && CHEAT.on('godmode')) dmg = 0;   // v13：金手指
  u.hp = Math.max(0, u.hp - dmg);
  log(`☄️ ${source} 擊中 ${u.name}，${dmg} 傷害`, 'enemy');
  if (u.hp <= 0) { log(`🔥 ${u.name} 被擊墜！`, 'enemy'); if (G.stage.hooks.onDefeat) await G.stage.hooks.onDefeat(G, u, null); }
}

// ==================== 玩家操作 ====================
cv.addEventListener('mousemove', (e) => {
  const r = cv.getBoundingClientRect();
  const { x, y } = screenToCell((e.clientX - r.left) * (cv.width / r.width), (e.clientY - r.top) * (cv.height / r.height));
  if (!inMap(x, y)) return;
  if (x === G.hover.x && y === G.hover.y) return;
  G.hover = { x, y };
  const t = terrainAt(x, y);
  $('terrainInfo').textContent = `地形：${t.name}｜防禦 ${t.def >= 0 ? '+' : ''}${t.def}%｜迴避 ${t.eva >= 0 ? '+' : ''}${t.eva}%｜移動消耗 ${t.cost >= 99 ? '不可通行' : t.cost}`;
  const u = unitAt(x, y); if (u && !G.sel) showUnit(u);
  render();
});
cv.addEventListener('click', (e) => {
  if (justDragged) { justDragged = false; return; }   // v8：剛拖曳完地圖，不算點擊
  const r = cv.getBoundingClientRect();
  const { x, y } = screenToCell((e.clientX - r.left) * (cv.width / r.width), (e.clientY - r.top) * (cv.height / r.height));
  if (inMap(x, y)) onCellClick(x, y);
});
cv.addEventListener('contextmenu', (e) => { e.preventDefault(); cancelAction(); });

async function onCellClick(x, y) {
  if (G.phase !== 'PLAYER' || G.busy || G.ended) return;
  const clicked = unitAt(x, y);
  if (G.mode === 'attack') {
    const inRange = G.atkRange.some((c) => c.x === x && c.y === y);
    if (inRange && clicked && clicked.team === 'enemy' && !clicked.untargetable) {
      const ok = await attackPreview(G.sel, clicked, G.weapon);
      if (!ok) return;
      const u = G.sel; G.atkRange = []; G.mode = 'idle'; hideMenu();
      await engage(u, clicked, G.weapon, true);
      await finishAction(u);
    } else if (clicked && clicked.untargetable && clicked.team !== 'player') {
      log(`⚠️ ${clicked.name} 無法成為攻擊目標`, 'system');
    } else { G.atkRange = []; G.mode = 'menu'; showMenu(G.sel); render(); }
    return;
  }
  if (G.mode === 'move' && G.sel) {
    const can = G.moveRange.some((c) => c.x === x && c.y === y);
    if (can && (!clicked || clicked === G.sel)) {
      G.origPos = { x: G.sel.x, y: G.sel.y }; G.sel.x = x; G.sel.y = y; G.moveRange = []; G.mode = 'menu';
      if (sndPrefix(G.sel)) SND.se(`se/${sndPrefix(G.sel)}_move`, 0.7);   // v12
      showMenu(G.sel); render(); return;
    }
  }
  if (G.mode === 'menu') return;   // 選單開著時，先選指令或取消
  if (clicked) {
    G.sel = clicked; G.weapon = null; showUnit(clicked);
    if (clicked.team === 'player' && !clicked.acted && clicked.kind === 'unit') { G.moveRange = calcMoveRange(clicked); G.mode = 'move'; }
    else { G.moveRange = []; G.mode = 'idle'; }
  } else { G.sel = null; G.moveRange = []; G.mode = 'idle'; }
  hideMenu(); render();
}
function availableTalks(u) {
  return (G.stage.talks || []).filter((t) => {
    if (t.from !== u.uid) return false;
    const to = unitById(t.to); if (!to || dist(u, to) !== 1) return false;
    if (t.when && !t.when(G)) return false;
    if (t.once && G.onceKeys.has('talk:' + t.from + '>' + t.to)) return false;
    return true;
  });
}
function hasTarget(u) {
  return u.weapons.some((w) => weaponUsable(u, w) && alive((e) => e.team === 'enemy' && !e.untargetable).some((e) => { const d = dist(u, e); return d >= w.min && d <= wMax(u, w); }));
}
function showMenu(u) {
  const m = $('actionMenu'); if (m.style.display !== 'flex') SND.se('ui/UI05_menu_open', 0.6);   // v12
  m.style.display = 'flex';
  $('btnAttack').disabled = !hasTarget(u);
  $('btnSpirit').style.display = u.spirits && u.spirits.length ? 'block' : 'none';   // v8
  const talks = availableTalks(u);
  $('btnTalk').style.display = talks.length ? 'block' : 'none';
  $('btnTalk').textContent = talks.length ? `💬 說服（${unitById(talks[0].to).name}）` : '';
  const r = cv.getBoundingClientRect(), wr = $('mapWrap').getBoundingClientRect();
  const sx = r.width / cv.width;
  const c = isoCenter(u.x, u.y);   // v3：選單放在棋子的斜角位置旁邊
  let left = (c.x + TW / 2 + 6) * sx + (r.left - wr.left), top = (c.y - 90) * sx + (r.top - wr.top);
  if (left + 170 > wr.width) left = (c.x - TW / 2 - 176) * sx + (r.left - wr.left);
  top = Math.max(0, top);
  m.style.left = left + 'px'; m.style.top = Math.min(top, wr.height - 200) + 'px';
}
function hideMenu() { $('actionMenu').style.display = 'none'; }
function cancelAction() {
  if (G.busy || G.phase !== 'PLAYER') return;
  if (G.mode !== 'idle') SND.se('ui/UI03_cancel', 0.7);   // v12
  if (G.mode === 'attack') { G.atkRange = []; G.mode = 'menu'; showMenu(G.sel); render(); return; }
  if (G.mode === 'menu' && G.sel) {
    if (G.origPos) { G.sel.x = G.origPos.x; G.sel.y = G.origPos.y; G.origPos = null; }
    hideMenu(); G.moveRange = calcMoveRange(G.sel); G.mode = 'move'; render(); return;
  }
  G.sel = null; G.moveRange = []; G.mode = 'idle'; hideMenu(); render();
}
$('btnAttack').onclick = () => {
  const u = G.sel; hideMenu();
  G.weapon = u.weapons.find((w) => weaponUsable(u, w) && alive((e) => e.team === 'enemy' && !e.untargetable).some((e) => { const d = dist(u, e); return d >= w.min && d <= wMax(u, w); })) || u.weapons[0];
  G.atkRange = calcAttackRange(u, G.weapon); G.mode = 'attack';
  log('🎯 右側可以切換武器；點紅色範圍內的敵機攻擊（右鍵取消）', 'system');
  showUnit(u); render();
};
$('btnTalk').onclick = async () => {
  const u = G.sel; const t = availableTalks(u)[0]; if (!t) return;
  hideMenu(); G.mode = 'idle';
  G.onceKeys.add('talk:' + t.from + '>' + t.to); SND.se('ui/UI21_persuade');   // v12
  G.busy = true; updateHud();
  await t.run(G, u, unitById(t.to));
  await flushQueue();
  G.busy = false;
  await finishAction(u);
};
// v8：精神指令選單（機戰的操作習慣：移動後在行動選單裡選「精神」）
// 為什麼：v7 以前只能在右側面板按，視窗不夠寬時面板被擠到地圖下面，看起來像不能用。
function openSpiritMenu(u) {
  const list = $('smList'); list.innerHTML = '';
  $('smTitle').textContent = `精神指令：${u.pilot}`;
  $('smSp').textContent = `SP ${u.sp} / ${u.maxSp}　氣力 ${u.morale}`;
  if (!u.spirits.length) list.innerHTML = '<div class="muted">沒有可用的精神指令</div>';
  for (const id of u.spirits) {
    const S = SPIRITS[id], b = document.createElement('button');
    const lack = u.sp < S.cost ? 'SP 不足' : (S.needMorale && u.morale < S.needMorale ? `氣力需 ${S.needMorale}` : '');
    b.className = 'sm-btn' + (u.spirit[id] ? ' active' : '');
    b.disabled = !!lack || !!u.spirit[id];
    b.innerHTML = `<span class="cost">${S.cost}</span><b>${S.name}${u.spirit[id] ? '（生效中）' : ''}</b><small>${lack || S.desc}</small>`;
    b.onclick = () => { useSpirit(u, id); openSpiritMenu(u); if (G.mode === 'menu') showMenu(u); };
    list.appendChild(b);
  }
  $('spiritModal').style.display = 'flex';
}
$('smClose').onclick = () => { $('spiritModal').style.display = 'none'; };
$('btnSpirit').onclick = () => { if (G.sel) openSpiritMenu(G.sel); };
$('btnWait').onclick = async () => { const u = G.sel; hideMenu(); G.mode = 'idle'; await finishAction(u); };
$('btnCancel').onclick = () => cancelAction();
$('btnEndTurn').onclick = () => endPlayerPhase();
$('btnAnim').onclick = () => { G.animOn = !G.animOn; saveSetting('srw_anim', G.animOn); updateHud(); };

async function finishAction(u) {
  if (u) { u.acted = true; u.spirit.accel = false; }
  if (u && u.hp > 0 && u.spirit.awaken) { u.spirit.awaken = false; u.acted = false; log(`⚡ ${u.pilot}【覺醒】：可以再行動一次`, 'player'); }   // v14
  G.sel = null; G.moveRange = []; G.atkRange = []; G.mode = 'idle'; G.origPos = null; hideMenu();
  render(); updateHud();
  if (u && u.hp > 0 && G.stage.hooks.afterAction) { G.busy = true; await G.stage.hooks.afterAction(G, u); await flushQueue(); G.busy = false; }
  if (await checkEnd()) return;
  updateHud(); render();
  if (alive((p) => p.team === 'player' && p.kind === 'unit' && !p.acted).length === 0) { await sleep(300); endPlayerPhase(); }
}

// ==================== 回合流程 ====================
async function playerPhaseStart() {
  G.turn += 1; G.phase = 'PLAYER'; G.busy = true;
  for (const u of G.units) {
    u.acted = false; u.spirit.surehit = false; u.spirit.ironwall = false; u.spirit.accel = false; u.spirit.focus = false; u.spirit.snipe = false;
    if (u.team === 'player' && u.hp > 0) u.en = Math.min(u.maxEn, u.en + 5);
    // v14：停在昭明號（母艦）旁邊 → 補給：彈藥、EN 全滿
    if (u.team === 'player' && u.hp > 0 && u.kind === 'unit' && G.turn > 1 && G.units.some((s) => s.type === 'SHOMEI' && s.hp > 0 && dist(s, u) === 1)
        && (u.en < u.maxEn || u.weapons.some((x) => x.ammo > 0 && x.left < x.ammo))) {
      u.en = u.maxEn; u.weapons.forEach((x) => { if (x.ammo > 0) x.left = x.ammo; });
      log(`🔧 ${u.name} 在昭明號旁完成補給：彈藥、EN 全滿`, 'player');
    }
    // v6：精神點數每回合恢復上限的 10%（第 1 回合開場已滿，不用加）
    if (u.team === 'player' && u.hp > 0 && u.maxSp && G.turn > 1) u.sp = Math.min(u.maxSp, u.sp + Math.round(u.maxSp * LEVELING.spRegen));
    if (u.team === 'player' && u.hp > 0 && CHEAT.on('maxmorale')) u.morale = 150;   // v13：金手指
  }
  updateHud(); render();
  SND.music(`MAP_${G.stage.id}`); SND.se('ui/UI10_player_phase');   // v12：我方回合音樂
  await banner(`第 ${G.turn} 回合`, '我方回合', 900);
  log(`── 第 ${G.turn} 回合・我方 ──`, 'player');
  G.busy = true;
  if (G.stage.hooks.playerPhaseStart) await G.stage.hooks.playerPhaseStart(G);
  await flushQueue();
  G.busy = false;
  if (await checkEnd()) return;
  updateHud(); render();
}
async function endPlayerPhase() {
  if (G.phase !== 'PLAYER' || G.busy || G.ended) return;
  G.sel = null; G.moveRange = []; G.atkRange = []; G.mode = 'idle'; hideMenu();
  tickDebuffs('player');   // v5：我方回合結束，我方身上的 debuff 倒數
  G.phase = 'ENEMY'; G.busy = true; updateHud(); render();
  SND.music(`MAP_${G.stage.id}_ENEMY`); SND.se('ui/UI11_enemy_phase');   // v12：敵方回合版音樂
  await banner('敵方回合', '', 800);
  log(`── 第 ${G.turn} 回合・敵方 ──`, 'enemy');
  // v5：E09【因果歪曲】敵方回合開始時回復 HP
  for (const e of alive((u) => u.causalWarp && u.causalWarp.regen)) {
    const heal = Math.min(e.maxHp - e.hp, Math.floor(e.maxHp * e.causalWarp.regen));
    if (heal > 0) { e.hp += heal; log(`♻ ${e.name}【因果歪曲】回復 ${heal} HP`, 'enemy'); }
  }
  if (G.stage.hooks.enemyPhaseStart) await G.stage.hooks.enemyPhaseStart(G);
  await flushQueue();
  if (await checkEnd()) return;
  for (const e of alive((u) => u.team === 'enemy' && u.kind === 'unit')) {
    if (G.ended) return;
    if (e.hp <= 0) continue;
    if (e.skipTurn) { log(`… ${e.name} 沒有行動`, 'system'); continue; }
    if (e.stunned) { e.stunned = false; log(`💫 ${e.name} 被擊暈，這回合不能行動`, 'system'); continue; }   // v6
    await enemyAct(e);
    if (await checkEnd()) return;
  }
  if (G.stage.hooks.enemyPhaseEnd) await G.stage.hooks.enemyPhaseEnd(G);
  await flushQueue();
  if (await checkEnd()) return;
  tickDebuffs('enemy');   // v5：敵方回合結束，敵方身上的 debuff 倒數
  G.busy = false;
  await playerPhaseStart();
}

// 敵方 AI：在可到達的格子中，找「能造成最大期望傷害」的位置與目標；找不到就往最近的目標前進
async function enemyAct(e) {
  const ai = e.ai || {};
  const targets = alive((u) => !u.untargetable && (u.team === 'player' || (u.team === 'npc' && ai.hitsNpc)) && !(ai.only === 'player' && u.team !== 'player'));
  if (!targets.length) return;
  const reach = ai.hold ? [{ x: e.x, y: e.y }] : calcMoveRange(e);
  // v5：keepAway＝盡量待在我方機體 N 格以外（E09：兩格以內沒有招式可用）
  //   1. 先找「安全格」（離所有我方機體都超過 N 格）裡能攻擊的位置
  //   2. 沒有的話，只移動到安全格：挑最接近射程的格子，下回合才打得到
  //   3. 連安全格都沒有（被包圍）：才允許從不安全的格子攻擊；也打不到就盡量拉開距離
  const foes = alive((u) => u.team === 'player' && u.kind === 'unit');
  const nearest = (c) => (foes.length ? Math.min(...foes.map((p) => Math.abs(c.x - p.x) + Math.abs(c.y - p.y))) : 99);
  const safeCells = ai.keepAway ? reach.filter((c) => nearest(c) > ai.keepAway) : reach;
  const attackFrom = ai.keepAway && safeCells.length ? safeCells : reach;
  let best = null;
  for (const c of attackFrom) for (const t of targets) {
    const d = Math.abs(c.x - t.x) + Math.abs(c.y - t.y);
    const ox = e.x, oy = e.y; e.x = c.x; e.y = c.y;
    const w = bestWeapon(e, t, d);
    let s = w ? calcDmg(e, t, w) * calcHit(e, t, w) / 100 : -1;
    e.x = ox; e.y = oy;
    if (!w) continue;
    if (ai.prefer && t.type === ai.prefer) s *= 1.8;
    if (ai.hitsNpc && t.team === 'npc') s *= 1.5;
    s -= (Math.abs(c.x - e.x) + Math.abs(c.y - e.y)) * 0.5;
    if (!best || s > best.s) best = { c, t, w, s };
  }
  G.sel = null;
  centerOn(e.x, e.y);   // v8：鏡頭跟著行動中的敵機
  if (best) {
    e.x = best.c.x; e.y = best.c.y; centerOn(e.x, e.y); render(); await sleep(350);
    if (G.stage.hooks.afterAction) { await G.stage.hooks.afterAction(G, e); await flushQueue(); }
    if (e.hp <= 0 || best.t.hp <= 0 || G.ended) return;
    showUnit(best.t);
    await engage(e, best.t, best.w, false);
    G.busy = true;
  } else if (!ai.hold) {
    let pick = null, pd = 1e9;
    const goal = ai.prefer ? (targets.find((t) => t.type === ai.prefer) || null) : null;
    if (ai.keepAway) {
      if (safeCells.length) {
        // 安全格裡，挑離我方最近的（剛好在 N+1 格），下回合就能進入射程
        for (const c of safeCells) { const d = nearest(c); if (d < pd) { pd = d; pick = c; } }
      } else {
        // 被包圍：盡量拉開距離
        let far = -1;
        for (const c of reach) { const d = nearest(c); if (d > far) { far = d; pick = c; } }
      }
    } else for (const c of reach) {
      const d = goal ? Math.abs(c.x - goal.x) + Math.abs(c.y - goal.y) : Math.min(...targets.map((t) => Math.abs(c.x - t.x) + Math.abs(c.y - t.y)));
      if (d < pd) { pd = d; pick = c; }
    }
    if (pick) { e.x = pick.x; e.y = pick.y; render(); await sleep(250); }
    if (G.stage.hooks.afterAction) { await G.stage.hooks.afterAction(G, e); await flushQueue(); }
  }
  e.flare = 0;
}

// ==================== 勝敗判定 ====================
async function checkEnd() {
  if (G.ended) return true;
  if (G.stage.defeat(G)) { await onDefeat(); return true; }
  if (G.stage.victory(G)) { await onVictory(); return true; }
  return false;
}
async function onVictory() {
  G.ended = true; G.busy = true; G.telegraph = null; updateHud(); render();
  SND.se('ui/UI14_reward'); SND.music(`EV${G.stage.id}`);   // v12：戰後劇情用劇情音樂
  await banner('作戰成功', `${G.stage.id}「${G.stage.title}」`, 1600);
  await talk(G.stage.post);
  if (G.stage.onClear) G.stage.onClear(G);
  // v14：過關獎勵＝每位出擊（有等級）的駕駛 clearBonus
  const fought = [...new Set(G.units.filter((u) => u.team === 'player' && hasLevel(u.pilotId)).map((u) => u.pilotId))];
  if (fought.length) award(ECONOMY.clearBonus * fought.length, `過關獎勵（${fought.map((pid) => PILOTS[pid].short).join('、')} 出擊）`);
  log(`📈 這一節得到經驗 ${(G.wallet || 0) - (G.walletAtStageStart || 0)}，全隊經驗 ${G.wallet || 0}`, 'player');
  const next = G.stageIndex + 1;
  saveProgress(next);
  showInterlude(next);   // v13：先停在幕間，可以存檔再繼續
}
async function onDefeat() {
  G.ended = true; G.busy = true; G.telegraph = null; updateHud(); render();
  await banner('作戰失敗', G.stage.lose, 1600);
  $('gameOver').style.display = 'flex';
}
$('btnRetry').onclick = () => { $('gameOver').style.display = 'none'; G.flags = JSON.parse(JSON.stringify(G.flagsAtStageStart)); startStage(G.stageIndex, true); };
$('btnToTitle').onclick = () => { $('gameOver').style.display = 'none'; showTitle(); };

// ==================== v7：演出素材預先下載 ====================
// 為什麼：一招演出有 70 多張圖，以前是「按下攻擊才開始下載」，所以每次都要等載入畫面。
// 做法：進關卡時，依 anim/preload_manifest.json 把「本關我方招式＋場上敵機」的圖先抓進瀏覽器快取（只下載不解碼，不佔記憶體），
//       之後播放器讀同一個網址就直接從快取拿。換關卡時舊的下載會停掉。
let preloadManifest = null, preloadToken = 0;
async function preloadStageAnims() {
  const token = ++preloadToken;
  // v8：先等地圖圖塊、棋子載完（最多 15 秒）再開始，否則幾百個背景下載會把地圖圖片擠到後面，畫面一直是色塊
  for (let k = 0; k < 75 && Object.values(IMG).some((v) => v === null); k++) await sleep(200);
  if (token !== preloadToken) return;
  try {
    if (!preloadManifest) preloadManifest = await fetch(ANIM_BASE + 'preload_manifest.json').then((r) => r.json());
  } catch (e) { return; }
  // v12：順序改成「戰鬥背景 → 我方招式 → 我方反應 → 敵機受擊 → 敵方招式 → 其他共用特效」，最先用到的先下載
  const M = preloadManifest, urls = new Set(M.common.filter((x) => x.includes('/backgrounds/')));
  for (const u of G.units) if (u.team === 'player' && u.animUnit) u.weapons.forEach((w) => (M.moves[w.anim] || []).forEach((x) => urls.add(x)));
  for (const u of G.units) {
    if (u.team === 'player' && u.animUnit) u.weapons.forEach((w) => (M.moves[w.anim] || []).forEach((x) => urls.add(x)));
    if (u.team === 'player' && u.animUnit) ((M.units || {})[u.animUnit] || []).forEach((x) => urls.add(x));   // v8：我方受擊／防禦／迴避
    if (u.team !== 'player') (M.targets[u.eid || 'PLACEHOLDER'] || []).forEach((x) => urls.add(x));
    if (u.team === 'enemy') u.weapons.forEach((w) => (M.moves[w.anim] || []).forEach((x) => urls.add(x)));      // v8：敵方出招
  }
  for (const x of M.common) urls.add(x);   // 其他共用特效最後
  const list = [...urls].map((x) => x.replace(/^anim\//, ANIM_BASE));
  let i = 0, bytes = 0, fails = 0;
  const worker = async () => {
    while (i < list.length && token === preloadToken) {
      const url = list[i++];
      try { const r = await fetch(url, { cache: 'force-cache' }); if (!r.ok) throw new Error(r.status); const n = (await r.arrayBuffer()).byteLength; bytes += n; }
      catch (e) { fails++; /* 下載失敗不影響遊戲，播放時會再讀一次 */ }
    }
  };
  const t0 = performance.now();
  await Promise.all([1, 2, 3, 4, 5, 6].map(worker));   // v12：3 → 6 條（GitHub Pages 是 HTTP/2，可以同時多抓）
  if (token === preloadToken && G.debug) log(`🎞️ 演出素材預先下載完成：${list.length} 個檔、${(bytes / 1e6).toFixed(1)} MB、${((performance.now() - t0) / 1000).toFixed(1)} 秒${fails ? `（${fails} 個失敗）` : ''}`, 'system');
  else if (token !== preloadToken && G.debug) log(`🎞️ 預先下載中斷（換關卡）：已下載 ${i}/${list.length}`, 'system');
}

// ==================== 關卡開始 ====================
async function startStage(index, retry = false) {
  const S = STAGES[index];
  G.stageIndex = index; G.stage = S; G.units = []; G.vars = {}; G.onceKeys = new Set();
  G.turn = 0; G.phase = 'PLAYER'; G.sel = null; G.moveRange = []; G.atkRange = []; G.mode = 'idle';
  G.telegraph = null; G.markers = []; G.queue = []; G.ended = false; G.busy = true; G.uidSeq = 0;
  G.flagsAtStageStart = JSON.parse(JSON.stringify(G.flags));
  // v6：重打這一關時，等級和經驗值回到開打前
  if (retry && G.rosterAtStageStart) { G.roster = JSON.parse(JSON.stringify(G.rosterAtStageStart)); G.wallet = G.walletAtStageStart || 0; }
  else { G.rosterAtStageStart = JSON.parse(JSON.stringify(G.roster || {})); G.walletAtStageStart = G.wallet || 0; }
  G.map = S.map.map((row) => [...row].map((ch) => TERRAIN_BY_CH[ch] || TERRAIN_BY_CH['.']));
  G.rows = G.map.length; G.cols = G.map[0].length;
  layoutIso();   // v3：畫布大小改成斜角地圖
  $('combatLog').innerHTML = '';
  $('title').style.display = 'none'; $('chapterEnd').style.display = 'none';
  S.setup(G);
  updateHud(); render();
  preloadStageAnims();   // v7：趁看開場對話時，在背景先下載本關會用到的演出素材
  SND.music(`EV${S.id}`);   // v12：開場劇情音樂
  await banner(`${S.id}`, S.title, 1600);
  if (!retry) await talk(S.pre);
  else await talk([{ sys: '重新挑戰。' }]);
  log(`★ 作戰開始：${S.id}「${S.title}」`, 'system'); SND.se('ui/UI12_mission_start');   // v12
  log(`勝利條件：${S.win}`, 'player'); log(`敗北條件：${S.lose}`, 'enemy');
  if (CHEAT.active().length) log(`🎮 金手指生效中：${CHEAT.active().map((c) => c.name).join('、')}`, 'system');   // v13
  G.busy = false;
  await playerPhaseStart();
  const first = alive((u) => u.team === 'player' && u.kind === 'unit')[0]; if (first) { showUnit(first); centerOn(first.x, first.y, false, true); }
}

// ==================== 標題畫面與章節結尾 ====================
function showTitle() {
  G.stage = null; G.ended = true; SND.music('BGM_TITLE');   // v12
  preloadToken++;   // v13：回標題就停掉關卡素材的背景下載，不然 MV 會排在幾百張圖後面載不出來
  $('title').style.display = 'flex'; $('chapterEnd').style.display = 'none'; $('interlude').style.display = 'none';
  const save = loadProgress();
  $('btnContinue').style.display = save && save.next > 0 && save.next < STAGES.length ? 'block' : 'none';
  if (save && save.next < STAGES.length) $('btnContinue').textContent = `繼續（${STAGES[save.next].id}「${STAGES[save.next].title}」）`;
  $('btnSave').disabled = !save;   // v13：還沒打完任何一節就沒有進度可存
  $('btnLoad').disabled = ![1, 2, 3].some((n) => readSlot(n));
  paintCheatOn();
  const sel = $('stageSelect'); sel.innerHTML = '';
  STAGES.forEach((s, i) => sel.insertAdjacentHTML('beforeend', `<option value="${i}">${s.id}「${s.title}」</option>`));
  $('chkAnim').checked = G.animOn; $('chkDebug').checked = G.debug;
  $('stageRow').style.display = G.debug ? 'flex' : 'none';   // v14：選關只在開發者模式顯示
}
$('btnNew').onclick = () => { G.flags = {}; G.roster = {}; G.wallet = 0; G.practice = false; startStage(0); };
$('btnContinue').onclick = () => { const s = loadProgress(); if (!s) return; G.flags = s.flags || {}; G.roster = s.roster || {}; G.wallet = s.wallet || 0; G.practice = false; startStage(s.next); };
// v9：選關時沿用存檔裡的等級與經驗值（v8 以前會重設成 Lv 1，看起來像經驗值沒有累計）
// v14：選關只給開發者測試（開發者模式才看得到），打完不存檔、不寫回經驗（開發者 10-27：正常遊玩只能一關一關接著打）
$('btnSelect').onclick = () => { const s = loadProgress(); G.flags = {}; G.roster = (s && s.roster) ? JSON.parse(JSON.stringify(s.roster)) : {}; G.wallet = (s && s.wallet) || 0; G.practice = true; startStage(+$('stageSelect').value); };
$('chkAnim').onchange = (e) => { G.animOn = e.target.checked; saveSetting('srw_anim', G.animOn); };
$('chkDebug').onchange = (e) => { G.debug = e.target.checked; saveSetting('srw_debug', G.debug); $('stageRow').style.display = G.debug ? 'flex' : 'none'; };

// ==================== v13：存檔欄位（3 格）＋過關幕間 ====================
// 「最近進度」（SAVE_KEY）照舊每過一節自動更新，給「繼續」用；3 個欄位是玩家自己選要不要存、存哪一格。
const SLOT_KEY = (n) => `srw_dawn_slot_${n}`;
function readSlot(n) { try { return JSON.parse(localStorage.getItem(SLOT_KEY(n)) || 'null'); } catch (e) { return null; } }
function slotLabel(d) {
  const where = d.next < STAGES.length ? `下一節：${STAGES[d.next].id}「${STAGES[d.next].title}」` : '第一大關全部完成';
  const t = new Date(d.time || 0), pad = (x) => String(x).padStart(2, '0');
  const when = d.time ? `${t.getFullYear()}/${pad(t.getMonth() + 1)}/${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}` : '';
  const lv = Object.entries(d.roster || {}).filter(([pid]) => hasLevel(pid)).map(([pid, r]) => `${PILOTS[pid].short || PILOTS[pid].name} Lv${r.lv}`).join('、');
  return { where, sub: [when, lv, `經驗 ${d.wallet || 0}`].filter(Boolean).join('・') };
}
let slotDone = null;   // 欄位畫面關掉後要做的事（從幕間打開的要回到幕間）
function openSlots(mode, after) {
  slotDone = after || null;
  const cur = loadProgress();
  $('slotTitle').textContent = mode === 'save' ? '存檔' : '讀取';
  $('slotHint').textContent = mode === 'save' ? (cur ? `要把目前進度（${slotLabel(cur).where}）存到哪一格？` : '目前沒有進度可以存') : '要從哪一格接著玩？';
  const box = $('slotList'); box.innerHTML = '';
  for (const n of [1, 2, 3]) {
    const d = readSlot(n), b = document.createElement('button');
    b.className = 'slot';
    if (d) { const L = slotLabel(d); b.innerHTML = `<b>欄位 ${n}</b>${L.where}<small>${L.sub}</small>`; }
    else b.innerHTML = `<b>欄位 ${n}</b>（空）`;
    b.disabled = mode === 'load' ? !d : !cur;
    b.onclick = () => {
      if (mode === 'save') {
        if (d && !confirm(`欄位 ${n} 已經有存檔，要覆蓋嗎？`)) return;
        try { localStorage.setItem(SLOT_KEY(n), JSON.stringify(Object.assign({}, cur, { time: Date.now() }))); } catch (e) { alert('存檔失敗（瀏覽器不允許儲存，例如無痕視窗）'); return; }
        SND.se('ui/UI02_confirm'); openSlots('save', slotDone); $('slotHint').textContent = `已存到欄位 ${n}。`;
      } else {
        $('slotModal').style.display = 'none';
        G.flags = d.flags || {}; G.roster = d.roster || {}; G.wallet = d.wallet || 0; G.practice = false;
        try { localStorage.setItem(SAVE_KEY, JSON.stringify({ next: d.next, flags: G.flags, roster: G.roster, wallet: G.wallet })); } catch (e) { /* 忽略 */ }
        if (d.next < STAGES.length) startStage(d.next);
        else { $('title').style.display = 'none'; showChapterEnd(); }
      }
    };
    box.appendChild(b);
  }
  $('slotModal').style.display = 'flex';
}
$('slotClose').onclick = () => { $('slotModal').style.display = 'none'; SND.se('ui/UI03_cancel'); if (slotDone) slotDone(); else showTitle(); };
$('btnLoad').onclick = () => openSlots('load');
$('btnSave').onclick = () => openSlots('save');

let interNext = 0;
function showInterlude(next) {
  interNext = next;
  $('ilText').textContent = next < STAGES.length ? `接下來：${STAGES[next].id}「${STAGES[next].title}」。要先存檔嗎？` : '第一大關全部完成！要先存檔嗎？';
  $('ilNext').textContent = next < STAGES.length ? '繼續下一節' : '看結尾';
  $('ilSave').style.display = G.practice ? 'none' : '';
  $('ilShop').style.display = next >= ECONOMY.shopOpenAt ? '' : 'none';   // v14：1-3 打完才開（遙 1-4 登場）
  if (G.practice) $('ilText').textContent += '（開發者選關：不存檔）';
  $('interlude').style.display = 'flex';
}
$('ilNext').onclick = () => { $('interlude').style.display = 'none'; if (interNext < STAGES.length) startStage(interNext); else showChapterEnd(); };
$('ilSave').onclick = () => { $('interlude').style.display = 'none'; openSlots('save', () => { $('interlude').style.display = 'flex'; }); };
$('ilTitle').onclick = () => showTitle();

// ==================== v13：金手指密碼（指令清單在 js/cheats.js） ====================
function paintCheatOn() {
  const a = CHEAT.active();
  $('cheatOn').textContent = a.length ? `🎮 金手指：${a.map((c) => c.name).join('、')}` : '';
  $('cheatList').innerHTML = a.length ? '目前開啟：<br>' + a.map((c) => `・${c.name}（${c.desc}）`).join('<br>') : '';
}
function openCheat() {
  $('cheatInput').value = ''; $('cheatMsg').textContent = '同一個密碼再打一次就關閉；輸入 OFF 全部關閉。'; $('cheatMsg').className = 'cheat-msg';
  paintCheatOn(); $('cheatModal').style.display = 'flex'; $('cheatInput').focus(); setTimeout(() => $('cheatInput').focus(), 50);
}
function submitCheat() {
  const r = CHEAT.enter($('cheatInput').value);
  $('cheatMsg').textContent = r.msg; $('cheatMsg').className = 'cheat-msg ' + (r.ok ? 'ok' : 'ng');
  SND.se(r.ok ? 'ui/UI02_confirm' : 'ui/UI04_buzzer');
  if (r.ok) $('cheatInput').value = '';
  paintCheatOn();
}
$('btnCheat').onclick = openCheat;
$('cheatOk').onclick = submitCheat;
$('cheatInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submitCheat(); } });
$('cheatClose').onclick = () => { $('cheatModal').style.display = 'none'; };

// ==================== v13：開場 MV ====================
// 開發者 10-27：只有第一次播；之後標題選單「觀看 MV」可重看。
// 瀏覽器規定「有聲音的影片要使用者先點一下才能播」→ 第一次先顯示「點一下畫面開始」。
const MV_SEEN = 'srw_mv_seen';
function playMV(needTap) {
  return new Promise((resolve) => {
    const L = $('mvLayer'), v = $('mvVideo'), st = $('mvStart');
    let done = false;
    const onKey = (e) => {
      if (!['Escape', 'Enter', ' '].includes(e.key)) return;
      e.preventDefault(); e.stopImmediatePropagation();
      if (st.style.display !== 'none') start(); else finish();
    };
    const finish = () => {
      if (done) return; done = true;
      v.pause(); v.removeAttribute('src'); v.load(); $('mvLoading').style.display = 'none';
      L.style.display = 'none'; window.removeEventListener('keydown', onKey, true); resolve();
    };
    const start = () => {
      st.style.display = 'none'; SND.stopMusic();
      try { localStorage.setItem(MV_SEEN, '1'); } catch (e) { /* 忽略 */ }
      $('mvLoading').style.display = 'block';
      v.src = 'assets/mv/opening_mv.mp4'; v.muted = SND.muted; v.play().catch(() => {});
    };
    v.onended = finish;
    // v15：影片還在下載時顯示「MV 載入中」，開始播放就收起來
    v.onwaiting = () => { $('mvLoading').style.display = 'block'; };
    v.onplaying = () => { $('mvLoading').style.display = 'none'; };
    $('mvSkip').onclick = (e) => { e.stopPropagation(); finish(); };
    st.onclick = start;
    L.style.display = 'flex'; SND.stopMusic();
    window.addEventListener('keydown', onKey, true);
    if (needTap) st.style.display = 'flex'; else start();
  });
}
$('btnWatchMV').onclick = () => { $('title').style.display = 'none'; playMV(false).then(showTitle); };

function showChapterEnd() {
  $('chapterEnd').style.display = 'flex';
  $('ceFlags').textContent = G.debug ? '旗標：' + JSON.stringify(G.flags) : '';
}
$('btnCeTitle').onclick = () => showTitle();

// ==================== 給 stages.js 使用的工具 ====================
Object.assign(G, {
  talk, banner, log, award, spawn, unit: unitById, alive, render, sleep, directDamage, playAnim,
  once(key) { if (G.onceKeys.has(key)) return false; G.onceKeys.add(key); return true; },
  later(fn) { G.queue.push(fn); },
  remove(uid) { const u = G.units.find((x) => x.uid === uid); if (u) u.hp = 0; render(); },
  protagonistsDown() { const p = G.units.filter((u) => u.protagonist); return p.length > 0 && p.every((u) => u.hp <= 0); },
  enemiesLeft(fn = () => true) { return alive((u) => u.team === 'enemy' && fn(u)).length; },
  adjacent(a, b) { return a && b && a.hp > 0 && b.hp > 0 && dist(a, b) === 1; },
  near(a, b, n) { return a && b && a.hp > 0 && b.hp > 0 && dist(a, b) <= n; },
  freeCell(x, y) {   // 找最近的空格（增援登場用）
    for (let r = 0; r < 6; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const nx = x + dx, ny = y + dy;
      if (inMap(nx, ny) && !unitAt(nx, ny) && terrainAt(nx, ny).cost < 99) return { x: nx, y: ny };
    }
    return { x, y };
  },
});

// ==================== 啟動 ====================
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if ($('spiritModal').style.display !== 'none') { $('spiritModal').style.display = 'none'; return; }   // v8：先關精神選單
  cancelAction();
});
window.onload = () => {
  G.animOn = loadSetting('srw_anim', true); G.debug = loadSetting('srw_debug', false);
  let seen = false; try { seen = localStorage.getItem(MV_SEEN) === '1'; } catch (e) { /* 忽略 */ }
  if (seen) showTitle(); else playMV(true).then(showTitle);   // v13：第一次進來先播開場 MV
};

// v12：素材快取（sw.js）。只有在網站上（http/https）才能用；直接開檔案時略過
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
