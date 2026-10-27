/**
 * 反應動作播放器（我方機體被攻擊時：防禦／迴避／受擊）2026-10-20
 * ------------------------------------------------------------
 * 繼承 BattleAnimPlayer（背景、發光、爆炸、火花、震動、事件、播放控制全部共用），原本的招式播放器不受影響。
 * 開發者規則照舊：只呈現動畫，HP／傷害數字由遊戲計算後自行疊加；播放器只在時間點發出事件。
 *
 * 用法（要先載入 battle_anim_player.js）：
 *   const rp = await BattleReactPlayer.create(canvas, { base: './' });
 *   await rp.load({ unit: 'AURORA', kind: 'DEFEND' | 'EVADE' | 'DAMAGE', attack: 'beam' | 'shot', terrain: 'PLAINS' });
 *   rp.on('event', ev => { ... });   // ev.type = 'impact' | 'damage_popup' | 'miss' | 'audio' | 'end'
 *   rp.play();
 *
 * 素材：data/characters.json 的 units.<機體>.react.<動作>（灰底 H3 影片去背後的透明 PNG 序列，24 fps）
 *   dir／prefix／digits／count：序列位置
 *   impact：攻擊打到（或擦過）的那一格（從 1 起算）
 *   point：命中點，影片畫面座標（1376×768）
 *   frame_scale／origin：整張序列畫到畫面上的縮放與左上角位置
 */
