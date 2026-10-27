/**
 * 敵機出招播放器（2026-10-21）
 * ------------------------------------------------------------
 * 敵機出招 → 我方反應（防禦＝A.T. 力場／迴避／受擊）。
 * 繼承 BattleAnimPlayer（背景、切入、動作序列、震動、事件全部共用）；受擊段交給內部的 BattleReactPlayer 畫我方反應。
 * 開發者規則照舊：只呈現動畫，HP／傷害數字由遊戲計算；播放器只在時間點發出事件。
 *
 * 用法（要先載入 battle_anim_player.js、battle_react_player.js）：
 *   const ep = await BattleEnemyPlayer.create(canvas, { base: './' });
 *   await ep.load({ move: 'E01_01', target: 'AURORA', reaction: 'DAMAGE' | 'DEFEND' | 'EVADE', terrain: 'PLAINS' });
 *   ep.play();
 *
 * 時間軸（和我方招式一樣）：0～1.3 敵機登場（從右邊飛入、面向左）｜1.3～2.7 首幀切入｜2.8～5.8 動作序列｜5.9～7.1 尾幀切入｜7.1～ 我方反應
 * 敵機各招式打在我方身上的「專屬受擊效果」還在討論中（conversation_logs/2026-10-21_待討論_敵機招式對我方的受擊效果.md），
 * 目前依招式類別先用「光束／實彈」兩種攻擊外觀；之後在 data/moves/<招式>.json 的 hit_on_player 欄位擴充。
 */
