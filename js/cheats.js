/**
 * v13：金手指密碼（開發者 2026-10-27：「我打算寫一個指令集，讓遊玩體驗更輕鬆」）
 *
 * 怎麼新增指令：在下面 CHEAT_LIST 加一行即可
 *   id    ：程式內部代號（engine.js 用 CHEAT.on('id') 判斷有沒有開）
 *   codes ：玩家可以打的密碼（英文不分大小寫；可以放好幾個，中文也可以）
 *   name  ：顯示名稱　desc：說明
 * 再到 engine.js 想生效的地方寫 if (CHEAT.on('id')) { ... }。
 * 已有的生效位置（engine.js 搜尋「CHEAT.on」就找得到）：
 *   godmode  我方受到的傷害變 0          → calcDmg、directDamage
 *   surehit  我方攻擊命中 100%           → calcHit
 *   oneshot  我方命中就擊墜（劇情不死的敵人仍照劇情）→ calcDmg
 *   infsp    精神指令不扣 SP             → useSpirit
 *   infammo  EN、彈藥不減少              → strike
 *   maxmorale 每回合開始我方氣力 150      → playerPhaseStart
 *   moveup   我方移動力 +3               → effMove
 *   exp5     經驗值 5 倍                 → gainExp
 * 打同一個密碼一次＝開、再打一次＝關；打 OFF 全部關掉。會記在瀏覽器裡。
 */
const CHEAT_LIST = [
  { id: 'godmode',   codes: ['GODMODE', '無敵'],       name: '我方無敵',     desc: '我方機體受到的傷害一律變 0' },
  { id: 'surehit',   codes: ['SUREHIT', '必中'],       name: '我方必中',     desc: '我方攻擊命中率 100%' },
  { id: 'oneshot',   codes: ['ONESHOT', '一擊必殺'],   name: '一擊必殺',     desc: '我方命中就擊墜敵機（劇情上不會倒的敵人仍照劇情）' },
  { id: 'infsp',     codes: ['INFSP', '精神無限'],     name: '精神無限',     desc: '使用精神指令不扣 SP' },
  { id: 'infammo',   codes: ['INFAMMO', '彈藥無限'],   name: '彈藥 EN 無限', desc: '攻擊不消耗 EN 與彈藥' },
  { id: 'maxmorale', codes: ['MAXMORALE', '氣力全滿'], name: '氣力全滿',     desc: '每回合開始我方氣力變 150' },
  { id: 'moveup',    codes: ['MOVEUP', '移動加三'],    name: '移動力 +3',    desc: '我方機體移動力 +3' },
  { id: 'exp5',      codes: ['EXP5', '經驗五倍'],      name: '經驗值 5 倍',  desc: '我方拿到的經驗值變 5 倍' },
];

const CHEAT = (() => {
  const KEY = 'srw_cheats';
  let on = new Set();
  try { on = new Set(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch (e) { /* 無痕視窗：不記住 */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify([...on])); } catch (e) { /* 忽略 */ } };
  const norm = (s) => String(s || '').trim().toUpperCase().replace(/\s+/g, '');
  // 輸入密碼：回傳 { ok, msg }
  function enter(text) {
    const c = norm(text);
    if (!c) return { ok: false, msg: '請輸入密碼' };
    if (c === 'OFF' || c === '全部關閉') { on.clear(); save(); return { ok: true, msg: '金手指已全部關閉' }; }
    const hit = CHEAT_LIST.find((x) => x.codes.some((k) => norm(k) === c));
    if (!hit) return { ok: false, msg: '密碼錯誤' };
    if (on.has(hit.id)) { on.delete(hit.id); save(); return { ok: true, msg: `【${hit.name}】關閉` }; }
    on.add(hit.id); save(); return { ok: true, msg: `【${hit.name}】開啟：${hit.desc}` };
  }
  return {
    on: (id) => on.has(id),
    enter,
    active: () => CHEAT_LIST.filter((x) => on.has(x.id)),
  };
})();
