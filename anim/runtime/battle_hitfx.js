/**
 * 敵機招式打我方：每招專屬「受擊」與「A.T. 力場防禦」特效（2026-10-23）
 * ------------------------------------------------------------
 * 開發者逐招指定（conversation_logs/2026-10-21_待討論_敵機招式對我方的受擊效果.md）：
 *   - 不准用通用特效；每招依描述各自呈現，特效要沿著我方機體外形。
 *   - A.T. 力場是我方專屬（顏色依 characters.json 的 field_color）。
 * 資料：data/hit_on_player.json  { "E01_01": { "DAMAGE": { "fx": "pierce", ... }, "DEFEND": { "fx": "drops", ... } } }
 * 用法：在 battle_react_player.js 之後載入。BattleReactPlayer.load({ ..., fx }) 帶入該招的設定後，
 *       renderAt 會改走這裡的 _fxRender（沒有 fx 時維持原本的通用畫法）。
 * 時間：d＝距離命中點（反應序列的 impact 格）的秒數；負數＝攻擊飛來中。
 */
(function (global) {
  'use strict';
  const W = 1280, H = 720;
  const WHITE = [255, 255, 255], YELLOW = [255, 220, 115], ORANGE = [255, 140, 40], RED = [255, 60, 50];
  const PURPLE = [170, 80, 255], ICE = [200, 245, 255], ELEC = [150, 210, 255], GOLD = [255, 200, 70];
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const lerp = (a, b, u) => a + (b - a) * u;
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${clamp(a, 0, 1)})`;
  function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  const P = global.BattleReactPlayer.prototype;

  // ───────── 共用工具 ─────────
  // 機體外框（畫面座標）：依目前那一格的透明度算，依格號快取
  P._bbox = function (fi) {
    this._bbCache = this._bbCache || {};
    if (!this._bbCache[fi]) {
      const img = this.seq[fi], k = 4, w = Math.ceil(img.width / k), h = Math.ceil(img.height / k);
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const g = cv.getContext('2d');
      g.drawImage(img, 0, 0, w, h); const a = g.getImageData(0, 0, w, h).data;
      let x0 = w, y0 = h, x1 = 0, y1 = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (a[(y * w + x) * 4 + 3] > 60) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      const s = this.R.frame_scale, o = this.R.origin;
      const b = { x0: o[0] + x0 * k * s, y0: o[1] + y0 * k * s, x1: o[0] + x1 * k * s, y1: o[1] + y1 * k * s };
      b.w = b.x1 - b.x0; b.h = b.y1 - b.y0; b.cx = (b.x0 + b.x1) / 2; b.cy = (b.y0 + b.y1) / 2;
      this._bbCache[fi] = b;
    }
    return this._bbCache[fi];
  };
  // 畫機體（可位移、縮放、旋轉、染色；pivot＝機體底部中央）
  P._drawMech = function (fi, M = {}) {
    const c = this.ctx, B = this._bbox(fi);
    c.save();
    const px = B.cx, py = B.y1;
    c.translate(px + (M.dx || 0), py + (M.dy || 0)); c.rotate((M.rot || 0) * Math.PI / 180); c.scale(M.sx || 1, M.sy || 1); c.translate(-px, -py);
    if (M.clip) { c.beginPath(); M.clip(c, B); c.clip(); }
    this._drawFrame(fi, M.alpha == null ? 1 : M.alpha, M.tint || null, M.tk || 0);
    c.restore();
  };
  // 只畫在機體輪廓上的特效：先畫進暫存畫布，再用機體剪影裁切，最後疊回主畫面
  P._onMech = function (fi, M, draw, op = 'source-over') {
    const cv = this._mcv || (this._mcv = document.createElement('canvas')); cv.width = W; cv.height = H;
    const g = cv.getContext('2d'), main = this.ctx;
    this.ctx = g; draw(g);
    g.globalCompositeOperation = 'destination-in'; this._drawMech(fi, M); g.globalCompositeOperation = 'source-over';
    this.ctx = main; main.save(); main.globalCompositeOperation = op; main.drawImage(cv, 0, 0); main.restore();
  };
  // 閃電（折線，可分岔）
  P._bolt = function (x0, y0, x1, y1, seed, col = ELEC, k = 1, w = 3, seg = 9, jag = 26) {
    if (k <= 0.01) return;
    const BI = this._S && this._S('S_bolt');
    if (BI) { const c = this.ctx, L = Math.hypot(x1 - x0, y1 - y0), ang = Math.atan2(y1 - y0, x1 - x0) - Math.PI / 2, r = rng(seed);
      c.save(); c.globalAlpha = Math.min(1, k); c.globalCompositeOperation = 'lighter'; c.translate(x0, y0); c.rotate(ang); c.scale((r() < 0.5 ? -1 : 1) * Math.max(0.25, w / 4) * 0.5, L / BI.height); c.drawImage(BI, -BI.width / 2, 0); c.restore(); return; } const c = this.ctx, r = rng(seed), pts = [[x0, y0]];
    const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
    for (let i = 1; i < seg; i++) { const u = i / seg, j = (r() - 0.5) * 2 * jag; pts.push([x0 + dx * u + nx * j, y0 + dy * u + ny * j]); }
    pts.push([x1, y1]);
    c.save(); c.globalCompositeOperation = 'lighter'; c.lineJoin = 'round'; c.lineCap = 'round';
    for (const [lw, cc, a] of [[w * 4, col, 0.35], [w * 1.6, col, 0.8], [w * 0.7, WHITE, 1]]) {
      c.strokeStyle = rgba(cc, a * k); c.lineWidth = lw; c.beginPath(); pts.forEach((p, i) => c[i ? 'lineTo' : 'moveTo'](p[0], p[1])); c.stroke(); }
    c.restore();
  };
  // 機體被打中時的抖動量（所有命中時間點的衰減總和）
  const jolt = (d, times, amp, decay = 14) => times.reduce((s, ti) => s + (d >= ti ? amp * Math.exp(-(d - ti) * decay) : 0), 0);
  // 依序／亂數的命中時間
  const hitTimes = (n, span, seed, jitter = 0.35) => { const r = rng(seed); return Array.from({ length: n }, (_, i) => n === 1 ? 0 : (i / (n - 1)) * span + (r() - 0.5) * jitter * span / n).sort((a, b) => a - b).map(x => Math.max(0, x)); };

  // ───────── A.T. 力場（我方專屬）：本體，可變形 ─────────
  // opt.wob(i, a)：第 i 個頂點的半徑倍率（抖動、漏斗擠壓用）；回傳 {cx, cy, R, path(r)}
  P._fieldBody = function (d, opt = {}) {
    const c = this.ctx, fi = this._frame(this.t), B = this._bbox(fi);
    const COL = this.unit.field_color || [255, 150, 60], dark = COL[0] + COL[1] + COL[2] < 150, RIM = dark ? (this.unit.field_rim || [210, 215, 230]) : COL;
    const len = opt.len || 1.2, up = smooth(-0.15, 0.02, d), dn = 1 - smooth(len, len + 0.4, d), k = up * dn;
    const cx = B.cx, cy = B.cy, R = Math.max(B.w, B.h) * 0.62, N = opt.verts || 8;
    const path = (r, ox = cx, oy = cy) => { c.beginPath(); for (let i = 0; i < N; i++) { const a = Math.PI / 8 + i * Math.PI * 2 / N;
      const m = opt.wob ? opt.wob(i, a) : 1, my = opt.wobY ? opt.wobY(i, a) : m; c[i ? 'lineTo' : 'moveTo'](ox + Math.cos(a) * r * m, oy + Math.sin(a) * r * my); } c.closePath(); };
    const F = { cx, cy, R, k, COL, RIM, dark, path, x: cx + R * 0.92 };   // x＝面向敵人那一側的表面（敵人在右邊）
    if (k <= 0.01) return F;
    if (this.fieldImg) {   // 2026-10-24 圖片區力場素材（中間透明）；變形的招式用頂點平均倍率把素材拉伸
      let mx = 1, my = 1; if (opt.wob || opt.wobY) { mx = 0; my = 0; for (let i = 0; i < N; i++) { const a = Math.PI / 8 + i * Math.PI * 2 / N, m = opt.wob ? opt.wob(i, a) : 1; mx += m / N; my += (opt.wobY ? opt.wobY(i, a) : m) / N; } }
      const fw = R * 1.95; c.save(); c.globalAlpha = k; c.drawImage(this.fieldImg, cx - fw * mx / 2, cy - fw * my / 2, fw * mx, fw * my); c.restore();
      return F; }
    c.save(); c.globalCompositeOperation = dark ? 'source-over' : 'lighter';
    if (dark) { path(R + 6); c.strokeStyle = rgba(RIM, 0.35 * k); c.lineWidth = 14; c.stroke(); }
    path(R); const g = c.createRadialGradient(cx, cy, R * 0.2, cx, cy, R);
    g.addColorStop(0, rgba(COL, (dark ? 0.12 : 0.05) * k)); g.addColorStop(0.75, rgba(COL, (dark ? 0.35 : 0.16) * k)); g.addColorStop(1, rgba(COL, (dark ? 0.7 : 0.42) * k));
    c.fillStyle = g; c.fill(); c.strokeStyle = rgba(RIM, 0.95 * k); c.lineWidth = 5; c.stroke();
    path(R - 10); c.strokeStyle = rgba(WHITE, 0.45 * k); c.lineWidth = 2; c.stroke();
    c.restore();
    return F;
  };
  // 力場內裁切（波紋只畫在力場裡）
  P._inField = function (F, draw) { const c = this.ctx; c.save(); F.path(F.R); c.clip(); c.globalCompositeOperation = F.dark ? 'source-over' : 'lighter'; draw(c); c.restore(); };
  // 直立 90° 的水滴波紋（水面轉成直立的牆，從側面看＝直立細橢圓）
  P._dropRipple = function (F, x, y, a, size, col) {
    if (a < 0 || a > 1.4) return; const c = this.ctx;
    for (let j = 0; j < 4; j++) { const aj = a - j * 0.09; if (aj < 0) continue; const f = Math.exp(-aj * 2.6);
      const rx = size * (0.18 + aj * 1.1), ry = size * (0.6 + aj * 3.4);
      c.strokeStyle = rgba(j % 2 ? WHITE : col, 1 * f * F.k); c.lineWidth = (j === 0 ? 5 : 3) * (0.6 + f);
      c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.stroke(); }
    if (a < 0.12) this._glow(x, y, size * 0.35, col, 1.2 * (1 - a / 0.12) * F.k);
  };

  // ───────── 攻擊物件 ─────────
  // 2026-10-23 開發者：子彈、砲彈要上色、有立體感，不要一條線。
  // 曳光彈：黃銅彈頭（亮面＋暗面＋描邊）＋往後漸細的橘黃曳光尾焰（外層橘、內層白黃）
  const bulletHead = (self, x, y, len, col, w) => {
    const SP = self._sprOn && self._vfxGet(self._projSpr || 'S_bullet');
    if (SP) { const img = SP.frames[0], sc = (len * 1.25) / img.width * (self._projScale || 1); self._vfx(self._projSpr || 'S_bullet', x, y, { scale: sc, anchor: [0.02, 0.5], hold: true }); return; }
    const c = self.ctx, s = w / 4;
    c.save(); c.globalCompositeOperation = 'lighter';
    const g = c.createLinearGradient(x, 0, x + len * 1.4, 0); g.addColorStop(0, rgba([255, 240, 190], 0.95)); g.addColorStop(0.25, rgba(col, 0.75)); g.addColorStop(1, rgba([255, 90, 20], 0));
    c.fillStyle = g; c.beginPath(); c.moveTo(x + 6 * s, y - 4 * s); c.lineTo(x + len * 1.4, y - 1); c.lineTo(x + len * 1.4, y + 1); c.lineTo(x + 6 * s, y + 4 * s); c.closePath(); c.fill();
    c.restore(); self._glow(x + 4 * s, y, 9 * s, col, 0.55);
    c.save(); c.translate(x, y);
    const b = c.createLinearGradient(0, -4 * s, 0, 4 * s); b.addColorStop(0, '#fff3c4'); b.addColorStop(0.35, '#e0b04a'); b.addColorStop(1, '#7a5418');
    c.fillStyle = b; c.strokeStyle = 'rgba(40,25,5,0.9)'; c.lineWidth = Math.max(1, s);
    c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(3 * s, -3.6 * s, 9 * s, -3.6 * s); c.lineTo(16 * s, -3.6 * s); c.lineTo(16 * s, 3.6 * s); c.lineTo(9 * s, 3.6 * s); c.quadraticCurveTo(3 * s, 3.6 * s, 0, 0); c.closePath(); c.fill(); c.stroke();
    c.restore(); };
  // 砲彈：金屬彈體（上亮下暗的圓柱）＋銅色彈帶＋彈頭＋後方噴焰與白煙
  P._shell = function (x, y, col, sz = 1) {
    const nm = this._shellSpr || (sz < 0.95 ? 'S_shell_small' : 'S_shell_big');
    if (this._sprOn && this._vfxGet(nm)) { const img = this._vfxGet(nm).frames[0]; this._vfx(nm, x, y, { scale: (110 * sz) / img.width * (nm === 'S_rocket' ? 2.0 : 1), anchor: [0.02, 0.5], hold: true }); return; }
    const c = this.ctx, L = 46 * sz, R = 9 * sz;
    const puff = this._tinted(this._puff(), [215, 210, 200]);
    for (let i = 1; i <= 4; i++) { const k = i / 4; c.save(); c.globalAlpha = 0.35 * (1 - k); const sp = R * (2.4 + 2.5 * k); c.drawImage(puff, x + L + i * 26 * sz - sp / 2, y - sp / 2, sp, sp); c.restore(); }
    c.save(); c.globalCompositeOperation = 'lighter';
    const f = c.createLinearGradient(x + L, 0, x + L + 60 * sz, 0); f.addColorStop(0, rgba([255, 250, 210], 1)); f.addColorStop(0.3, rgba(col, 0.9)); f.addColorStop(1, rgba([255, 60, 10], 0));
    c.fillStyle = f; c.beginPath(); c.moveTo(x + L, y - R * 0.7); c.lineTo(x + L + 60 * sz, y); c.lineTo(x + L, y + R * 0.7); c.closePath(); c.fill(); c.restore();
    c.save(); c.translate(x, y);
    const g = c.createLinearGradient(0, -R, 0, R); g.addColorStop(0, '#f2f4f6'); g.addColorStop(0.3, '#a9b0b8'); g.addColorStop(0.75, '#5c636c'); g.addColorStop(1, '#2c3036');
    c.fillStyle = g; c.strokeStyle = 'rgba(15,15,20,0.95)'; c.lineWidth = Math.max(1.2, 1.6 * sz);
    c.beginPath(); c.moveTo(0, 0); c.bezierCurveTo(R * 0.6, -R, R * 1.6, -R, L * 0.42, -R); c.lineTo(L, -R); c.lineTo(L, R); c.lineTo(L * 0.42, R); c.bezierCurveTo(R * 1.6, R, R * 0.6, R, 0, 0); c.closePath(); c.fill(); c.stroke();
    const cu = c.createLinearGradient(0, -R, 0, R); cu.addColorStop(0, '#ffd9a0'); cu.addColorStop(0.5, '#c27a32'); cu.addColorStop(1, '#6a3a12');
    c.fillStyle = cu; c.fillRect(L * 0.68, -R, L * 0.1, R * 2); c.strokeRect(L * 0.68, -R, L * 0.1, R * 2);
    c.fillStyle = 'rgba(255,255,255,0.55)'; c.fillRect(L * 0.3, -R * 0.75, L * 0.6, R * 0.22);
    c.restore(); };
  // 2026-10-24 E04～E08 素材圖工具
  P._S = function (name) { return this._sprOn && this._vfxGet(name) ? this._vfxGet(name).frames[0] : null; };
  // 長條素材（光束、長槍、風柱…）從 (x0,y0) 拉到 (x1,y1)：素材已翻成朝左（尖端在左緣），thick＝畫面上的粗細
  P._sprBeam = function (name, x0, y0, x1, y1, thick, alpha = 1) { const img = this._S(name); if (!img || alpha <= 0.01) return false;
    const c = this.ctx, L = Math.hypot(x1 - x0, y1 - y0); if (L < 2) return true; const ang = Math.atan2(y1 - y0, x1 - x0) - Math.PI;
    c.save(); c.globalAlpha = alpha; c.translate(x1, y1); c.rotate(ang); c.scale(L / img.width, thick / img.height); c.drawImage(img, 0, -img.height / 2); c.restore(); return true; };
  // 單張素材：置中、寬 w、旋轉 rot、可上下翻
  P._sprAt = function (name, x, y, w, o = {}) { const img = this._S(name); if (!img) return false; const c = this.ctx, k = w / img.width;
    c.save(); c.globalAlpha = o.alpha == null ? 1 : o.alpha; if (o.blend) c.globalCompositeOperation = o.blend; c.translate(x, y); if (o.rot) c.rotate(o.rot);
    c.scale(k * (o.flipX ? -1 : 1), k * (o.flipY ? -1 : 1) * (o.sy || 1)); c.drawImage(img, -img.width * (o.ax == null ? 0.5 : o.ax), -img.height * (o.ay == null ? 0.5 : o.ay)); c.restore(); return true; };

  // 素材版爆炸：S_boom 4 張依序播（每張 0.11 秒），最後一張煙慢慢上飄淡出；外加金屬火花與碎片
  P._boomSpr = function (x, y, age, power = 1, seed = 1) {
    if (age < 0 || age > 1.6) return; const V = this._vfxGet('S_boom'); const sc = 0.75 * power;
    const i = Math.min(3, Math.floor(age / 0.11)), rise = i === 3 ? (age - 0.33) * 60 : 0, fade = i === 3 ? 1 - smooth(0.6, 1.6, age) : 1;
    const c = this.ctx, img = V.frames[i], k = sc * (0.75 + 0.25 * smooth(0, 0.2, age)) * (i === 3 ? 1 + 0.25 * (age - 0.33) : 1);
    c.save(); c.globalAlpha = fade; c.translate(x, y - rise); c.rotate(((seed * 37) % 20 - 10) * Math.PI / 180); c.scale(k, k); c.drawImage(img, -img.width / 2, -img.height / 2); c.restore();
    if (age < 0.25 && this._vfxGet('S_sparks')) { const S = this._vfxGet('S_sparks').frames[0]; c.save(); c.globalAlpha = 1 - age / 0.25; c.translate(x, y); c.rotate(-0.4 + (seed % 5) * 0.2); c.scale(0.45 * power, 0.45 * power); c.drawImage(S, -S.width * 0.15, -S.height / 2); c.restore(); }
    if (age > 0.05 && age < 0.9 && this._vfxGet('S_debris')) { const D = this._vfxGet('S_debris').frames[0], u = (age - 0.05) / 0.85, kk = 0.3 * power * (0.6 + 0.9 * u);
      c.save(); c.globalAlpha = 1 - u; c.translate(x - 40 * u * power, y + 60 * u * u * power); c.rotate(u * 1.5); c.scale(kk, kk); c.drawImage(D, -D.width / 2, -D.height / 2); c.restore(); }
  };
  // 機體上的彈孔焦痕貼圖（只畫在機體輪廓內，由 _onMech 呼叫）
  P._holeSpr = function (x, y, size, seed = 1) { const V = this._vfxGet('S_hole'); if (!V) return false; const img = V.frames[0], k = size / img.width, c = this.ctx;
    c.save(); c.translate(x, y); c.rotate((seed * 53 % 360) * Math.PI / 180); c.scale(k, k); c.drawImage(img, -img.width / 2, -img.height / 2); c.restore(); return true; };
  P._explosion = function (x, y, age, power, seed, col) {
    if (this._sprOn && this._vfxGet('S_boom')) return this._boomSpr(x, y, age, power * 1.4, seed);
    return global.BattleAnimPlayer.prototype._explosion.call(this, x, y, age, power, seed, col); };

  // 從敵機 H3 影片裁下來的特效（assets/vfx/<名稱>/frame_###.png，tools/extract_vfx.py 產生）。age＝出現後秒數；加亮疊上去
  P._vfxGet = function (name) { return (this.vfxLib || {})[name]; };
  P._vfx = function (name, x, y, o = {}) { const V = this._vfxGet(name); if (!V) return false; const age = o.age || 0; if (age < 0) return true;
    const fps = o.fps || 24, n = V.frames.length; let i = Math.floor(age * fps); if (o.loop) i %= n; else if (i >= n) { if (!o.hold) return true; i = n - 1; }
    const img = V.frames[i], sc = o.scale || 1, ax = (o.anchor || [0.5, 0.5])[0] * img.width, ay = (o.anchor || [0.5, 0.5])[1] * img.height;
    const fade = o.fade ? 1 - smooth(o.fade[0], o.fade[1], age) : 1; if (fade <= 0.01) return true;
    const c = this.ctx; c.save(); c.globalCompositeOperation = o.blend || 'source-over'; c.globalAlpha = (o.alpha == null ? 1 : o.alpha) * fade;   // 一般疊色：亮天空也看得出火光顏色（加亮會洗成白）
    c.translate(x, y); if (o.rot) c.rotate(o.rot); c.scale(sc * (o.flip ? -1 : 1), sc); c.drawImage(img, -ax, -ay); c.restore(); return true; };
  // 長兵器（刺刀、槍）：從右邊刺過來的尖錐
  P._spike = function (tipX, y, len, wid, col, glow = 1) {
    const nm = this._spikeSpr || (col === PURPLE ? 'S_crystal_arrow' : col === ICE ? 'S_iceshard' : null);
    if (nm && this._S(nm)) { this._sprBeam(nm, tipX + Math.max(len, wid * 9), y, tipX, y, Math.max(wid * 4.2, len * 0.24)); return; }
    const c = this.ctx; c.save();
    const g = c.createLinearGradient(tipX, 0, tipX + len, 0); g.addColorStop(0, '#f4f8ff'); g.addColorStop(0.35, rgba(col, 1)); g.addColorStop(1, rgba(col, 0.2));
    c.fillStyle = g; c.beginPath(); c.moveTo(tipX, y); c.lineTo(tipX + len * 0.25, y - wid); c.lineTo(tipX + len, y - wid * 0.6); c.lineTo(tipX + len, y + wid * 0.6); c.lineTo(tipX + len * 0.25, y + wid); c.closePath(); c.fill();
    c.restore(); if (glow) this._glow(tipX + 6, y, wid * 1.2, col, 0.6 * glow); };
  // 長槍：菱形槍頭＋槍身＋後方拖曳的槍勢光
  P._spear = function (tipX, y, thick, col, f) { if (f <= 0.01) return;
    const nm = thick > 1.5 ? 'S_goldlance' : 'S_lance';
    if (this._S(nm)) { const img = this._S(nm), L = 460 * Math.sqrt(thick); this._sprBeam(nm, tipX + L, y, tipX, y, L * img.height / img.width, f);
      if (thick > 1.5) this._glow(tipX + 20, y, 30 * thick, col, 0.6 * f); return; }
    const c = this.ctx, hl = 70 * thick, hw = 16 * thick;
    this._line(tipX + hl * 0.8, y, W + 80, y, col, 0.7 * f, 9 * thick);                       // 槍勢光
    c.save(); c.globalAlpha = f; c.fillStyle = '#5a4a3a'; c.fillRect(tipX + hl * 0.9, y - 4 * thick, 420, 8 * thick);   // 槍身
    const g = c.createLinearGradient(tipX, y - hw, tipX, y + hw); g.addColorStop(0, '#ffffff'); g.addColorStop(0.5, rgba(col, 1)); g.addColorStop(1, '#8090a8');
    c.fillStyle = g; c.beginPath(); c.moveTo(tipX, y); c.lineTo(tipX + hl * 0.55, y - hw); c.lineTo(tipX + hl, y - hw * 0.3); c.lineTo(tipX + hl, y + hw * 0.3); c.lineTo(tipX + hl * 0.55, y + hw); c.closePath(); c.fill();
    c.strokeStyle = rgba(WHITE, 0.9); c.lineWidth = 1.5; c.stroke(); c.restore(); this._glow(tipX + 8, y, 18 * thick, col, 0.8 * f); };
  // 撕咬的獸顎虛影：上下兩片彎弧，內緣一排尖牙，cl＝閉合程度（0 張開、1 咬合）；嘴巴朝左（獵犬從右邊咬過來）
  P._jaws = function (x, y, size, cl, a) {
    if (this._S('S_jaws')) { this._sprAt('S_jaws', x, y, size * 1.7, { alpha: a, sy: 0.55 + 0.45 * (1 - cl) }); return; }
    const c = this.ctx, gap = size * 0.55 * (1 - cl) + size * 0.06;
    c.save(); c.globalCompositeOperation = 'lighter'; c.lineWidth = 4;
    for (const s of [-1, 1]) { const y0 = y + s * gap;
      c.fillStyle = rgba(PURPLE, 0.35 * a); c.strokeStyle = rgba([220, 170, 255], 0.9 * a);
      c.beginPath(); c.moveTo(x + size * 0.7, y0 + s * size * 0.25);                                   // 下顎根部（右）
      c.quadraticCurveTo(x, y0 + s * size * 0.35, x - size * 0.75, y0 + s * size * 0.02);              // 外弧到嘴尖（左）
      for (let i = 0; i < 7; i++) { const tx = x - size * 0.65 + i * size * 0.2;                         // 牙齒
        c.lineTo(tx, y0); c.lineTo(tx + size * 0.07, y0 - s * size * 0.16); c.lineTo(tx + size * 0.14, y0); }
      c.lineTo(x + size * 0.7, y0 + s * size * 0.05); c.closePath(); c.fill(); c.stroke(); }
    c.restore(); };
  // 有方向的犬影：(vx,vy)＝前進方向（素材本身朝左）
  P._dogDir = function (x, y, vx, vy, h, a) { const im = this._S('S_doghost'); if (!im) return this._dogGhost(x, y, h, a);
    const right = vx > 0, ang = right ? Math.atan2(vy, vx) : Math.atan2(-vy, -vx);
    this._sprAt('S_doghost', x, y, h * 1.4 * im.width / im.height, { alpha: 0.9 * a, flipX: right, rot: ang }); };
  // 紫色犬影：用出招敵機的立繪染紫、半透明
  P._dogGhost = function (x, y, h, a, flip = 1) { if (a > 0.01 && this._S('S_doghost')) { const im = this._S('S_doghost'); this._sprAt('S_doghost', x, y, h * 0.75 * im.width / im.height, { alpha: 0.9 * a }); return; }
    const img = this.fxImg; if (!img || a <= 0.01) return;
    const s = h / img.height; this.ctx.save(); this.ctx.globalCompositeOperation = 'lighter';
    this._sprite(img, x, y, s, 0, 0.55 * a, PURPLE, 0.85); this.ctx.restore(); };
  // 螯爪虛影（程式畫）：鉸點在 (x, y) 右邊，上下兩片彎鉤往左伸，open＝張開程度（1 全開、0 夾緊）
  P._claw = function (x, y, size, open, upper, col, a) { if (a <= 0.01) return;
    if (this._S('S_claw')) { const sg = upper ? -1 : 1; this._sprAt('S_claw', x + size * 0.9, y + sg * size * 0.12, size * 1.25, { alpha: a, ax: 0.92, ay: upper ? 0.62 : 0.62, flipY: !upper, rot: sg * (0.05 + 0.45 * open) }); return; }
    const c = this.ctx, sg = upper ? -1 : 1;
    c.save(); c.translate(x + size * 0.9, y); c.rotate(sg * (0.05 + 0.55 * open)); c.globalCompositeOperation = 'lighter';
    c.fillStyle = rgba(col, 0.45 * a); c.strokeStyle = rgba(WHITE, 0.85 * a); c.lineWidth = 3;
    c.beginPath(); c.moveTo(0, 0);
    c.quadraticCurveTo(-size * 0.45, sg * size * 0.42, -size * 1.05, sg * size * 0.08);                 // 外緣弧
    c.lineTo(-size * 0.98, -sg * size * 0.02);                                                           // 爪尖往內勾
    for (let i = 0; i < 5; i++) c.lineTo(-size * (0.82 - i * 0.15), sg * size * (0.1 + (i % 2 ? 0.07 : 0)));   // 內緣鋸齒
    c.quadraticCurveTo(-size * 0.1, sg * size * 0.12, 0, 0); c.closePath(); c.fill(); c.stroke();
    c.restore(); };
  // 碎片（紫色玻璃、冰晶等）
  P._shards = function (x, y, a, n, seed, col, speed = 600, size = 10) { if (a < 0 || a > 1.2) return; const c = this.ctx, r = rng(seed);
    c.save(); c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n; i++) { const ang = r() * Math.PI * 2, sp = speed * (0.3 + r()), px = x + Math.cos(ang) * sp * a, py = y + Math.sin(ang) * sp * a + 300 * a * a;
      const s = size * (0.5 + r()); c.save(); c.translate(px, py); c.rotate(a * (r() * 16 - 8)); c.fillStyle = rgba(col, 0.85 * (1 - a / 1.2));
      c.beginPath(); c.moveTo(0, -s); c.lineTo(s * 0.6, 0); c.lineTo(0, s * 0.8); c.lineTo(-s * 0.5, 0); c.closePath(); c.fill(); c.restore(); }
    c.restore(); };
  // 空間裂縫
  P._spaceCrack = function (x, y, a, seed, size = 160) { if (a <= 0.01) return;
    if (this._S('S_rift')) { this._sprAt('S_rift', x, y, size * 1.2 * (0.4 + 0.6 * a), { alpha: Math.min(1, a * 1.5) }); this._glow(x, y, size * 0.25 * a, PURPLE, 0.7); return; }
    const c = this.ctx, r = rng(seed);
    c.save(); c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 9; i++) { const ang = r() * Math.PI * 2; let px = x, py = y; c.beginPath(); c.moveTo(px, py);
      for (let j = 1; j <= 4; j++) { px = x + Math.cos(ang + (r() - 0.5) * 0.8) * size * a * j / 4; py = y + Math.sin(ang + (r() - 0.5) * 0.8) * size * a * j / 4; c.lineTo(px, py); }
      c.strokeStyle = rgba(PURPLE, 0.9); c.lineWidth = 6; c.stroke(); c.strokeStyle = rgba(WHITE, 0.95); c.lineWidth = 2; c.stroke(); }
    c.restore(); this._glow(x, y, size * 0.25 * a, PURPLE, 0.9); };

  // 機體碎裂：pieces＝多邊形清單（以外框比例 0～1 表示），分開量隨 d 先增後減
  P._drawShatter = function (fi, M, pieces, amt) {
    const B = this._bbox(fi), c = this.ctx;
    pieces.forEach((pc, i) => { const cx = pc.reduce((s, q) => s + q[0], 0) / pc.length, cy = pc.reduce((s, q) => s + q[1], 0) / pc.length;
      const vx = (cx - 0.5) * 2, vy = (cy - 0.5) * 2, L = Math.hypot(vx, vy) || 1;
      c.save(); c.translate(vx / L * 110 * amt, vy / L * 80 * amt); c.translate(B.x0 + cx * B.w, B.y0 + cy * B.h); c.rotate((i % 2 ? 1 : -1) * 0.12 * amt); c.translate(-(B.x0 + cx * B.w), -(B.y0 + cy * B.h));
      c.beginPath(); pc.forEach((q, k) => c[k ? 'lineTo' : 'moveTo'](B.x0 - 40 + q[0] * (B.w + 80), B.y0 - 40 + q[1] * (B.h + 80))); c.closePath(); c.clip();
      this._drawMech(fi, M); c.restore(); });
    const onEdge = (a, b) => (a[0] === b[0] && (a[0] <= 0 || a[0] >= 1)) || (a[1] === b[1] && (a[1] <= 0 || a[1] >= 1));   // 外框邊不畫裂縫
    if (amt > 0.05) pieces.forEach((pc, i) => { for (let k = 0; k < pc.length; k++) { const a = pc[k], b = pc[(k + 1) % pc.length]; if (onEdge(a, b)) continue;
      this._line(B.x0 - 40 + a[0] * (B.w + 80), B.y0 - 40 + a[1] * (B.h + 80), B.x0 - 40 + b[0] * (B.w + 80), B.y0 - 40 + b[1] * (B.h + 80), ORANGE, 0.5 * amt, 2); } });
  };
  const X4 = [[[0, 0], [1, 0], [0.5, 0.5]], [[1, 0], [1, 1], [0.5, 0.5]], [[1, 1], [0, 1], [0.5, 0.5]], [[0, 1], [0, 0], [0.5, 0.5]]];   // 沿 X 刀痕切成四塊
  const randPieces = (seed, n = 7) => { const r = rng(seed), cx = 0.45 + 0.1 * r(), cy = 0.4 + 0.15 * r(), pts = [];
    for (let i = 0; i < n; i++) { const a = (i + r() * 0.6) / n * Math.PI * 2; pts.push([Math.cos(a), Math.sin(a)]); }
    const edge = ([x, y]) => { const t = Math.min(x > 0 ? (1 - cx) / x : x < 0 ? -cx / x : 9, y > 0 ? (1 - cy) / y : y < 0 ? -cy / y : 9); return [cx + x * t, cy + y * t]; };
    return pts.map((q, i) => { const e1 = edge(q), e2 = edge(pts[(i + 1) % n]), corners = [];
      for (const k of [[0, 0], [1, 0], [1, 1], [0, 1]]) { const a1 = Math.atan2(q[1], q[0]), a2 = Math.atan2(pts[(i + 1) % n][1], pts[(i + 1) % n][0]), ak = Math.atan2(k[1] - cy, k[0] - cx);
        const norm = x => (x - a1 + Math.PI * 4) % (Math.PI * 2); if (norm(ak) < norm(a2)) corners.push(k); }
      corners.sort((u, v) => ((Math.atan2(u[1] - cy, u[0] - cx) - Math.atan2(q[1], q[0]) + Math.PI * 4) % (Math.PI * 2)) - ((Math.atan2(v[1] - cy, v[0] - cx) - Math.atan2(q[1], q[0]) + Math.PI * 4) % (Math.PI * 2)));
      return [[cx, cy], e1, ...corners, e2]; }); };

  // ───────── 受擊特效（DAMAGE）─────────
  // 每個特效：{ len: 持續秒數, shake(d), mech(d, B) → 機體變形, under(d, F/B)：畫在機體後面, over(d, B, fi)：畫在機體前面 }
  const DMG = {
    // 子彈亂數貫穿機體（E01_01、E02_01、E07_02、E03_03 小砲彈）
    pierce: o => { const n = o.n || 10, span = o.span || 0.9, T = hitTimes(n, span, o.seed || 11), col = o.col || YELLOW;
      return { len: span + 0.5, shake: d => jolt(d, T, o.shell ? 7 : 4),
        mech: d => ({ dx: -jolt(d, T, o.shell ? 9 : 5, 18), tint: T.some((ti, i) => i % 3 === 0 && d >= ti && d < ti + 0.035) ? WHITE : (d > 0 && d < span + 0.2 && Math.floor(d * 20) % 3 === 0 ? RED : null), tk: 0.25 }),
        over(d, B, fi) { const r = rng(o.seed || 11), pts = T.map(() => [B.x0 + B.w * (0.25 + 0.5 * r()), B.y0 + B.h * (0.18 + 0.62 * r())]);
          // 彈孔（沿機體外形）
          const every = n > 60 ? 4 : 1;
          this._onMech(fi, this._lastM, () => { pts.forEach((p, i) => { const a = d - T[i]; if (a < 0 || i % every) return;
            this._glow(p[0], p[1], o.shell ? 13 : 10, ORANGE, Math.max(0.45, 1.4 * Math.exp(-a * 3)));
            if (!(this._sprOn && this._holeSpr(p[0], p[1], o.shell ? 34 : 26, i + 1))) { this.ctx.fillStyle = 'rgba(20,10,8,0.9)'; this.ctx.beginPath(); this.ctx.arc(p[0], p[1], o.shell ? 8 : 6, 0, Math.PI * 2); this.ctx.fill(); } }); });
          pts.forEach((p, i) => { const a = d - T[i], sp = 4200;
            const head = p[0] + 40 - sp * a; if (a < -0.4) return;
            if (head > -200 && a < 0.25) { if (o.shell) this._shell(head, p[1] + (p[0] - head) * 0.02, col, 0.9); else bulletHead(this, head, p[1], 200, col, 8); }
            if (a >= 0 && o.hitSpr) this._vfx(o.hitSpr, p[0], p[1], { age: a, scale: o.hitScale || 0.3, anchor: o.hitAnchor || [0.5, 0.5], fps: 48 });
            if (a >= 0 && !(i % every)) { this._sparks(p[0], p[1], a, 10, 300 + i, 0, 1.0, 420, col);                    // 入口火花往後噴
              this._sparks(B.x0 + 4, p[1] + 6, a - 0.02, 12, 400 + i, Math.PI, 0.7, 620, col);           // 出口火花往左噴
              if (o.shell) this._explosion(p[0], p[1], a, 0.35, 500 + i, ORANGE); } }); } }; },
    // 刺刀插入機體（E01_02）
    stab: o => ({ len: 1.3, shake: d => jolt(d, [0], 10, 6) + jolt(d, [0.75], 6, 10),
      mech: d => ({ dx: -26 * smooth(0, 0.08, d) * (1 - smooth(0.75, 1.0, d)), rot: -3 * smooth(0, 0.1, d) * (1 - smooth(0.75, 1.0, d)), tint: d >= 0 && d < 0.06 ? WHITE : (d > 0.1 && d < 0.75 && Math.floor(d * 24) % 3 === 0 ? RED : null), tk: 0.45 }),
      over(d, B, fi) { const y = B.y0 + B.h * 0.42, depth = B.w * 0.32, ent = B.x1 - B.w * 0.18;
        let tip = d < 0 ? lerp(W + 40, ent, smooth(-0.2, 0, d)) : d < 0.75 ? ent - depth * smooth(0, 0.1, d) : ent - depth * (1 - smooth(0.75, 0.95, d)) + 600 * smooth(0.95, 1.2, d);
        if (d > 1.25) return;
        // 刺進去的部分要被機體擋住（只畫入口外面那段＋入口處的發紅裂口）
        const c = this.ctx; c.save(); c.beginPath(); c.rect(ent - 4, 0, W, H); c.clip();
        if (!(o.blade && this._vfx(o.blade, tip, y, { scale: o.bladeScale || 1.4, anchor: o.bladeAnchor || [0.08, 0.6], hold: true, blend: 'source-over' }))) this._spike(tip, y, 420, 15, [200, 210, 230], 0.6);
        c.restore();
        if (d >= 0) this._onMech(fi, this._lastM, () => { const k = d < 0.9 ? 1 : Math.exp(-(d - 0.9) * 3);
          this._glow(ent - depth * 0.5, y, depth * 0.35, RED, 0.8 * k); this._spike(tip, y, ent - tip, 9, [255, 120, 80], 0.2);
          c; this.ctx.strokeStyle = rgba([255, 200, 120], 0.8 * k); this.ctx.lineWidth = 2; for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; this.ctx.beginPath(); this.ctx.moveTo(ent, y); this.ctx.lineTo(ent + Math.cos(a) * 40 * smooth(0, 0.1, d), y + Math.sin(a) * 40 * smooth(0, 0.1, d)); this.ctx.stroke(); } });
        this._sparks(ent, y, d, 30, 61, 0, 1.4, 600, YELLOW); this._sparks(ent, y, d - 0.75, 26, 62, 0, 1.2, 700, ORANGE); } }),
    // 砲彈依序撞擊爆炸（E01_03 四發、E03_01 兩發同時、E03_02／E05_02 8～10 發、E07_04 20～30 小砲彈）
    shells: o => { const n = o.n || 4, span = o.span == null ? 0.9 : o.span, T = hitTimes(n, span, o.seed || 21, o.jitter == null ? 0.35 : o.jitter), pw = o.power || 1, col = o.col || ORANGE;
      return { len: span + 0.9, shake: d => jolt(d, T, 9 * pw, 7),
        mech: d => ({ dx: -jolt(d, T, 10 * pw, 12), tint: T.some((ti, i) => i % 3 === 0 && d >= ti && d < ti + 0.04) ? WHITE : (d > 0 && d < span + 0.5 && Math.floor(d * 24) % 3 === 0 ? RED : null), tk: 0.28 }),
        over(d, B, fi) { const r = rng(o.seed || 21), pts = T.map(() => [B.x0 + B.w * (0.2 + 0.6 * r()), B.y0 + B.h * (0.15 + 0.65 * r())]);
          this._onMech(fi, this._lastM, () => pts.forEach((p, i) => { const a = d - T[i]; if (a < 0) return;
            if (!(this._sprOn && this._holeSpr(p[0], p[1], 46 * pw, i + 3))) { this.ctx.fillStyle = rgba([25, 18, 15], 0.75); this.ctx.beginPath(); this.ctx.arc(p[0], p[1], 14 * pw, 0, Math.PI * 2); this.ctx.fill(); }
            this._glow(p[0], p[1], 12 * pw, ORANGE, Math.max(0.2, Math.exp(-a * 2))); }));
          pts.forEach((p, i) => { const a = d - T[i];
            if (a < 0 && a > -0.3) this._shell(p[0] + (-a) * 3000, p[1] - (o.arc ? (-a) * 900 : 0), YELLOW, o.small ? 0.7 : 1.2 * pw);
            if (!(o.hitSpr && a >= 0 && this._vfx(o.hitSpr, p[0], p[1], { age: a, scale: (o.hitScale || 0.55) * (o.small ? 0.6 : pw), fade: [0.5, 1.0] })))
              this._explosion(p[0], p[1], a, (o.small ? 0.45 : 0.9) * pw, 600 + i, col);
            else this._explosion(p[0], p[1], a - 0.2, 0.4 * pw, 600 + i, col); }); } }; },
    // X 光芒傷痕壓印（E02_02 紅黃、E04_01 紫）
    xscar: o => { const C1 = o.col || [255, 70, 40], C2 = o.col2 || YELLOW;
      return { len: 1.4, drawMechFn: o.split4 ? function (d, fi, M) { this._drawShatter(fi, M, X4, smooth(0.15, 0.45, d) * (1 - smooth(1.0, 1.4, d))); } : null, shake: d => jolt(d, [0, 0.12], 12, 7), mech: d => ({ dx: -14 * Math.exp(-Math.max(0, d) * 6) * (d > 0), tint: d >= 0 && d < 0.08 ? WHITE : null, tk: 0.6 }),
        over(d, B, fi) { const cx = B.cx, cy = B.y0 + B.h * 0.42, s = Math.min(B.w, B.h) * 0.42;
          if (o.stamp) { const V = this._vfxGet(o.stamp); if (V && d > -0.1) { const sc = (s * 2.4) / V.frames[0].height;
              this._vfx(o.stamp, cx, cy, { age: d + 0.1, scale: sc * (1 + 0.35 * (1 - smooth(-0.1, 0.1, d))), hold: true, fade: [0.9, 1.4] });
              this._sparks(cx, cy, d, 40, 71, 0, Math.PI, 700, C2); this._sparks(cx, cy, d - 0.12, 30, 72, 0, Math.PI, 600, C1); }
            return; }
          const strokes = [[cx + s, cy - s, cx - s, cy + s, 0], [cx + s, cy + s, cx - s, cy - s, 0.12]];
          strokes.forEach(([x0, y0, x1, y1, t0]) => { const a = d - t0; if (a < -0.1) return; const u = smooth(-0.1, 0.02, a);
            if (a < 0.25) { const f = 1 - smooth(0.05, 0.25, a); this._line(x0 - 60, y0 - 60 * Math.sign(y1 - y0) * -1, lerp(x0, x1, u), lerp(y0, y1, u), C1, 1.3 * f, 16); this._line(x0, y0, lerp(x0, x1, u), lerp(y0, y1, u), C2, 1.2 * f, 6); } });
          if (d >= 0) this._onMech(fi, this._lastM, () => { const f = d < 0.9 ? 1 : Math.exp(-(d - 0.9) * 2.5), c = this.ctx; c.globalCompositeOperation = 'lighter';
            strokes.forEach(([x0, y0, x1, y1, t0]) => { if (d < t0) return; c.lineCap = 'round';
              c.strokeStyle = rgba(C1, 0.85 * f); c.lineWidth = 22; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
              c.strokeStyle = rgba(C2, 0.95 * f); c.lineWidth = 7; c.stroke(); c.strokeStyle = rgba(WHITE, f); c.lineWidth = 2; c.stroke(); }); }, 'lighter');
          this._sparks(cx, cy, d, 40, 71, 0, Math.PI, 700, C2); this._sparks(cx, cy, d - 0.12, 30, 72, 0, Math.PI, 600, C1); } }; },
    // 龍捲風般的刀勢橫向切砍（E02_03、E08_02）
    tornadoSlash: o => { const col = o.col || [200, 235, 255], n = o.n || 5, RP = o.shatter ? randPieces(o.seed || 77, 7) : null;
      return { len: 1.3, drawMechFn: RP ? function (d, fi, M) { this._drawShatter(fi, M, RP, smooth(0.5, 0.8, d) * (1 - smooth(1.05, 1.3, d))); } : null, shake: d => d >= 0 && d < 1.0 ? 6 : 0, mech: d => ({ dx: d > 0 && d < 1 ? Math.sin(d * 60) * 5 : 0, tint: d > 0 && d < 1 && Math.floor(d * 30) % 3 === 0 ? WHITE : null, tk: 0.35 }),
        under(d, B) { if (!o.stamp) this._windSpiral(d, B, col, 0.5); },
        over(d, B, fi) { if (o.stamp) { const V = this._vfxGet(o.stamp); if (V && d > -0.2) this._vfx(o.stamp, B.cx, B.cy, { age: d + 0.2, scale: (B.h * (o.stampK || 1.25)) / V.frames[0].height, fade: [1.0, 1.3], fps: 30, hold: true, rot: o.spin ? d * o.spin : 0 }); }
          else this._windSpiral(d, B, col, 1);
          if (d >= 0) this._onMech(fi, this._lastM, () => { const c = this.ctx; c.globalCompositeOperation = 'lighter';
            for (let i = 0; i < n; i++) { const ti = i * 0.16, a = d - ti; if (a < 0) continue; const y = B.y0 + B.h * (0.2 + 0.6 * (i / (n - 1))), f = Math.exp(-a * 1.6);
              c.strokeStyle = rgba(col, 0.9 * f); c.lineWidth = 6; c.beginPath(); c.moveTo(B.x1, y + 8); c.quadraticCurveTo(B.cx, y - 14, B.x0, y + 10); c.stroke();
              c.strokeStyle = rgba(WHITE, f); c.lineWidth = 2; c.stroke(); } }, 'lighter');
          for (let i = 0; i < n; i++) this._sparks(B.cx, B.y0 + B.h * (0.2 + 0.6 * i / (n - 1)), d - i * 0.16, 14, 80 + i, Math.PI, 0.8, 520, col); } }; },
    // 雲爆彈：上方落下 → 全屏爆炸 → 機體多處爆炸（E04_02）
    fuelAir: o => ({ len: 1.8, shake: d => d >= 0.05 ? 26 * Math.exp(-(d - 0.05) * 2.5) : 0,
      mech: d => ({ dx: -40 * smooth(0.05, 0.3, d) * (1 - smooth(1.2, 1.7, d)), rot: -4 * smooth(0.05, 0.3, d) * (1 - smooth(1.2, 1.7, d)), tint: d > 0.05 && d < 1.2 ? (Math.floor(d * 20) % 2 ? RED : ORANGE) : null, tk: 0.32 }),
      under(d, B) { if (d < -0.45 || d > 0.08) return; const y = lerp(-80, B.y0 - 40, smooth(-0.45, 0.05, d)), c = this.ctx;
        if (!this._sprAt('S_fae_bomb', B.cx, y, 70)) { c.save(); c.fillStyle = '#2b2b30'; c.beginPath(); c.ellipse(B.cx, y, 18, 42, 0, 0, Math.PI * 2); c.fill(); c.restore(); } this._glow(B.cx, y - 50, 14, ORANGE, 0.8); },
      over(d, B, fi) { if (d < 0.05) return; const a = d - 0.05, c = this.ctx;
        if (a < 0.7) { const g = c.createRadialGradient(B.cx, B.y0, 0, B.cx, B.y0, 900 * smooth(0, 0.35, a) + 1);
          g.addColorStop(0, rgba(WHITE, 0.95 * (1 - a / 0.7))); g.addColorStop(0.35, rgba(YELLOW, 0.8 * (1 - a / 0.7))); g.addColorStop(1, rgba(ORANGE, 0.3 * (1 - a / 0.7)));
          c.fillStyle = g; c.fillRect(0, 0, W, H); }
        if (this._S('S_fae_boom') && a < 1.4) this._sprAt('S_fae_boom', B.cx, B.y1 - B.h * 0.35, B.h * 1.6 * (0.5 + 0.6 * smooth(0, 0.4, a)), { alpha: 1 - smooth(0.9, 1.4, a), ay: 0.6 });
        const r = rng(91); for (let i = 0; i < 12; i++) this._explosion(B.x0 + B.w * r(), B.y0 + B.h * r(), a - i * 0.07, 0.7, 900 + i, ORANGE);
        if (a < 0.08) { c.fillStyle = rgba(WHITE, 1 - a / 0.08); c.fillRect(0, 0, W, H); } } }),
    // 兩側空氣牆往中間擠壓（E04_03）
    airWalls: o => ({ len: 1.5, shake: d => d > 0 && d < 1.1 ? 7 : 0,
      mech: d => { const sq = smooth(-0.05, 0.25, d) * (1 - smooth(1.0, 1.3, d)); return { sx: 1 - 0.28 * sq + Math.sin(d * 50) * 0.02 * sq, sy: 1 + 0.08 * sq, tint: sq > 0.5 && Math.floor(d * 20) % 2 ? WHITE : null, tk: 0.3 }; },
      over(d, B, fi) { const c = this.ctx, sq = smooth(-0.35, 0.25, d) * (1 - smooth(1.0, 1.4, d)); if (sq <= 0.01) return;
        if (this._S('S_airwall')) { for (const side of [-1, 1]) { const x = side < 0 ? lerp(-260, B.x0 - 20, sq) : lerp(W + 260, B.x1 + 20, sq);
            this._sprAt('S_airwall', x, B.cy, B.h * 0.8, { alpha: 0.85 * sq, flipX: side < 0, sy: 1.5 }); } }
        else for (const side of [-1, 1]) { const x = side < 0 ? lerp(-260, B.x0 - 30, sq) : lerp(W + 260, B.x1 + 30, sq);
          const g = c.createLinearGradient(x - side * 220, 0, x, 0); g.addColorStop(0, 'rgba(220,240,255,0)'); g.addColorStop(1, rgba([220, 240, 255], 0.45 * sq));
          c.fillStyle = g; c.fillRect(Math.min(x, x - side * 220), 0, 220, H);
          for (let i = 0; i < 14; i++) { const r = rng(300 + i + (side > 0 ? 50 : 0)), y = r() * H, len = 60 + r() * 140, xx = x - side * r() * 180;
            this._line(xx, y, xx - side * len, y + Math.sin(d * 9 + i) * 6, [230, 245, 255], 0.5 * sq, 2); } }
        if (d > 0) this._onMech(fi, this._lastM, () => { const cc = this.ctx; cc.strokeStyle = 'rgba(20,15,15,0.8)'; cc.lineWidth = 2; const r = rng(330);
          for (let i = 0; i < 8; i++) { const x = B.x0 + B.w * r(), y = B.y0 + B.h * r(); cc.beginPath(); cc.moveTo(x, y); cc.lineTo(x + (r() - 0.5) * 50 * sq, y + (r() - 0.5) * 70 * sq); cc.stroke(); } }); } }),
    // 兩個螯爪虛影夾住機體擠碎（E05_01）
    claws: o => ({ len: 1.5, shake: d => jolt(d, [0, 0.45], 12, 6),
      mech: d => { const sq = smooth(0, 0.2, d) * (1 - smooth(1.0, 1.3, d)); return { sy: 1 - 0.18 * sq, sx: 1 + 0.06 * sq, dx: Math.sin(d * 70) * 4 * sq, tint: sq > 0.3 && Math.floor(d * 18) % 2 ? RED : null, tk: 0.45 }; },
      over(d, B, fi) { const op = 1 - smooth(-0.3, 0.05, d), a = smooth(-0.4, -0.15, d) * (1 - smooth(1.0, 1.4, d)), sz = Math.max(B.w, B.h) * 0.62;
        const hx = lerp(B.x1 + 260, B.x1 - B.w * 0.15, smooth(-0.4, -0.2, d)), hy = B.cy;     // 螯爪從右邊伸過來，在機體中段夾住
        if (this._S('S_claw')) { const w = Math.max(B.w * 1.5, B.h * 0.9), rx = lerp(W + w, B.x1 + B.w * 0.35, smooth(-0.4, -0.15, d)), sq = smooth(-0.1, 0.12, d);
          for (const up of [true, false]) this._sprAt('S_claw', rx, hy + (up ? -1 : 1) * B.h * (0.28 - 0.18 * sq), w, { alpha: a, ax: 0.95, ay: 0.55, flipY: !up, rot: (up ? -1 : 1) * (0.25 - 0.25 * sq) }); }
        else { this._claw(hx, hy, sz, op, true, [120, 220, 200], a); this._claw(hx, hy, sz, op, false, [120, 220, 200], a); }
        if (d >= 0) this._onMech(fi, this._lastM, () => { const c = this.ctx, r = rng(510), g = smooth(0, 0.5, d); c.strokeStyle = 'rgba(10,8,8,0.9)'; c.lineWidth = 3;
          for (let i = 0; i < 12; i++) { let x = B.cx + (r() - 0.5) * B.w * 0.5, y = B.cy + (r() - 0.5) * B.h * 0.5; c.beginPath(); c.moveTo(x, y);
            for (let j = 0; j < 3; j++) { x += (r() - 0.5) * 70 * g; y += (r() - 0.5) * 70 * g; c.lineTo(x, y); } c.stroke(); } });
        this._sparks(B.cx, B.y0 + B.h * 0.2, d, 26, 520, -Math.PI / 2, 1.4, 500, YELLOW); this._sparks(B.cx, B.y1 - B.h * 0.2, d, 26, 521, Math.PI / 2, 1.4, 500, YELLOW); } }),
    // 電光球從上方落下、機體麻痺（E05_03）；電流從下往上貫穿麻痺（E07_01）
    electric: o => { const n = o.n || 5, up = o.dir === 'up', T = up ? [0, 0.15, 0.3] : hitTimes(n, 0.6, 31);
      return { len: 1.8, shake: d => d >= 0 && d < 1.5 ? 5 * (1 - d / 1.5) + 2 : 0,
        mech: d => ({ dx: d > 0 && d < 1.5 ? Math.sin(d * 90) * 3 : 0, tint: d > 0 && d < 1.6 && Math.floor(d * 24) % 2 ? ELEC : (d >= 0 && d < 0.05 ? WHITE : null), tk: 0.55 }),
        under(d, B) { if (up && d > -0.1 && d < 1.2) { const c = this.ctx, g = c.createLinearGradient(0, B.y1, 0, B.y1 - 40); g.addColorStop(0, rgba(ELEC, 0.6)); g.addColorStop(1, rgba(ELEC, 0)); c.fillStyle = g; c.fillRect(B.x0 - 120, B.y1 - 40, B.w + 240, 60); } },
        over(d, B, fi) { const r = rng(32);
          if (!up) T.forEach((ti, i) => { const x = B.x0 + B.w * (0.2 + 0.6 * r()), a = d - ti; if (a < -0.4 || a > 0.4) return;
            const y = a < 0 ? lerp(-60, B.y0 + B.h * 0.2, smooth(-0.4, 0, a)) : B.y0 + B.h * 0.2;
            if (!this._sprAt('S_eorb', x, y, 110 * (a < 0 ? 1 : 1 - a / 0.4))) this._glow(x, y, 26 * (a < 0 ? 1 : 1 - a / 0.4), ELEC, 1.2); if (a >= 0 && a < 0.15) this._bolt(x, y, x + (r() - 0.5) * 80, B.y1, 340 + i + Math.floor(d * 30), ELEC, 1, 3); });
          const BG = o.big || 1, TT = BG > 1 ? [0, 0.08, 0.15, 0.22, 0.3, 0.38] : T;
          if (up) TT.forEach((ti, i) => { const a = d - ti; if (a < 0 || a > 1.2) return; const x = B.cx + B.w * (r() - 0.5) * 0.4 * BG * 1.6, u = smooth(0, 0.18, a);
            this._bolt(x, B.y1 + 20 * BG, x + (r() - 0.5) * 60 * BG, lerp(B.y1, B.y0 - 80 * BG, u), 360 + i * 7 + Math.floor(d * 24), ELEC, 1.2 * (1 - smooth(0.6, 1.2, a)), 4 * BG, 12, 30 * BG); });
          if (up && BG > 1 && d > 0 && d < 1.2) this._glow(B.cx, B.cy, Math.max(B.w, B.h) * 0.55, ELEC, 0.5 * (1 - smooth(0.8, 1.2, d)));
          if (d >= 0 && d < 1.7) this._onMech(fi, this._lastM, () => { const k = 1 - smooth(1.2, 1.7, d);
            for (let i = 0; i < 9; i++) { const rr = rng(380 + i + Math.floor(d * 20) * 13); const x0 = B.x0 + B.w * rr(), y0 = B.y0 + B.h * rr();
              this._bolt(x0, y0, x0 + (rr() - 0.5) * 160 * (o.big || 1), y0 + (rr() - 0.5) * 160 * (o.big || 1), 390 + i + Math.floor(d * 20), ELEC, k, 2 * (o.big || 1), 6, 14); } }, 'lighter'); } }; },
    // 水勢火焰交錯的圓柱從右往左撞擊爆炸（E05_04）
    waterFire: o => ({ len: 1.4, shake: d => jolt(d, [0], 18, 4),
      mech: d => ({ dx: -36 * smooth(0, 0.15, d) * (1 - smooth(0.9, 1.3, d)), tint: d >= 0 && d < 0.6 ? (Math.floor(d * 20) % 2 ? ORANGE : [80, 160, 255]) : null, tk: 0.45 }),
      over(d, B, fi) { const y = B.y0 + B.h * 0.45, head = d < 0 ? lerp(W + 50, B.x1 - 20, smooth(-0.3, 0, d)) : B.x1 - 20, f = 1 - smooth(0.5, 0.9, d);
        if (d > -0.3 && f > 0.01 && this._sprBeam('S_waterfire', W + 80, y, head, y, 150 * (o.thick || 1), f)) {}
        else if (d > -0.3 && f > 0.01) for (let i = 0; i < 80; i++) { const u = i / 80, x = lerp(W + 50, head, u), ang = u * 26 - d * 30;
          this._glow(x, y + Math.sin(ang) * 46, 16, [80, 170, 255], 0.5 * f); this._glow(x, y + Math.sin(ang + Math.PI) * 46, 16, ORANGE, 0.5 * f); }
        this._explosion(B.cx + B.w * 0.15, y, d, 1.4, 940, ORANGE); this._sparks(B.x1, y, d, 40, 941, 0, 1.2, 600, [150, 220, 255]); } }),
    // 撕咬：機體從畫面中間被咬住拖到最左邊（E06_01）
    bite: o => ({ len: 1.5, shake: d => jolt(d, [0], 12, 5),
      mech: d => ({ dx: -(this_cx_holder.v - 170) * smooth(0.05, 0.75, d) * (1 - smooth(1.15, 1.45, d)), rot: -8 * smooth(0.05, 0.4, d) * (1 - smooth(1.15, 1.45, d)), tint: d > 0 && d < 1.1 && Math.floor(d * 16) % 2 ? RED : null, tk: 0.4 }),
      over(d, B, fi) { const jx = B.cx + this._lastM.dx, jy = B.y0 + B.h * 0.35, cl = smooth(-0.15, 0.05, d), a = smooth(-0.3, -0.1, d) * (1 - smooth(1.0, 1.3, d)), c = this.ctx;
        if (a > 0.01) this._jaws(jx, jy, B.w * 0.75, cl, a);
        if (d >= 0) this._onMech(fi, this._lastM, () => { for (let i = 0; i < 10; i++) { const x = B.x0 + B.w * (0.1 + i * 0.08); for (const s of [-1, 1]) {
          this.ctx.fillStyle = 'rgba(15,5,10,0.85)'; this.ctx.beginPath(); this.ctx.moveTo(x, jy + s * 25); this.ctx.lineTo(x + 8, jy + s * 50); this.ctx.lineTo(x + 16, jy + s * 25); this.ctx.fill(); } } });
        if (d > 0.05 && d < 0.8) for (let i = 0; i < 3; i++) this._sparks(jx + 120, B.y1 - 10, d - 0.05 - i * 0.2, 14, 1000 + i, 0, 0.6, 400, YELLOW); } }),
    // 依序出現犬影衝撞粉碎（E06_02 三道；E06_05 無數道）
    dogs: o => { const n = o.n || 3, span = o.span || 0.8, T = hitTimes(n, span, o.seed || 41, o.crack ? 0.6 : 0);
      return { len: span + 0.9, shake: d => jolt(d, T, n > 5 ? 6 : 11, 8),
        mech: d => ({ dx: -jolt(d, T, n > 5 ? 8 : 16, 10), tint: T.some((ti, i) => i % 2 === 0 && d >= ti && d < ti + 0.05) ? WHITE : (d > 0 && d < span + 0.3 && Math.floor(d * 20) % 3 === 0 ? PURPLE : null), tk: 0.32 }),
        under(d, B) { if (o.crack) this._spaceCrack(B.x1 + 220, B.y0 - 10, smooth(-0.5, -0.2, d) * (1 - smooth(span + 0.4, span + 0.8, d)), 1200, 260); },
        over(d, B, fi) { const r = rng(o.seed || 41);
          T.forEach((ti, i) => { const a = d - ti, yy = B.y0 + B.h * (0.35 + (n > 3 ? (r() - 0.5) * 0.5 : 0)), sx = o.crack ? B.x1 + 220 : W + 200;
            if (a > -0.25 && a < 0) this._dogGhost(lerp(sx, B.cx, smooth(-0.25, 0, a)), lerp(o.crack ? B.y0 : yy, yy, smooth(-0.25, 0, a)), B.h * 0.6, 1);
            this._shards(B.cx, yy, a, n > 5 ? 10 : 24, 1300 + i, PURPLE, 600, n > 5 ? 8 : 12); });
          if (d >= 0) this._onMech(fi, this._lastM, () => { const c = this.ctx, rr = rng(1400); c.strokeStyle = rgba([200, 140, 255], 0.9); c.lineWidth = 3;
            T.forEach((ti, i) => { if (d < ti) return; const x = B.x0 + B.w * rr(), y = B.y0 + B.h * rr(); for (let k = 0; k < 3; k++) { c.beginPath(); c.moveTo(x + k * 12, y); c.lineTo(x - 50 + k * 12, y + 70); c.stroke(); } }); }, 'lighter'); } }; },
    // 紫色箭簇依序插入貫穿（E06_03 16 道）
    arrows: o => { const n = o.n || 16, T = hitTimes(n, 1.0, 51);
      return { len: 1.5, shake: d => jolt(d, T, 4), mech: d => ({ dx: -jolt(d, T, 5, 16), tint: T.some((ti, i) => i % 3 === 0 && d >= ti && d < ti + 0.04) ? PURPLE : null, tk: 0.35 }),
        over(d, B, fi) { const r = rng(52);
          T.forEach((ti, i) => { const y = B.y0 + B.h * (0.15 + 0.7 * r()), ent = B.x1 - B.w * (0.1 + 0.2 * r()), a = d - ti;
            if (a < -0.2) return; const tip = a < 0 ? lerp(W + 60, ent, smooth(-0.2, 0, a)) : ent - B.w * 0.55 - 2000 * Math.max(0, a - 0.05);
            if (a < 0.4) { const c = this.ctx; c.save(); if (a >= 0) { c.beginPath(); c.rect(ent - 2, 0, W, H); c.clip(); } this._spike(tip, y, 160, 7, PURPLE, 0.8); c.restore(); }
            if (a >= 0) { this._sparks(ent, y, a, 8, 530 + i, 0, 0.9, 420, PURPLE); this._sparks(B.x0, y, a - 0.03, 8, 560 + i, Math.PI, 0.6, 600, PURPLE); } });
          if (d >= 0) this._onMech(fi, this._lastM, () => { const rr = rng(52); T.forEach(ti => { const y = B.y0 + B.h * (0.15 + 0.7 * rr()), ent = B.x1 - B.w * (0.1 + 0.2 * rr());
            if (d >= ti) this._glow(ent, y, 7, PURPLE, Math.max(0.3, Math.exp(-(d - ti) * 3))); }); }); } }; },
    // 空間碎裂、紫光從右上往左下貫穿（E06_04）
    voidBeam: o => ({ len: 1.5, shake: d => d >= 0 && d < 0.9 ? 14 * (1 - d / 0.9) + 3 : 0,
      mech: d => ({ dx: -20 * smooth(0, 0.1, d) * (1 - smooth(0.9, 1.3, d)), tint: d >= 0 && d < 0.9 ? (Math.floor(d * 24) % 3 === 0 ? WHITE : PURPLE) : null, tk: 0.35 }),
      under(d, B) { this._spaceCrack(W - 140, 90, smooth(-0.5, -0.25, d) * (1 - smooth(1.0, 1.4, d)), 1500, 220); },
      over(d, B) { const f = smooth(-0.22, -0.05, d) * (1 - smooth(0.7, 1.0, d)); if (f <= 0.01) return;
        const x0 = W - 140, y0 = 90, k2 = 1.9, x1 = x0 + (B.cx - x0) * k2, y1 = y0 + (B.cy - y0) * k2, u = smooth(-0.22, -0.02, d);
        if (!this._sprBeam('S_purple_beam', x0, y0, lerp(x0, x1, u), lerp(y0, y1, u), 120, f)) { this._line(x0, y0, lerp(x0, x1, u), lerp(y0, y1, u), PURPLE, 1.3 * f, 70); this._line(x0, y0, lerp(x0, x1, u), lerp(y0, y1, u), WHITE, 1.1 * f, 22); }
        if (d >= 0) { this._glow(B.cx, B.cy, 70, PURPLE, 1.2 * f); this._shards(B.cx, B.cy, d, 30, 1550, PURPLE, 700, 12); } } }),
    // 由粗到細的風柱直撞穿刺（E08_01）
    windSpear: o => ({ len: 1.2, shake: d => jolt(d, [0], 14, 5),
      mech: d => ({ dx: -30 * smooth(0, 0.12, d) * (1 - smooth(0.8, 1.1, d)), tint: d >= 0 && d < 0.08 ? WHITE : null, tk: 0.5 }),
      over(d, B) { const y = B.y0 + B.h * 0.42, f = smooth(-0.25, -0.1, d) * (1 - smooth(0.5, 0.8, d)); if (f <= 0.01) return;
        const tip = d < 0 ? lerp(W + 40, B.x1, smooth(-0.25, 0, d)) : B.x0 - 300 * smooth(0, 0.15, d), c = this.ctx;
        if (this._sprBeam('S_windlance', W + 60, y, tip, y, 220, f * (o.alpha || 1))) { if (d >= 0) { this._sparks(B.x1, y, d, 30, 1650, 0, 1.4, 600, [210, 240, 255]); this._sparks(B.x0, y, d, 30, 1651, Math.PI, 0.7, 800, [210, 240, 255]); } return; }
        c.save(); c.globalCompositeOperation = 'lighter'; const g = c.createLinearGradient(tip, 0, W, 0); g.addColorStop(0, rgba(WHITE, 0.75 * f)); g.addColorStop(1, rgba([170, 230, 255], 0.2 * f));
        c.fillStyle = g; c.beginPath(); c.moveTo(tip, y); c.lineTo(W + 40, y - 70); c.lineTo(W + 40, y + 70); c.closePath(); c.fill();
        for (let i = 0; i < 10; i++) { const r = rng(1600 + i), yy = y + (r() - 0.5) * 220 * ((W - tip) / W); this._line(W, yy, tip + 60, y + (yy - y) * 0.1, [210, 240, 255], 0.5 * f, 2); }
        c.restore(); if (d >= 0) { this._sparks(B.x1, y, d, 30, 1650, 0, 1.4, 600, [210, 240, 255]); this._sparks(B.x0, y, d, 30, 1651, Math.PI, 0.7, 800, [210, 240, 255]); } } }),
    // 槍勢衝刺（E08_03 貫穿；E08_05 粗壯黃色衝撞＋爆炸）
    spear: o => { const col = o.col || [220, 230, 255], thick = o.thick || 1;
      return { len: 1.2, shake: d => jolt(d, [0], 12 * thick, 5),
        mech: d => ({ dx: -(30 + 30 * thick) * smooth(0, 0.1, d) * (1 - smooth(0.8, 1.1, d)), tint: d >= 0 && d < 0.08 ? WHITE : null, tk: 0.55 }),
        over(d, B, fi) { const y = B.y0 + B.h * 0.4, f = 1 - smooth(0.4, 0.7, d); if (d < -0.18 || f <= 0.01) return;
          const tip = d < 0 ? lerp(W + 60, B.x1, smooth(-0.18, 0, d)) : (o.pierce ? B.x0 - 260 * smooth(0, 0.1, d) : B.x1 - 30);
          this._spear(tip, y, thick, col, f);
          if (d >= 0) { this._sparks(B.x1, y, d, 34, 1700, 0, 1.3, 650, col); if (o.pierce) this._sparks(B.x0, y, d, 26, 1701, Math.PI, 0.6, 800, col);
            if (o.boom) this._explosion(B.cx + B.w * 0.2, y, d - 0.05, 1.3, 1702, col); } } }; },
    // 尖銳細針亂數穿刺（E08_04 九道）
    needles: o => { const n = o.n || 9, T = hitTimes(n, 0.8, 61);
      return { len: 1.3, shake: d => jolt(d, T, 4), mech: d => ({ dx: -jolt(d, T, 4, 18), tint: T.some((ti, i) => i % 3 === 0 && d >= ti && d < ti + 0.04) ? WHITE : null, tk: 0.25 }),
        over(d, B, fi) { const r = rng(62); T.forEach((ti, i) => { const y0 = B.y0 + B.h * (0.1 + 0.8 * r()), ang = (r() - 0.5) * 0.5, a = d - ti; if (a < -0.15 || a > 0.5) return;
          const u = smooth(-0.15, 0.05, a), x = lerp(W + 40, B.x0 - 120, u), y = y0 + (x - B.cx) * Math.tan(ang);
          if (!this._sprBeam('S_needle', x + 240, y - 240 * Math.tan(ang), x, y, 34, 1 - smooth(0.2, 0.5, a))) this._line(x, y, x + 200, y - 200 * Math.tan(ang), [235, 240, 255], 1.1 * (1 - smooth(0.2, 0.5, a)), 2);
          if (a >= 0) this._sparks(B.x1 - 10, y0 + (B.x1 - B.cx) * Math.tan(ang), a, 8, 630 + i, 0, 0.8, 380, WHITE); }); } }; },
    // 18 道冰晶覆蓋 → 冰凍（E08_06）
    iceCover: o => { const n = o.n || 18, T = hitTimes(n, 0.8, 71);
      return { len: 1.8, shake: d => jolt(d, T, 3), mech: d => ({ tint: d > 0 ? ICE : null, tk: 0.55 * smooth(0, 1.0, d) }),
        over(d, B, fi) { const r = rng(72), pts = T.map(() => [B.x0 + B.w * (0.15 + 0.75 * r()), B.y0 + B.h * (0.1 + 0.8 * r())]);
          pts.forEach((p, i) => { const a = d - T[i]; if (a < -0.2) return; const x = a < 0 ? lerp(W + 40, p[0], smooth(-0.2, 0, a)) : p[0];
            if (a < 0) this._spike(x, p[1], 60, 10, ICE, 0.6); else this._sparks(p[0], p[1], a, 6, 720 + i, 0, 1.2, 300, ICE); });
          // 冰晶黏在機體上，最後整台結霜
          this._onMech(fi, this._lastM, () => { const c = this.ctx; pts.forEach((p, i) => { if (d < T[i]) return;
            if (this._sprAt('S_iceshard', p[0] + 20, p[1], 80, { rot: (i % 5 - 2) * 0.25, ax: 0.15 })) return; c.fillStyle = rgba([230, 248, 255], 0.9);
            c.beginPath(); c.moveTo(p[0], p[1] - 22); c.lineTo(p[0] + 12, p[1]); c.lineTo(p[0], p[1] + 18); c.lineTo(p[0] - 10, p[1]); c.closePath(); c.fill(); });
            const fr = smooth(0.6, 1.3, d); if (fr > 0) { c.fillStyle = rgba([210, 240, 255], 0.55 * fr); c.fillRect(0, 0, W, H);
              c.strokeStyle = rgba(WHITE, 0.7 * fr); c.lineWidth = 2; for (let i = 0; i < 8; i++) { const x = B.x0 + B.w * i / 8; c.beginPath(); c.moveTo(x, B.y0); c.lineTo(x - B.h * 0.3, B.y1); c.stroke(); } } }); } }; },
    // 無數白色槍勢由上到下、由右到左撕裂 → 碎裂（E08_07）
    spearStorm: o => ({ len: 1.9, shake: d => d >= 0 && d < 1.4 ? 9 : 0,
      mech: d => ({ alpha: 1 - smooth(1.25, 1.35, d), tint: d > 0 && Math.floor(d * 24) % 3 === 0 ? WHITE : null, tk: 0.3, dx: Math.sin(d * 70) * 4 * (d > 0 && d < 1.3) }),
      over(d, B, fi) { for (let i = 0; i < 40; i++) { const r = rng(1800 + i), ti = r() * 1.1, a = d - ti; if (a < -0.15 || a > 0.12) continue;
          const u = smooth(-0.15, 0.12, a), x0 = B.x1 + 300 + r() * 300, y0 = B.y0 - 300 - r() * 200, x1 = B.x0 - 200 + r() * 200, y1 = B.y1 + 100 - r() * 200;
          if (!this._sprBeam('S_lance', lerp(x0, x1, u - 0.35), lerp(y0, y1, u - 0.35), lerp(x0, x1, u), lerp(y0, y1, u), 40, 0.95)) this._line(lerp(x0, x1, u - 0.25), lerp(y0, y1, u - 0.25), lerp(x0, x1, u), lerp(y0, y1, u), WHITE, 1.2, 4); }
        if (d >= 0 && d < 1.3) this._onMech(fi, this._lastM, () => { const c = this.ctx; c.strokeStyle = rgba(WHITE, 0.9); c.lineWidth = 3;
          for (let i = 0; i < 40; i++) { const r = rng(1800 + i), ti = r() * 1.1; if (d < ti) continue; const x = B.x0 + B.w * r(), y = B.y0 + B.h * r(); c.beginPath(); c.moveTo(x + 40, y - 40); c.lineTo(x - 40, y + 40); c.stroke(); } }, 'lighter');
        if (d >= 1.3) { const a = d - 1.3; this._shards(B.cx, B.cy, a, 50, 1900, [200, 210, 225], 700, 22); this._shards(B.cx, B.cy, a, 30, 1901, WHITE, 900, 10);
          if (a < 0.1) { this.ctx.fillStyle = rgba(WHITE, 0.8 * (1 - a / 0.1)); this.ctx.fillRect(0, 0, W, H); } } } }),
    // 地震：畫面上下跳動、機體彈跳、下半身碎裂（E07_03）
    quake: o => ({ len: 2.0, shake: () => 0, screenY: d => d >= 0 && d < 1.6 ? Math.abs(Math.sin(d * 24)) * -26 * (1 - d / 1.6) : 0,
      mech: d => ({ dy: d >= 0 && d < 1.4 ? -Math.abs(Math.sin(d * 12)) * 60 * (1 - d / 1.4) : 0, clip: d > 0.55 ? (c, B) => c.rect(0, 0, W, B.y0 + B.h * 0.58) : null }),
      over(d, B, fi) { if (d <= 0.55) return; const a = d - 0.55, c = this.ctx, r = rng(2000), cut = B.y0 + B.h * 0.58;
        for (let k = 0; k < 10; k++) { const x0 = B.x0 + B.w * k / 10, wd = B.w / 10, vx = (r() - 0.5) * 300, vy = -80 - r() * 160, rot = (r() - 0.5) * 6;
          c.save(); c.translate(x0 + wd / 2 + vx * a, (cut + B.y1) / 2 + vy * a + 600 * a * a); c.rotate(rot * a); c.translate(-(x0 + wd / 2), -(cut + B.y1) / 2);
          c.beginPath(); c.rect(x0, cut, wd, B.y1 - cut); c.clip(); this._drawFrame(fi, 1 - smooth(0.6, 1.1, a)); c.restore(); }
        this._sparks(B.cx, cut, a, 40, 2001, 0, Math.PI, 600, ORANGE); if (a < 0.4) this._explosion(B.cx, cut, a, 0.9, 2002, ORANGE);
        if (this._S('S_rocks')) for (let k = 0; k < 4; k++) { const rr = rng(2010 + k), vx = (rr() - 0.5) * 500, vy = -300 - rr() * 300;
          this._sprAt('S_rocks', B.cx + vx * a, B.y1 + vy * a + 700 * a * a, 160 + 80 * rr(), { rot: a * (rr() * 6 - 3), alpha: 1 - smooth(0.8, 1.3, a) }); } } }),
    // 騰空後往下方壓縮破裂（E07_05）
    gravCrush: o => ({ len: 1.8, shake: d => jolt(d, [0.5], 20, 5),
      mech: d => { const lift = smooth(0, 0.4, d) * (1 - smooth(0.42, 0.52, d)), crush = smooth(0.48, 0.6, d) * (1 - smooth(1.4, 1.7, d));
        return { dy: -150 * lift, sy: 1 - 0.38 * crush, sx: 1 + 0.12 * crush, tint: crush > 0.2 && Math.floor(d * 18) % 2 ? RED : (lift > 0.1 ? PURPLE : null), tk: 0.4 }; },
      under(d, B) { const k = smooth(-0.1, 0.2, d) * (1 - smooth(1.4, 1.8, d)), c = this.ctx; if (k <= 0.01) return; c.save(); c.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 4; i++) { const yy = B.y1 - i * 46 - (d < 0.5 ? 0 : 0);
          if (!this._sprAt('S_gravring', B.cx, yy, B.w * 1.5, { alpha: 0.85 * k, sy: 0.3, rot: 0 })) { c.strokeStyle = rgba(PURPLE, 0.8 * k); c.lineWidth = 4; c.beginPath(); c.ellipse(B.cx, yy, B.w * 0.75, 18, 0, 0, Math.PI * 2); c.stroke(); } } c.restore(); },
      over(d, B, fi) { if (d > 0.5) { this._onMech(fi, this._lastM, () => { const c = this.ctx, r = rng(2100), g = smooth(0.5, 0.8, d); c.strokeStyle = 'rgba(10,8,8,0.9)'; c.lineWidth = 3;
          for (let i = 0; i < 14; i++) { let x = B.x0 + B.w * r(), y = B.y0 + B.h * r(); c.beginPath(); c.moveTo(x, y); for (let j = 0; j < 3; j++) { x += (r() - 0.5) * 80 * g; y += (r() - 0.5) * 40 * g; c.lineTo(x, y); } c.stroke(); } });
        this._sparks(B.cx, B.y1, d - 0.5, 40, 2101, 0, Math.PI, 700, ORANGE); this._explosion(B.cx, B.y1 - 20, d - 0.5, 0.8, 2102, ORANGE); } } }),
    // 金色火焰光波貫穿爆炸（E07_06）
    goldBeam: o => ({ len: 1.6, shake: d => d >= 0 && d < 1.0 ? 16 * (1 - d) + 4 : 0,
      mech: d => ({ dx: -40 * smooth(0, 0.2, d) * (1 - smooth(1.1, 1.5, d)), tint: d >= 0 && d < 1.0 ? (Math.floor(d * 24) % 3 === 0 ? WHITE : GOLD) : null, tk: 0.35 }),
      over(d, B) { const y = B.y0 + B.h * 0.45, f = smooth(-0.25, -0.05, d) * (1 - smooth(0.85, 1.15, d)); if (f > 0.01) { const head = d < 0 ? lerp(W + 60, B.x1, smooth(-0.25, 0, d)) : -100;
          if (this._sprBeam('S_goldbeam', W + 80, y, head, y, 170 * (o.thick || 1), f)) {} else { this._line(W + 60, y, head, y, GOLD, 1.1 * f, 46); this._line(W + 60, y, head, y, WHITE, 1.0 * f, 14); }
          if (!this._S('S_goldbeam')) for (let i = 0; i < 40; i++) { const r = rng(2200 + i), u = ((d * 2 + r()) % 1), x = lerp(W + 60, Math.max(head, -100), u), yy = y + (r() - 0.5) * 90;
            this._glow(x, yy, 10 + r() * 14, ORANGE, 0.7 * f); } }
        this._explosion(B.cx, y, d - 0.35, 1.8, 2250, GOLD); } }),
    // 音爆（E04_03）：戰機超音速掠過 → 音錐白霧 → 空氣牆（衝擊波面）從右往左橫掃穿過機體，裝甲被壓裂、碎片飛散
    sonicBoom: o => ({ len: 1.6, shake: d => d >= 0 ? 20 * Math.exp(-d * 3) : 0,
      mech: d => { const hit = smooth(0.0, 0.08, d) * (1 - smooth(0.5, 0.9, d)); return { dx: -60 * hit, sx: 1 - 0.18 * hit, tint: d > 0 && d < 0.6 && Math.floor(d * 24) % 2 ? WHITE : null, tk: 0.35 }; },
      under(d, B) { if (d > -0.55 && d < -0.1) { const u = smooth(-0.55, -0.1, d), x = lerp(W + 300, -300, u), y = B.y0 - 60, c = this.ctx;   // 戰機掠過的音錐
          this._sprAt('S_airwall', x + 90, y, 220, { alpha: 0.8, sy: 0.9 }); this._line(x, y, x + 520, y, WHITE, 0.6, 3); } },
      over(d, B, fi) { const c = this.ctx;
        if (d > -0.12 && d < 0.6) { const u = smooth(-0.12, 0.35, d), x = lerp(W + 250, B.x0 - 380, u), a = 1 - smooth(0.4, 0.6, d);   // 空氣牆：一道直立的透明衝擊波面
          this._sprAt('S_airwall', x, B.cy, B.h * 1.0, { alpha: 0.9 * a, sy: 2.4 });
          c.save(); c.globalCompositeOperation = 'lighter'; c.strokeStyle = rgba(WHITE, 0.6 * a); c.lineWidth = 6; c.beginPath(); c.ellipse(x + 40, B.cy, 60, B.h * 0.95, 0, 0, Math.PI * 2); c.stroke(); c.restore();
          for (let i = 0; i < 12; i++) { const r = rng(330 + i), yy = B.y0 + B.h * r(); this._line(x + 60, yy, x + 260 + r() * 200, yy, [230, 245, 255], 0.5 * a, 2); } }
        if (d > 0.05 && d < 0.3) { c.fillStyle = rgba(WHITE, 0.35 * (1 - (d - 0.05) / 0.25)); c.fillRect(0, 0, W, H); }   // 音爆白閃
        if (d > 0.08) this._onMech(fi, this._lastM, () => { const cc = this.ctx, r = rng(331), g = smooth(0.08, 0.3, d); cc.strokeStyle = 'rgba(15,10,10,0.9)'; cc.lineWidth = 3;
          for (let i = 0; i < 14; i++) { let x = B.x1 - B.w * 0.1 * r(), y = B.y0 + B.h * r(); cc.beginPath(); cc.moveTo(x, y); for (let j = 0; j < 4; j++) { x -= (20 + r() * 50) * g; y += (r() - 0.5) * 40 * g; cc.lineTo(x, y); } cc.stroke(); } });
        if (d > 0.1) { this._shards(B.cx, B.cy, d - 0.1, 30, 340, [190, 195, 205], 800, 14); if (this._S('S_debris')) this._sprAt('S_debris', B.x0 - 120 * (d - 0.1) * 3, B.cy, 220, { alpha: 1 - smooth(0.6, 1.0, d), rot: d * 3 }); } } }),
    // 四方犬影匯聚（E06_05）：右上、左上、右下、左下四個方向的紫色犬影輪流撲向機體
    dogs4: o => { const n = o.n || 12, span = o.span || 1.1, T = hitTimes(n, span, o.seed || 43, 0);
      const DIRS = [[1, -1], [-1, -1], [1, 1], [-1, 1]];
      return { len: span + 0.9, shake: d => jolt(d, T, 7, 8),
        mech: d => ({ dx: Math.sin(d * 50) * 5 * (d > 0 && d < span + 0.2), tint: T.some((ti, i) => i % 2 === 0 && d >= ti && d < ti + 0.05) ? WHITE : (d > 0 && d < span + 0.3 && Math.floor(d * 20) % 3 === 0 ? PURPLE : null), tk: 0.32 }),
        under(d, B) { [[W - 120, 80], [120, 80], [W - 120, H - 120], [120, H - 120]].forEach((q, i) => this._spaceCrack(q[0], q[1], smooth(-0.5, -0.2, d) * (1 - smooth(span + 0.4, span + 0.8, d)), 1210 + i, 200)); },
        over(d, B, fi) { T.forEach((ti, i) => { const a = d - ti, [sx, sy] = DIRS[i % 4], x0 = B.cx + sx * 900, y0 = B.cy + sy * 520;
            if (a > -0.25 && a < 0) { const u = smooth(-0.25, 0, a); this._dogDir(lerp(x0, B.cx, u), lerp(y0, B.cy, u), -sx, -sy, B.h * 0.32, 1); }
            this._shards(B.cx, B.cy, a, 16, 1310 + i, PURPLE, 600, 10); });
          if (d >= 0) this._onMech(fi, this._lastM, () => { const c = this.ctx, rr = rng(1410); c.strokeStyle = rgba([200, 140, 255], 0.9); c.lineWidth = 3;
            T.forEach((ti, i) => { if (d < ti) return; const x = B.x0 + B.w * rr(), y = B.y0 + B.h * rr(), [sx, sy] = DIRS[i % 4]; for (let k = 0; k < 3; k++) { c.beginPath(); c.moveTo(x + k * 12, y); c.lineTo(x + k * 12 - sx * 50, y - sy * 60); c.stroke(); } }); }, 'lighter'); } }; },
    // 由下而上逐層碎裂（E07_03）：地震把機體震起，從腳開始一層一層碎掉往外噴
    quakeLayers: o => { const NL = 6, t0 = 0.45, step = 0.13;
      return { len: 2.2, shake: () => 0, screenY: d => d >= 0 && d < 1.6 ? Math.abs(Math.sin(d * 24)) * -26 * (1 - d / 1.6) : 0,
        mech: d => ({ dy: d >= 0 && d < 1.4 ? -Math.abs(Math.sin(d * 12)) * 50 * (1 - d / 1.4) : 0,
          alpha: d > 1.6 && d < 1.75 ? 0 : 1, clip: d > t0 && d < 1.75 ? (c, B) => { const k = clamp(Math.floor((d - t0) / step) + 1, 0, NL - 2); c.rect(0, 0, W, B.y1 - B.h * k / NL); } : null }),
        over(d, B, fi) { const c = this.ctx;
          for (let L = 0; L < NL - 1; L++) { const tl = t0 + L * step, a = d - tl; if (a < 0) continue; const y1 = B.y1 - B.h * L / NL, y0 = y1 - B.h / NL;
            for (let k = 0; k < 6; k++) { const r = rng(2000 + L * 10 + k), x0 = B.x0 + B.w * k / 6, wd = B.w / 6, vx = (r() - 0.5) * 500, vy = -150 - r() * 250, rot = (r() - 0.5) * 8;
              c.save(); c.globalAlpha = 1 - smooth(0.5, 0.9, a); c.translate(x0 + wd / 2 + vx * a, (y0 + y1) / 2 + vy * a + 700 * a * a); c.rotate(rot * a); c.translate(-(x0 + wd / 2), -(y0 + y1) / 2);
              c.beginPath(); c.rect(x0, y0, wd, y1 - y0); c.clip(); this._drawFrame(fi, 1); c.restore(); }
            if (a < 0.3) { this._sparks(B.cx, (y0 + y1) / 2, a, 24, 2001 + L, 0, Math.PI, 600, ORANGE); this._explosion(B.cx + (L % 2 ? 60 : -60), (y0 + y1) / 2, a, 0.6, 2002 + L, ORANGE); }
            if (this._S('S_rocks') && a < 1.0) this._sprAt('S_rocks', B.cx + (L % 2 ? 1 : -1) * 200 * a, y1 + 300 * a * a - 80 * a, 140, { rot: a * 4, alpha: 1 - smooth(0.6, 1.0, a) }); }
          // 最上面那層到最後才一起炸開，再恢復（受擊不等於擊毀）
        } }; },
    // 重力壓縮至一點後引爆（E07_05）：重力環收緊，機體由外而內縮成一點 → 引爆 → 恢復
    gravPoint: o => ({ len: 2.0, shake: d => jolt(d, [1.0], 26, 4),
      mech: d => { const sq = smooth(0.1, 0.95, d), back = smooth(1.5, 1.9, d), k = lerp(1 - 0.96 * sq, 1, back);
        return { sx: k, sy: k, dy: -(1 - k) * 120, rot: 140 * sq * (1 - back), alpha: d > 0.97 && d < 1.5 ? 0 : 1, tint: d > 0.1 ? PURPLE : null, tk: 0.5 * sq * (1 - back) }; },
      under(d, B) { const c = this.ctx, k = smooth(-0.1, 0.1, d) * (1 - smooth(0.95, 1.05, d)); if (k <= 0.01) return; const sq = smooth(0.1, 0.95, d);
        for (let i = 0; i < 4; i++) { const rr = (1.6 - 1.5 * sq) * (1 + i * 0.25); this._sprAt('S_gravring', B.cx, B.cy - B.h * 0.3 * sq + (i - 1.5) * 40 * (1 - sq), B.w * rr * 1.4, { alpha: 0.85 * k, sy: 0.3 }); } },
      over(d, B) { const c = this.ctx, cx = B.cx, cy = B.cy - B.h * 0.3;
        if (d > 0.3 && d < 1.0) this._glow(cx, cy, 30 + 30 * smooth(0.3, 0.95, d), PURPLE, 1.2 * smooth(0.3, 0.9, d));
        if (d > 0.97) { const a = d - 0.97; this._explosion(cx, cy, a, 2.4, 2150, ORANGE); this._explosion(cx - 90, cy + 50, a - 0.08, 1.6, 2151, ORANGE); this._explosion(cx + 90, cy - 40, a - 0.15, 1.6, 2152, ORANGE);
          if (a < 0.12) { c.fillStyle = rgba([235, 210, 255], 0.8 * (1 - a / 0.12)); c.fillRect(0, 0, W, H); } } } }),
    // 斷罪滿屏（E08_07）：無數白色光槍從畫面右上鋪滿全屏，由上到下、由右到左撕裂，最後全屏白閃碎裂
    spearStormFull: o => ({ len: 2.2, shake: d => d >= 0 && d < 1.5 ? 12 : 0,
      mech: d => ({ alpha: 1 - smooth(1.35, 1.45, d) + smooth(1.9, 2.1, d), tint: d > 0 && Math.floor(d * 24) % 3 === 0 ? WHITE : null, tk: 0.35, dx: Math.sin(d * 70) * 5 * (d > 0 && d < 1.4) }),
      over(d, B, fi) { const c = this.ctx;
        for (let i = 0; i < 140; i++) { const r = rng(1800 + i), ti = -0.3 + r() * 1.5, a = d - ti; if (a < -0.15 || a > 0.12) continue;
          const u = smooth(-0.15, 0.12, a), x0 = W * (0.3 + r() * 0.9) + 300, y0 = -200 - r() * 200, x1 = x0 - 900 - r() * 300, y1 = H + 200;
          if (!this._sprBeam('S_lance', lerp(x0, x1, u - 0.3), lerp(y0, y1, u - 0.3), lerp(x0, x1, u), lerp(y0, y1, u), 72, 0.95)) this._line(lerp(x0, x1, u - 0.25), lerp(y0, y1, u - 0.25), lerp(x0, x1, u), lerp(y0, y1, u), WHITE, 1.2, 4); }
        if (d > 0 && d < 1.4) { c.fillStyle = rgba([230, 240, 255], 0.18 * Math.abs(Math.sin(d * 18))); c.fillRect(0, 0, W, H); }
        if (d >= 1.35) { const a = d - 1.35; this._shards(B.cx, B.cy, a, 80, 1900, [200, 210, 225], 1100, 26); this._shards(W / 2, H / 2, a, 80, 1901, WHITE, 1400, 12);
          if (a < 0.45) { c.fillStyle = rgba(WHITE, 0.95 * (1 - a / 0.45)); c.fillRect(0, 0, W, H); } } } }),
    // 三連撕咬（E06_01，開發者 10/24 選定）：獵犬高速繞機體留殘影，從左肩 → 右腰 → 正面連咬三口，每口留下紫色齒痕；最後一口咬住不放、甩頭撕扯，扯下一塊裝甲
    tripleBite: o => { const T = [0, 0.38, 0.76], HOLD = 0.5;
      return { len: 2.0, shake: d => jolt(d, T, 12, 7) + (d > 0.76 && d < 0.76 + HOLD ? 5 : 0),
        mech: d => { const tear = d > 0.76 && d < 0.76 + HOLD ? Math.sin((d - 0.76) * 40) * 10 : 0;
          return { dx: -jolt(d, T, 18, 9) + tear, rot: tear * 0.3, tint: T.some(ti => d >= ti && d < ti + 0.05) ? WHITE : (d > 0 && d < 1.4 && Math.floor(d * 18) % 3 === 0 ? PURPLE : null), tk: 0.4 }; },
        over(d, B, fi) { const P = [[B.x0 + B.w * 0.3, B.y0 + B.h * 0.22, 1], [B.x1 - B.w * 0.2, B.y0 + B.h * 0.6, -1], [B.cx + B.w * 0.15, B.y0 + B.h * 0.4, -1]];
          // 繞圈殘影：獵犬在機體四周高速移動
          if (d > -0.5 && d < 1.3) for (let j = 0; j < 4; j++) { const tt = d - j * 0.05, ang = tt * 7, x = B.cx + Math.cos(ang) * B.w * 0.9, y = B.cy + Math.sin(ang) * B.h * 0.35;
            this._dogDir(x, y, -Math.sin(ang), Math.cos(ang) * 0.4, B.h * 0.3, (j ? 0.25 : 0.6) * (1 - smooth(-0.12, 0.02, d))); }   // 只在第一口前繞圈
          T.forEach((ti, i) => { const a = d - ti, [x, y, sd] = P[i]; const hold = i === 2 ? HOLD : 0.15;
            // 2026-10-25 開發者：不要紫色嘴巴 → 獵犬本體從外側撲上去咬住，咬完往外退開
            if (a > -0.16 && a < hold + 0.12) { const ox = x + sd * B.w * 0.9, oy = y - B.h * 0.12, u = a < 0 ? smooth(-0.16, 0, a) : a < hold ? 1 : 1 - smooth(hold, hold + 0.12, a);
              this._dogDir(lerp(ox, x + sd * B.w * 0.12, u), lerp(oy, y, u), -sd, 0.15, B.h * 0.42, a < hold ? 1 : 1 - smooth(hold, hold + 0.12, a)); }
            if (a >= 0) { this._sparks(x, y, a, 18, 1000 + i, sd > 0 ? Math.PI : 0, 1.3, 520, PURPLE); this._shards(x, y, a, 10, 1010 + i, PURPLE, 400, 8); } });
          // 齒痕（只畫在機體上）
          // 咬痕：上下兩排焦黑凹洞（2026-10-25 開發者：不要紫色三角形）
          if (d >= 0) this._onMech(fi, this._lastM, () => { T.forEach((ti, i) => { if (d < ti) return; const [x, y] = P[i];
              for (let k = 0; k < 4; k++) for (const sgn of [-1, 1]) if (!this._sprAt('S_hole', x - 36 + k * 24, y + sgn * 16, 34, { rot: k + sgn })) { const c = this.ctx; c.fillStyle = 'rgba(20,20,24,0.85)'; c.beginPath(); c.arc(x - 36 + k * 24, y + sgn * 16, 7, 0, Math.PI * 2); c.fill(); } }); });
          // 最後一口：扯下一塊裝甲
          const tr = d - (0.76 + HOLD); if (tr > 0 && tr < 1.0) { const [x, y] = P[2];
            const c = this.ctx, poly = [[-55, -40], [20, -55], [60, -5], [35, 45], [-30, 50], [-60, 10]];
            // 被扯掉的位置留下破洞（只畫在機體上）
            this._onMech(fi, this._lastM, () => { c.fillStyle = 'rgba(25,8,35,0.92)'; c.beginPath(); poly.forEach(([px, py], k) => c[k ? 'lineTo' : 'moveTo'](x + px * 0.8, y + py * 0.8)); c.closePath(); c.fill();
              c.strokeStyle = rgba(ORANGE, 0.8 * (1 - smooth(0.3, 1.0, tr))); c.lineWidth = 3; c.stroke(); });
            // 真的從機體上切下那一塊裝甲，往右上甩飛
            c.save(); c.globalAlpha = 1 - smooth(0.75, 1.0, tr); c.translate(x + 420 * tr, y - 260 * tr + 520 * tr * tr); c.rotate(tr * 7); c.translate(-x, -y);
            c.beginPath(); poly.forEach(([px, py], k) => c[k ? 'lineTo' : 'moveTo'](x + px, y + py)); c.closePath(); c.clip(); this._drawMech(fi, this._lastM); c.restore();
            this._sparks(x, y, tr, 30, 1031, 0, 1.4, 700, YELLOW); this._explosion(x, y, tr, 0.5, 1032, ORANGE); } } }; },
  };
  const this_cx_holder = { v: 640 };   // 撕咬拖曳用（機體中心 x，渲染時更新）

  // 迴旋風刃（龍捲刀勢用）
  P._windSpiral = function (d, B, col, side) { if (d < -0.2 || d > 1.1) return; const c = this.ctx, f = smooth(-0.2, 0, d) * (1 - smooth(0.8, 1.1, d));
    c.save(); c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 24; i++) { const r = rng(2300 + i), th = d * 16 + r() * 6.3, z = Math.sin(th); if ((side < 1 && z > 0) || (side >= 1 && z <= 0)) continue;
      const x = B.cx + (r() - 0.5) * B.w * 1.4 - d * 120, y = B.cy + Math.cos(th) * B.h * 0.55, len = 80 + r() * 120;
      c.strokeStyle = rgba(col, 0.7 * f); c.lineWidth = 3; c.beginPath(); c.arc(x, y, len, Math.PI * 0.9, Math.PI * 1.4); c.stroke(); }
    c.restore(); };

  // ───────── 防禦特效（DEFEND，A.T. 力場）─────────
  const DEF = {
    // 亂數小水滴／依序大水珠落在直立水面（E01_01、E01_03、E02_01、E03_03、E07_02）
    drops: o => { const n = o.n || 10, span = o.span || 0.9, T = hitTimes(n, span, o.seed || 101, o.seq ? 0 : 0.5), big = o.size === 'big';
      return { len: span + 0.8, shake: d => jolt(d, T, big ? 6 : 2.5),
        over(d, F) { const r = rng(o.seed || 101), pts = T.map(() => [F.x - F.R * (0.05 + 0.2 * r()), F.cy + F.R * (r() - 0.5) * 1.3]);
          this._inField(F, () => pts.forEach((p, i) => this._dropRipple(F, p[0], p[1], d - T[i], big ? 85 : (o.tiny ? 24 : 40), F.RIM)));
          pts.forEach((p, i) => { const a = d - T[i];
            if (big && this._shellSpr && a < 0 && a > -0.3) this._shell(p[0] + (-a) * 3000, p[1], YELLOW, 1.2);
            else if (a < 0 && a > -0.12) bulletHead(this, lerp(p[0], W + 40, -a / 0.12), p[1], big ? 120 : 110, o.col || YELLOW, big ? 9 : 7);
            if (big) { if (!(o.hitSpr && a >= 0 && this._vfx(o.hitSpr, p[0] + 18, p[1], { age: a, scale: o.hitScale || 0.4, fade: [0.5, 0.9] }))) this._explosion(p[0] + 18, p[1], a, 0.5, 1100 + i, ORANGE); }
            else if (a >= 0 && a < 0.2) { if (o.hitSpr) this._vfx(o.hitSpr, p[0] + 8, p[1], { age: a, scale: o.hitScale || 0.22, fps: 48 }); this._sparks(p[0], p[1], a, 5, 1150 + i, 0, 1.2, 300, YELLOW); } }); } }; },
    // 力場擋住尖銳物＋火花（E01_02 刺刀）
    blockSpike: o => ({ len: 1.2, shake: d => jolt(d, [0], 7),
      over(d, F) { const y = F.cy - F.R * 0.15, tip = d < 0 ? lerp(W + 40, F.x, smooth(-0.2, 0, d)) : F.x + 10 * Math.sin(d * 60) * Math.exp(-d * 4) + 500 * smooth(0.7, 1.0, d);
        if (d < 1.0 && !(o.blade && this._vfx(o.blade, tip, y, { scale: o.bladeScale || 1.4, anchor: o.bladeAnchor || [0.08, 0.6], hold: true, blend: 'source-over' }))) this._spike(tip, y, 420, 15, [200, 210, 230], 0.7);
        this._inField(F, () => { for (let j = 0; j < 4; j++) { const a = d - j * 0.12; if (a < 0) continue; const f = Math.exp(-a * 2.5);
          this.ctx.strokeStyle = rgba(F.RIM, 0.9 * f * F.k); this.ctx.lineWidth = 3; this.ctx.beginPath(); this.ctx.ellipse(F.x - 8, y, 10 + a * 60, 30 + a * 260, 0, 0, Math.PI * 2); this.ctx.stroke(); } });
        for (let k = 0; k < 4; k++) this._sparks(F.x, y, d - k * 0.15, 24, 1200 + k, 0, 1.6, 650, YELLOW); } }),
    // 力場擋住 X 光芒（E02_02 紅黃、E04_01 紫）
    blockX: o => { const C1 = o.col || [255, 70, 40], C2 = o.col2 || YELLOW;
      return { len: 1.3, shake: d => jolt(d, [0, 0.12], 7),
        over(d, F) { const s = F.R * 0.55, cx = F.x - 6, cy = F.cy;
          if (o.stamp && o.cover) { const V = this._vfxGet(o.stamp); if (V && d > -0.1) {
              const k = 1 + 0.3 * (1 - smooth(-0.1, 0.08, d));
              this._vfx(o.stamp, F.cx, F.cy, { age: d + 0.1, scale: (F.R * 2.1 / V.frames[0].height) * k, hold: true, fade: [0.8, 1.3] });
              this._inField(F, () => this._dropRipple(F, F.cx, F.cy, d, 110, C1)); }
            return; }
          if (o.stamp) { const V = this._vfxGet(o.stamp); if (V && d > -0.1) this._vfx(o.stamp, cx + 30, cy, { age: d + 0.1, scale: (s * 2.2) / V.frames[0].height, hold: true, fade: [0.5, 0.9] }); }
          [[s, -s, 0], [s, s, 0.12]].forEach(([dx, dy, t0], i) => { const a = d - t0; if (a < -0.1 || a > 0.6) return; const f = 1 - smooth(0.25, 0.6, a);
            if (!o.stamp) { this._line(cx + dx * 0.5, cy + dy, cx + dx * 0.05, cy - dy, C1, 1.2 * f, 14); this._line(cx + dx * 0.5, cy + dy, cx + dx * 0.05, cy - dy, C2, 1.1 * f, 5); }
            for (let k = 0; k < 6; k++) this._sparks(cx, cy + dy * (1 - k / 3), a, 8, 1250 + i * 10 + k, 0, 1.3, 520, k % 2 ? C2 : C1); });
          this._inField(F, () => [0, 0.12].forEach(t0 => this._dropRipple(F, cx - 10, cy, d - t0, 60, C1))); } }; },
    // 從上到下橫向刀芒＋阻擋火花（E02_03、E08_02）
    blockSlash: o => { const n = o.n || 5, col = o.col || [200, 235, 255];
      return { len: 1.3, shake: d => d >= 0 && d < 1 ? 4 : 0,
        over(d, F) { if (o.ring) { const V = this._vfxGet(o.stamp || 'S_spinblade');
            if (V && d > -0.2 && d < 1.5) { const c = this.ctx, f = 1 - smooth(1.0, 1.45, d), g = smooth(-0.2, 0.15, d);
              [[1.08, 1, 0], [1.22, -1.3, 1.1], [0.95, 1.6, 2.3], [1.35, -0.8, 3.6]].forEach(([rk, sp, ph], i) => { if (d < i * 0.08 - 0.2) return;
                c.save(); c.globalAlpha = f * g; c.translate(F.cx, F.cy); c.rotate(ph + d * sp * 6); c.scale(1, 0.55 + 0.15 * i % 0.4);
                const img = V.frames[0], k = (F.R * rk * 2) / img.width; c.scale(k, k); c.drawImage(img, -img.width / 2, -img.height / 2); c.restore(); });
              if (d > 0 && d < 1.0) for (let i = 0; i < 6; i++) { const a = d * 9 + i; this._sparks(F.cx + Math.cos(a) * F.R, F.cy + Math.sin(a) * F.R * 0.7, (d * 3 + i * 0.17) % 0.4, 6, 1300 + i, a + Math.PI / 2, 0.8, 380, YELLOW); }
              this._inField(F, () => { for (let j = 0; j < 3; j++) this._dropRipple(F, F.cx, F.cy, d - j * 0.25, 90, F.RIM); }); }
            return; }
          if (o.stamp) { const V = this._vfxGet(o.stamp); if (V && d > -0.25 && d < 1.2) this._vfx(o.stamp, lerp(W + 150, F.x + 40, smooth(-0.25, 0, d)), F.cy, { scale: (F.R * 1.5) / V.frames[0].height, hold: true, rot: d * 9, fade: [0.8, 1.2] }); }
          for (let i = 0; i < n; i++) { const a = d - i * 0.15, y = F.cy - F.R * 0.75 + F.R * 1.5 * i / (n - 1); if (a < -0.08 || a > 0.5) continue;
          const f = 1 - smooth(0.2, 0.5, a), u = smooth(-0.08, 0.02, a);
          if (!o.stamp) this._line(lerp(W + 40, F.x, u), y - 10, W + 40, y + 6, col, 1.1 * f, 6);
          this._sparks(F.x, y, a, 18, 1300 + i, Math.PI * 1.5, 1.0, 600, YELLOW); this._sparks(F.x, y, a, 12, 1350 + i, Math.PI * 0.5, 1.0, 500, col); }
          this._inField(F, () => { for (let i = 0; i < n; i++) { const a = d - i * 0.15; if (a < 0 || a > 0.8) continue; const y = F.cy - F.R * 0.75 + F.R * 1.5 * i / (n - 1), f = Math.exp(-a * 3);
            this.ctx.strokeStyle = rgba(F.RIM, f * F.k); this.ctx.lineWidth = 4; this.ctx.beginPath(); this.ctx.moveTo(F.x, y); this.ctx.lineTo(F.x - F.R * 1.6 * smooth(0, 0.3, a), y); this.ctx.stroke(); } }); } }; },
    // 砲彈在力場上爆炸（E03_01 兩發同時、E03_02／E05_02 8～10 發、E07_04 30 發重型）
    fieldBoom: o => { const n = o.n || 2, span = o.span == null ? 0.8 : o.span, T = hitTimes(n, span, o.seed || 111, o.jitter == null ? 0.4 : o.jitter);
      return { len: span + 0.9, shake: d => jolt(d, T, n > 10 ? 4 : 8, 7),
        over(d, F) { const r = rng(o.seed || 111), pts = T.map(() => [F.x - F.R * 0.08 * r(), F.cy + F.R * (r() - 0.5) * 1.4]);
          this._inField(F, () => pts.forEach((p, i) => this._dropRipple(F, p[0], p[1], d - T[i], 55, F.RIM)));
          pts.forEach((p, i) => { const a = d - T[i]; if (a < 0 && a > -0.3) this._shell(p[0] + (-a) * 3000, p[1], YELLOW, n > 10 ? 0.9 : 1.2);
            if (!(o.hitSpr && a >= 0 && this._vfx(o.hitSpr, p[0] + 30, p[1], { age: a, scale: (o.hitScale || 0.5) * (n > 10 ? 0.6 : 1), fade: [0.5, 0.9] }))) this._explosion(p[0] + 26, p[1], a, (n > 10 ? 0.6 : 0.95) * (o.power || 1), 1400 + i, ORANGE); }); } }; },
    // 全幅大量爆炸光芒（E04_02 雲爆彈）
    fieldNuke: o => ({ len: 1.8, shake: d => d >= 0.05 ? 18 * Math.exp(-(d - 0.05) * 2.5) : 0,
      over(d, F) { const a = d - 0.05, c = this.ctx; if (d > -0.45 && d < 0.08) { const y = lerp(-80, F.cy - F.R - 20, smooth(-0.45, 0.05, d)); if (!this._sprAt('S_fae_bomb', F.cx, y, 70)) { c.save(); c.fillStyle = '#2b2b30'; c.beginPath(); c.ellipse(F.cx, y, 18, 42, 0, 0, Math.PI * 2); c.fill(); c.restore(); } }
        if (a < 0) return; if (this._S('S_fae_boom') && a < 1.4) this._sprAt('S_fae_boom', F.cx, F.cy - F.R * 1.25, F.R * 2.4 * (0.5 + 0.6 * smooth(0, 0.4, a)), { alpha: 1 - smooth(0.9, 1.4, a), ay: 0.75 });
        const r = rng(1450); for (let i = 0; i < 14; i++) { const ang = r() * Math.PI * 2, rr = F.R * (1.05 + 0.5 * r()); this._explosion(F.cx + Math.cos(ang) * rr, F.cy + Math.sin(ang) * rr, a - i * 0.05, 0.8, 1460 + i, ORANGE); }
        if (a < 0.6) { c.save(); F.path(F.R); c.rect(W, 0, -W, H); c.clip('evenodd'); c.fillStyle = rgba(YELLOW, 0.55 * (1 - a / 0.6)); c.fillRect(0, 0, W, H); c.restore(); }
        this._inField(F, () => this._dropRipple(F, F.cx, F.cy - F.R * 0.6, a, 160, F.RIM)); } }),
    // 忽強忽弱的波紋抖動（E04_03；E07_03 超過兩秒）
    wobble: o => { const L = o.len || 1.4;
      return { len: L, shake: d => d >= 0 && d < L ? 3 + 3 * Math.abs(Math.sin(d * 7)) : 0,
        wob: d => (i) => d < 0 ? 1 : 1 + (0.05 + 0.06 * Math.abs(Math.sin(d * 9))) * Math.sin(d * 38 + i * 1.7) * (1 - smooth(L - 0.2, L + 0.3, d)),
        over(d, F) { this._inField(F, () => { for (let j = 0; j < 8; j++) { const ph = (d * 1.4 + j / 8) % 1, amp = 0.4 + 0.6 * Math.abs(Math.sin(d * 6 + j)); if (d < 0) return;
          this.ctx.strokeStyle = rgba(j % 2 ? WHITE : F.RIM, 0.75 * amp * (1 - ph) * F.k); this.ctx.lineWidth = 3; F.path(F.R * (1 - ph)); this.ctx.stroke(); } }); } }; },
    // 螯爪虛影在力場上碎裂（E05_01）
    clawShatter: o => ({ len: 1.3, shake: d => jolt(d, [0], 8),
      over(d, F) { const op = 1 - smooth(-0.3, 0.02, d), a = smooth(-0.4, -0.15, d) * (1 - smooth(0.0, 0.08, d)), sz = F.R * 1.1;
        if (this._S('S_claw')) { const w = F.R * 1.6, rx = lerp(W + w, F.x + w * 0.85, smooth(-0.4, -0.15, d));
          for (const up of [true, false]) this._sprAt('S_claw', rx, F.cy + (up ? -1 : 1) * F.R * 0.35, w, { alpha: a, ax: 0.95, ay: 0.55, flipY: !up, rot: (up ? -1 : 1) * 0.25 * op }); }
        else { this._claw(F.x + 30, F.cy, sz, op, true, [120, 220, 200], a); this._claw(F.x + 30, F.cy, sz, op, false, [120, 220, 200], a); }
        this._shards(F.x + 30, F.cy - F.R * 0.45, d, 30, 1500, [120, 220, 200], 600, 14); this._shards(F.x + 30, F.cy + F.R * 0.45, d, 30, 1501, [120, 220, 200], 600, 14);
        this._inField(F, () => { this._dropRipple(F, F.x - 20, F.cy - F.R * 0.45, d, 70, F.RIM); this._dropRipple(F, F.x - 20, F.cy + F.R * 0.45, d, 70, F.RIM); }); } }),
    // 電氣光芒（E05_03）；滿屏電光（E07_01）
    fieldElectric: o => ({ len: 1.6, shake: d => d >= 0 && d < 1.2 ? 3 : 0,
      over(d, F) { if (d < 0 || d > 1.5) return; const k = 1 - smooth(1.1, 1.5, d), N = o.full ? 9 : 7;
        for (let i = 0; i < N; i++) { const r = rng(1550 + i + Math.floor(d * 20) * 31);
          if (o.full) this._bolt(r() * W, -20, r() * W, H + 20, 1560 + i + Math.floor(d * 20), ELEC, k * 0.55, 1.6, 12, 40);
          const a0 = r() * Math.PI * 2, a1 = a0 + (r() - 0.5) * 1.2; this._bolt(F.cx + Math.cos(a0) * F.R, F.cy + Math.sin(a0) * F.R, F.cx + Math.cos(a1) * F.R, F.cy + Math.sin(a1) * F.R, 1570 + i + Math.floor(d * 20), ELEC, k, 3); }
        this._inField(F, () => { this.ctx.fillStyle = rgba(ELEC, 0.25 * k * (Math.floor(d * 24) % 2 ? 1 : 0.4)); this.ctx.fillRect(0, 0, W, H); });
        if (o.full && d < 0.08) { this.ctx.fillStyle = rgba(ELEC, 0.35 * (1 - d / 0.08)); this.ctx.fillRect(0, 0, W, H); } } }),
    // 水紋及火花（E05_04）
    waterSpark: o => ({ len: 1.3, shake: d => jolt(d, [0], 9),
      over(d, F) { const y = F.cy - F.R * 0.1, f = 1 - smooth(0.4, 0.8, d);
        if (d > -0.3 && f > 0.01 && this._sprBeam('S_waterfire', W + 80, y, d < 0 ? lerp(W + 50, F.x, smooth(-0.3, 0, d)) : F.x, y, 140 * (o.thick || 1), f)) {}
        else if (d > -0.3 && f > 0.01) for (let i = 0; i < 60; i++) { const u = i / 60, x = lerp(W + 50, d < 0 ? lerp(W + 50, F.x, smooth(-0.3, 0, d)) : F.x, u), ang = u * 26 - d * 30;
          this._glow(x, y + Math.sin(ang) * 40, 14, [80, 170, 255], 0.45 * f); this._glow(x, y + Math.sin(ang + Math.PI) * 40, 14, ORANGE, 0.45 * f); }
        this._inField(F, () => { for (let j = 0; j < 3; j++) this._dropRipple(F, F.x - 10, y, d - j * 0.18, 90, [120, 200, 255]); });
        this._sparks(F.x, y, d, 40, 1600, 0, 1.6, 650, ORANGE); this._sparks(F.x, y, d - 0.2, 30, 1601, 0, 1.6, 550, [150, 220, 255]); } }),
    // 鋸齒狀效果（E06_01 撕咬）
    jagged: o => ({ len: 1.3, shake: d => jolt(d, [0, 0.3], 8), verts: 24,
      wob: d => i => d < 0 ? 1 : 1 + (i % 2 ? 0.1 : -0.04) * smooth(0, 0.1, d) * (1 - smooth(1.0, 1.4, d)) * (1 + 0.3 * Math.sin(d * 30)),
      over(d, F) { const jx = F.x + 60, jy = F.cy - F.R * 0.2, cl = smooth(-0.15, 0.05, d), a = smooth(-0.3, -0.1, d) * (1 - smooth(0.4, 0.7, d)), c = this.ctx;
        if (a > 0.01) this._jaws(jx + F.R * 0.45, jy, F.R * 0.8, cl * 0.75, a);           // 咬在力場上（咬不進去，停在半開）
        this._sparks(jx, jy, d, 30, 1650, 0, 1.6, 560, YELLOW); } }),
    // 犬影在力場上依序破碎（E06_02 三道；E06_05 九道）
    dogShatter: o => { const n = o.n || 3, span = o.span || 0.8, T = hitTimes(n, span, o.seed || 121, 0);
      return { len: span + 0.8, shake: d => jolt(d, T, 6),
        under(d, F) { if (o.crack) this._spaceCrack(W - 200, F.cy - F.R, smooth(-0.5, -0.2, d) * (1 - smooth(span + 0.3, span + 0.7, d)), 1700, 240); },
        over(d, F) { const r = rng(o.seed || 121); T.forEach((ti, i) => { const a = d - ti, yy = F.cy + (n > 3 ? (r() - 0.5) * F.R : 0);
          if (a > -0.25 && a < 0) this._dogGhost(lerp(W + 200, F.x + F.R * 0.45, smooth(-0.25, 0, a)), yy, F.R * 1.0, 1);
          this._shards(F.x, yy, a, 30, 1700 + i, PURPLE, 650, 14); this._inField(F, () => this._dropRipple(F, F.x - 10, yy, a, 70, F.RIM)); }); } }; },
    // 紫色箭簇亂數插在力場上（E06_03）
    arrowsStuck: o => { const n = o.n || 16, T = hitTimes(n, 1.0, 131);
      return { len: 1.5, shake: d => jolt(d, T, 2.5),
        over(d, F) { const r = rng(132); T.forEach((ti, i) => { const ang = r() * Math.PI * 0.8 - Math.PI * 0.4, px = F.cx + Math.cos(ang) * F.R * 0.98, py = F.cy + Math.sin(ang) * F.R * 0.98, a = d - ti;
          if (a < -0.2) return; const x = a < 0 ? lerp(W + 40, px, smooth(-0.2, 0, a)) : px + 12 * Math.sin(a * 60) * Math.exp(-a * 8);
          const fade = 1 - smooth(1.1, 1.4, d); if (fade > 0.01) { this.ctx.save(); this.ctx.globalAlpha = fade; this._spike(x - 14, py, 150, 6, PURPLE, 0.7); this.ctx.restore(); }
          if (a >= 0) { this._sparks(px, py, a, 6, 1750 + i, 0, 1.2, 300, PURPLE); this._inField(F, () => this._dropRipple(F, px - 6, py, a, 26, F.RIM)); } }); } }; },
    // 擋住紫色圓柱光波後散射碎裂（E06_04）
    beamScatter: o => ({ len: 1.5, shake: d => d >= 0 && d < 0.8 ? 6 : 0,
      under(d, F) { this._spaceCrack(W - 140, 90, smooth(-0.5, -0.25, d) * (1 - smooth(1.0, 1.4, d)), 1800, 220); },
      over(d, F) { const f = smooth(-0.55, -0.35, d) * (1 - smooth(0.8, 1.1, d)); if (f <= 0.01) return; const hx = F.cx + F.R * 0.6, hy = F.cy - F.R * 0.65, u = smooth(-0.45, -0.02, d);
        if (!this._sprBeam('S_purple_beam', W - 140, 90, lerp(W - 140, hx, u), lerp(90, hy, u), 110, f)) { this._line(W - 140, 90, lerp(W - 140, hx, u), lerp(90, hy, u), PURPLE, 1.3 * f, 60); this._line(W - 140, 90, lerp(W - 140, hx, u), lerp(90, hy, u), WHITE, 1.1 * f, 18); }
        if (d >= 0) { for (let i = 0; i < 10; i++) { const r = rng(1850 + i), ang = -Math.PI * 0.2 + r() * Math.PI * 0.9; this._line(hx, hy, hx + Math.cos(ang) * 400 * smooth(0, 0.2, d), hy + Math.sin(ang) * 400 * smooth(0, 0.2, d) - 100, PURPLE, 0.6 * f, 6); }
          this._shards(hx, hy, d, 40, 1860, PURPLE, 700, 14); this._inField(F, () => this._dropRipple(F, hx, hy, d, 110, F.RIM)); } } }),
    // 風柱撞上力場後碎裂濺射（E08_01）
    windSplash: o => ({ len: 1.2, shake: d => jolt(d, [0], 8),
      over(d, F) { const y = F.cy - F.R * 0.1, f = smooth(-0.25, -0.1, d) * (1 - smooth(0.3, 0.6, d)); const tip = d < 0 ? lerp(W + 40, F.x, smooth(-0.25, 0, d)) : F.x, c = this.ctx;
        if (f > 0.01 && this._sprBeam('S_windlance', W + 60, y, tip, y, 220, f * (o.alpha || 1))) {}
        else if (f > 0.01) { c.save(); c.globalCompositeOperation = 'lighter'; c.fillStyle = rgba([210, 240, 255], 0.45 * f); c.beginPath(); c.moveTo(tip, y); c.lineTo(W + 40, y - 70); c.lineTo(W + 40, y + 70); c.closePath(); c.fill(); c.restore(); }
        this._shards(F.x, y, d, 46, 1900, [210, 240, 255], 700, 10); this._inField(F, () => this._dropRipple(F, F.x - 10, y, d, 100, F.RIM)); } }),
    // 擋住槍勢（E08_03；E08_05 粗壯黃色＋爆炸光）
    blockSpear: o => { const col = o.col || [220, 230, 255], thick = o.thick || 1;
      return { len: 1.2, shake: d => jolt(d, [0], 8 * thick),
        over(d, F) { const y = F.cy - F.R * 0.1, f = 1 - smooth(0.5, 0.8, d); if (d < -0.18 || f <= 0.01) return;
          const tip = d < 0 ? lerp(W + 60, F.x, smooth(-0.18, 0, d)) : F.x + 8 * Math.sin(d * 70) * Math.exp(-d * 5);
          this._spear(tip, y, thick, col, f);
          this._sparks(F.x, y, d, 40, 1950, 0, 1.6, 650, col); this._inField(F, () => this._dropRipple(F, F.x - 10, y, d, 80, F.RIM));
          if (o.boom && d >= 0) { this._explosion(F.x + 40, y, d, 1.2, 1951, col); if (d < 0.1) { this.ctx.fillStyle = rgba(col, 0.5 * (1 - d / 0.1)); this.ctx.fillRect(0, 0, W, H); } } } }; },
    // 擋住九針（E08_04）
    blockNeedles: o => { const n = o.n || 9, T = hitTimes(n, 0.8, 141);
      return { len: 1.3, shake: d => jolt(d, T, 2),
        over(d, F) { const r = rng(142); T.forEach((ti, i) => { const y = F.cy + F.R * (r() - 0.5) * 1.4, a = d - ti; if (a < -0.15 || a > 0.6) return;
          const x = a < 0 ? lerp(W + 40, F.x, smooth(-0.15, 0, a)) : F.x + 3 * Math.sin(a * 80); if (!this._sprBeam('S_needle', x + 220, y, x, y, 30, 1 - smooth(0.3, 0.6, a))) this._line(x, y, x + 160, y, [235, 240, 255], 1 - smooth(0.3, 0.6, a), 2);
          if (a >= 0) { this._sparks(F.x, y, a, 8, 1960 + i, 0, 1.3, 380, WHITE); this._inField(F, () => this._dropRipple(F, F.x - 6, y, a, 22, F.RIM)); } }); } }; },
    // 擋住 18 道碎冰（E08_06）
    blockIce: o => { const n = o.n || 18, T = hitTimes(n, 0.8, 151);
      return { len: 1.4, shake: d => jolt(d, T, 2.5),
        over(d, F) { const r = rng(152); T.forEach((ti, i) => { const y = F.cy + F.R * (r() - 0.5) * 1.5, a = d - ti; if (a < -0.2) return;
          if (a < 0) this._spike(lerp(W + 40, F.x, smooth(-0.2, 0, a)), y, 60, 10, ICE, 0.6);
          else { this._shards(F.x, y, a, 10, 1980 + i, ICE, 380, 8); this._inField(F, () => this._dropRipple(F, F.x - 6, y, a, 30, ICE)); } }); } }; },
    // 亂數冰紋＋白光全屏閃光（E08_07）
    iceCrackFlash: o => ({ len: 1.8, shake: d => d >= 0 && d < 1.3 ? 5 : 0,
      over(d, F) { for (let i = 0; i < 30; i++) { const r = rng(2050 + i), ti = r() * 1.0, a = d - ti; if (a < -0.15 || a > 0.1) continue; const u = smooth(-0.15, 0.1, a);
          const x0 = F.cx + F.R + 300 + r() * 200, y0 = F.cy - F.R - 300, x1 = F.x, y1 = F.cy + (r() - 0.5) * F.R * 1.4; if (!this._sprBeam('S_lance', lerp(x0, x1, u - 0.35), lerp(y0, y1, u - 0.35), lerp(x0, x1, u), lerp(y0, y1, u), 40, 0.95)) this._line(lerp(x0, x1, u - 0.3), lerp(y0, y1, u - 0.3), lerp(x0, x1, u), lerp(y0, y1, u), WHITE, 1.1, 4); }
        if (this._S('S_icecrack')) this._inField(F, () => { for (let i = 0; i < 12; i++) { const r = rng(2050 + i), ti = r() * 1.0; if (d < ti) continue;
            this._sprAt('S_icecrack', F.x - F.R * 0.3 * r(), F.cy + (r() - 0.5) * F.R * 1.4, 150 + 90 * r(), { rot: r() * 6, alpha: F.k, blend: 'source-over' }); } });
        else this._inField(F, () => { const c = this.ctx; c.strokeStyle = rgba(ICE, 0.9 * F.k); c.lineWidth = 2.5;
          for (let i = 0; i < 30; i++) { const r = rng(2050 + i), ti = r() * 1.0; if (d < ti) continue; let x = F.x - F.R * 0.1 * r(), y = F.cy + (r() - 0.5) * F.R * 1.4; c.beginPath(); c.moveTo(x, y);
            for (let j = 0; j < 4; j++) { x -= 20 + r() * 40; y += (r() - 0.5) * 50; c.lineTo(x, y); } c.stroke(); } });
        if (d > 1.0 && d < 1.35) { this.ctx.fillStyle = rgba(WHITE, 0.95 * (1 - Math.abs(d - 1.1) / 0.25)); this.ctx.fillRect(0, 0, W, H); } } }),
    // 被擠壓、不規則漏斗狀（E07_05）
    funnel: o => ({ len: 1.6, shake: d => jolt(d, [0.45], 10, 5),
      wobY: d => (i, a) => { const sq = smooth(0.4, 0.6, d) * (1 - smooth(1.3, 1.6, d)); return Math.sin(a) > 0 ? 1 + 0.25 * sq : 1 - 0.35 * sq; },
      wob: d => (i, a) => { const sq = smooth(0.4, 0.6, d) * (1 - smooth(1.3, 1.6, d)), r = rng(2100 + i)(); return Math.sin(a) > 0 ? 1 - 0.55 * sq * (0.7 + 0.5 * r) : 1 + 0.15 * sq * r; },
      under(d, F) { const k = smooth(-0.1, 0.2, d) * (1 - smooth(1.4, 1.8, d)), c = this.ctx; if (k <= 0.01) return; c.save(); c.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 4; i++) { if (this._sprAt('S_gravring', F.cx, F.cy + F.R + 20 - i * 40, F.R * 2.3, { alpha: 0.8 * k, sy: 0.3 })) continue;
          c.strokeStyle = rgba(PURPLE, 0.7 * k); c.lineWidth = 4; c.beginPath(); c.ellipse(F.cx, F.cy + F.R + 20 - i * 40, F.R * 1.1, 16, 0, 0, Math.PI * 2); c.stroke(); } c.restore(); },
      over(d, F) { if (d > 0.45) this._sparks(F.cx, F.cy + F.R * 0.6, d - 0.45, 30, 2150, Math.PI / 2, 1.6, 500, PURPLE); } }),
    // 擋住金色光波後爆炸（E07_06）
    blockGoldBeam: o => ({ len: 1.5, shake: d => d >= 0 && d < 1.0 ? 9 : 0,
      over(d, F) { const y = F.cy - F.R * 0.1, f = smooth(-0.25, -0.05, d) * (1 - smooth(0.85, 1.15, d)); if (f > 0.01) { const head = d < 0 ? lerp(W + 60, F.x, smooth(-0.25, 0, d)) : F.x;
          if (!this._sprBeam('S_goldbeam', W + 80, y, head, y, 160 * (o.thick || 1), f)) { this._line(W + 60, y, head, y, GOLD, 1.1 * f, 44); this._line(W + 60, y, head, y, WHITE, 1.0 * f, 14); }
          if (!o.noRays) for (let i = 0; i < 12; i++) { const r = rng(2200 + i), ang = (r() - 0.5) * 2.4; this._line(F.x, y, F.x + Math.cos(ang) * 260, y + Math.sin(ang) * 260, GOLD, 0.6 * f, 5); }
          if (o.noRays && d >= 0 && d < 0.9) for (let i = 0; i < 3; i++) this._explosion(F.x + 20, y + (i - 1) * 70, d - i * 0.12, 0.9, 2270 + i, GOLD); }
        this._inField(F, () => this._dropRipple(F, F.x - 10, y, d, 120, GOLD)); this._explosion(F.x + 50, y, d - 0.35, 1.4, 2260, GOLD); } }),
    // 四方犬影撞上力場碎裂（E06_05）
    dogShatter4: o => { const n = o.n || 12, span = o.span || 1.1, T = hitTimes(n, span, o.seed || 123, 0), DIRS = [[1, -1], [-1, -1], [1, 1], [-1, 1]];
      return { len: span + 0.8, shake: d => jolt(d, T, 5),
        under(d, F) { [[W - 120, 80], [120, 80], [W - 120, H - 120], [120, H - 120]].forEach((q, i) => this._spaceCrack(q[0], q[1], smooth(-0.5, -0.2, d) * (1 - smooth(span + 0.3, span + 0.7, d)), 1710 + i, 200)); },
        over(d, F) { T.forEach((ti, i) => { const a = d - ti, [sx, sy] = DIRS[i % 4], L = Math.hypot(sx, sy), px = F.cx + sx / L * F.R * 0.95, py = F.cy + sy / L * F.R * 0.95;
          if (a > -0.25 && a < 0) { const u = smooth(-0.25, 0, a); this._dogDir(lerp(F.cx + sx * 900, px, u), lerp(F.cy + sy * 520, py, u), -sx, -sy, F.R * 0.45, 1); }
          this._shards(px, py, a, 26, 1720 + i, PURPLE, 600, 12); this._inField(F, () => this._dropRipple(F, px, py, a, 60, F.RIM)); }); } }; },
    // 力場由外而內壓縮，再反彈（E07_05）
    funnelBounce: o => ({ len: 1.8, shake: d => jolt(d, [0.85], 14, 5),
      wob: d => () => d < 0 ? 1 : d < 0.8 ? lerp(1, 0.42, smooth(0.0, 0.8, d)) : d < 0.95 ? lerp(0.42, 1.25, smooth(0.8, 0.95, d)) : lerp(1.25, 1, smooth(0.95, 1.4, d)),
      under(d, F) { const k = smooth(-0.1, 0.1, d) * (1 - smooth(0.8, 0.9, d)); if (k <= 0.01) return; const sq = smooth(0.0, 0.8, d);
        for (let i = 0; i < 3; i++) this._sprAt('S_gravring', F.cx, F.cy + (i - 1) * F.R * 0.5 * (1 - sq), F.R * (2.6 - 1.4 * sq) * (1 + i * 0.15), { alpha: 0.8 * k, sy: 0.3 }); },
      over(d, F) { if (d > 0.8 && d < 1.3) { const a = d - 0.8; this.ctx.save(); this.ctx.globalCompositeOperation = 'lighter'; this.ctx.strokeStyle = rgba(F.RIM, 1 - a / 0.5); this.ctx.lineWidth = 8; F.path(F.R * (1.2 + a * 2)); this.ctx.stroke(); this.ctx.restore();
          this._shards(F.cx, F.cy, a, 40, 2160, PURPLE, 900, 12); } } }),
    // 斷罪滿屏（E08_07 防禦）：全屏光槍＋力場整面冰紋＋長白閃
    iceStormFull: o => ({ len: 2.0, shake: d => d >= 0 && d < 1.4 ? 7 : 0,
      over(d, F) { const c = this.ctx;
        for (let i = 0; i < 120; i++) { const r = rng(2050 + i), ti = -0.3 + r() * 1.4, a = d - ti; if (a < -0.15 || a > 0.1) continue; const u = smooth(-0.15, 0.1, a);
          const x0 = W * (0.3 + r() * 0.9) + 300, y0 = -200 - r() * 200, x1 = x0 - 900 - r() * 300, y1 = H + 200, xe = lerp(x0, x1, u), ye = lerp(y0, y1, u);
          if (!this._sprBeam('S_lance', lerp(x0, x1, u - 0.3), lerp(y0, y1, u - 0.3), xe, ye, 68, 0.95)) this._line(lerp(x0, x1, u - 0.3), lerp(y0, y1, u - 0.3), xe, ye, WHITE, 1.1, 4); }
        if (this._S('S_icecrack')) this._inField(F, () => { for (let i = 0; i < 26; i++) { const r = rng(2150 + i), ti = r() * 1.1; if (d < ti) continue;
          this._sprAt('S_icecrack', F.cx + (r() - 0.5) * F.R * 1.8, F.cy + (r() - 0.5) * F.R * 1.8, 160 + 120 * r(), { rot: r() * 6, alpha: F.k, blend: 'source-over' }); } });
        if (d > 0 && d < 1.3) { c.fillStyle = rgba([230, 240, 255], 0.15 * Math.abs(Math.sin(d * 18))); c.fillRect(0, 0, W, H); }
        if (d > 1.15 && d < 1.7) { c.fillStyle = rgba(WHITE, 0.95 * (1 - Math.abs(d - 1.3) / 0.4)); c.fillRect(0, 0, W, H); } } }),
    // 三連撕咬防禦（E06_01）：獵犬繞力場高速移動，從三個方向咬上力場，最後一口咬住撕扯，被力場彈開
    tripleBiteBlock: o => { const T = [0, 0.38, 0.76], HOLD = 0.5;
      return { len: 2.0, shake: d => jolt(d, T, 7, 7) + (d > 0.76 && d < 0.76 + HOLD ? 3 : 0),
        wob: d => i => d > 0.76 && d < 0.76 + HOLD ? 1 + 0.04 * Math.sin((d - 0.76) * 40 + i) : 1,
        over(d, F) { const A = [-2.3, 0.6, -0.2], P = A.map(a => [F.cx + Math.cos(a) * F.R * 0.98, F.cy + Math.sin(a) * F.R * 0.98, a]);
          if (d > -0.5 && d < 1.3) for (let j = 0; j < 4; j++) { const tt = d - j * 0.05, ang = tt * 7, x = F.cx + Math.cos(ang) * F.R * 1.9, y = F.cy + Math.sin(ang) * F.R * 0.7;
            this._dogDir(x, y, -Math.sin(ang), Math.cos(ang) * 0.4, F.R * 0.5, (j ? 0.25 : 0.6) * (1 - smooth(-0.12, 0.02, d))); }   // 只在第一口前繞圈
          T.forEach((ti, i) => { const a = d - ti, [x, y, ang] = P[i], hold = i === 2 ? HOLD : 0.15;
            if (a > -0.16 && a < hold + 0.2) { const ca = Math.cos(ang), sa = Math.sin(ang), u = a < 0 ? smooth(-0.16, 0, a) : a < hold ? 1 : 1 - smooth(hold, hold + 0.2, a) * 1.6;   // 撲到力場表面就被擋住，咬完被彈開
              const r = F.R * (1.75 + 0.9 * (1 - u)); this._dogDir(F.cx + ca * r, F.cy + sa * r * 0.8, -ca, -sa * 0.5, F.R * 0.7, a < hold ? 1 : 1 - smooth(hold, hold + 0.2, a)); }
            if (a >= 0) { this._sparks(x, y, a, 20, 1100 + i, ang, 1.4, 520, YELLOW); this._inField(F, () => this._dropRipple(F, x, y, a, 60, F.RIM)); } });
          const tr = d - (0.76 + HOLD); if (tr > 0 && tr < 0.8) { const [x, y] = P[2]; this._shards(x, y, tr, 30, 1130, PURPLE, 700, 12); this._glow(x, y, 50, PURPLE, 1.2 * (1 - tr / 0.8)); } } }; },
  };

  // ───────── 主渲染 ─────────
  P._fxSetup = function (fx) {
    const lib = this.kind === 'DAMAGE' ? DMG : this.kind === 'DEFEND' ? DEF : null;
    if (!fx || !lib || !lib[fx.fx] || (this.kind === 'DEFEND' && this.unit.no_field)) { this.fxDef = null; return; }   // no_field（昭明號）防禦不畫力場
    this.fxDef = lib[fx.fx](fx);
    this.duration = Math.max(this.duration, this.T + this.fxDef.len + 0.6);
  };
  P._fxRender = function (t) {
    const c = this.ctx, T = this.T, d = t - T, X = this.fxDef, fi = this._frame(t), B = this._bbox(fi);
    this_cx_holder.v = B.cx;
    c.save(); c.clearRect(0, 0, W, H);
    const sh = X.shake ? X.shake(d) : 0;
    if (sh > 0.3) { const r = rng(Math.floor(t * 60) + 7); c.translate((r() - 0.5) * 2 * sh, (r() - 0.5) * 1.2 * sh); }
    if (X.screenY) c.translate(0, X.screenY(d));
    this._bg(400 + 10 * t, 1.0);
    const M = Object.assign({ dx: 0 }, X.mech ? X.mech(d, B) : {}); this._lastM = M;
    if (this.kind === 'DEFEND') {
      if (X.under) X.under.call(this, d, this._fieldBodyPreview(d, X));
      this._drawMech(fi, d >= 0 && d < 0.06 ? { tint: WHITE, tk: 0.35 } : {});
      const F = this._fieldBody(d, { len: X.len, verts: X.verts, wob: X.wob ? X.wob(d) : null, wobY: X.wobY ? X.wobY(d) : null });
      X.over.call(this, d, F);
    } else {
      if (X.under) X.under.call(this, d, B);
      if (X.drawMechFn) X.drawMechFn.call(this, d, fi, M); else this._drawMech(fi, M);
      X.over.call(this, d, B, fi);
    }
    const O = this._fxOpt;
    if (O && O.src && d > -0.45 && d < (O.srcLen || 1.0)) { const V = this._vfxGet(O.src); if (V) { const sc = (O.srcScale || 0.7);
        this._vfx(O.src, W + 30, (O.srcY || 0.42) * H, { age: d + 0.45, loop: true, scale: sc, anchor: [0.95, 0.5], alpha: 0.95 }); } }
    c.restore();
    if (this.kind === 'DAMAGE' && d >= 0 && d < 0.08) { c.fillStyle = rgba(WHITE, 0.4 * (1 - d / 0.08)); c.fillRect(0, 0, W, H); }
  };
  // under 階段要先知道力場位置（不畫）
  P._fieldBodyPreview = function (d) { const B = this._bbox(this._frame(this.t)), R = Math.max(B.w, B.h) * 0.62; return { cx: B.cx, cy: B.cy, R, x: B.cx + R * 0.92 }; };

  // 包住原本的 load／renderAt：有 fx 就走專屬畫法
  const _load = P.load, _render = P.renderAt;
  P.load = async function (opt) { await _load.call(this, opt); this.fxImg = null;
    if (opt.fxImg) { try { this.fxImg = await new Promise((ok, ng) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ng; i.src = global.BattleAnimPlayer.src(this.base + opt.fxImg); }); } catch (e) { this.fxImg = null; } }
    // 影片裁切特效（fx 的 hitSpr／blade／stamp／src 指到 assets/vfx/<名稱>）
    this.vfxLib = this.vfxLib || {};
    const SHARED = opt.fx && opt.fx.sprites ? ['S_bullet', 'S_shell_big', 'S_shell_small', 'S_rocket', 'S_orb', 'S_boom', 'S_sparks', 'S_hole', 'S_debris',
      'S_xslash_pu', 'S_fae_bomb', 'S_fae_boom', 'S_airwall', 'S_claw', 'S_torpedo', 'S_eorb', 'S_waterfire', 'S_jaws', 'S_doghost', 'S_crystal_arrow', 'S_rift', 'S_purple_beam',
      'S_bolt', 'S_rocks', 'S_gravring', 'S_goldbeam', 'S_windlance', 'S_crescent', 'S_lance', 'S_needle', 'S_goldlance', 'S_iceshard', 'S_whitespear', 'S_icecrack'] : [];
    const want = (opt.fx ? ['hitSpr', 'blade', 'stamp', 'src'].map(k => opt.fx[k]) : []).concat(SHARED).filter((n, i, a) => n && !this.vfxLib[n] && a.indexOf(n) === i);
    for (const n of want) { try { const info = await fetch(`${this.base}assets/vfx/${n}/info.json`, { cache: 'no-store' }).then(r => r.json());
        const frames = await Promise.all(Array.from({ length: info.count }, (_, i) => new Promise((ok, ng) => { const im = new Image(); im.onload = () => ok(im); im.onerror = ng; im.src = global.BattleAnimPlayer.src(`${this.base}assets/vfx/${n}/frame_${String(i + 1).padStart(3, '0')}.png`); })));
        this.vfxLib[n] = { info, frames }; } catch (e) { console.warn('特效素材載入失敗', n, e); } }
    this._fxOpt = opt.fx || null;
    this._sprOn = !!(opt.fx && opt.fx.sprites); this._projSpr = (opt.fx && opt.fx.proj) || null; this._shellSpr = (opt.fx && opt.fx.shellSpr) || null; this._projScale = (opt.fx && opt.fx.projScale) || 1; this._spikeSpr = (opt.fx && opt.fx.spikeSpr) || null;
    this._bbCache = {}; this._fxSetup(opt.fx); this.renderAt(0); };
  P.renderAt = function (t) { this.t = t; if (this.fxDef) return this._fxRender(t); return _render.call(this, t); };
  global.BattleHitFX = { DMG: Object.keys(DMG), DEF: Object.keys(DEF) };
})(window);
