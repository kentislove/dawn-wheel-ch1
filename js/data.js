/**
 * 遊戲資料：地形、駕駛員、機體、武器
 * 武器數值以《OG雙主角機全新九大武裝與技能數值大全》為準（開發者 2026-10-19 報告建議：只保留一套數值）。
 * anim：對應演出播放器 data/moves/ 的招式檔；沒有 anim 的武器用簡易戰鬥框。
 * v8：敵機 E01～E04 的武器也接上 anim（E0X_0Y），敵方出招、我方反擊都會播演出。
 */
'use strict';

// 演出播放器的位置（相對於本資料夾的 index.html）
const ANIM_BASE = 'anim/';   // v7：演出播放器與壓縮素材都放在本版資料夾內（網頁發布用，不再讀上層原始素材）

// ───────── 地形 ─────────
// ch：地圖字串用的字元；bg：演出播放器的舊背景（沒有戰鬥背景庫時才用）
// scene（v4）：戰鬥背景場景代號，對應 assets/battle_bg/<scene>/（見 js/battle_bg.js）
const TERRAINS = {
  PLAINS:   { ch: '.', name: '平地', def: 0,  eva: 0,  cost: 1,  color: '#1e3a1e', bg: 'PLAINS', scene: 'GRASS' },
  FOREST:   { ch: 'f', name: '森林', def: 10, eva: 10, cost: 2,  color: '#14532d', bg: 'FOREST', scene: 'GRASS' },
  CITY:     { ch: 'c', name: '都市', def: 20, eva: 15, cost: 1,  color: '#334155', bg: 'CITY', scene: 'CITY' },
  MOUNTAIN: { ch: 'm', name: '山嶽', def: 30, eva: 20, cost: 3,  color: '#475569', bg: 'MOUNTAIN', scene: 'LAND' },
  WATER:    { ch: 'w', name: '河川', def: -10, eva: -10, cost: 2, color: '#0c4a6e', bg: 'WATER', scene: 'SEA' },
  SPACE:    { ch: 's', name: '宇宙', def: 0,  eva: 0,  cost: 1,  color: '#070b1f', bg: 'SPACE', scene: 'SPACE' },
  DEBRIS:   { ch: 'd', name: '殘骸', def: 10, eva: 20, cost: 2,  color: '#2a2f45', bg: 'SPACE', scene: 'SPACE' },
  WALL:     { ch: '#', name: '要塞外壁', def: 0, eva: 0, cost: 99, color: '#3f3f46', bg: 'SPACE', scene: 'SPACE' },
  // v4 新增（第二大關以後的地圖用；防禦、迴避、移動消耗為暫定數值，之後依關卡設計調整）
  DESERT:   { ch: 'z', name: '沙漠', def: 0,  eva: -5, cost: 2,  color: '#a16207', bg: 'PLAINS', scene: 'DESERT' },
  SEA:      { ch: 'o', name: '海面', def: -10, eva: -10, cost: 2, color: '#075985', bg: 'WATER', scene: 'SEA' },
  DEEPSEA:  { ch: 'u', name: '深海', def: 10, eva: -10, cost: 3,  color: '#082f49', bg: 'WATER', scene: 'DEEPSEA' },
  INDOOR:   { ch: 'i', name: '避難所', def: 15, eva: 0,  cost: 1,  color: '#44403c', bg: 'CITY', scene: 'SHELTER' },
  DEEPSPACE:{ ch: 'v', name: '深空', def: 0,  eva: 5,  cost: 1,  color: '#020617', bg: 'SPACE', scene: 'DEEPSPACE' },
};
const TERRAIN_BY_CH = Object.fromEntries(Object.entries(TERRAINS).map(([k, v]) => [v.ch, Object.assign({ id: k }, v)]));

