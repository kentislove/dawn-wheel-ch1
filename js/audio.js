/**
 * v12：音效與音樂（Web Audio）
 * - 素材：assets/audio/（tools/build_audio.py 從音樂區的 WAV 母帶轉成 MP3），manifest.json 記每個檔的真正長度
 * - 音樂 A／B：開發者 2026-10-23 指示「要在遊戲畫面裡選擇 A 或 B 才知道好不好」→ 右下角按鈕即時切換，會記住
 * - 瀏覽器規定要使用者先點一下畫面才能出聲：第一次點擊／按鍵時才建立 AudioContext
 * - 循環音樂：MP3 開頭有約 0.025 秒編碼空白，只循環 WAV 原本的長度，接縫不卡
 */
const SND = (() => {
  const BASE = 'assets/audio/';
  const MP3_DELAY = 0.025057;                       // LAME 編碼器延遲 1105 格 ÷ 44100
  let ctx = null, master = null, bgmBus = null, seBus = null, man = {};
  const bufs = {}, active = new Set();
  let variant = 'A', muted = false;
  try { variant = localStorage.getItem('srw_bgm_ab') === 'B' ? 'B' : 'A'; muted = localStorage.getItem('srw_mute') === '1'; } catch (e) { /* 無痕視窗 */ }
  let want = null, cur = null;                       // want＝想播的音樂（邏輯名稱）；cur＝正在播的 { key, src, gain }
  let duck = 1;

  fetch(BASE + 'manifest.json').then((r) => r.json()).then((m) => { man = m; if (want) music(want); }).catch(() => {});

  function unlock() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      ctx = new AC(); master = ctx.createGain(); bgmBus = ctx.createGain(); seBus = ctx.createGain();
      bgmBus.gain.value = 0.55; seBus.gain.value = 0.9; master.gain.value = muted ? 0 : 1;
      bgmBus.connect(master); seBus.connect(master); master.connect(ctx.destination);
      if (want) music(want);
    }
    if (ctx.state === 'suspended') ctx.resume();
  }
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);

  function load(key) {
    if (!bufs[key]) bufs[key] = fetch(BASE + key + '.mp3').then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
      .then((a) => new Promise((ok, ng) => ctx.decodeAudioData(a, ok, ng))).catch(() => null);
    return bufs[key];
  }
  // 音效：key 例 'se/AURORA_02_start'、'ui/UI02_confirm'；沒有這個檔就安靜跳過
  async function se(key, vol = 1, battle = false) {
    if (!ctx || muted || !(key in man)) return;
    const b = await load(key); if (!b) return;
    const g = ctx.createGain(); g.gain.value = vol; g.connect(seBus);
    const s = ctx.createBufferSource(); s.buffer = b; s.connect(g); s.start();
    if (battle) { active.add(s); s.onended = () => active.delete(s); }
  }
  function stopBattle() { for (const s of active) { try { s.stop(); } catch (e) { /* 已停止 */ } } active.clear(); }
  // 音樂：name 例 'MAP_1-1'、'MAP_1-1_ENEMY'、'EV1-1'、'BGM_TITLE'；有 _A／_B 兩版就照目前選擇
  function resolve(name) { return man[`bgm/${name}_${variant}`] ? `bgm/${name}_${variant}` : `bgm/${name}`; }
  async function music(name) {
    want = name;
    if (!ctx || !Object.keys(man).length) return;
    const key = resolve(name);
    if (cur && cur.key === key) return;
    fadeOut(cur); cur = null;
    if (!(key in man)) return;
    const b = await load(key); if (!b || want !== name || resolve(name) !== key) return;
    const g = ctx.createGain(); g.gain.value = 0; g.connect(bgmBus);
    const s = ctx.createBufferSource(); s.buffer = b; s.loop = true;
    const off = b.duration - man[key] > 0.02 ? MP3_DELAY : 0;     // 瀏覽器沒去掉編碼空白時，跳過它
    s.loopStart = off; s.loopEnd = Math.min(b.duration, off + man[key]);
    s.connect(g); s.start(0, off);
    g.gain.linearRampToValueAtTime(duck, ctx.currentTime + 0.6);
    cur = { key, src: s, gain: g };
  }
  function fadeOut(c) {
    if (!c) return; const t = ctx.currentTime;
    c.gain.gain.cancelScheduledValues(t); c.gain.gain.setValueAtTime(c.gain.gain.value, t); c.gain.gain.linearRampToValueAtTime(0, t + 0.5);
    c.src.stop(t + 0.55);
  }
  // v13：播開場 MV 時先把音樂停掉（MV 自己有歌）
  function stopMusic() { want = null; if (ctx && cur) fadeOut(cur); cur = null; }
  // 戰鬥演出時音樂壓小聲，讓音效聽得清楚
  function setDuck(on) {
    duck = on ? 0.35 : 1;
    if (ctx && cur) { const t = ctx.currentTime; cur.gain.gain.cancelScheduledValues(t); cur.gain.gain.setValueAtTime(cur.gain.gain.value, t); cur.gain.gain.linearRampToValueAtTime(duck, t + 0.3); }
  }
  function setVariant(v) {
    variant = v; try { localStorage.setItem('srw_bgm_ab', v); } catch (e) { /* 忽略 */ }
    if (want) { const w = want; if (cur) { fadeOut(cur); cur = null; } music(w); }
  }
  function setMuted(m) {
    muted = m; try { localStorage.setItem('srw_mute', m ? '1' : '0'); } catch (e) { /* 忽略 */ }
    if (master) master.gain.value = m ? 0 : 1;
  }
  return { se, music, stopMusic, stopBattle, setDuck, setVariant, setMuted, get variant() { return variant; }, get muted() { return muted; }, has: (k) => k in man,
    get playing() { return cur ? cur.key : null; }, get state() { return ctx ? ctx.state : 'locked'; } };   // playing／state：除錯用
})();

