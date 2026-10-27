/**
 * v14：精神指令交易（昭明號通信士 遙 的窗口）
 * 開發者 2026-10-27：用經驗值升級、提升精神、購買精神指令；全隊共用一個經驗錢包；每人最多帶 6 個精神；買了不能退。
 * 價錢、清單都在 data.js 的 ECONOMY。只在幕間（1-3 打完之後）打開。
 * 每次花完都立刻寫回「最近進度」，所以重新整理、讀檔都退不回來。
 */
let shopPilot = null;
const SHOP_SAY = {
  open: '這裡是昭明號的補給窗口。戰鬥資料換成訓練課程，要給誰用？',
  buy: '登錄完成。……用過就收不回來囉。',
  poor: '經驗不夠呢。先去前線多累積一點吧。',
  full: '這位駕駛的精神指令已經滿 6 個了。',
};
function shopPilots() {
  return Object.keys(G.roster || {}).filter((pid) => hasLevel(pid) && !ECONOMY.shopHide.includes(pid));
}
function openShop() {
  const list = shopPilots();
  if (!shopPilot || !list.includes(shopPilot)) shopPilot = list[0] || null;
  $('shopSay').textContent = SHOP_SAY.open;
  paintShop();
  $('shopModal').style.display = 'flex';
}
function shopSpend(cost, what) {
  if ((G.wallet || 0) < cost) { $('shopSay').textContent = SHOP_SAY.poor; SND.se('ui/UI04_buzzer'); return false; }
  if (!confirm(`花 ${cost} 經驗${what}？\n買了不能退回。`)) return false;
  G.wallet -= cost;
  return true;
}
function shopCommit() {   // 花完立刻存（練習模式不存）
  saveProgress(interNext);
  SND.se('ui/UI13_level_up'); $('shopSay').textContent = SHOP_SAY.buy;
  paintShop();
}
function paintShop() {
  $('shopWallet').textContent = G.wallet || 0;
  const tabs = $('shopTabs'); tabs.innerHTML = '';
  for (const pid of shopPilots()) {
    const b = document.createElement('button');
    b.className = 'shop-tab' + (pid === shopPilot ? ' on' : '');
    b.textContent = `${PILOTS[pid].short} Lv${rosterOf(pid).lv}`;
    b.onclick = () => { shopPilot = pid; paintShop(); };
    tabs.appendChild(b);
  }
  const body = $('shopBody'); body.innerHTML = '';
  if (!shopPilot) { body.textContent = '目前沒有可以訓練的駕駛員。'; return; }
  const pid = shopPilot, r = rosterOf(pid), P = PILOTS[pid], L = LEVELING, w = G.wallet || 0;
  const maxSp = P.sp + (r.lv - 1) * L.spPerLevel + r.spUp * ECONOMY.spUpAmount;
  const lvCost = ECONOMY.levelCost(r.lv), spCost = ECONOMY.spUpCost(r.spUp);
  const full = r.learned.length >= ECONOMY.slots;

  const row = (title, sub, cost, can, onBuy) => {
    const d = document.createElement('div'); d.className = 'shop-row';
    d.innerHTML = `<div><b>${title}</b><small>${sub}</small></div>`;
    const b = document.createElement('button'); b.className = 'btn small'; b.textContent = `${cost} 經驗`;
    b.disabled = !can || w < cost; b.onclick = onBuy;
    d.appendChild(b); return d;
  };
  const sec = (t) => { const h = document.createElement('h3'); h.textContent = t; body.appendChild(h); };

  sec('駕駛員');
  body.appendChild(row(`升級：Lv ${r.lv} → ${r.lv + 1}`, `機體 HP 上限 +${L.hpPerLevel}、SP 上限 +${L.spPerLevel}`, lvCost, r.lv < L.maxLevel, () => {
    if (!shopSpend(lvCost, `讓${P.short}升到 Lv ${r.lv + 1}`)) return;
    r.lv += 1; shopCommit();
  }));
  body.appendChild(row(`提升精神：SP 上限 ${maxSp} → ${maxSp + ECONOMY.spUpAmount}`, `已提升 ${r.spUp} 次（每次越來越貴）`, spCost, true, () => {
    if (!shopSpend(spCost, `提升${P.short}的 SP 上限`)) return;
    r.spUp += 1; shopCommit();
  }));

  sec(`已學會的精神指令（${r.learned.length} / ${ECONOMY.slots}）`);
  const own = document.createElement('div'); own.className = 'shop-own';
  own.innerHTML = r.learned.map((id) => `<span title="${SPIRITS[id].desc}">${SPIRITS[id].name}<small>SP ${SPIRITS[id].cost}</small></span>`).join('');
  body.appendChild(own);

  sec(full ? '精神指令（已滿 6 個，不能再買）' : '可以購買的精神指令');
  for (const [id, price] of ECONOMY.shop) {
    if (r.learned.includes(id)) continue;
    const S = SPIRITS[id];
    body.appendChild(row(`${S.name}（使用 SP ${S.cost}）`, S.desc, price, !full, () => {
      if (r.learned.length >= ECONOMY.slots) { $('shopSay').textContent = SHOP_SAY.full; return; }
      if (!shopSpend(price, `讓${P.short}學會【${S.name}】`)) return;
      r.learned.push(id); shopCommit();
    }));
  }
}
$('ilShop').onclick = () => { $('interlude').style.display = 'none'; openShop(); };
$('shopClose').onclick = () => { $('shopModal').style.display = 'none'; $('interlude').style.display = 'flex'; };
