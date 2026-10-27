/**
 * 戰鬥背景引擎（v4，2026-10-21）
 *
 * 用途：戰鬥演出開始時，依「被攻擊的機體站在什麼地形」挑一種場景，再從那種場景的 10 張圖裡隨機抽一張。
 *
 * 決定場景的順序（越前面越優先）：
 *   1. 關卡整關指定：stage.battleBg = 'DEEPSPACE'          → 這一關全部用深空
 *   2. 關卡逐地形指定：stage.battleBg = { WATER: 'DEEPSEA' } → 這一關的河川改用深海，其他照預設
 *   3. 會飛的機體（機體資料 fly: true）站在地面或海面上 → 天空
 *   4. 地形預設：TERRAINS 的 scene 欄位（data.js）
 *
 * 場景代號：SKY 天空、LAND 陸地、DESERT 沙漠、CITY 都市、SHELTER 避難所、GRASS 草原、
 *          SEA 海面、DEEPSEA 深海、SPACE 太空、DEEPSPACE 深空
 * 圖片位置：assets/battle_bg/<場景代號>/01.jpg…（由 tools/build_battle_bg.py 產生，張數記在 manifest.json）
 */
'use strict';

const BattleBG = (() => {
  const DIR = 'assets/battle_bg/';
  const NAMES = {
    SKY: '天空', LAND: '陸地', DESERT: '沙漠', CITY: '都市', SHELTER: '避難所',
    GRASS: '草原', SEA: '海面', DEEPSEA: '深海', SPACE: '太空', DEEPSPACE: '深空',
  };
  // 會飛的機體在這些場景會改成天空（室內、水裡、宇宙不改）
  const GROUND = new Set(['LAND', 'DESERT', 'CITY', 'GRASS', 'SEA']);
  let manifest = null;              // { SKY: { count: 10 }, ... }
  const last = {};                  // 每種場景上一次抽到第幾張（避免連續兩次同一張）

  async function init() {
    if (manifest) return manifest;
    try {
      const r = await fetch(DIR + 'manifest.json', { cache: 'no-cache' });
      manifest = r.ok ? await r.json() : {};
    } catch (e) {
      console.warn('戰鬥背景清單讀取失敗，改用演出播放器的舊背景', e);
      manifest = {};
    }
    return manifest;
  }

  /** 決定場景代號。terrain：地形資料（含 id、scene）；unit：被攻擊的機體；stage：目前關卡 */
  function sceneFor(terrain, unit, stage) {
    const o = stage && stage.battleBg;
    if (typeof o === 'string') return o;
    let s = (o && o[terrain.id]) || terrain.scene || 'LAND';
    if (unit && unit.fly && GROUND.has(s)) s = 'SKY';
    return s;
  }

  /** 從該場景隨機抽一張；回傳 { scene, name, index, url }。場景沒有圖時 url 為 null（播放器會用舊背景） */
  function pick(terrain, unit, stage) {
    const scene = sceneFor(terrain, unit, stage);
    const n = (manifest && manifest[scene] && manifest[scene].count) || 0;
    if (!n) return { scene, name: NAMES[scene] || scene, index: 0, url: null };
    let i = 1 + Math.floor(Math.random() * n);
    if (n > 1 && i === last[scene]) i = (i % n) + 1;          // 不要連續兩次同一張
    last[scene] = i;
    return { scene, name: NAMES[scene] || scene, index: i, url: `${DIR}${scene}/${String(i).padStart(2, '0')}.jpg` };
  }

  return { init, sceneFor, pick, NAMES };
})();
