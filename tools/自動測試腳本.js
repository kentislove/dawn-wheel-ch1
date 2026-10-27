/**
 * 自動測試腳本（開發用，遊戲本身不會載入）
 * 用法：在瀏覽器主控台執行
 *   await import('./tools/自動測試腳本.js?' + Date.now())
 * 之後可以呼叫：
 *   await runStage(最多回合數, 每回合開始前要做的事)
 * 功能：自動按掉對話、自動選「反擊」、自動關閉簡易戰鬥框，並用簡單的 AI 幫我方出手。
 */
window.__errs = [];
window.addEventListener('error', (e) => __errs.push(String(e.message)));
window.addEventListener('unhandledrejection', (e) => __errs.push('rej:' + String((e.reason && e.reason.stack) || e.reason)));
clearInterval(window.__auto);
window.__auto = setInterval(() => {
  const d = document.getElementById('dialogue'); if (d.style.display !== 'none') d.click();
  const r = document.getElementById('response'); if (r.style.display !== 'none') { const b = [...r.querySelectorAll('button')].find((x) => !x.disabled); if (b) b.click(); }
  const q = document.getElementById('quickBattle'); if (q.style.display !== 'none') q.click();
}, 30);

window.waitIdle = async (ms = 60000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (G.ended || (G.phase === 'PLAYER' && !G.busy)) return true; await sleep(100); }
  return false;
};

// 我方簡易 AI：找能造成最大期望傷害的位置與目標；skip 裡的機體只待命
window.autoTurn = async (skip = []) => {
  for (const u of alive((p) => p.team === 'player' && p.kind === 'unit' && !p.acted)) {
    await waitIdle();
    if (G.ended || G.phase !== 'PLAYER' || u.hp <= 0 || u.acted) continue;
    if (skip.includes(u.uid)) { await finishAction(u); continue; }
    const reach = calcMoveRange(u); let best = null;
    const tg = alive((e) => e.team === 'enemy' && !e.untargetable);
    for (const c of reach) for (const t of tg) {
      const ox = u.x, oy = u.y; u.x = c.x; u.y = c.y;
      const d = Math.abs(c.x - t.x) + Math.abs(c.y - t.y); const w = bestWeapon(u, t, d);
      const s = w ? calcDmg(u, t, w) * calcHit(u, t, w) / 100 : -1; u.x = ox; u.y = oy;
      if (w && (!best || s > best.s)) best = { c, t, w, s };
    }
    if (best) { u.x = best.c.x; u.y = best.c.y; await engage(u, best.t, best.w, true); await finishAction(u); }
    else {
      let pick = null, pd = 1e9;
      for (const c of reach) { const d = Math.min(...tg.map((t) => Math.abs(c.x - t.x) + Math.abs(c.y - t.y))); if (d < pd) { pd = d; pick = c; } }
      if (pick) { u.x = pick.x; u.y = pick.y; }
      await finishAction(u);
    }
  }
};

window.runStage = async (maxTurns = 20, perTurn = null) => {
  const id = G.stage.id;
  for (let i = 0; i < maxTurns; i++) {
    await waitIdle(); if (G.ended || G.stage.id !== id) break;
    if (perTurn) await perTurn();
    await waitIdle(); if (G.ended || G.stage.id !== id) break;
    await autoTurn(); await sleep(200); await waitIdle();
    if (G.ended || G.stage.id !== id) break;
    if (G.phase === 'PLAYER' && !G.busy && alive((p) => p.team === 'player' && p.kind === 'unit' && !p.acted).length) await endPlayerPhase();
  }
  await sleep(2200);
  return {
    stage: id, nowStage: G.stage && G.stage.id, turn: G.turn, ended: G.ended,
    gameOver: document.getElementById('gameOver').style.display,
    flags: G.flags, vars: G.vars, errs: __errs,
    lastLogs: [...document.querySelectorAll('#combatLog .log-entry')].map((e) => e.textContent).slice(-6),
  };
};

// 把某台我方機體瞬間移到目標旁邊，執行「說服」
window.doTalk = async (fromUid, toUid) => {
  await waitIdle();
  const u = G.unit(fromUid), t = G.unit(toUid); if (!u || !t || u.acted) return 'no';
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const x = t.x + dx, y = t.y + dy;
    if (x >= 0 && y >= 0 && x < G.cols && y < G.rows && !G.alive((k) => k.x === x && k.y === y).length) { u.x = x; u.y = y; break; }
  }
  G.sel = u; G.mode = 'menu';
  if (!availableTalks(u).length) return 'no talk';
  await document.getElementById('btnTalk').onclick();
  return 'ok';
};