// 機體代碼 → 音效檔名前綴（音樂區的檔名：AURORA、TITAN、E01～E04）
function sndPrefix(u) {
  const k = (u && (u.animUnit || u.eid)) || '';
  if (k.startsWith('AURORA')) return 'AURORA';
  if (k.startsWith('TITAN')) return 'TITAN';
  return /^E0\d$/.test(k) ? k : null;
}
// 招式代碼 → 音效檔名：AURORA_02_v4 → AURORA_02、TITAN_12 → TITAN_12、E01_01 → E01_M1
function sndMove(anim) {
  const m = /^(E0\d)_0(\d)$/.exec(anim); if (m) return `${m[1]}_M${m[2]}`;
  return anim.replace(/_v\d+$/, '');
}
// 精神指令 → 介面音效
const SPIRIT_SND = { hotblood: 'UI15_spirit_hotblood', soul: 'UI15_spirit_hotblood', surehit: 'UI16_spirit_strike', flash: 'UI17_spirit_alert', focus: 'UI17_spirit_alert',
  accel: 'UI18_spirit_accel', ironwall: 'UI19_spirit_ironwall', unyield: 'UI19_spirit_ironwall', guts: 'UI20_spirit_guts', spirit: 'UI20_spirit_guts' };

// 左下角的音樂 A／B 與靜音按鈕（標題畫面、遊戲中都看得到）
(() => {
  const box = document.createElement('div'); box.id = 'audioCtl';
  box.innerHTML = '<button id="btnBgmAB" title="切換音樂 A／B 版（開發者試聽用）"></button><button id="btnMute" title="靜音"></button>';
  document.body.appendChild(box);
  const ab = document.getElementById('btnBgmAB'), mu = document.getElementById('btnMute');
  const paint = () => { ab.textContent = `♪ 音樂 ${SND.variant}`; mu.textContent = SND.muted ? '🔇' : '🔊'; };
  ab.onclick = (e) => { e.stopPropagation(); SND.setVariant(SND.variant === 'A' ? 'B' : 'A'); paint(); };
  mu.onclick = (e) => { e.stopPropagation(); SND.setMuted(!SND.muted); paint(); };
  paint();
})();