// ───────── 駕駛員 ─────────
// color：對話框頭像佔位色；spirits：精神指令
// v6（開發者 2026-10-24）：我方駕駛有等級。一開始每人 3 種精神指令，升級再解鎖（spiritsByLevel：[等級, 指令]）；
//   SP 上限、HP 上限隨等級增加（見 LEVELING）；精神點數每回合恢復上限的 10%。
//   spirits 欄位保留給沒有等級的駕駛（敵方、客串）。
const PILOTS = {
  LEONA:   { name: '蕾歐娜・艾爾文', short: '蕾歐娜', color: '#38bdf8', sp: 100, spirits: ['surehit', 'flash', 'accel'],
             spiritsByLevel: [[1, 'surehit'], [1, 'flash'], [1, 'accel'], [5, 'hotblood'], [12, 'focus'], [24, 'soul']] },
  KAI:     { name: '神城 甲斐', short: '甲斐', color: '#f97316', sp: 80, spirits: ['hotblood', 'ironwall', 'guts'],
             spiritsByLevel: [[1, 'hotblood'], [1, 'ironwall'], [1, 'guts'], [6, 'spirit'], [14, 'surehit'], [26, 'soul']] },
  NOAH:    { name: '諾亞・艾爾文', short: '諾亞', color: '#a78bfa', sp: 90, spirits: ['flash', 'accel', 'focus'],
             spiritsByLevel: [[1, 'flash'], [1, 'accel'], [1, 'focus'], [8, 'hotblood'], [16, 'spirit']] },   // 明鏡止水是劇情解鎖的特殊指令，另外做
  GO:      { name: '神城 剛', short: '剛', color: '#64748b', sp: 70, spirits: ['ironwall', 'guts', 'hotblood'],
             spiritsByLevel: [[1, 'ironwall'], [1, 'guts'], [1, 'hotblood'], [10, 'unyield'], [18, 'surehit']] },
  DRONE:   { name: '無人機', short: '無人機', color: '#ef4444', sp: 0, spirits: [], atk: 0.85 },   // atk：攻擊補正，無人機沒有駕駛員的判斷力
  CIVIL:   { name: '民用機駕駛', short: '民用機駕駛', color: '#94a3b8', sp: 0, spirits: [], atk: 0.8 },
  // v5：敵方沒有精神指令（開發者 2026-10-24）
  AZRAEL:  { name: '阿茲拉爾', short: '阿茲拉爾', color: '#7c3aed', sp: 0, spirits: [] },
  NONE:    { name: '－', short: '－', color: '#64748b', sp: 0, spirits: [] },
};

// 對話中出現、但沒有機體的角色（頭像佔位色）
const SPEAKER_COLORS = {
  '蕾歐娜': '#38bdf8', '諾亞': '#a78bfa', '甲斐': '#f97316', '神城 玄藏': '#fbbf24', '瑪格麗特': '#34d399',
  '席格': '#e2e8f0', '小米': '#f9a8d4', '通信士 遙': '#5eead4', '格雷少將': '#9ca3af', '研究員': '#94a3b8',
  '廣播': '#64748b', '聯邦士官': '#9ca3af', '聯邦指揮官': '#9ca3af', '副官': '#9ca3af', '影蝠': '#7c3aed',
  '？？？': '#6b21a8', '紙條': '#e5e7eb', '訊息': '#e5e7eb', '民用機駕駛': '#94a3b8',
  '黑曜突擊兵': '#ef4444', '赤炎斬擊者': '#ef4444',
};

// ───────── 精神指令 ─────────
const SPIRITS = {
  hotblood: { name: '熱血', cost: 40, desc: '下一次攻擊傷害 2 倍' },
  surehit:  { name: '必中', cost: 20, desc: '本回合攻擊命中率 100%' },
  flash:    { name: '閃躲', cost: 15, desc: '下一次被攻擊必定迴避' },
  accel:    { name: '加速', cost: 10, desc: '本回合移動力 +3' },
  ironwall: { name: '鐵壁', cost: 30, desc: '本回合受到傷害減為 1/4' },
  guts:     { name: '根性', cost: 20, desc: '立即恢復 30% HP' },
  // v6 新增（升級解鎖）
  focus:    { name: '集中', cost: 15, desc: '本回合命中率 +30%、被命中率 -30%' },
  spirit:   { name: '氣合', cost: 30, desc: '氣力立即 +10' },
  soul:     { name: '魂',   cost: 60, desc: '下一次攻擊傷害 2.5 倍' },
  unyield:  { name: '不屈', cost: 15, desc: '下一次受到的傷害變成 10' },
  // 諾亞專用，劇情解鎖（G.flags.meikyo）：氣力 130 以上才能用，扣氣力 50，變成黃金雲雀（120%），可用 07、08；用完回原型態
  meikyo:   { name: '明鏡止水', cost: 0, needMorale: 130, desc: '氣力 -50，變成黃金雲雀，可以使用朱雀神掌、朱雀天驚拳' },
  // v14 新增（只能在遙的「精神指令交易」用經驗購買）
  snipe:     { name: '狙擊', cost: 20, desc: '本回合射擊武器（射程 2 以上）射程 +2' },
  trust:     { name: '信賴', cost: 25, desc: '相鄰的我方機體恢復 30% HP' },
  lucky:     { name: '幸運', cost: 30, desc: '下一次擊墜得到的經驗 2 倍' },
  direct:    { name: '直擊', cost: 35, desc: '下一次攻擊無視對方裝甲' },
  encourage: { name: '激勵', cost: 40, desc: '相鄰的我方機體氣力 +10' },
  supply:    { name: '補給', cost: 45, desc: '相鄰的我方機體彈藥、EN 全滿' },
  valor:     { name: '氣魄', cost: 55, desc: '氣力立即 +30' },
  awaken:    { name: '覺醒', cost: 70, desc: '這次行動結束後可以再行動一次' },
};