(function (global) {
  'use strict';
  const W = 1280, H = 720, GROUND = 620;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const easeOut = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return 1 - Math.pow(1 - t, 3); };
  const lerp = (a, b, u) => a + (b - a) * u;
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${clamp(a, 0, 1)})`;
  const loadImg = src => new Promise((ok, ng) => { const i = new Image(); src = global.BattleAnimPlayer.src(src); i.onload = () => ok(i); i.onerror = () => ng(new Error('載入失敗：' + src)); i.src = src; });   // v8：.png → .webp
  const loadJSON = src => fetch(src, { cache: 'no-store' }).then(r => { if (!r.ok) throw new Error('載入失敗：' + src); return r.json(); });
  const SHOT_KIND = { '近戰': 'beam', '中程': 'shot', '遠程': 'beam', 'MAP': 'beam' };   // 暫定：之後依討論結果改成每招專屬

  class BattleEnemyPlayer extends global.BattleAnimPlayer {
    static async create(canvas, opt = {}) { const p = new BattleEnemyPlayer(canvas, opt); await p._loadCommon(); return p; }

    async load({ move, target = 'AURORA', reaction = 'DAMAGE', terrain = 'PLAINS', bgUrl = null }) {   // 網頁 v16：bgUrl＝遊戲指定的整張戰鬥背景（和我方出招一樣）
      const b = this.base;
      this.move = await loadJSON(`${b}data/moves/${move}.json`);
      this.enemyId = this.move.attacker || move.split('_')[0];
      this.enemy = this.enemies.units[this.enemyId];
      this.terrain = terrain;
      const img = {};
      const want = { cutinStart: this.move.cutin_start.image, cutinEnd: this.move.cutin_end.image,
        bgFar: `assets/backgrounds/${terrain}_far.png`, bgNear: `assets/backgrounds/${terrain}_near.png` };
      if (this.enemy.stand) want.stand = this.enemy.stand;
      if (bgUrl) { delete want.bgFar; delete want.bgNear; }
      await Promise.all(Object.entries(want).map(async ([k, v]) => { img[k] = await loadImg(b + v); }));
      if (bgUrl) { img.bgFar = await loadImg(bgUrl); const blank = document.createElement('canvas'); blank.width = blank.height = 1; img.bgNear = blank; }
      this.img = img;
      const F = this.move.action.frames, pad = n => String(n).padStart(F.digits || 3, '0');
      this.seq = await Promise.all(Array.from({ length: F.count }, (_, i) => loadImg(`${b}${F.dir}/${F.prefix || 'frame_'}${pad(i + 1)}.png`)));
      this.rig = null; this.targetSeq = null; this.hitStyle = null; this.dmg = 0;
      // 我方反應：內部的反應播放器（共用同一張畫布與已載入的資料）
      this.rp = new global.BattleReactPlayer(this.cv, { base: b });
      Object.assign(this.rp, { chars: this.chars, enemies: this.enemies, dialogue: this.dialogue, audio: this.audio });
      const attack = (this.move.hit_on_player && this.move.hit_on_player.attack) || SHOT_KIND[this.move.category] || 'beam';
      // 每招專屬受擊／防禦特效（data/hit_on_player.json，2026-10-23 開發者逐招指定）
      if (!this.hitOnPlayer) { try { this.hitOnPlayer = await loadJSON(`${b}data/hit_on_player.json`); } catch (e) { this.hitOnPlayer = {}; } }
      const fx = ((this.hitOnPlayer[this.move.id || move] || {})[reaction]) || null;
      await this.rp.load({ unit: target, kind: reaction, attack, terrain, fx, fxImg: this.enemy.stand, bgUrl });
      this.rpStart = Math.max(0, this.rp.T - 0.6);            // 命中點落在受擊段開始後 0.6 秒
      this.H0 = this.move.segments.hit[0];
      this.duration = this.H0 + (this.rp.duration - this.rpStart);
      // 事件：出招段沿用招式檔（只取受擊段之前），受擊段改用反應播放器的事件
      this.events = (this.move.events || []).filter(e => e.t < this.H0)
        .concat(this.rp.events.map(e => Object.assign({}, e, { t: e.t - this.rpStart + this.H0 })))
        .sort((a, c) => a.t - c.t);
      this.move = Object.assign({}, this.move, { shakes: (this.move.shakes || []).filter(s => s.t < this.H0), flashes: (this.move.flashes || []).filter(f => f < this.H0 + 0.01) });
      // 台詞：敵方台詞（無人機是合成語音）
      const L = (this.dialogue.enemy_lines || {})[this.enemyId] || {};
      // 2026-10-23：每招各自的出招台詞（enemy_lines.<敵機>.moves.<招式>），沒有才用通用 attack
      const ML = (L.moves || {})[this.move.id || move];
      this.line = (ML && ML[0]) || (L.attack && L.attack[0]) || '……';
      this.moveName = this.move.name || '';
      this.speaker = this.enemy.name;
      this.target = { box: [300, 420] };   // 給父類別用（不會畫到）
      this._noCutin();
      this.t = 0; this._firedUpTo = -1;
      this.renderAt(0);
    }

    // ① 敵機登場：從右邊飛入，面向左
    _entry(t) {
      const img = this.img.stand; this._bg(900 - 120 * t);
      if (!img) return;
      const sc = Math.min(0.85, 520 / img.height, 620 / img.width);
      const fx = lerp(W + 380, W - 430, easeOut(0, 0.75, t)), fy = GROUND - img.height * sc / 2 - 10 + 6 * Math.sin(t * 4);
      for (let k = 4; k >= 1; k--) { const tk = t - 0.035 * k; if (tk < 0 || t > 0.9) continue;
        this._sprite(img, lerp(W + 380, W - 430, easeOut(0, 0.75, tk)), fy, sc, 0, 0.4 - 0.08 * k, [170, 90, 255], 0.6); }
      this._sprite(img, fx, fy, sc, -6 * (1 - easeOut(0, 0.9, t)));
      this._speedLines(t, 1 - smooth(0.6, 0.9, t), 13, -1);
    }
    // ⑤ 受擊段：我方反應
    _hit(t) { this.rp.renderAt(t - this.H0 + this.rpStart); }
    renderAt(t) {
      super.renderAt(t);
    }
    // 台詞框：敵方（右側名牌、沒有頭像就顯示敵機圖示）
    _dialogue(lt) {
      const c = this.ctx, by = H - 150, k = smooth(0, 0.15, lt);
      c.save(); c.globalAlpha = k;
      c.fillStyle = 'rgba(22,6,14,0.82)'; c.fillRect(0, by, W, 150);
      c.fillStyle = '#c0264a'; c.fillRect(0, by, W, 3);
      if (this.img.stand) { const s = Math.min(120 / this.img.stand.width, 120 / this.img.stand.height);
        c.fillStyle = '#1a0a12'; c.fillRect(W - 140, by + 14, 120, 120);
        c.drawImage(this.img.stand, W - 80 - this.img.stand.width * s / 2, by + 74 - this.img.stand.height * s / 2, this.img.stand.width * s, this.img.stand.height * s); }
      c.fillStyle = 'rgba(90,12,30,0.95)'; c.beginPath(); c.moveTo(W - 160, by - 22); c.lineTo(W - 420, by - 22); c.lineTo(W - 440, by); c.lineTo(W - 160, by); c.fill();
      c.fillStyle = '#ffe6ec'; c.font = 'bold 18px "Microsoft JhengHei"'; c.textAlign = 'right'; c.fillText(this.speaker, W - 172, by - 5);
      // 招式名稱（正式名稱）：台詞框左上角的紅色標籤
      if (this.moveName) { c.font = 'bold 20px "Microsoft JhengHei"'; c.textAlign = 'left'; const tw = c.measureText(this.moveName).width;
        c.fillStyle = 'rgba(150,20,45,0.95)'; c.beginPath(); c.moveTo(20, by - 30); c.lineTo(48 + tw, by - 30); c.lineTo(66 + tw, by); c.lineTo(20, by); c.fill();
        c.fillStyle = '#ffe6ec'; c.fillText(this.moveName, 34, by - 8); }
      const line = this.line, n = Math.floor(line.length * clamp((lt - 0.1) / 0.8, 0, 1));
      c.fillStyle = '#fff5f8'; c.font = 'bold 28px "Microsoft JhengHei"'; c.textAlign = 'left';
      c.fillText(line.slice(0, n), 40, by + 62);
      c.restore();
    }
  }
  global.BattleEnemyPlayer = BattleEnemyPlayer;
})(window);