(function (global) {
  'use strict';
  const W = 1280, H = 720;
  const CYAN = [56, 189, 248], ICE = [200, 245, 255], WHITE = [255, 255, 255];
  const ORANGE = [255, 140, 40], YELLOW = [255, 220, 115], RED = [255, 60, 50];
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${clamp(a, 0, 1)})`;
  function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const loadImg = src => new Promise((ok, ng) => { const i = new Image(); src = global.BattleAnimPlayer.src(src); i.onload = () => ok(i); i.onerror = () => ng(new Error('載入失敗：' + src)); i.src = src; });   // v8：.png → .webp

  const ATTACK_COLOR = { beam: [255, 90, 60], shot: YELLOW };   // 敵方攻擊顏色（我方是青色，敵方用暖色區分）

  class BattleReactPlayer extends global.BattleAnimPlayer {
    static async create(canvas, opt = {}) { const p = new BattleReactPlayer(canvas, opt); await p._loadCommon(); return p; }

    async load({ unit, kind, attack = 'beam', terrain = 'PLAINS' }) {
      const b = this.base;
      this.unit = this.chars.units[unit];
      const R = this.unit.react && this.unit.react[kind];
      if (!R) throw new Error(`${unit} 沒有反應動作 ${kind}`);
      this.R = R; this.kind = kind; this.attack = attack; this.terrain = terrain;
      this.move = { id: `${unit}_REACT_${kind}` };          // 給錄影檔名用
      this.img = { bgFar: await loadImg(`${b}assets/backgrounds/${terrain}_far.png`), bgNear: await loadImg(`${b}assets/backgrounds/${terrain}_near.png`) };
      const pad = n => String(n).padStart(R.digits || 3, '0');
      this.seq = await Promise.all(Array.from({ length: R.count }, (_, i) => loadImg(`${b}${R.dir}/${R.prefix || 'frame_'}${pad(i + 1)}.png`)));
      this.fps = R.fps || 24;
      // 2026-10-23 雲雀「明鏡止水」B 案：光環／光羽／水紋由程式即時旋轉（H3 轉不準方向）。R.halo 有設定才載入
      this.halo = null;
      if (R.halo) { const H = R.halo, L = {};
        await Promise.all(['outer', 'inner', 'feathers', 'ripple'].map(async k => { L[k] = await loadImg(`${b}${H.dir}/${k}.png`); }));
        this.halo = Object.assign({}, H, { img: L }); }
      // 2026-10-24 圖片區我方特效：A.T. 力場本體（中間透明）、閃避殘影光帶、我方 MISS 美術字
      const opt = async u => { try { return u ? await loadImg(b + u) : null; } catch (e) { return null; } };
      [this.fieldImg, this.trailImg, this.missImg] = await Promise.all([opt(this.unit.field_sprite), opt(this.unit.evade_trail), opt('assets/vfx/S_ally_miss/frame_001.png')]);
      this.T = (R.impact - 1) / this.fps;                     // 命中時間（秒）
      this.duration = R.count / this.fps + 0.5;               // 最後一格多停 0.5 秒
      const ev = [{ t: 0.02, type: 'audio', cue: attack === 'beam' ? 'se_enemy_beam' : 'se_enemy_shot' },
                  { t: this.T, type: 'impact', name: kind }];
      if (kind === 'DEFEND') ev.push({ t: this.T, type: 'audio', cue: 'se_guard' }, { t: this.T + 0.12, type: 'damage_popup', name: 'guard' });
      if (kind === 'EVADE') ev.push({ t: this.T - 0.3, type: 'audio', cue: 'se_evade' }, { t: this.T + 0.12, type: 'miss' });
      if (kind === 'DAMAGE') ev.push({ t: this.T, type: 'audio', cue: 'se_hit_heavy' }, { t: this.T + 0.12, type: 'damage_popup', name: 'hit' });
      this.events = ev.sort((a, c) => a.t - c.t);
      this.t = 0; this._firedUpTo = -1;
      this.renderAt(0);
    }

    // 影片座標 → 畫面座標
    _map(p) { const s = this.R.frame_scale, o = this.R.origin; return [o[0] + p[0] * s, o[1] + p[1] * s]; }
    _frame(t) { return clamp(Math.floor(t * this.fps), 0, this.seq.length - 1); }
    _drawFrame(i, alpha = 1, tint = null, tk = 0, dx = 0) {
      const img = this.seq[i], s = this.R.frame_scale, o = this.R.origin;
      this._sprite(img, o[0] + dx + img.width * s / 2, o[1] + img.height * s / 2, s, 0, alpha, tint, tk);
    }

    renderAt(t) {
      const c = this.ctx, T = this.T, K = this.kind, d = t - T;
      c.save(); c.clearRect(0, 0, W, H);
      // 震動：受擊最大、防禦次之、迴避沒有
      const amp = K === 'DAMAGE' ? 22 : K === 'DEFEND' ? 9 : 0;
      const shake = d >= 0 ? amp * Math.exp(-d * 7) : 0;
      if (shake > 0.3) { const r = rng(Math.floor(t * 60) + 7); c.translate((r() - 0.5) * 2 * shake, (r() - 0.5) * 1.2 * shake); }
      this._bg(400 + 10 * t, 1.0);
      const fi = this._frame(t), P = this._map(this.R.point);

      if (K === 'EVADE') { this._incoming(t, P); this._evadeGhosts(fi); }   // 迴避：攻擊從機體後方掠過
      // 機體：受擊後紅色閃爍、命中瞬間白閃
      let tint = null, tk = 0;
      if (K === 'DAMAGE' && d >= 0) { if (d < 0.07) { tint = WHITE; tk = 0.75; } else if (d < 0.7 && Math.floor(t * 24) % 2 === 0) { tint = RED; tk = 0.45 * Math.exp(-d * 2.5); } }
      if (K === 'DEFEND' && d >= 0 && d < 0.06) { tint = WHITE; tk = 0.35; }
      if (this.halo) this._haloFX(t, false);              // 光環、光羽在機體後面
      this._drawFrame(fi, 1, tint, tk);
      if (this.halo) this._haloFX(t, true);               // 腳下水紋在機體前面

      if (K !== 'EVADE' && !K.startsWith('MEIKYO')) this._incoming(t, P);   // 明鏡止水是發動演出，沒有敵方攻擊
      if (K === 'DEFEND' && !this.unit.no_field) this._guardFX(d, P);   // 昭明號等 no_field 的單位：不出 A.T. 力場，艦體硬扛（序列本身有爆炸）
      if (K === 'EVADE') this._missFX(d, P);
      if (K === 'DAMAGE') this._damageHitFX(d, P);
      c.restore();
      // 受擊命中：全畫面白閃（蓋住 H3 光束被剪掉的接點）
      if (K === 'DAMAGE' && d >= 0 && d < 0.17) { c.fillStyle = rgba(WHITE, 0.85 * (1 - d / 0.17)); c.fillRect(0, 0, W, H); }
    }

    // 敵方攻擊從畫面右邊飛進來（光束＝一道粗光；射擊＝連續曳光彈）
    _incoming(t, P) {
      const T = this.T, col = ATTACK_COLOR[this.attack] || ATTACK_COLOR.beam, K = this.kind;
      const stopX = K === 'DEFEND' ? P[0] : K === 'DAMAGE' ? P[0] : -100;   // 迴避：直接穿過畫面
      if (this.attack === 'beam') {
        const t0 = T - 0.22, d = t - t0; if (d < 0) return;
        const head = K === 'EVADE' ? W + 100 - (W + 300) * clamp(d / 0.32, 0, 1) : Math.max(stopX, W + 100 - (W + 100 - stopX) * clamp(d / 0.22, 0, 1));
        const fade = 1 - smooth(T + 0.15, T + 0.55, t), w = 26 * fade;
        if (fade <= 0.01) return;
        this._line(W + 100, P[1], head, P[1], col, 1.2 * fade, w);
        this._line(W + 100, P[1], head, P[1], WHITE, 1.1 * fade, w * 0.35);
        if (K !== 'EVADE' && t >= T) this._glow(stopX, P[1], 30, col, 1.1 * fade);
      } else {
        for (let i = 0; i < 7; i++) {
          const ti = T - 0.18 + i * 0.05, d = t - ti; if (d < 0) continue;
          const x = W + 60 - 2600 * d, y = P[1] + ((i * 37) % 50 - 25);
          const end = K === 'EVADE' ? -200 : stopX; if (x < end) continue;
          this._line(x, y, x + 90, y, col, 1.2, 4);
        }
      }
    }

    // 防禦：A.T. 力場式八角形屏障（2026-10-21 開發者指定，參考《新世紀福音戰士》）
    //   整台機體被一個大八角形力場包住；攻擊打到的位置擴散出一圈圈同心八角形波紋；力場本體半透明、邊緣發光。
    //   顏色：characters.json 的 field_color，沒填用 A.T. 力場橘。
    _guardFX(d, P) {
      if (d < -0.15) return;
      const c = this.ctx, COL = this.unit.field_color || [255, 150, 60];
      const img = this.seq[this._frame(this.t)], s = this.R.frame_scale, o = this.R.origin;
      const ux = o[0] + img.width * s / 2, uy = o[1] + img.height * s / 2;      // 機體中心
      const R = Math.max(img.width, img.height) * s * 0.36;                     // 力場半徑：包住整台
      const up = smooth(-0.15, 0.02, d), dn = 1 - smooth(1.0, 1.4, d), k = up * dn;
      const oct = (x, y, r, rot = Math.PI / 8) => { c.beginPath(); for (let i = 0; i < 8; i++) { const a = rot + i * Math.PI / 4;
        c[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * r, y + Math.sin(a) * r); } c.closePath(); };
      if (k > 0.01) {
        const rr = R * (0.85 + 0.15 * up);
        // 黑色力場（神盾泰坦我方版，2026-10-22）：'lighter' 疊加黑色會看不見，改用一般疊加畫半透明黑面＋白銀亮邊
        const dark = COL[0] + COL[1] + COL[2] < 150, RIM = dark ? (this.unit.field_rim || [210, 215, 230]) : COL;
        c.save(); c.globalCompositeOperation = dark ? 'source-over' : 'lighter';
        if (this.fieldImg) { c.save(); c.globalCompositeOperation = 'source-over'; c.globalAlpha = k; const fw = rr * 1.95; c.drawImage(this.fieldImg, ux - fw / 2, uy - fw / 2, fw, fw); c.restore(); }   // 圖片區力場素材
        else {
        if (dark) { oct(ux, uy, rr + 6); c.strokeStyle = rgba(RIM, 0.35 * k); c.lineWidth = 14; c.stroke(); }
        // 力場本體：中心淡、邊緣亮
        oct(ux, uy, rr); const g = c.createRadialGradient(ux, uy, rr * 0.2, ux, uy, rr);
        g.addColorStop(0, rgba(COL, (dark ? 0.12 : 0.05) * k)); g.addColorStop(0.75, rgba(COL, (dark ? 0.35 : 0.18) * k)); g.addColorStop(1, rgba(COL, (dark ? 0.7 : 0.45) * k));
        c.fillStyle = g; c.fill();
        c.strokeStyle = rgba(RIM, 0.95 * k); c.lineWidth = 5; c.stroke();
        oct(ux, uy, rr - 10); c.strokeStyle = rgba(WHITE, 0.5 * k); c.lineWidth = 2; c.stroke(); }
        // 命中點的同心八角形波紋（只畫在力場內）
        c.save(); oct(ux, uy, rr); c.clip();
        if (d >= 0) for (let i = 0; i < 7; i++) { const a = d - i * 0.06; if (a < 0) continue;
          const r = 20 + a * 900, fa = Math.exp(-a * 2.2) * k;
          if (fa < 0.02) continue;
          oct(P[0], P[1], r); c.strokeStyle = rgba(i % 2 ? WHITE : (dark ? [8, 8, 10] : COL), 0.9 * fa); c.lineWidth = 6 * fa + 1.5; c.stroke(); }
        // 命中後一小段時間，力場整片閃一下
        if (d >= 0 && d < 0.25) { oct(ux, uy, rr); c.fillStyle = rgba(dark ? RIM : COL, (dark ? 0.25 : 0.35) * (1 - d / 0.25)); c.fill(); }
        c.restore(); c.restore();
      }
      if (d >= 0) {
        this._glow(P[0], P[1], 40, COL[0] + COL[1] + COL[2] < 150 ? (this.unit.field_rim || [210, 215, 230]) : COL, 1.3 * Math.exp(-d * 6));
        this._sparks(P[0], P[1], d, 30, 51, 0, 2.2, 650, YELLOW);
        this._sparks(P[0], P[1], d - 0.08, 18, 52, -0.6, 1.6, 500, COL[0] + COL[1] + COL[2] < 150 ? WHITE : COL);
        if (d < 0.08) { c.fillStyle = rgba(WHITE, 0.45 * (1 - d / 0.08)); c.fillRect(0, 0, W, H); }
      }
    }

    // 明鏡止水光環：座標＝序列畫面（1376×768）；內環順時針、外環逆時針、12 光羽順時針公轉；腳下水紋由內往外不斷擴散
    _haloFX(t, front) {
      const H = this.halo, c = this.ctx, s = this.R.frame_scale, o = this.R.origin, a = smooth(H.appear, H.appear + 0.35, t);
      if (a <= 0.01) return;
      c.save(); c.translate(o[0], o[1]); c.scale(s, s); c.globalCompositeOperation = 'lighter';
      const [hx, hy] = H.center, spin = (img, ang, alpha, sc = 1) => { c.save(); c.globalAlpha = alpha; c.translate(hx, hy); c.rotate(ang); c.scale(sc, sc); c.translate(-hx, -hy); c.drawImage(img, 0, 0); c.restore(); };
      if (!front) {
        const tt = t - H.appear, pop = 0.85 + 0.15 * smooth(0, 0.35, tt);
        spin(H.img.outer, -tt * H.speed[0], H.alpha * a, pop);      // 外環：逆時針
        spin(H.img.inner, tt * H.speed[1], H.alpha * a, pop);       // 內環：順時針
        spin(H.img.feathers, tt * H.speed[2], H.alpha * a, pop);    // 光羽：順時針公轉
      } else {
        const [rx, ry] = H.ripple_center;
        for (let i = 0; i < 4; i++) { const u = ((t - H.appear) * 0.55 + i / 4) % 1; if (t - H.appear < i * 0.45) continue;
          c.save(); c.globalAlpha = H.alpha * a * (1 - u) * 0.9; c.translate(rx, ry); c.scale(0.4 + 2.2 * u, 0.4 + 2.2 * u); c.translate(-rx, -ry); c.drawImage(H.img.ripple, 0, 0); c.restore(); }
      }
      c.restore();
    }

    // 迴避：爆衝時留下青色殘影
    _evadeGhosts(fi) {
      const G = this.R.ghost || [0, 0]; if (fi < G[0] || fi > G[1] + 6) return;
      const fade = 1 - clamp((fi - G[1]) / 6, 0, 1);
      if (this.trailImg && this._bbox) {   // 殘影光帶：光頭貼著機體、朝移動方向，尾巴拖在後面
        const B = this._bbox(fi), B0 = this._bbox(Math.max(0, fi - 4)), vx = B.cx - B0.cx, vy = B.cy - B0.cy, L0 = Math.hypot(vx, vy);
        if (L0 > 3) { const ang = Math.atan2(vy, vx), TI = this.trailImg, c = this.ctx;
          [[-0.28, 1], [0.05, 0.85], [0.3, 0.7]].forEach(([o, k]) => { const L = Math.max(B.w, B.h) * 1.2 * k, h = L * TI.height / TI.width;
            c.save(); c.globalAlpha = 0.85 * fade * k; c.translate(B.cx - Math.sin(ang) * o * B.h, B.cy + Math.cos(ang) * o * B.h); c.rotate(ang); c.drawImage(TI, -L * 0.95, -h / 2, L, h); c.restore(); }); } }
      for (let k = 3; k >= 1; k--) { const j = fi - 2 * k; if (j < G[0] - 1) continue;
        this._drawFrame(j, (0.42 - 0.1 * k) * fade, this.unit.stand_thruster_color || CYAN, 0.7); }   // 殘影顏色跟機體推進器（AURORA 青、轟天巨神橘紅）
    }
    _missFX(d, P) {
      if (d < 0 || d > 1.3) return;
      const c = this.ctx, u = smooth(0, 0.12, d), f = 1 - smooth(0.9, 1.3, d);
      if (this.missImg) { const MI = this.missImg, w = 380 * (0.85 + 0.15 * u), h = w * MI.height / MI.width;
        let mx = P[0] + 120, my = P[1] - 280;   // 放在機體正上方（不壓到機體、不超出畫面頂）
        if (this._bbox) { const B = this._bbox(this._frame(this.t)); mx = clamp(B.cx, w / 2 + 20, W - w / 2 - 20); my = B.y0 - h / 2 - 10; if (my < h / 2 + 12) mx = clamp(B.x1 + w / 2 + 10, w / 2 + 20, W - w / 2 - 20), my = Math.max(h / 2 + 12, B.y0 + h / 2); }
        c.save(); c.globalAlpha = f; c.drawImage(MI, mx - w / 2, my - 30 * u * 0 - h / 2 + 20 * (1 - u), w, h); c.restore(); return; }
      c.save(); c.globalAlpha = f; c.translate(P[0] + 120, P[1] - 260 - 30 * u); c.scale(0.7 + 0.3 * u, 0.7 + 0.3 * u);
      c.font = 'italic 900 72px "Arial Black", "Microsoft JhengHei", sans-serif'; c.textAlign = 'center';
      c.lineWidth = 8; c.strokeStyle = 'rgba(5,15,40,0.9)'; c.strokeText('MISS', 0, 0);
      c.fillStyle = rgba(ICE, 1); c.fillText('MISS', 0, 0); c.restore();
    }

    // 受擊：胸口爆炸＋火花＋裝甲碎片
    _damageHitFX(d, P) {
      if (d < 0) return;
      this._explosion(P[0], P[1], d, 1.1, 777, ORANGE);
      this._explosion(P[0] - 40, P[1] + 50, d - 0.12, 0.6, 778, ORANGE);
      this._sparks(P[0], P[1], d, 34, 61, Math.PI, 1.8, 700, YELLOW);
    }
  }
  global.BattleReactPlayer = BattleReactPlayer;
})(window);