// v14：經驗值經濟（開發者 2026-10-27 確認方案）
// ・全隊共用一個「經驗錢包」（G.wallet）；升級、提升精神（SP 上限）、購買精神指令都從這裡扣，買了不能退
// ・不再自動升級；精神指令不再隨等級自動學會，開場只有 PILOTS[...].spirits 的 3 個，最多帶 slots 個
// ・賺：擊墜依敵機種類計價；命中不擊墜只有在傷害 ≥ 對方最大 HP 10% 時給 hitExp；被劇情保住不死的那一下不給；
//       過關時每位出擊駕駛 clearBonus；說服民用機、逼退影蝠、擊落影蝠 BOSS 由 stages.js 用 G.award() 發
// ・遙的交易窗口在 1-3 打完後開（劇情上 1-4 才上昭明號）：幕間的下一節索引 ≥ shopOpenAt
const ECONOMY = {
  killExp: { E01: 60, E02: 90, E03: 130, E04: 150, TURRET: 100, CIVIL: 0 }, killDefault: 60,
  hitExp: 5, hitMinPct: 0.10, clearBonus: 200,
  levelCost: (lv) => 100 + 20 * (lv - 1),       // 從 lv 升到 lv+1 的價錢（Lv1→2 100、Lv2→3 120……）
  spUpCost: (n) => 200 + 100 * n, spUpAmount: 10, // 第 n+1 次提升精神：200、300、400……
  slots: 6, shopOpenAt: 3,
  shopHide: ['NOAH'],                             // 第一大關諾亞 1-3 之後是敵方，交易清單先不列
  shop: [
    ['flash', 300], ['accel', 300], ['focus', 300], ['surehit', 300], ['guts', 300], ['unyield', 300], ['snipe', 300],
    ['ironwall', 500], ['spirit', 500], ['trust', 500], ['lucky', 500],
    ['hotblood', 700], ['direct', 700], ['encourage', 700], ['supply', 700],
    ['soul', 1000], ['valor', 1000],
    ['awaken', 1500],
  ],
};

// v6：等級（方案 A，開發者 2026-10-24；機體改造先保留）
// v14：升級改成花經驗買（見 ECONOMY）；expPerLevel、expHit、expKill、expBoss、spiritsByLevel 已不使用，留著備查
// 命中敵機 +10 經驗、擊墜 +50、擊墜 BOSS +150；每 100 經驗升 1 級
// 每升 1 級：駕駛的 SP 上限 +2、機體 HP 上限 +100
const LEVELING = { expPerLevel: 100, expHit: 10, expKill: 50, expBoss: 150, hpPerLevel: 100, spPerLevel: 2, spRegen: 0.10, maxLevel: 60 };

