/**
 * 關卡資料驗收腳本（v8 大地圖）
 * 用法：node tools/檢查關卡.js
 *
 * 檢查項目：
 *  1. js/data.js＋js/stages.js 能一起載入（模擬瀏覽器全域腳本）
 *  2. 每關地圖每列長度相同、只用合法字元、尺寸符合要求
 *  3. setup 與 hooks（模擬第 1～8 回合呼叫 playerPhaseStart / enemyPhaseStart）裡所有 spawn 座標
 *     都在地圖內、地面機不在不能通行的地形上、沒有兩台疊在同一格
 *  4. 我方出生點到最近敵機的「實際移動消耗距離」（依地形消耗的最短路徑）在 3 回合移動力以內
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

// 各關尺寸要求：[最小, 最大]
const SIZE_RULE = { '1-1': [25, 25], '1-2': [25, 25], '1-3': [25, 25], '1-4': [28, 30], '1-5': [28, 30] };

let fail = 0;
const ng = (msg) => { fail++; console.log('  ✗ ' + msg); };
const ok = (msg) => console.log('  ✓ ' + msg);

// ───── 1. 載入 ─────
const ctx = { window: {}, console, document: { addEventListener() {} }, localStorage: { getItem: () => null, setItem() {} } };
vm.createContext(ctx);
let api;
try {
  vm.runInContext(read('js/data.js') + '\n' + read('js/stages.js') +
    '\n;globalThis.__api = { STAGES, UNIT_TYPES, TERRAIN_BY_CH };', ctx, { filename: 'data+stages' });
  api = ctx.__api;
  console.log('✓ js/data.js＋js/stages.js 載入成功，共 ' + api.STAGES.length + ' 關');
} catch (e) {
  console.log('✗ 載入失敗：' + e.message); process.exit(1);
}
const { STAGES, UNIT_TYPES, TERRAIN_BY_CH } = api;

// ───── 模擬引擎物件 G ─────
function makeG(stage) {
  const map = stage.map.map((row) => [...row].map((ch) => TERRAIN_BY_CH[ch]));
  const rows = map.length, cols = map[0].length;
  const inMap = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows;
  const units = []; const spawnLog = []; let seq = 0;
  const unitAt = (x, y) => units.find((u) => u.hp > 0 && u.x === x && u.y === y);
  const onceSet = new Set();
  const noop = async () => {};
  const base = {
    turn: 0, rows, cols, vars: {}, flags: {}, markers: [], telegraph: null, animOn: false, units,
    spawn(type, o) {
      const T = UNIT_TYPES[type];
      const u = Object.assign({ uid: o.uid || ('u' + (++seq)), type, team: 'enemy', kind: 'unit', hp: T ? T.hp : 1, maxHp: T ? T.hp : 1, weapons: T ? T.weapons.slice() : [], ai: {} }, o);
      u.fly = o.fly !== undefined ? !!o.fly : !!(T && T.fly);
      if (['SHOMEI', 'EVAC'].includes(type)) u.kind = 'ship';
      units.push(u); spawnLog.push({ turn: base.turn, unit: u, existsType: !!T });
      return u;
    },
    unit: (uid) => units.find((u) => u.uid === uid && u.hp > 0),
    alive: (fn = () => true) => units.filter((u) => u.hp > 0 && fn(u)),
    remove(uid) { const u = units.find((k) => k.uid === uid); if (u) u.hp = 0; },
    freeCell(x, y) {   // 與 engine.js 相同邏輯
      for (let r = 0; r < 6; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const nx = x + dx, ny = y + dy;
        if (inMap(nx, ny) && !unitAt(nx, ny) && map[ny][nx].cost < 99) return { x: nx, y: ny };
      }
      return { x, y };
    },
    once(k) { if (onceSet.has(k)) return false; onceSet.add(k); return true; },
    later(fn) { /* 劇情對話延後執行：驗收時略過 */ },
    near: (a, b, n) => a && b && Math.abs(a.x - b.x) + Math.abs(a.y - b.y) <= n,
    adjacent: (a, b) => a && b && Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1,
    enemiesLeft: () => units.filter((u) => u.hp > 0 && u.team === 'enemy').length,
    protagonistsDown: () => false,
    directDamage: noop, talk: noop, banner: noop, render() {}, log() {}, playAnim: noop,
  };
  const G = new Proxy(base, { get: (t, k) => (k in t ? t[k] : noop) });
  return { G, map, rows, cols, inMap, spawnLog, units };
}

// 依地形消耗的最短距離（Dijkstra，忽略單位阻擋）
function costDist(map, sx, sy) {
  const rows = map.length, cols = map[0].length;
  const d = Array.from({ length: rows }, () => Array(cols).fill(Infinity));
  d[sy][sx] = 0; const q = [[0, sx, sy]];
  while (q.length) {
    q.sort((a, b) => a[0] - b[0]); const [c, x, y] = q.shift();
    if (c > d[y][x]) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const t = map[ny][nx]; if (t.cost >= 99) continue;
      const nc = c + t.cost; if (nc < d[ny][nx]) { d[ny][nx] = nc; q.push([nc, nx, ny]); }
    }
  }
  return d;
}