// ───────── 武器 ─────────
// hit：命中補正；ammo：-1＝不用彈藥；en：EN 消耗；morale：氣力需求
// v14（開發者 10-27）：真實系（AURORA、作業機雲雀）每把武器都有彈藥次數；超級系（轟天巨神）每招都扣 EN。
//   每一節開始補滿；我方回合開始時停在昭明號旁邊（相鄰）會補給：彈藥全滿、EN 全滿。
// v5 新增：surehit 必中；ignoreArmor 無視裝甲；debuff 命中後讓對方下降數值（到對方下一個回合結束）
//   debuff 例：{ mobility: -10 }、{ move: -2 }、{ armorPct: -20 }
// v6 新增：debuff 可加 turns（持續幾個對方回合，預設 1）、armorFlat（裝甲直接減多少）、move: -99（移動歸零）；
//   pierce＝無視對方裝甲的百分比（螺旋穿甲飛拳 35）；stun＝命中後對方下一個回合不能行動
const W = (o) => Object.assign({ min: 1, max: 1, hit: 0, en: 0, ammo: -1, morale: 100, anim: null, effect: null, surehit: false, ignoreArmor: false, debuff: null, pierce: 0, stun: false }, o);

// ───────── 機體模板 ─────────
// kind：unit 一般機體 / object 地圖物件（不移動、不反擊）/ ship 母艦與避難船（不可操控）
// v3：piece＝地圖棋子圖（assets/map/pieces/）、pieceAlly＝入隊後的我方版、mapObject＝物件圖（assets/map/objects/）
//     沒填的（雲雀、民用機、昭明號）先用 v2 的圓形／方塊標記
const UNIT_TYPES = {
  AURORA: {
    name: '極光鋼姬', label: '鋼姬', pilot: 'LEONA', animUnit: 'AURORA', eid: null, piece: 'AURORA',
    hp: 5500, en: 180, armor: 1400, mobility: 135, move: 6,
    // v6：九招全部放進遊戲（開發者 2026-10-24：招式演出都做完了），演出改用 v4 版腳本（04 v4、06 v5）
    weapons: [
      W({ name: '高頻振盪格鬥刺刀', min: 1, max: 1, power: 3200, hit: 20, ammo: 12, anim: 'AURORA_01_v4' }),
      W({ name: '極光光束軍刀・一閃', min: 1, max: 1, power: 4100, hit: 25, ammo: 6, morale: 105, anim: 'AURORA_02_v4', debuff: { armorFlat: -100 } }),
      W({ name: '真・極光次元裂空斬', min: 1, max: 2, power: 5800, hit: 35, ammo: 2, morale: 130, anim: 'AURORA_03_v4' }),
      W({ name: '頭部近防密集陣機砲', min: 1, max: 2, power: 2600, hit: 30, ammo: 20, anim: 'AURORA_04_v4' }),
      W({ name: '高出力極光光束步槍', min: 1, max: 4, power: 3700, hit: 15, ammo: 10, anim: 'AURORA_05_v4' }),
      W({ name: '擴散高能光束散射彈', min: 2, max: 4, power: 4300, hit: 10, ammo: 4, morale: 110, anim: 'AURORA_06_v5', debuff: { mobility: -25, turns: 2 } }),
      W({ name: '肩部追蹤微型導彈艙', min: 3, max: 6, power: 4100, hit: 15, ammo: 6, anim: 'AURORA_07_v4' }),
      W({ name: '極光等離子加農砲', min: 2, max: 7, power: 5300, hit: 20, ammo: 2, morale: 120, anim: 'AURORA_08_v4' }),
      W({ name: '全武裝連鎖覺醒暴風', min: 3, max: 8, power: 6600, hit: 30, ammo: 1, morale: 140, anim: 'AURORA_09_v4' }),   // MAP 模式之後再做，先當單體超必殺
    ],
  },
  TITAN: {
    name: '轟天巨神', label: '轟天', pilot: 'KAI', animUnit: 'TITAN-X', piece: 'TITAN',
    hp: 7500, en: 220, armor: 1900, mobility: 85, move: 5,
    // v6：九招全部放進遊戲，接上 TITAN_10～18 演出
    weapons: [
      W({ name: '鋼鐵魔神粉碎連打', min: 1, max: 1, power: 3500, hit: 10, en: 5, anim: 'TITAN_10' }),
      W({ name: '巨神烈焰大車輪粉碎擊', min: 1, max: 1, power: 5100, hit: 15, en: 35, morale: 115, anim: 'TITAN_11' }),
      W({ name: '真・霸皇神角破天碎', min: 1, max: 2, power: 6400, hit: 20, en: 65, morale: 135, anim: 'TITAN_12', stun: true }),
      W({ name: '火箭鐵拳・疾風噴射', min: 1, max: 3, power: 4300, hit: 20, en: 10, anim: 'TITAN_13' }),
      W({ name: '強化螺旋穿甲飛拳', min: 1, max: 4, power: 4800, hit: 15, en: 20, morale: 110, anim: 'TITAN_14', pierce: 35 }),
      W({ name: '巨神高熱酸蝕風暴', min: 1, max: 3, power: 4200, hit: 10, en: 25, morale: 105, anim: 'TITAN_15', debuff: { armorFlat: -400, turns: 3 } }),
      W({ name: '胸部熔火爆炎・熱線射', min: 1, max: 5, power: 5600, hit: 15, en: 50, morale: 115, anim: 'TITAN_16' }),
      W({ name: '巨神光子絕對零度雷射', min: 2, max: 6, power: 4700, hit: 25, en: 40, morale: 110, anim: 'TITAN_17', debuff: { move: -99 } }),
      W({ name: '天地終焉・神魔真紅大滅絕', min: 2, max: 7, power: 7000, hit: 20, en: 95, morale: 145, anim: 'TITAN_18' }),   // MAP 模式之後再做
    ],
  },
  HIBARI: {
    name: '作業機「雲雀」', label: '雲雀', pilot: 'NOAH', guest: true,
    hp: 2400, en: 100, armor: 600, mobility: 165, move: 7,
    weapons: [
      W({ name: '作業用鑽頭', min: 1, max: 1, power: 1600, hit: 10, ammo: 8 }),
      W({ name: '信號彈', min: 1, max: 3, power: 600, hit: 30, ammo: 3, effect: 'flare' }),
    ],
  },
  E01: {
    name: '黑曜突擊兵', label: '黑曜', pilot: 'DRONE', eid: 'E01', piece: 'E01',
    hp: 3600, en: 120, armor: 1100, mobility: 105, move: 5,
    weapons: [
      W({ name: '高熱戰術刺刀', min: 1, max: 1, power: 2600, anim: 'E01_02' }),
      W({ name: '90mm 實體突擊機槍', min: 1, max: 3, power: 2800, ammo: 12, anim: 'E01_01' }),
      W({ name: '雙聯裝破甲火箭彈', min: 2, max: 4, power: 3200, ammo: 4, anim: 'E01_03' }),
    ],
  },
  E02: {
    name: '赤炎斬擊者', label: '赤炎', pilot: 'DRONE', eid: 'E02', piece: 'E02',
    hp: 5200, en: 160, armor: 1300, mobility: 130, move: 6,
    weapons: [
      W({ name: '赤炎雙刃迴旋斬', min: 1, max: 1, power: 3800, anim: 'E02_03' }),
      W({ name: '居合突進・修羅十字', min: 1, max: 2, power: 4400, morale: 110, anim: 'E02_02' }),
      W({ name: '腕部擴散光束', min: 1, max: 3, power: 3000, en: 15, anim: 'E02_01' }),
    ],
  },
  E03: {
    name: '鐵甲犀牛', label: '犀牛', pilot: 'DRONE', eid: 'E03', piece: 'E03',
    hp: 8500, en: 200, armor: 1950, mobility: 75, move: 4,
    weapons: [
      W({ name: '犀角重鋼衝撞', min: 1, max: 1, power: 3600, anim: 'E03_01' }),
      W({ name: '200mm 雙聯裝加農重砲', min: 2, max: 6, power: 4600, ammo: 8, anim: 'E03_02' }),
      W({ name: '全方位煙霧震盪彈', min: 1, max: 3, power: 2500, anim: 'E03_03' }),
    ],
  },
  E04: {
    name: '影蝠戰鬥機', label: '影蝠', pilot: 'NOAH', eid: 'E04', piece: 'E04', pieceAlly: 'E04_ally', fly: true,   // v4：戰鬥機，在地面／海面挨打時背景用天空
    hp: 4800, en: 180, armor: 950, mobility: 145, move: 8,
    weapons: [
      W({ name: '翼刃高頻音速切裂', min: 1, max: 1, power: 3400, anim: 'E04_01' }),
      W({ name: '巡航隱形空對地導彈', min: 3, max: 6, power: 4100, ammo: 6, anim: 'E04_02' }),
    ],
  },
  // v5：暗面影蝠改成常態敵機，駕駛是 AI（開發者 2026-10-24：2-3 保留，但不是諾亞）
  E04B: {
    name: '暗面影蝠', label: '暗蝠', pilot: 'DRONE', eid: 'E04', piece: 'E04_dark', fly: true,
    hp: 4800, en: 180, armor: 950, mobility: 145, move: 8,
    weapons: [
      W({ name: '翼刃高頻音速切裂', min: 1, max: 1, power: 3400, anim: 'E04_01' }),
      W({ name: '巡航隱形空對地導彈', min: 3, max: 6, power: 4100, ammo: 6, anim: 'E04_02' }),
    ],
  },
  // v5：E09 虛數審判官（第四大關起）。武器全部中遠距離（最近射程 3）：兩格以內沒有招式、不能反擊。
  // aiDefault.keepAway：AI 盡量待在我方機體 2 格以外（開發者 2026-10-24）
  // causalWarp【因果歪曲】：設定集數值＝每回合 HP 回復 20%、受到傷害減半（平衡待開發者決定，見數值報告）
  // 07【MAP】因果重構斷罪陣（環狀 3～5 格）：引擎還沒有 MAP 武器，先不放
  E09: {
    name: '虛數審判官', label: '審判', pilot: 'AZRAEL', eid: 'E09', piece: 'E09', fly: true,
    hp: 45000, en: 500, armor: 2200, mobility: 135, move: 6,
    aiDefault: { keepAway: 2 },
    causalWarp: { regen: 0.10, halve: true, breakRange: 2 },   // v6：開發者選「近身破法」：被 2 格內攻擊時減半失效；回復改 10%
    weapons: [
      W({ name: '虛數幾何射線', min: 3, max: 6, power: 4200, en: 10 }),
      W({ name: '引力黑洞撕扯', min: 3, max: 5, power: 5600, en: 30, debuff: { mobility: -10 } }),
      W({ name: '異次元浮游石碑列陣', min: 3, max: 7, power: 5200, en: 40, debuff: { move: -2 } }),
      W({ name: '空間坍縮裂解波', min: 3, max: 7, power: 6500, en: 50 }),
      W({ name: '時間逆流停滯衝擊', min: 3, max: 6, power: 6000, en: 40, morale: 120, surehit: true }),
      W({ name: '虛空滅殺重力球', min: 4, max: 8, power: 6800, en: 60, morale: 125, debuff: { armorPct: -20 } }),
      W({ name: '終焉神格・虛數原質消解', min: 3, max: 6, power: 7800, en: 100, morale: 140, ignoreArmor: true }),
    ],
  },
  // v6：雲雀（諾亞，第四大關起入隊；全格鬥）。開發者 2026-10-24：一般型 100%、黃金雲雀（明鏡止水）120%、朱雀完全體 140%；
  //   基數（hp 等）隨雲雀等級成長，再乘上型態百分比。型態切換用 engine.js 的 setForm()；還沒接進關卡。
  HIBARI_FIGHTER: {
    name: '雲雀', label: '雲雀', pilot: 'NOAH', animUnit: 'HIBARI', piece: 'HIBARI_ally', pieceAlly: 'HIBARI_ally',
    hp: 6200, en: 200, armor: 1500, mobility: 150, move: 7,
    forms: {
      normal:   { name: '雲雀', mult: 1.0, piece: 'HIBARI_ally' },
      golden:   { name: '黃金雲雀', mult: 1.2, piece: 'HIBARI_ally' },                 // 明鏡止水：可用 07、08，用完回原型態
      complete: { name: '雲雀・朱雀完全體', mult: 1.4, piece: 'HIBARI_complete_ally',   // 涅槃後維持到關卡結束
                  anim: { HIBARI_01: 'HIBARI_F01', HIBARI_02: 'HIBARI_F02', HIBARI_03: 'HIBARI_F03', HIBARI_04: 'HIBARI_F04', HIBARI_05: 'HIBARI_F05', HIBARI_06: 'HIBARI_F06' } },
    },
    weapons: [
      W({ name: '雀步連環拳', min: 1, max: 1, power: 3300, hit: 20, anim: 'HIBARI_01' }),
      W({ name: '鷹爪擒拿', min: 1, max: 1, power: 3900, hit: 15, en: 10, anim: 'HIBARI_02', debuff: { mobility: -15 } }),
      W({ name: '白鶴亮翅踢', min: 1, max: 2, power: 4300, hit: 15, en: 20, morale: 105, anim: 'HIBARI_03' }),
      W({ name: '離火掌', min: 1, max: 3, power: 4600, hit: 10, en: 30, morale: 110, anim: 'HIBARI_04' }),
      W({ name: '雲雀鑽天掌', min: 1, max: 2, power: 5000, hit: 20, en: 35, morale: 115, anim: 'HIBARI_05' }),
      W({ name: '隼落鐵山靠', min: 1, max: 1, power: 5400, hit: 15, en: 40, morale: 120, anim: 'HIBARI_06', pierce: 35 }),
      W({ name: '朱雀神掌', min: 1, max: 2, power: 6400, hit: 25, en: 60, morale: 50, anim: 'HIBARI_07', needForm: 'golden' }),
      W({ name: '朱雀天驚拳', min: 1, max: 4, power: 6800, hit: 20, en: 70, morale: 50, anim: 'HIBARI_08', needForm: 'golden' }),
      W({ name: '朱雀涅槃拳・鳳凰', min: 1, max: 3, power: 7400, hit: 30, morale: 130, anim: 'HIBARI_09A', oncePerStage: true, nirvana: true }),
    ],
  },
  // v6：我方神盾泰坦（剛，隱藏 4-6 救回後入隊；開發者 2026-10-24 OK）。神盾重力場我方版：2000 以下傷害無效
  AEGIS_ALLY: {
    name: '神盾泰坦', label: '神盾', pilot: 'GO', animUnit: 'AEGIS', piece: 'E07', pieceAlly: 'E07_ally',
    hp: 12000, en: 260, armor: 2200, mobility: 75, move: 4,
    aegisField: 2000,
    weapons: [
      W({ name: '巨盾猛擊', min: 1, max: 1, power: 4000, hit: 10, anim: 'AEGIS_01' }),
      W({ name: '格林暴風', min: 1, max: 3, power: 3900, hit: 15, ammo: 16, anim: 'AEGIS_02' }),
      W({ name: '重力戰槌砸地', min: 1, max: 1, power: 4600, hit: 10, anim: 'AEGIS_03' }),
      W({ name: '肩部巡航重砲', min: 2, max: 6, power: 4800, hit: 10, ammo: 6, anim: 'AEGIS_04' }),
      W({ name: '重力場牽引撕裂', min: 1, max: 3, power: 5000, hit: 15, en: 40, morale: 115, anim: 'AEGIS_05', debuff: { move: -2 } }),
      W({ name: '神盾主砲・光束裂解', min: 2, max: 7, power: 5500, hit: 15, en: 50, morale: 110, anim: 'AEGIS_06' }),
    ],
  },
  CIVIL: {
    name: '民用作業機（被入侵）', label: '民用', pilot: 'CIVIL', eid: null,
    hp: 2000, en: 60, armor: 600, mobility: 90, move: 4,
    weapons: [W({ name: '採礦鑽頭', min: 1, max: 1, power: 1500 })],
  },
  TURRET: {
    name: '要塞砲台', label: '砲台', pilot: 'NONE', kind: 'object', eid: null, mapObject: 'TURRET',
    hp: 6000, en: 0, armor: 1500, mobility: 0, move: 0, weapons: [],
  },
  SHELTER: {
    name: '避難所', label: '避難', pilot: 'NONE', kind: 'object', eid: null, mapObject: 'SHELTER',
    hp: 99999, en: 0, armor: 0, mobility: 0, move: 0, weapons: [],
  },
  SHOMEI: {
    name: '昭明號', label: '昭明', pilot: 'NONE', kind: 'ship', mapObject: 'SHOMEI',
    hp: 30000, en: 0, armor: 1500, mobility: 0, move: 0, weapons: [],
  },
  EVAC: {
    name: '避難船', label: '避難船', pilot: 'NONE', kind: 'ship', mapObject: 'EVAC',
    hp: 4000, en: 0, armor: 500, mobility: 0, move: 0, weapons: [],
  },
};

// 1-5 BOSS 版影蝠：HP 提高、技能「雲雀的翅膀」迴避 +15%、血量五成以下解禁音障轟炸
const BOSS_BAT_WEAPON_UNLOCK = W({ name: '超音速音障轟炸', min: 1, max: 4, power: 4500, en: 30, anim: 'E04_03' });