(async () => {
  for (const S of STAGES) {
    console.log(`\n【${S.id} ${S.title}】`);
    // ───── 2. 地圖 ─────
    const w = S.map[0].length, h = S.map.length;
    const badLen = S.map.findIndex((r) => r.length !== w);
    if (badLen >= 0) ng(`第 ${badLen} 列長度 ${S.map[badLen].length}，與第 0 列 ${w} 不同`); else ok(`每列長度一致：${w} 欄 × ${h} 列`);
    const badCh = new Set(); S.map.forEach((r) => [...r].forEach((c) => { if (!TERRAIN_BY_CH[c]) badCh.add(c); }));
    if (badCh.size) ng('非法字元：' + [...badCh].join(' ')); else ok('地圖字元全部合法');
    const [mn, mx] = SIZE_RULE[S.id] || [1, 999];
    if (w < mn || w > mx || h < mn || h > mx) ng(`尺寸 ${w}×${h} 不符合要求 ${mn}～${mx}`); else ok(`尺寸符合要求（${mn}～${mx}）`);
    const cnt = {}; S.map.join('').split('').forEach((c) => { cnt[c] = (cnt[c] || 0) + 1; });
    const total = w * h;
    console.log('    地形比例：' + Object.entries(cnt).map(([c, n]) => `${TERRAIN_BY_CH[c] ? TERRAIN_BY_CH[c].name : c} ${(n * 100 / total).toFixed(0)}%`).join('、'));
    if ((cnt['#'] || 0) / total > 0.25) ng('不能通行的格子超過 25%');

    // ───── 3. spawn（setup＋模擬回合）─────
    const sim = makeG(S);
    const { G, map, inMap, spawnLog, units } = sim;
    try { S.setup(G); } catch (e) { ng('setup 執行錯誤：' + e.message); continue; }
    const opening = units.filter((u) => u.team === 'enemy' && u.type !== 'TURRET' && !u.boss).length;
    const players = units.filter((u) => u.team === 'player');
    for (let t = 1; t <= 8; t++) {
      G.turn = t;
      // 模擬我方回合結束後敵機往我方推進：不移動（只檢查座標合法）
      try {
        if (S.hooks && S.hooks.playerPhaseStart) await S.hooks.playerPhaseStart(G);
        if (S.hooks && S.hooks.enemyPhaseStart) await S.hooks.enemyPhaseStart(G);
      } catch (e) { ng(`第 ${t} 回合 hooks 執行錯誤：${e.message}`); }
      if (G.telegraph) {
        const out = G.telegraph.cells.filter((c) => !inMap(c.x, c.y));
        if (out.length) ng(`第 ${t} 回合重砲發射線有 ${out.length} 格在地圖外`);
      }
    }
    if (S.hooks && S.hooks.afterAction) {   // afterAction 也跑一次，確認不會報錯
      try { for (const u of units.slice()) await S.hooks.afterAction(G, u); } catch (e) { ng('afterAction 執行錯誤：' + e.message); }
    }
    for (const m of G.markers) if (!inMap(m.x, m.y)) ng(`地圖標記 ${m.id} (${m.x},${m.y}) 在地圖外`);

    let posErr = 0;
    const seen = new Map();
    for (const { turn, unit: u, existsType } of spawnLog) {
      const tag = `${u.type}${u.uid && !/^u\d+$/.test(u.uid) ? '(' + u.uid + ')' : ''} @(${u.x},${u.y}) 第${turn}回合`;
      if (!existsType) { ng('未知機體類型 ' + tag); posErr++; continue; }
      if (!inMap(u.x, u.y)) { ng('座標在地圖外 ' + tag); posErr++; continue; }
      const t = map[u.y][u.x];
      if (t.cost >= 99 && !u.fly) { ng(`地面機站在不能通行的「${t.name}」上 ` + tag); posErr++; }
      const k = u.x + ',' + u.y;
      // 同一格同時有兩台活著的單位（以出現回合判斷，setup 內的才嚴格檢查）
      if (turn === 0) { if (seen.has(k)) { ng(`與 ${seen.get(k)} 疊在同一格 ` + tag); posErr++; } else seen.set(k, tag); }
    }
    if (!posErr) ok(`全部 ${spawnLog.length} 次 spawn 座標合法（含 hooks 增援）`);
    const byTurn = {};
    spawnLog.filter((s) => s.turn > 0 && s.unit.team === 'enemy').forEach((s) => { byTurn[s.turn] = (byTurn[s.turn] || 0) + 1; });
    console.log(`    開場敵機 ${opening} 台（不含砲台、BOSS）；增援：` + (Object.keys(byTurn).length ? Object.entries(byTurn).map(([t, n]) => `第${t}回合 ${n} 台`).join('、') : '無'));

    // ───── 4. 接敵距離 ─────
    const enemies0 = spawnLog.filter((s) => s.turn === 0 && s.unit.team === 'enemy' && s.unit.type !== 'TURRET').map((s) => s.unit);
    for (const p of players) {
      const T = UNIT_TYPES[p.type]; const mv = T.move;
      const d = costDist(map, p.x, p.y);
      let best = Infinity, who = null;
      for (const e of enemies0) if (d[e.y][e.x] < best) { best = d[e.y][e.x]; who = e; }
      const turns = best / mv;
      const msg = `${p.uid}（移動 ${mv}）→ 最近敵機 ${who.type}@(${who.x},${who.y}) 移動消耗 ${best}，約 ${turns.toFixed(1)} 回合（敵機也會前進）`;
      if (best > mv * 3) ng(msg + '：超過 3 回合'); else ok(msg);
    }
  }
  console.log('\n' + (fail ? `✗ 共 ${fail} 項未通過` : '✓ 全部檢查通過'));
  process.exit(fail ? 1 : 0);
})();
