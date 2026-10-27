/**
 * 戰鬥招式演出播放器（遊戲內即時合成）v2
 * ------------------------------------------------------------
 * 開發者規則：
 *   1. 只呈現動畫：HP / EN / SP / 傷害數字一律不寫死，由遊戲依公式計算後自行疊加。
 *      播放器只在指定時間點發出事件（hit、damage_popup、audio），遊戲接住後顯示數值、播音效。
 *   2. 敵機可替換：受擊目標從 data/enemies.json 讀取；沒有立繪時顯示「佔位幅」。
 *   3. 背景依地圖地形載入：terrain = PLAINS / FOREST / CITY / MOUNTAIN / WATER（對應 game.js 的 TERRAINS）。
 *   4. 台詞由 data/dialogue.json 讀取，可依對手切換專屬台詞。
 *   5. 音樂音效：時間軸上已標好 audio 事件點，檔案日後補上（data/audio.json）。
 *
 * 畫面固定 1280×720 邏輯座標，所有特效都是「時間 t 的純函數」：任意跳到某一秒都能正確畫出，
 * 錄影時逐幀呼叫 renderAt(t) 即可得到與即時播放完全相同的結果。
 *
 * 用法：
 *   const player = await BattleAnimPlayer.create(canvas, { base: './' });
 *   await player.load({ move: 'AURORA_02', attacker: 'AURORA', target: 'E01', terrain: 'PLAINS' });
 *   player.on('event', ev => { ... });   // ev.type = 'hit' | 'damage_popup' | 'audio' | 'segment' | 'end'
 *   player.play();
 */
(function (global) {
  'use strict';
  const W = 1280, H = 720, GROUND = 620;
  const ENEMY_UP = 1.1;   // 2026-10-27 開發者：敵機至少比我方大 120% → 敵機在受擊／反應畫面放大 10%（我方另外縮 10%，見 _comboK）
  const CYAN = [56, 189, 248], ICE = [200, 245, 255], WHITE = [255, 255, 255];
  const ORANGE = [255, 140, 40], YELLOW = [255, 220, 115], RED = [255, 60, 50];

  // ───────── 工具 ─────────
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const easeOut = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return 1 - Math.pow(1 - t, 3); };
  const lerp = (a, b, u) => a + (b - a) * u;
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${clamp(a, 0, 1)})`;
  function rng(seed) {            // 固定種子亂數（mulberry32）：同一個種子永遠得到同一串數字
    let s = seed >>> 0;
    return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  let CACHE_BUST = '';   // 開發時設定 BattleAnimPlayer.cacheBust = true，可強制重新讀取素材
const loadImg = src => new Promise((ok, ng) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ng(new Error('載入失敗：' + src)); i.src = src + CACHE_BUST; });
  const loadJSON = src => fetch(src + CACHE_BUST, { cache: CACHE_BUST ? 'no-store' : 'default' }).then(r => { if (!r.ok) throw new Error('載入失敗：' + src); return r.json(); });

  class BattleAnimPlayer {
    static set cacheBust(v) { CACHE_BUST = v ? '?t=' + Date.now() : ''; }
    static async create(canvas, opt = {}) { const p = new BattleAnimPlayer(canvas, opt); await p._loadCommon(); return p; }

    constructor(canvas, opt) {
      this.cv = canvas; canvas.width = W; canvas.height = H;
      this.ctx = canvas.getContext('2d');
      this.base = opt.base || './';
      this.listeners = {}; this.t = 0; this.playing = false; this._firedUpTo = -1;
      this.tmp = document.createElement('canvas'); this.tmp.width = 1600; this.tmp.height = 1200;
      this.tctx = this.tmp.getContext('2d');
    }
    on(name, fn) { (this.listeners[name] = this.listeners[name] || []).push(fn); }
    _emit(name, ev) { (this.listeners[name] || []).forEach(f => f(ev)); }

    async _loadCommon() {
      const b = this.base;
      [this.chars, this.enemies, this.dialogue, this.audio] = await Promise.all([
        loadJSON(b + 'data/characters.json'), loadJSON(b + 'data/enemies.json'),
        loadJSON(b + 'data/dialogue.json'), loadJSON(b + 'data/audio.json')]);
      this.damageTiers = await loadJSON(b + 'data/damage_tiers.json').then(j => j.tiers || {}).catch(() => ({}));
      this.hitStyles = await loadJSON(b + 'data/hit_styles.json').then(j => j.styles || {}).catch(() => ({}));   // 分招受擊特效   // 受傷分級（檔案不在就全部 0）
    }

    // bgUrl（v2.10，選填）：遊戲指定一整張戰鬥背景圖（網址照原樣使用，不加 base）。
    //   有給就用這張當遠景、近景留空；沒給就照舊用 assets/backgrounds/<terrain>_far/_near.png
    async load({ move, attacker, target, terrain, bgUrl, targetReact = 'DAMAGE' }) {
      this.targetReact = targetReact;   // 敵機的反應：DAMAGE 受擊（預設）／DEFEND 防禦／EVADE 迴避
      const b = this.base;
      this.move = await loadJSON(`${b}data/moves/${move}.json`);
      // 2026-10-23 昭明號：同一招依戰鬥地形換一套演出（例：高空 SHOMEI_01 → 太空 SHOMEI_S01）
      if (this.move.terrain_variants && this.move.terrain_variants[terrain]) this.move = await loadJSON(`${b}data/moves/${this.move.terrain_variants[terrain]}.json`);
      this.attacker = this.chars.units[attacker];
      this.pilot = this.chars.pilots[this.attacker.pilot];
      this.target = this.enemies.units[target] || this.enemies.units.PLACEHOLDER;
      this.targetId = target;
      this.terrain = terrain;
      const img = {};
      const want = {
        stand: this.move.entry_stand || this.attacker.stand, cutinStart: this.move.cutin_start.image, cutinEnd: this.move.cutin_end.image,
        bgFar: `assets/backgrounds/${terrain}_far.png`, bgNear: `assets/backgrounds/${terrain}_near.png`,
      };
      for (const [k, v] of Object.entries(this.move.parts || {})) want['part_' + k] = v.image;
      if (this.target.sprite) want.target = this.target.sprite;
      { const hs = this.hitStyles[this.move.id] || this.hitStyles[move]; if (hs && hs.sprite) want.hitSprite = hs.sprite; }   // 受擊段要用的圖（例：螺旋飛拳的鑽頭拳）
      if (this.pilot.portrait) want.portrait = this.pilot.portrait;
      // 骨骼零件（分件動作用）
      this.rig = null;
      if (this.move.rig) {
        this.rig = await loadJSON(b + this.move.rig);
        for (const [k, v] of Object.entries(this.rig.parts)) want['rig_' + k] = v.image;
      }
      if (bgUrl) { delete want.bgFar; delete want.bgNear; }
      await Promise.all(Object.entries(want).map(async ([k, v]) => { img[k] = await loadImg(b + v); }));
      if (bgUrl) {
        img.bgFar = await loadImg(bgUrl);
        const blank = document.createElement('canvas'); blank.width = blank.height = 1;   // 近景留空（透明 1×1）
        img.bgNear = blank;
      }
      this.img = img;
      // v2.3：動作段改用「逐格 PNG 序列」（AI 影片去背後的透明圖），預先全部載入
      // 敵機受擊序列（enemies.json 的 hit_seq：受擊段 7.1～10 秒逐格播放透明 PNG）
      this.dmg = this.damageTiers[this.move.id] || this.damageTiers[move] || 0;
      this.hitStyle = this.hitStyles[this.move.id] || this.hitStyles[move] || null;
      this.targetSeq = null;
      const HS = this.target.hit_seq;
      if (HS) {
        const pad = n => String(n).padStart(HS.digits || 3, '0');
        this.targetSeq = await Promise.all(Array.from({ length: HS.count }, (_, i) => loadImg(`${b}${HS.dir}/${HS.prefix || 'frame_'}${pad(i + 1)}.png`)));
      }
      this.targetReactSeq = null;
      const TR = this.target.react && this.target.react[targetReact];
      if (targetReact !== 'DAMAGE' && TR) {
        const pad = n => String(n).padStart(TR.digits || 3, '0');
        this.targetReactSeq = await Promise.all(Array.from({ length: TR.count }, (_, i) => loadImg(`${b}${TR.dir}/${TR.prefix || 'frame_'}${pad(i + 1)}.png`)));
      }
      // 2026-10-24 圖片區素材（敵機防禦／閃避共用）：紫色流光光暈、紫色命中漣漪、紫色殘影光帶、MISS 美術字
      // 2026-10-25 圖片區 AURORA 命中特效 14 張（我方攻擊朝右）
      this.auVfx = {};
      if (/^AURORA_/.test(this.move.id || move) && (!targetReact || targetReact === 'DAMAGE'))
        await Promise.all(['S_au01_blade', 'S_au01_pierce', 'S_au02_slash', 'S_au02_xspark', 'S_au03_rift', 'S_au03_shards', 'S_au04_tracer', 'S_au04_hole', 'S_au05_beam', 'S_au05_burst', 'S_au06_orb', 'S_au06_flash', 'S_au07_missile', 'S_au08_plasma']
          .map(async k => { try { this.auVfx[k] = await loadImg(`${b}assets/vfx/${k}/frame_001.png`); } catch (e) {} }));
      // 2026-10-25 圖片區轟天巨神命中特效 13 張（14 鑽頭維持原樣）
      if (/^TITAN_/.test(this.move.id || move) && (!targetReact || targetReact === 'DAMAGE'))
        await Promise.all(['S_ti10_fist', 'S_ti10_dent', 'S_ti11_wheel', 'S_ti11_lava', 'S_ti12_horn', 'S_ti13_rocket', 'S_ti15_tornado', 'S_ti15_smoke', 'S_ti16_ray', 'S_ti16_melt', 'S_ti17_ice', 'S_ti17_shard', 'S_ti18_boom', 'S_ti14_spiral', 'S_ti14_entry', 'S_ti14_exit']
          .map(async k => { try { this.auVfx[k] = await loadImg(`${b}assets/vfx/${k}/frame_001.png`); } catch (e) {} }));
      // 爆炸素材（共用 S_boom 4 階段），轟天 10／13 的擊中改用它
      if (/^TITAN_/.test(this.move.id || move)) { this.boomSpr = [];
        try { this.boomSpr = await Promise.all([1, 2, 3, 4].map(n => loadImg(`${b}assets/vfx/S_boom/frame_00${n}.png`))); } catch (e) { this.boomSpr = []; } }
      if (/^HIBARI_/.test(this.move.id || move) && (!targetReact || targetReact === 'DAMAGE'))
        await Promise.all(['S_hb01_fist', 'S_hb02_palm', 'S_hb03_arc', 'S_hb04_fire', 'S_hb05_rise', 'S_hb06_wave', 'S_hb07_burst']
          .map(async k => { try { this.auVfx[k] = await loadImg(`${b}assets/vfx/${k}/frame_001.png`); } catch (e) {} }));
      this.enVfx = {};
      if (targetReact === 'DEFEND' || targetReact === 'EVADE')
        await Promise.all(['S_en_aura', 'S_en_ripple', 'S_en_trail', 'S_en_miss'].map(async k => { try { this.enVfx[k] = await loadImg(`${b}assets/vfx/${k}/frame_001.png`); } catch (e) {} }));
      this.seq = null;
      this.comboSeq = null;
      if (this.hitStyle && this.hitStyle.type === 'combo' && this.move.full_grey) {
        const FG = this.move.full_grey, pad3 = n => String(n).padStart(3, '0');
        this.comboSeq = await Promise.all(Array.from({ length: FG.count }, (_, i) => loadImg(`${b}${FG.dir}/frame_${pad3(i + 1)}.png`)));
        // 2026-10-24 開發者：進場後直接衝到敵機旁邊出招 → 拿掉原本的動作段（原地演一次）與結尾切入，切入卡片後直接進受擊段
        const S = this.hitStyle, c0 = this.move.segments.cutin_start[1], h0 = c0 + 0.1, fps = S.fps || 30, a = (S.range || [1])[0];
        this.move.segments = Object.assign({}, this.move.segments, { action: [h0, h0], cutin_end: [h0, h0] });
        this.move = Object.assign({}, this.move, { flashes: (this.move.flashes || []).filter(f => f <= c0).concat([h0]), shakes: (this.move.shakes || []).filter(e => e.t < c0)
          .concat((S.hits || []).map((f, i, A) => ({ t: h0 + (S.lead || 0.15) + (f - a) / fps, amp: i === A.length - 1 ? 22 : 10, decay: 9 })))
          .concat(S.finish === 'boom' || S.finish === 'phoenix' ? [{ t: h0 + (S.lead || 0.15) + ((S.hits || [a]).slice(-1)[0] - a) / fps + 0.25, amp: 30, decay: 3 }] : []) });
        this.move.segments = Object.assign({}, this.move.segments, { hit: [h0, h0 + S.len] });
      }
      this.haloImg = null;
      if ((this.move.action && this.move.action.halo) || this.move.entry_halo) { const Hd = this.move.action.halo || { dir: 'assets/units/HIBARI_halo' }, L = {};
        await Promise.all(['outer', 'inner', 'feathers', 'ripple'].map(async k => { L[k] = await loadImg(`${b}${Hd.dir}/${k}.png`); })); this.haloImg = L; }
      this.cleanHold = null;   // 天驚拳鳳凰飛出後停住的乾淨出拳格（hit_styles 的 clean）
      { const hs2 = this.hitStyles[this.move.id] || this.hitStyles[move]; if (hs2 && hs2.clean) { try { this.cleanHold = await loadImg(b + hs2.clean); } catch (e) {} } }
      this.afterSeq = null;
      if (this.move.after_action) { const F = this.move.after_action.frames, pad = n => String(n).padStart(F.digits || 3, '0');
        this.afterSeq = await Promise.all(Array.from({ length: F.count }, (_, i) => loadImg(`${b}${F.dir}/${F.prefix || 'frame_'}${pad(i + 1)}.png`))); }
      const SA = this.move.action;
      if (SA && SA.type === 'sprite_seq') {
        const F = SA.frames, pad = n => String(n).padStart(F.digits || 3, '0');
        this.seq = await Promise.all(Array.from({ length: F.count }, (_, i) => loadImg(`${b}${F.dir}/${F.prefix || 'frame_'}${pad(i + 1)}.png`)));
      }
      // 台詞：先找對手專屬台詞，沒有就用通用台詞
      const lines = this.dialogue.moves[this.move.id] || this.dialogue.moves[move] || {};   // v2.3：新版腳本沿用同一招的台詞
      const pick = lines['vs_' + target] || lines.default || ['……'];
      this.line = pick[0];
      this.duration = this.move.duration;
      if (this.comboSeq) this.duration = this.move.segments.hit[1] + 0.3;
      // 2026-10-23 開發者：剛（神盾泰坦我方版）的招式和敵方 E07 一樣 → 打中敵機的受擊效果沿用 E07 打我方的專屬特效（左右反過來）
      this.mirrorRP = null;
      if (this.hitStyle && this.hitStyle.type === 'mirrorfx' && targetReact === 'DAMAGE' && this.target.hit_seq && global.BattleReactPlayer && global.BattleReactPlayer.prototype._fxSetup) {
        if (!this.hitOnPlayer) { try { this.hitOnPlayer = await loadJSON(`${b}data/hit_on_player.json`); } catch (e) { this.hitOnPlayer = {}; } }
        const fx = (this.hitOnPlayer[this.hitStyle.from] || {}).DAMAGE;
        if (fx) {
          const HS = this.target.hit_seq, rp = new global.BattleReactPlayer(this.cv, { base: b });
          const units = Object.assign({}, this.chars.units, { __MIRROR_TARGET__: { react: { DAMAGE: { dir: HS.dir, prefix: HS.prefix || 'frame_', digits: HS.digits || 3, count: HS.count, fps: HS.fps || 24,
            frame_scale: 0.8, origin: [-130, 34], impact: 9, point: [550, 300] } } } });
          Object.assign(rp, { chars: Object.assign({}, this.chars, { units }), enemies: this.enemies, dialogue: this.dialogue, audio: this.audio });
          await rp.load({ unit: '__MIRROR_TARGET__', kind: 'DAMAGE', terrain: this.terrain || 'PLAINS', fx });
          // 敵機圖先左右翻轉，整個受擊段再翻回來 → 敵機方向不變、攻擊改成從左邊打過來
          rp.seq = rp.seq.map(im => { const cv = document.createElement('canvas'); cv.width = im.width; cv.height = im.height; const g = cv.getContext('2d'); g.translate(im.width, 0); g.scale(-1, 1); g.drawImage(im, 0, 0); return cv; });
          rp._bbCache = {}; rp.renderAt(0);
          this.mirrorRP = rp;
          this.duration = Math.max(this.duration, this.move.segments.hit[0] + 0.45 + rp.fxDef.len + 0.6);
        }
      }
      this.events = (this.move.events || []).slice().sort((a, b) => a.t - b.t);
      this._noCutin();
      this.t = 0; this._firedUpTo = -1;
      this.renderAt(0);
    }

    // 2026-10-25 開發者：首尾幀只用來做 H3 影片，既然已經有影片，演出裡不再放首尾幀切入卡片。
    //   做法：把「進場結束 → 動作開始」與「動作結束 → 受擊開始」兩段（切入卡片＋黑場）從時間軸上跳過。
    //   對外的 t／duration 都是跳過後的時間；內部 renderAt 換算回招式檔原本的時間，招式檔不用改。
    _noCutin() {
      this._skips = [];
      const S = this.move && this.move.segments; if (!S || !S.action || !S.hit || !S.entry) return;
      for (const [a, b] of [[S.entry[1], S.action[0]], [S.action[1], S.hit[0]]]) if (b - a > 0.001) this._skips.push([a, b]);
      this.duration -= this._skips.reduce((s, [a, b]) => s + (b - a), 0);
    }
    _orig(t) { for (const [a, b] of this._skips || []) if (t >= a) t += b - a; return t; }          // 顯示時間 → 招式檔時間
    _disp(t) { let d = t; for (const [a, b] of this._skips || []) { if (t >= b) d -= b - a; else if (t > a) d -= t - a; } return d; }   // 招式檔時間 → 顯示時間
    // 播放控制
    play() { if (this.playing) return; this.playing = true; this._last = performance.now(); requestAnimationFrame(this._tick.bind(this)); }
    pause() { this.playing = false; }
    seek(t) { this.t = clamp(t, 0, this.duration); this._firedUpTo = this.t - 1e-6; this.renderAt(this.t); }
    _tick(now) {
      if (!this.playing) return;
      const dt = (now - this._last) / 1000; this._last = now;
      const prev = this.t; this.t = Math.min(this.duration, this.t + dt);
      this._fire(prev, this.t); this.renderAt(this.t);
      if (this.t >= this.duration) { this.playing = false; this._emit('event', { type: 'end', t: this.t }); return; }
      requestAnimationFrame(this._tick.bind(this));
    }
    _fire(a, b) {
      if (this._skips && this._skips.length) { a = this._orig(a); b = this._orig(b); }
      for (const ev of this.events) if (ev.t > a && ev.t <= b) {
        const out = Object.assign({}, ev);
        if (ev.type === 'audio') out.file = (this.audio.cues[ev.cue] || {}).file || null;   // 檔案日後補上
        this._emit('event', out);
      }
    }

    // ───────── 每一幀 ─────────
    renderAt(t) {
      t = this._orig(t);
      const c = this.ctx, m = this.move, S = m.segments;
      c.save(); c.clearRect(0, 0, W, H);
      let shake = this._shake(t);
      if (shake > 0.3) { const r = rng(Math.floor(t * 60) + 7); c.translate((r() - 0.5) * 2 * shake, (r() - 0.5) * 1.2 * shake); c.scale(1.02, 1.02); c.translate(-W * 0.01, -H * 0.01); }
      if (t < S.entry[1]) this._entry(t);
      else if (t < S.cutin_start[1]) this._cutin(this.img.cutinStart, S.cutin_start, t, -1);
      else if (t < S.action[0]) this._black();
      else if (t < S.action[1]) this._action(t);
      else if (t < S.cutin_end[0]) this._black();
      else if (t < S.cutin_end[1]) this._cutin(this.img.cutinEnd, S.cutin_end, t, -1);
      else if (S.after && t >= S.after[0]) this._after(t);   // 2026-10-25：受擊後再接一段（雲雀 09 涅槃重生）
      else this._hit(t);
      c.restore();
      // 段落交界白閃
      for (const tc of m.flashes || []) if (t >= tc && t < tc + 0.1) { c.fillStyle = rgba(WHITE, 0.9 * (1 - (t - tc) / 0.1)); c.fillRect(0, 0, W, H); }
      if (t >= S.action[0] && t < S.action[1]) this._dialogue(t - S.action[0]);
    }
    _shake(t) {
      let s = 0;
      const hk = 1 + 0.2 * (this.dmg || 0), h0 = this.move.segments.hit[0];
      for (const e of this.move.shakes || []) if (t >= e.t) s = Math.max(s, e.amp * (e.t >= h0 ? hk : 1) * Math.exp(-(t - e.t) * (e.decay || 6)));
      return s;
    }
    _black() { this.ctx.fillStyle = '#000'; this.ctx.fillRect(0, 0, W, H); }

    // 背景：遠景視差 0.3、近景 1.0；camX 是鏡頭在世界中的位置
    _bg(camX, zoom = 1) {
      const c = this.ctx, f = this.img.bgFar, n = this.img.bgNear;
      const draw = (img, par) => {
        const s = (H / img.height) * zoom * 1.0;
        // 每兩張為一組：第二張水平鏡射，接縫兩側像素相同 → 無縫捲動
        const w = img.width * s, pair = 2 * w, off = camX * par;
        let x = -(((off % pair) + pair) % pair);
        const y = H - img.height * s - (zoom - 1) * 120;
        for (let k = 0; x + k * w < W; k++) {
          const px = x + k * w;
          if (k % 2 === 0) c.drawImage(img, px, y, w, img.height * s);
          else { c.save(); c.translate(px + w, y); c.scale(-1, 1); c.drawImage(img, 0, 0, w, img.height * s); c.restore(); }
        }
      };
      draw(f, 0.3); draw(n, 1.0);
    }

    // 立繪（可上色閃白、閃紅）
    _sprite(img, x, y, scale, rot = 0, alpha = 1, tint = null, tintK = 0, anchor = null) {
      const c = this.ctx; const ax = anchor ? anchor[0] : img.width / 2, ay = anchor ? anchor[1] : img.height / 2;
      let src = img;
      if (tint && tintK > 0) {
        const tc = this.tctx; this.tmp.width = img.width; this.tmp.height = img.height;
        tc.clearRect(0, 0, img.width, img.height); tc.drawImage(img, 0, 0);
        tc.globalCompositeOperation = 'source-atop'; tc.fillStyle = rgba(tint, tintK); tc.fillRect(0, 0, img.width, img.height);
        tc.globalCompositeOperation = 'source-over'; src = this.tmp;
      }
      c.save(); c.globalAlpha = alpha; c.translate(x, y); c.rotate(rot * Math.PI / 180); c.scale(scale, scale);
      c.drawImage(src, -ax, -ay); c.restore();
    }

    // 發光
    _glow(x, y, r, col, k = 1) {
      if (k <= 0.01) return; const c = this.ctx; c.save(); c.globalCompositeOperation = 'lighter';
      const g = c.createRadialGradient(x, y, 0, x, y, r * 2.4);
      g.addColorStop(0, rgba([255, 255, 255], 0.95 * k)); g.addColorStop(0.18, rgba(col, 0.9 * k));
      g.addColorStop(0.45, rgba(col, 0.35 * k)); g.addColorStop(1, rgba(col, 0));
      c.fillStyle = g; c.beginPath(); c.arc(x, y, r * 2.4, 0, Math.PI * 2); c.fill(); c.restore();
    }
    _line(x0, y0, x1, y1, col, k, w) {
      const c = this.ctx; c.save(); c.globalCompositeOperation = 'lighter'; c.lineCap = 'round';
      c.strokeStyle = rgba(col, 0.5 * k); c.lineWidth = w * 2.6; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
      c.strokeStyle = rgba(WHITE, k); c.lineWidth = w; c.stroke(); c.restore();
    }
    _speedLines(t, k, seed, dir = 1) {
      if (k <= 0.01) return; const r = rng(seed + Math.floor(t * 30));
      for (let i = 0; i < 26; i++) { const y = r() * H, x = r() * W, l = 200 + r() * 500;
        this._line(x, y, x - dir * l, y, WHITE, 0.18 * k, 1.5); }
    }

    // 爆炸（純函數：給生成時間與種子，任何時刻都畫得出來）
    _explosion(x, y, age, power, seed, col = ORANGE) {
      if (age < 0 || age > 2.4) return; const c = this.ctx, r = rng(seed);
      // 黑煙
      for (let i = 0; i < 6 * power; i++) {
        const a = r() * Math.PI * 2, sp = 20 + r() * 60, life = 1.4 + r();
        if (age > life) continue; const u = age / life;
        const px = x + Math.cos(a) * sp * age * 1.5, py = y + Math.sin(a) * sp * age - 60 * age;
        const rad = (18 + r() * 22) * power * (0.5 + u);
        c.fillStyle = rgba([45, 42, 40], 0.55 * (1 - u) * Math.min(1, age / 0.12));
        c.beginPath(); c.arc(px, py, rad, 0, Math.PI * 2); c.fill();
      }
      if (age < 0.5) {
        const f = 1 - age / 0.5;
        this._glow(x, y, 75 * power * (0.5 + 0.5 * f), col, 1.2 * f);
        if (age < 0.12) this._glow(x, y, 50 * power, WHITE, 1.4 * (1 - age / 0.12));
        c.save(); c.globalCompositeOperation = 'lighter'; c.strokeStyle = rgba(YELLOW, f);
        c.lineWidth = Math.max(1, 6 * f); c.beginPath(); c.ellipse(x, y, 25 + 560 * age * power, 25 + 470 * age * power, 0, 0, Math.PI * 2); c.stroke(); c.restore();
      }
      // 火花
      for (let i = 0; i < 26 * power; i++) {
        const a = r() * Math.PI * 2, sp = (260 + r() * 750) * power, life = 0.3 + r() * 0.5;
        if (age > life) continue; const u = age / life;
        const px = x + Math.cos(a) * sp * age, py = y + Math.sin(a) * sp * age + 420 * age * age;
        this._line(px, py, px - Math.cos(a) * sp * 0.03, py - Math.sin(a) * sp * 0.03 - 840 * age * 0.03, [YELLOW, ORANGE, WHITE][i % 3], 1.3 * (1 - u), 2);
      }
      // 碎片
      c.save(); c.fillStyle = '#3a4252';
      for (let i = 0; i < 8 * power; i++) {
        const a = -Math.PI * r(), sp = (160 + r() * 380) * power, life = 1.2;
        if (age > life) continue; const px = x + Math.cos(a) * sp * age, py = y + Math.sin(a) * sp * age + 650 * age * age;
        const s = 3 + r() * 5; c.save(); c.translate(px, py); c.rotate(age * (r() * 20 - 10)); c.fillRect(-s, -s * 0.6, s * 2, s * 1.2); c.restore();
      }
      c.restore();
    }

    // ───────── ① 登場（0~1.3 秒，不變） ─────────
    _entry(t) {
      const S = this.move.segments.entry, img = this.img.stand, sc = this.attacker.stand_scale || 0.86;
      // 眼睛閃光、推進器噴焰顏色依機體設定（沒填就用 AURORA 的青色）
      const EYE = this.attacker.stand_eye_color || CYAN, JET = this.attacker.stand_thruster_color || CYAN;
      const cam = 300 + 120 * t;
      this._bg(cam);
      const fx = lerp(-380, 430, easeOut(0, 0.75, t)), fy = GROUND - img.height * sc / 2 - 10 + 8 * Math.sin(t * 4);
      for (let k = 4; k >= 1; k--) { const tk = t - 0.035 * k; if (tk < 0 || t > 0.9) continue;
        this._sprite(img, lerp(-380, 430, easeOut(0, 0.75, tk)), fy, sc, 0, 0.45 - 0.09 * k, JET, 0.6); }
      if (this.move.entry_halo && this.haloImg) {   // 明鏡止水：進場立繪背後疊程式光環（內環順、外環逆、光羽順）
        const L = this.haloImg, c = this.ctx, k = img.height * sc / 540, hx = fx, hy = fy - img.height * sc * 0.18, a = smooth(0.2, 0.6, t);
        c.save(); c.globalCompositeOperation = 'lighter';
        for (const [im, sp] of [[L.outer, -0.45], [L.inner, 0.6], [L.feathers, 0.35]]) { c.save(); c.globalAlpha = 0.6 * a; c.translate(hx, hy); c.rotate(t * sp); c.scale(k, k); c.translate(-680, -300); c.drawImage(im, 0, 0); c.restore(); }
        c.restore(); }
      this._sprite(img, fx, fy, sc, 8 * (1 - easeOut(0, 0.9, t)));
      const eye = this.move.entry_eye || this.attacker.stand_eye, ex = fx + (eye[0] - img.width / 2) * sc, ey = fy + (eye[1] - img.height / 2) * sc;
      const kk = Math.exp(-Math.pow((t - 0.95) / 0.08, 2));
      this._glow(ex, ey, 6, EYE, 0.9 + kk);
      const FLASH = this.attacker.stand_eye_color ? WHITE : ICE;
      if (kk > 0.05) { this._line(ex - 70 * kk, ey, ex + 70 * kk, ey, FLASH, 1.2 * kk, 2); this._line(ex, ey - 32 * kk, ex, ey + 32 * kk, FLASH, 1.2 * kk, 2); }
      const back = this.move.entry_thruster || this.attacker.stand_thruster, bx = fx + (back[0] - img.width / 2) * sc, by = fy + (back[1] - img.height / 2) * sc;
      const tr = 1 - 0.6 * smooth(0.6, 1.0, t);
      this._glow(bx, by, 22, JET, 0.8 * tr);   // 2026-10-25 開發者：進場不要那一束橫向光芒（原本的推進器尾焰線已拿掉）
      this._speedLines(t, 1 - smooth(0.6, 0.9, t), 11);
    }

    // ───────── ② ④ 切入（整張原圖完整顯示、不裁切） ─────────
    _cutin(img, seg, t, dir) {
      const c = this.ctx, t0 = seg[0], u = smooth(t0, seg[1], t);
      // 底層：同一張圖放大模糊鋪滿，取代黑邊
      const cover = Math.max(W / img.width, H / img.height) * 1.08;
      c.save(); c.filter = 'blur(18px) brightness(0.45)';
      c.drawImage(img, (W - img.width * cover) / 2, (H - img.height * cover) / 2, img.width * cover, img.height * cover);
      c.restore();
      // 主圖：contain 縮放，最大只推近到 0.97，保證整張完整入鏡（原圖畫到的部分不會被切掉）
      const fit = Math.min(W / img.width, H / img.height);
      const s = fit * lerp(0.93, 0.97, u);
      const slide = (1 - easeOut(t0, t0 + 0.18, t)) * W * 0.6 * dir;
      const w = img.width * s, h = img.height * s, x = (W - w) / 2 + slide, y = (H - h) / 2;
      c.save(); c.shadowColor = 'rgba(0,0,0,0.7)'; c.shadowBlur = 30; c.drawImage(img, x, y, w, h); c.restore();
      c.strokeStyle = 'rgba(56,189,248,0.8)'; c.lineWidth = 3; c.strokeRect(x, y, w, h);
      return { x, y, s };
    }

    // ───────── ③ 首尾幀過渡：台詞＋動作場面（2.8~5.8 秒） ─────────
    _action(t) {
      const A = this.move.action;
      if (A.type === 'melee_dash_slash') return this._actMeleeDashSlash(t, A);
      if (A.type === 'melee_rig_slash') return this._actMeleeRigSlash(t, A);
      if (A.type === 'sprite_seq') return this._actSpriteSeq(t, A);
    }

    // 受擊段之後的尾段：借用動作段的畫法，換成尾段序列與時間
    _after(t) {
      const S = this.move.segments, keep = this.seq; this.seq = this.afterSeq;
      this._actSpriteSeq(t - S.after[0] + S.action[0], this.move.after_action); this.seq = keep;
    }

    // ── v2.3 逐格序列：地形背景照常捲動，機體畫面直接換成透明 PNG（24 fps，一拍一／一拍二已在圖裡排好） ──
    _actSpriteSeq(t, A) {
      const t0 = this.move.segments.action[0], lt = t - t0, F = A.frames, TM = A.timing || {};
      if (A.fullframe) {                       // v2.4：序列本身含背景（例如從切入圖演到切入圖），整張鋪滿畫面
        const img = this.seq[clamp(Math.floor(lt * F.fps), 0, this.seq.length - 1)], c = this.ctx;
        const k = Math.max(W / img.width, H / img.height), w = img.width * k, h = img.height * k;
        c.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
        for (const ts of A.flash_at || []) { const f = Math.exp(-Math.pow((lt - ts) / 0.05, 2));
          if (f > 0.02) { c.fillStyle = rgba(WHITE, 0.35 * f); c.fillRect(0, 0, W, H); } }
        return;
      }
      const dash = smooth((TM.dash || [0.55, 0.78])[0], (TM.dash || [0.55, 0.78])[1], lt);
      this._bg(200 + 1400 * dash + 60 * lt, 1 + 0.06 * smooth(...(TM.zoom || [0.8, 1.6]), lt));
      const i = clamp(Math.floor(lt * F.fps), 0, this.seq.length - 1), img = this.seq[i];
      const s = A.seq_scale || A.scale || 0.8, w = img.width * s, h = img.height * s;
      const x = (A.center_x || W / 2) - w / 2, y = GROUND - (A.foot_y || img.height) * s;   // 腳底對齊地面
      if (A.halo && this.haloImg) this._moveHalo(A.halo, i, lt, x, y, s, false);   // 明鏡止水光環：畫在機體後面
      this.ctx.drawImage(img, x, y, w, h);
      if (A.halo && this.haloImg) this._moveHalo(A.halo, i, lt, x, y, s, true);    // 腳下水紋：畫在機體前面
      const c = this.ctx;
      for (const ts of A.flash_at || []) { const k = Math.exp(-Math.pow((lt - ts) / 0.05, 2));
        if (k > 0.02) { c.fillStyle = rgba(WHITE, 0.35 * k); c.fillRect(0, 0, W, H); } }
    }

    // 雲雀明鏡止水金色模式（07～09）：內環順時針、外環逆時針、12 光羽順時針公轉、腳下水紋往外擴散。
    // 分層圖座標＝明鏡止水尾幀（1376×768，光環中心 ref_center、機體高 ref_height）；依每格機體位置（track）平移縮放
    _moveHalo(Hc, i, lt, x, y, s, front) {
      const T = Hc.track[Math.min(i, Hc.track.length - 1)], [hx, hy, foot, bh] = T, k = bh / Hc.ref_height, L = this.haloImg, c = this.ctx;
      const [rx, ry] = Hc.ref_center;
      c.save(); c.translate(x, y); c.scale(s, s); c.globalCompositeOperation = 'lighter';
      const layer = (img, ang, alpha) => { c.save(); c.globalAlpha = alpha; c.translate(hx, hy); c.rotate(ang); c.scale(k, k); c.translate(-rx, -ry); c.drawImage(img, 0, 0); c.restore(); };
      if (!front) { layer(L.outer, -lt * Hc.speed[0], Hc.alpha); layer(L.inner, lt * Hc.speed[1], Hc.alpha); layer(L.feathers, lt * Hc.speed[2], Hc.alpha); }
      else { const rc = [681, 689];
        for (let j = 0; j < 4; j++) { const u = (lt * 0.55 + j / 4) % 1;
          c.save(); c.globalAlpha = Hc.alpha * (1 - u) * 0.9; c.translate(hx, foot); c.scale(k * (0.4 + 2.2 * u), k * (0.4 + 2.2 * u)); c.translate(-rc[0], -rc[1]); c.drawImage(L.ripple, 0, 0); c.restore(); } }
      c.restore();
    }

    // ── 分件骨骼：依關鍵姿勢內插各關節角度 ──
    _pose(keys, lt) {
      const out = {};
      if (lt <= keys[0].t) return Object.assign({}, keys[0].pose);
      for (let i = 0; i < keys.length - 1; i++) {
        const a = keys[i], b = keys[i + 1];
        if (lt >= a.t && lt <= b.t) {
          let u = (lt - a.t) / (b.t - a.t);
          const e = b.ease || 's';
          u = e === 'in' ? u * u * u : e === 'out' ? 1 - Math.pow(1 - u, 3) : e === 'lin' ? u : u * u * (3 - 2 * u);
          const names = new Set([...Object.keys(a.pose), ...Object.keys(b.pose)]);
          for (const n of names) out[n] = lerp(a.pose[n] || 0, b.pose[n] || 0, u);
          return out;
        }
      }
      return Object.assign({}, keys[keys.length - 1].pose);
    }
    // 計算每個零件的變換矩陣：子零件＝父零件矩陣 × 繞自己的關節軸心旋轉
    _rigMatrices(pose, x, y, scale) {
      const R = this.rig, M = {};
      const rot = (name, parent) => {
        const p = R.parts[name].pivot, a = pose[name] || 0;
        const len = name === 'blade' ? clamp(pose.blade_len === undefined ? 1 : pose.blade_len, 0.001, 1.2) : 1;   // 光束長度：0＝收刀、1＝全開
        M[name] = parent.multiply(new DOMMatrix().translate(p[0], p[1]).rotate(a).scale(len).translate(-p[0], -p[1]));
        for (const c of (R.hierarchy[name] || [])) rot(c, M[name]);
      };
      const rp = R.parts.torso.pivot;
      const root = new DOMMatrix().translate(x, y + (pose.root_dy || 0)).rotate(pose.root_rot || 0).scale(scale).translate(-rp[0], -rp[1]);
      for (const c of R.hierarchy.root) rot(c, root);
      return M;
    }
    _drawRig(M, alpha = 1, tint = null, tintK = 0) {
      const c = this.ctx, parts = Object.entries(this.rig.parts).sort((a, b) => a[1].z - b[1].z);
      for (const [name] of parts) {
        let img = this.img['rig_' + name];
        if (tint && tintK > 0) {
          const tc = this.tctx; this.tmp.width = img.width; this.tmp.height = img.height;
          tc.drawImage(img, 0, 0); tc.globalCompositeOperation = 'source-atop'; tc.fillStyle = rgba(tint, tintK);
          tc.fillRect(0, 0, img.width, img.height); tc.globalCompositeOperation = 'source-over'; img = this.tmp;
        }
        c.save(); c.globalAlpha = alpha; c.setTransform(c.getTransform().multiply(M[name])); c.drawImage(img, 0, 0); c.restore();
      }
    }
    _actMeleeRigSlash(t, A) {
      const t0 = this.move.segments.action[0], lt = t - t0, sc = A.scale, R = this.rig;
      // 時間設定全部由招式腳本提供（不同招式可以有不同節奏）
      const TM = Object.assign({ dash: [0.45, 1.4], ghost: [0.5, 1.5], speed: [0.45, 1.6], eye: 1.25, thrust: [0.3, 2.0], zoom: [1.35, 2.4] }, A.timing || {});
      const dash = smooth(TM.dash[0], TM.dash[1], lt);
      this._bg(200 + 2600 * dash + 120 * lt, 1 + 0.1 * smooth(TM.zoom[0], TM.zoom[1], lt));
      this._speedLines(t, smooth(TM.speed[0], TM.speed[0] + 0.15, lt) * (1 - smooth(TM.speed[1] - 0.25, TM.speed[1], lt)), 31, 1);
      const path = A.path, pt = path.t || [0.3, 1.4], lt2 = path.lunge_t || [1.35, 1.6, 2.2, 3.0];
      const bx = lerp(path.x[0], path.x[1], easeOut(pt[0], pt[1], lt)) + path.lunge * smooth(lt2[0], lt2[1], lt) * (1 - 0.5 * smooth(lt2[2], lt2[3], lt));
      const by = path.y + 5 * Math.sin(lt * 5);
      const at = (tt) => { const p = this._pose(A.keys, tt); return { p, M: this._rigMatrices(p, bx, by, sc) }; };
      const cur = at(lt);
      // 殘影（衝刺中）
      const ghost = smooth(TM.ghost[0], TM.ghost[0] + 0.1, lt) * (1 - smooth(TM.ghost[1] - 0.2, TM.ghost[1], lt));
      for (let k = 4; k >= 1 && ghost > 0.01; k--) {
        const g = this._pose(A.keys, lt - 0.05 * k), gx = bx - 80 * k;
        this._drawRig(this._rigMatrices(g, gx, by, sc), (0.34 - 0.07 * k) * ghost, CYAN, 0.75);
      }
      // 背部推進器（掛在軀幹上）
      const th = cur.M.torso.transformPoint(new DOMPoint(A.thruster[0], A.thruster[1]));
      const thr = smooth(TM.thrust[0], TM.thrust[0] + 0.15, lt) * (1 - 0.6 * smooth(TM.thrust[1] - 0.4, TM.thrust[1], lt));
      this._line(th.x, th.y, th.x - 300 * thr, th.y + 50 * thr, CYAN, thr, 16); this._glow(th.x, th.y, 30, CYAN, thr);
      // 刀光殘影：取刀身最近 0.12 秒的實際軌跡，畫成扇形光帶（揮得越快光帶越寬）
      const tip = R.blade_tip, hp = R.parts.blade.pivot;
      const samples = [];
      for (let s = 0; s <= 0.12; s += 0.012) {
        const q = at(lt - s).M.blade;
        samples.push([q.transformPoint(new DOMPoint(hp[0], hp[1])), q.transformPoint(new DOMPoint(tip[0], tip[1])), s]);
      }
      const c = this.ctx;
      c.save(); c.globalCompositeOperation = 'lighter';
      for (let i = 0; i < samples.length - 1; i++) {
        const [h0, t0p, s0] = samples[i], [h1, t1p] = samples[i + 1];
        const k = 1 - s0 / 0.12;
        const move = Math.hypot(t0p.x - t1p.x, t0p.y - t1p.y);
        if (move < 18) continue;                       // 揮得慢時不畫光帶
        const kk = k * Math.min(1, (move - 18) / 60);
        c.fillStyle = rgba(CYAN, 0.32 * kk); c.beginPath();
        c.moveTo(lerp(h0.x, t0p.x, 0.5), lerp(h0.y, t0p.y, 0.5)); c.lineTo(t0p.x, t0p.y); c.lineTo(t1p.x, t1p.y);
        c.lineTo(lerp(h1.x, t1p.x, 0.5), lerp(h1.y, t1p.y, 0.5)); c.closePath(); c.fill();
        c.strokeStyle = rgba(WHITE, 0.85 * kk); c.lineWidth = 5; c.beginPath(); c.moveTo(t0p.x, t0p.y); c.lineTo(t1p.x, t1p.y); c.stroke();
      }
      c.restore();
      // 機體本體（分件）
      this._drawRig(cur.M);
      const hand = samples[0][0];
      const bl = cur.p.blade_len === undefined ? 1 : cur.p.blade_len;
      this._glow(hand.x, hand.y, 14 + 12 * bl, CYAN, 0.5 + 0.5 * bl + 0.2 * Math.sin(lt * 30));
      // 納刀「喀」的瞬間光點
      for (const tc of A.sheathe_at || []) { const k = Math.exp(-Math.pow((lt - tc) / 0.05, 2));
        if (k > 0.02) { this._glow(hand.x, hand.y, 40, WHITE, 1.3 * k); this._line(hand.x - 120 * k, hand.y, hand.x + 120 * k, hand.y, ICE, k, 2); } }
      // 眼睛：揮斬前一刻閃光
      const eye = cur.M.head.transformPoint(new DOMPoint(A.eye[0], A.eye[1]));
      const ek = Math.exp(-Math.pow((lt - TM.eye) / 0.07, 2));
      this._glow(eye.x, eye.y, 8, CYAN, 0.8 + ek);
      if (ek > 0.05) this._line(eye.x - 90 * ek, eye.y, eye.x + 90 * ek, eye.y, ICE, 1.2 * ek, 2);
      // 蓄力粒子吸入
      if (lt < (A.charge_until || 0.5)) { const r = rng(91 + Math.floor(lt * 24));
        for (let i = 0; i < 10; i++) { const a = r() * Math.PI * 2, d = (1 - ((lt * 3 + r()) % 1)) * 160; this._glow(hand.x + Math.cos(a) * d, hand.y + Math.sin(a) * d, 3, ICE, 0.9); } }
      // 揮斬瞬間白閃
      for (const ts of A.flash_at) { const k = Math.exp(-Math.pow((lt - ts) / 0.05, 2));
        if (k > 0.02) { c.fillStyle = rgba(WHITE, 0.35 * k); c.fillRect(0, 0, W, H); } }
    }
    _actMeleeDashSlash(t, A) {
      const t0 = this.move.segments.action[0], lt = t - t0;
      const body = this.img.part_body, blade = this.img.part_blade, P = this.move.parts;
      const sc = A.scale;
      // 鏡頭：前 0.5 秒定住蓄勢 → 衝刺時背景快速捲動 → 揮刀時推近
      const dash = smooth(0.5, 1.5, lt);
      const camX = 200 + 2600 * dash + 120 * lt;
      const zoom = 1 + 0.12 * smooth(1.5, 2.6, lt);
      this._bg(camX, zoom);
      this._speedLines(t, smooth(0.45, 0.6, lt) * (1 - smooth(1.5, 1.7, lt)), 31, 1);
      // 機體位置：螢幕上由左向右推進（世界中高速衝刺）
      const bx = lerp(300, 620, smooth(0.3, 1.5, lt)) + 30 * Math.sin(lt * 9) * (1 - dash) * smooth(0.3, 0.5, lt);
      const by = 300 + 6 * Math.sin(lt * 5) - 20 * smooth(0.3, 0.5, lt) * (1 - smooth(1.3, 1.6, lt));
      const lean = lerp(0, 10, smooth(0.4, 0.8, lt)) - 14 * smooth(1.5, 1.8, lt);
      // 刀身角度（相對原圖）：起手 → 高舉蓄力 → 第一刀大揮 → 回斬 → 收勢
      const keys = A.blade_keys; let ang = keys[0][1];
      for (let i = 0; i < keys.length - 1; i++) { const [ta, aa] = keys[i], [tb, ab] = keys[i + 1];
        if (lt >= ta && lt <= tb) { const u = smooth(ta, tb, lt); ang = lerp(aa, ab, u); } else if (lt > tb) ang = ab; }
      // 殘影（衝刺中）
      const ghost = smooth(0.5, 0.7, lt) * (1 - smooth(1.4, 1.6, lt));
      for (let k = 5; k >= 1 && ghost > 0.01; k--) this._sprite(body, bx - 85 * k, by, sc, lean, (0.36 - 0.06 * k) * ghost, CYAN, 0.7, P.body.anchor);
      // 背部推進器噴焰
      const th = P.body.thruster, rad = lean * Math.PI / 180;
      const tx = bx + ((th[0] - P.body.anchor[0]) * Math.cos(rad) - (th[1] - P.body.anchor[1]) * Math.sin(rad)) * sc;
      const ty = by + ((th[0] - P.body.anchor[0]) * Math.sin(rad) + (th[1] - P.body.anchor[1]) * Math.cos(rad)) * sc;
      const thr = smooth(0.3, 0.5, lt) * (1 - 0.6 * smooth(1.5, 1.8, lt));
      this._line(tx, ty, tx - 300 * thr, ty + 40 * thr, CYAN, thr, 16); this._glow(tx, ty, 30, CYAN, thr);
      // 機體本體
      this._sprite(body, bx, by, sc, lean, 1, null, 0, P.body.anchor);
      // 刀身：以手為軸旋轉
      const hand = P.blade.pivot;
      const hx = bx + ((hand[0] - P.body.anchor[0]) * Math.cos(rad) - (hand[1] - P.body.anchor[1]) * Math.sin(rad)) * sc;
      const hy = by + ((hand[0] - P.body.anchor[0]) * Math.sin(rad) + (hand[1] - P.body.anchor[1]) * Math.cos(rad)) * sc;
      // 揮刀弧光（依角速度畫出扇形殘光）
      for (const sw of A.swings) {
        const a = smooth(sw.t[0], sw.t[1], lt), fade = 1 - smooth(sw.t[1], sw.t[1] + 0.35, lt);
        if (lt < sw.t[0] || fade <= 0) continue;
        const R = sw.radius * sc, a0 = (sw.from + lean) * Math.PI / 180, a1 = lerp(sw.from, sw.to, a) + lean;
        const c = this.ctx; c.save(); c.globalCompositeOperation = 'lighter';
        for (const [wid, col, k] of [[46, CYAN, 0.35], [22, CYAN, 0.7], [8, WHITE, 1.0]]) {
          c.strokeStyle = rgba(col, k * fade); c.lineWidth = wid * sc * 3; c.lineCap = 'round'; c.beginPath();
          c.arc(hx, hy, R, Math.min(a0, a1 * Math.PI / 180), Math.max(a0, a1 * Math.PI / 180)); c.stroke(); }
        c.restore();
      }
      this._sprite(blade, hx, hy, sc, lean + ang, 1, null, 0, hand);
      this._glow(hx, hy, 26, CYAN, 0.9 + 0.3 * Math.sin(lt * 30));
      // 蓄力：刀身充能粒子吸入
      if (lt < 0.55) { const r = rng(91 + Math.floor(lt * 24));
        for (let i = 0; i < 10; i++) { const a = r() * Math.PI * 2, d = (1 - ((lt * 3 + r()) % 1)) * 160;
          this._glow(hx + Math.cos(a) * d, hy + Math.sin(a) * d, 3, ICE, 0.9); } }
      // 揮刀瞬間白閃
      for (const sw of A.swings) { const k = Math.exp(-Math.pow((lt - (sw.t[0] + sw.t[1]) / 2) / 0.05, 2));
        if (k > 0.02) { this.ctx.fillStyle = rgba(WHITE, 0.35 * k); this.ctx.fillRect(0, 0, W, H); } }
      // 收勢：刀身持續發光、火花
      if (lt > 2.4) { const r = rng(5 + Math.floor(lt * 20)); for (let i = 0; i < 4; i++) this._glow(hx + r() * 200 - 40, hy + r() * 120 - 60, 2.5, ICE, 0.8); }
    }

    // 台詞框（2.8~5.8 秒顯示；頭像目前是佔位幅）
    _dialogue(lt) {
      const c = this.ctx, by = H - 150, k = smooth(0, 0.15, lt);
      c.save(); c.globalAlpha = k;
      c.fillStyle = 'rgba(4,10,22,0.82)'; c.fillRect(0, by, W, 150);
      c.fillStyle = '#38bdf8'; c.fillRect(0, by, W, 3);
      // 頭像
      if (this.img.portrait) c.drawImage(this.img.portrait, 20, by + 14, 120, 120);
      else { c.fillStyle = '#0b1a3a'; c.fillRect(20, by + 14, 120, 120); c.setLineDash([6, 5]); c.strokeStyle = '#c9a248'; c.lineWidth = 2;
        c.strokeRect(20, by + 14, 120, 120); c.setLineDash([]); c.fillStyle = '#c9a248'; c.font = 'bold 16px "Microsoft JhengHei"';
        c.textAlign = 'center'; c.fillText('頭像', 80, by + 70); c.fillText('佔位', 80, by + 92); c.textAlign = 'left'; }
      // 名牌
      c.fillStyle = 'rgba(12,60,90,0.95)'; c.beginPath(); c.moveTo(160, by - 22); c.lineTo(420, by - 22); c.lineTo(440, by); c.lineTo(160, by); c.fill();
      c.fillStyle = '#e6f6ff'; c.font = 'bold 18px "Microsoft JhengHei"'; c.fillText(this.pilot.name, 172, by - 5);
      // 逐字出現
      const line = this.line, n = Math.floor(line.length * clamp((lt - 0.1) / 0.8, 0, 1));
      c.fillStyle = '#f5f8ff'; c.font = 'bold 28px "Microsoft JhengHei"';
      c.fillText('「' + line.slice(0, n) + (n >= line.length ? '」' : ''), 172, by + 62);
      c.restore();
    }

    // ───────── ⑤ 敵機受擊＋爆炸（7.1~10 秒） ─────────
    // ═════════ 敵機反應：我方出招、敵機選擇防禦或迴避（2026-10-21）═════════
    //   防禦＝深紫色 A.T. 力場（enemies.json 的 field_color）；E10 等 field_null 的機體不出力場，直接顯示「無效」。
    //   迴避＝敵機閃開（react.EVADE 序列）＋ MISS。命中時間固定在受擊段 0.45 秒。
    _enemyReact(t) {
      const c = this.ctx, lt = t - this.move.segments.hit[0], T = 0.45, d = lt - T, K = this.targetReact;
      const tg = this.target, box = tg.box, cx = 860, cy = 380;
      this._bg(900 - 25 * lt, 1.0);
      const seq = this.targetReactSeq, PUR = tg.field_color || [110, 30, 190];
      // 敵機：有反應序列就照序列播（命中前一點開始），沒有就用受擊序列第一格靜止
      let img = null;
      if (seq) img = seq[clamp(Math.floor((lt + (K === 'EVADE' ? 0.2 : 0.3)) * 24), 0, seq.length - 1)];
      else if (this.targetSeq) img = this.targetSeq[0];
      const s = (img ? Math.min((box[1] * 1.55) / img.height, 700 / img.width) : 1) * ENEMY_UP;   // 反應序列是整張 16:9 畫面，寬的機體（獵犬、戰機）用寬度限制
      // 我方攻擊從左邊飛來（共用：一道青白光束）
      const beamEnd = K === 'EVADE' ? W + 100 : cx - box[0] * 0.75;
      if (lt > T - 0.25 && lt < T + 0.5) { const k = smooth(T - 0.25, T - 0.1, lt) * (1 - smooth(T + 0.2, T + 0.5, lt));
        this._line(-60, cy - 20, K === 'EVADE' ? lerp(-60, beamEnd, smooth(T - 0.25, T + 0.1, lt)) : beamEnd, cy - 20, CYAN, 1.2 * k, 26); this._line(-60, cy - 20, beamEnd, cy - 20, WHITE, 1.1 * k, 8); }
      if (K === 'EVADE') {
        // 有迴避序列：序列本身已經有閃開的動作與殘影，只加 MISS；沒有序列才用程式位移＋殘影
        const j = seq ? 0 : smooth(T - 0.15, T + 0.1, lt), ex = cx + 140 * j, ey = cy - 90 * Math.sin(Math.PI * Math.min(1, j));
        if (!seq && lt > T - 0.15 && lt < T + 1.2 && img) for (let k = 3; k >= 1; k--) {
          const jj = smooth(T - 0.15, T + 0.1, lt - 0.05 * k); this._drawEnemy(img, s, cx + 180 * jj, cy - 90 * Math.sin(Math.PI * Math.min(1, jj)), 0, 0.3 * (1 - smooth(T + 0.3, T + 1.2, lt)), PUR, 0.7); }
        const TR = this.enVfx.S_en_trail, MS = this.enVfx.S_en_miss;
        if (TR && img && d > -0.15 && d < 0.8) { const u = smooth(-0.15, 0.2, d), f = 1 - smooth(0.35, 0.8, d);   // 紫色殘影光帶：光頭貼著機體、尾巴拖在後面（閃開的反方向）
          const [bx, by, bw, bh] = this._alphaBox(img), px = ex - img.width * s / 2 + bx * s, py = ey - img.height * s / 2 + by * s;
          [[-0.3, 1], [0.05, 0.85], [0.32, 0.7]].forEach(([oy, k]) => { const L = bw * s * 1.3 * k * u, hh = L * TR.height / TR.width * 1.4;
            c.save(); c.globalAlpha = 0.9 * f * k; c.translate(px + bw * s * 0.15, py + oy * bh * s); c.scale(-1, 1); c.drawImage(TR, -L * 0.05, -hh / 2, L, hh); c.restore(); }); }
        this._drawEnemy(img, s, ex, ey, 0, 1, null, 0);
        if (MS && d > 0 && d < 1.3) { const u = smooth(0, 0.12, d), f = 1 - smooth(0.9, 1.3, d), w = 380 * (0.7 + 0.3 * u + 0.15 * (1 - u)), h = w * MS.height / MS.width;
          c.save(); c.globalAlpha = f; c.drawImage(MS, ex - 20 - w / 2, cy - 290 - 30 * u - h / 2, w, h); c.restore(); }
        else if (d > 0 && d < 1.3) { const u = smooth(0, 0.12, d), f = 1 - smooth(0.9, 1.3, d);
          c.save(); c.globalAlpha = f; c.translate(ex - 20, cy - 260 - 30 * u); c.scale(0.7 + 0.3 * u, 0.7 + 0.3 * u);
          c.font = 'italic 900 72px "Arial Black", "Microsoft JhengHei", sans-serif'; c.textAlign = 'center';
          c.lineWidth = 8; c.strokeStyle = 'rgba(30,5,20,0.9)'; c.strokeText('MISS', 0, 0); c.fillStyle = '#ffd6e6'; c.fillText('MISS', 0, 0); c.restore(); }
        return;
      }
      // 防禦
      const shake = d > 0 && d < 0.4 ? Math.sin(lt * 80) * 5 * Math.exp(-d * 6) : 0;
      this._drawEnemy(img, s, cx + shake, cy, 0, 1, d >= 0 && d < 0.05 ? WHITE : null, 0.3);
      if (tg.field_null) {                     // E10：一切歸於虛無
        if (d >= 0) { const g = smooth(0, 0.25, d), f = 1 - smooth(1.8, 2.3, d);
          // 光束碰到它就像被吞掉一樣消散
          for (let i = 0; i < 26; i++) { const r = rng(9100 + i), a = d * (0.8 + r()), ang = r() * Math.PI * 2;
            this._glow(cx - box[0] * 0.6 + Math.cos(ang) * 120 * a, cy - 20 + Math.sin(ang) * 80 * a, 6, [40, 0, 60], 0.8 * (1 - clamp(a, 0, 1))); }
          c.save(); c.globalAlpha = g * f; c.translate(cx, cy - 40); c.scale(0.8 + 0.2 * g, 0.8 + 0.2 * g);
          c.font = '900 120px "Microsoft JhengHei", "Noto Serif TC", serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
          c.lineWidth = 12; c.strokeStyle = 'rgba(0,0,0,0.9)'; c.strokeText(tg.field_null_text || '無效', 0, 0);
          const gr = c.createLinearGradient(0, -60, 0, 60); gr.addColorStop(0, '#f5e6ff'); gr.addColorStop(1, '#7a3cff');
          c.fillStyle = gr; c.fillText(tg.field_null_text || '無效', 0, 0); c.restore(); }
        return;
      }
      // 敵機防禦：紫色流狀光體籠罩機體（2026-10-23 開發者：A.T. 力場是我方專屬，敵機不出八角力場）
      if (lt > T - 0.2 && img) this._purpleFlow(img, s, cx + shake, cy, lt, smooth(T - 0.2, T, lt) * (1 - smooth(T + 1.2, T + 1.7, lt)), d, PUR);
    }
    // 圖片裡機體實際所在的範圍（反應序列是整張 16:9 畫面，機體不一定在正中間）→ [中心x, 中心y, 寬, 高]（圖片像素）
    _alphaBox(img) {
      this._abCache = this._abCache || new WeakMap(); let r = this._abCache.get(img); if (r) return r;
      const k = 8, w = Math.ceil(img.width / k), h = Math.ceil(img.height / k), cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const g = cv.getContext('2d'); g.drawImage(img, 0, 0, w, h); const a = g.getImageData(0, 0, w, h).data; let x0 = w, y0 = h, x1 = 0, y1 = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (a[(y * w + x) * 4 + 3] > 60) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      r = x1 < x0 ? [img.width / 2, img.height / 2, img.width, img.height] : [(x0 + x1 + 1) / 2 * k, (y0 + y1 + 1) / 2 * k, (x1 - x0 + 1) * k, (y1 - y0 + 1) * k];
      this._abCache.set(img, r); return r;
    }
    // 紫色流光：沿敵機外形的外擴光暈（脈動）＋往上流動的光帶（只在機體輪廓內）＋命中點的紫色漣漪
    _purpleFlow(img, s, x, y, lt, k, d, PUR) {
      if (k <= 0.01) return; const c = this.ctx, w = img.width * s, h = img.height * s, LP = [200, 140, 255];
      const AU = this.enVfx && this.enVfx.S_en_aura, RP = this.enVfx && this.enVfx.S_en_ripple;
      if (AU) { const [bx, by, bw, bh] = this._alphaBox(img), pulse2 = 1 + 0.06 * Math.sin(lt * 7) + (d >= 0 ? 0.12 * Math.exp(-d * 4) : 0);   // 紫色流光光暈：以機體本身為中心包住、慢慢旋轉
        const R0 = Math.max(bw, bh) * s * 1.15 * pulse2, aw = R0, ah = R0 * AU.height / AU.width;
        c.save(); c.translate(x - w / 2 + bx * s, y - h / 2 + by * s); c.scale(Math.max(1, bw / bh) * 0.85, 1);
        for (const [rot, al] of [[lt * 0.8, 0.6], [-lt * 0.5 + 1.2, 0.35]]) { c.save(); c.globalAlpha = k * al; c.rotate(rot); c.drawImage(AU, -aw / 2, -ah / 2, aw, ah); c.restore(); }
        c.restore(); }
      const pad = Math.round(18 / s), halo = this._iceSil(img, pad, PUR), pulse = 0.55 + 0.25 * Math.sin(lt * 9) + (d >= 0 ? 0.6 * Math.exp(-d * 4) : 0);
      c.save(); c.globalCompositeOperation = 'lighter'; c.globalAlpha = k * pulse * 0.4;
      c.drawImage(halo, x - w / 2 - pad * s, y - h / 2 - pad * s, (img.width + pad * 2) * s, (img.height + pad * 2) * s); c.restore();
      const cv = this._flowCv || (this._flowCv = document.createElement('canvas')); cv.width = Math.ceil(w); cv.height = Math.ceil(h); const g = cv.getContext('2d');
      g.clearRect(0, 0, cv.width, cv.height);
      for (let i = 0; i < 7; i++) { const u = ((lt * 0.55 + i / 7) % 1), yy = h * (1.1 - 1.3 * u), wv = Math.sin(lt * 3 + i * 1.9) * w * 0.08;
        const gr = g.createLinearGradient(0, yy - h * 0.09, 0, yy + h * 0.09); gr.addColorStop(0, rgba(LP, 0)); gr.addColorStop(0.5, rgba(LP, 0.85)); gr.addColorStop(1, rgba(PUR, 0));
        g.fillStyle = gr; g.save(); g.translate(wv, 0); g.fillRect(-w * 0.2, yy - h * 0.09, w * 1.4, h * 0.18); g.restore(); }
      g.globalCompositeOperation = 'destination-in'; g.drawImage(img, 0, 0, w, h); g.globalCompositeOperation = 'source-over';
      c.save(); c.globalCompositeOperation = 'lighter'; c.globalAlpha = 0.38 * k; c.drawImage(cv, x - w / 2, y - h / 2); c.restore();
      if (RP && d >= 0 && d < 1.0) { const P = [x - w * 0.32, y - 20];   // 紫色命中漣漪：側面看（壓扁成直立橢圓），兩圈往外擴
        c.save();
        for (let i = 0; i < 2; i++) { const a = d - i * 0.12; if (a < 0) continue; const sc = 0.35 + a * 1.6, rw = RP.width * sc * 0.45, rh = RP.height * sc * 1.1;
          c.globalAlpha = k * Math.exp(-a * 2.6); c.drawImage(RP, P[0] - rw / 2, P[1] - rh / 2, rw, rh); }
        c.restore(); this._glow(P[0], P[1], 34, LP, 1.2 * Math.exp(-d * 6)); this._sparks(P[0], P[1], d, 26, 51, Math.PI, 2.0, 600, YELLOW); }
      else if (d >= 0 && d < 1.0) { const P = [x - w * 0.32, y - 20]; c.save(); c.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 4; i++) { const a = d - i * 0.08; if (a < 0) continue; const f = Math.exp(-a * 3) * k;
          c.strokeStyle = rgba(i % 2 ? WHITE : LP, 0.85 * f); c.lineWidth = 3; c.beginPath(); c.ellipse(P[0], P[1], 12 + a * 90, 30 + a * 260, 0, 0, Math.PI * 2); c.stroke(); }
        c.restore(); this._glow(P[0], P[1], 34, LP, 1.2 * Math.exp(-d * 6)); this._sparks(P[0], P[1], d, 26, 51, Math.PI, 2.0, 600, YELLOW); }
    }

    _hit(t) {
      if (this.targetReact && this.targetReact !== 'DAMAGE') return this._enemyReact(t);
      if (this.mirrorRP) { const c = this.ctx, lt = t - this.move.segments.hit[0], rp = this.mirrorRP;
        c.save(); c.translate(W, 0); c.scale(-1, 1); rp.renderAt(lt - 0.45 + rp.T); c.restore(); return; }
      if (this.hitStyle) return this._hitStyled(t, this.hitStyle);
      const Hd = this.move.hit, t0 = this.move.segments.hit[0], lt = t - t0;
      this._bg(900 - 25 * lt, 1.0);
      const tg = this.target;
      // 擊退量（每次命中累加）
      let kb = 0, flash = 0, red = 0;
      for (const h of Hd.impacts) { const d = lt - h.t; if (d < 0) continue;
        kb += 10 * h.power * (1 + 0.08 * this.dmg) * (1 - Math.exp(-d * 8));
        if (d < 0.06) flash = 0.85; else if (d < 0.5 && Math.floor(t * 24) % 2 === 0) red = Math.max(red, 0.45 * Math.exp(-d * 3)); }
      const cx = 860 + Math.min(kb, 140 + 12 * this.dmg), cy = 380 + 6 * Math.sin(lt * 4);
      const box = tg.box;  // 受擊判定框：[寬, 高]，相對中心
      if (this.targetSeq) {
        const HS = tg.hit_seq, img = this.targetSeq[clamp(Math.floor(lt * (HS.fps || 24)), 0, this.targetSeq.length - 1)];
        const s = (HS.scale || (box[1] * 1.3 / img.height)) * ENEMY_UP;
        const vanish = this.dmg >= 5 && Hd.finale ? 1 - clamp((lt - Hd.finale - 0.3) / 0.5, 0, 1) : 1;   // 等級 5：在火球中消失
        const burn = clamp(0.12 * this.dmg * clamp((lt - 0.2) / 1.5, 0, 1), 0, 0.55);                     // 裝甲燒焦變暗
        if (vanish > 0) this._sprite(img, cx, cy, s, -Math.min(6, kb * 0.05), vanish, flash ? WHITE : (red ? RED : [25, 15, 10]), flash ? 0.3 : (red ? red * 0.5 : burn));   // 序列本身已有受擊火花，閃白／閃紅只輕輕帶過
      } else if (this.img.target) {
        const s = tg.scale || 1; this._sprite(this.img.target, cx, cy, s, -Math.min(10, kb * 0.08), 1, flash ? WHITE : RED, flash || red);
      } else this._placeholder(cx, cy, box, flash, red, kb);
      // 命中點：散佈在受擊框內（依招式設定的落點）
      const pts = Hd.points.map(p => [cx + p[0] * box[0] / 2, cy + p[1] * box[1] / 2]);
      // 斬擊：主角帶殘影高速穿過
      for (const sl of Hd.slashes || []) { const d = lt - sl.t; if (d < -0.12 || d > 0.4) continue;
        const u = clamp((d + 0.12) / 0.2, 0, 1), y = cy + sl.y * box[1] / 2;
        const x = lerp(-200, W + 200, u);
        if (u < 1) for (let k = 0; k < 6; k++) this._sprite(this.img.part_body, x - 70 * k, y, this.move.action.scale * 0.7, 8, (0.45 - 0.07 * k), CYAN, 0.75, this.move.parts.body.anchor);
        const f = 1 - clamp(d / 0.4, 0, 1);
        if (d > 0) { const a = sl.angle * Math.PI / 180, L = 360;
          const p0 = [cx - Math.cos(a) * L, cy + sl.y * box[1] / 2 - Math.sin(a) * L], p1 = [cx + Math.cos(a) * L, cy + sl.y * box[1] / 2 + Math.sin(a) * L];
          this._line(p0[0], p0[1], p1[0], p1[1], CYAN, 1.4 * f, 10); this._line(p0[0], p0[1], p1[0], p1[1], WHITE, 1.2 * f, 3); } }
      // 連環爆炸（大量火力）
      Hd.impacts.forEach((h, i) => {
        const p = pts[h.p % pts.length]; this._explosion(p[0] + (h.dx || 0), p[1] + (h.dy || 0), lt - h.t, h.power * (1 + 0.1 * this.dmg), 1000 + i * 37, h.color === 'cyan' ? CYAN : ORANGE);
      });
      this._damageFX(lt, cx, cy, box, pts, Hd);
      // 終結大爆炸前的全畫面白光（等級 5 更久）
      if (Hd.finale) { const d = lt - Hd.finale, len = this.dmg >= 5 ? 0.6 : 0.25; if (d >= 0 && d < len) { this.ctx.fillStyle = rgba(WHITE, 0.9 * (1 - d / len)); this.ctx.fillRect(0, 0, W, H); } }
    }


    // ═════════ 分招受擊特效（data/hit_styles.json，2026-10-18）：近戰＝刀痕，射擊＝依距離與威力 ═════════
    _enemyImg(lt) {
      if (this.targetSeq) { const HS = this.target.hit_seq; return this.targetSeq[clamp(Math.floor(lt * (HS.fps || 24)), 0, this.targetSeq.length - 1)]; }
      return this.img.target || null;
    }
    // 畫敵機（有圖用圖；沒有圖用佔位幅）
    _drawEnemy(img, s, x, y, rot = 0, alpha = 1, tint = null, tk = 0) {
      if (img) this._sprite(img, x, y, s, rot, alpha, tint, tk);
      else this._placeholder(x, y, this.target.box, tk > 0.5 && tint === WHITE ? 1 : 0, 0, 0);
    }
    _hitStyled(t, S) {
      const lt = t - this.move.segments.hit[0], tg = this.target, box = tg.box;
      this._bg(900 - 25 * lt, 1.0);
      const img = this._enemyImg(lt);
      const s = (img ? ((tg.hit_seq && tg.hit_seq.scale) || (this.targetSeq ? box[1] * 1.3 / img.height : (tg.scale || 1))) : 1) * ENEMY_UP;
      const T = S.t || 0.3;
      const push = (S.push || 0) * (1 - Math.exp(-Math.max(0, lt - T) * 6));
      const cx = 860 + push, cy = 380 + 4 * Math.sin(lt * 4);
      const E = { lt, T, img, s, cx, cy, box };
      if (S.type === 'pierce') this._hsPierce(E, S);
      else if (S.type === 'cleave') this._hsCleave(E, S);
      else if (S.type === 'shatter') this._hsShatter(E, S);
      else if (S.type === 'super') this._hsSuper(E, S);
      else if (S.type === 'combo') this._hsCombo(E, S);
      else this._hsShots(E, S);
    }
    // 雲雀連打（2026-10-24 開發者）：雲雀直接出現在敵機身旁，播自己的出拳／踢擊動作（去背整段），
    // 每一下命中（hits＝動作裡拳頭閃光的格號）敵機就受擊一次；最後一擊依 finish：up＝昇龍擊飛上天、off＝撞飛出畫面、boom＝撞飛＋爆炸、phoenix＝鳳凰飛撲全屏爆炸、back＝擊退
    _hsCombo(E, S) {
      const { lt, img, s, box } = E, c = this.ctx, fps = S.fps || 30, [a, b] = S.range || [1, this.comboSeq.length], lead = S.lead || 0.15;
      const hitT = (S.hits || []).map(f => lead + (f - a) / fps), last = hitT.length ? hitT[hitT.length - 1] : lead;
      const mv = (this.move.id || '').replace(/^HIBARI_G?F?/, '').slice(0, 2);   // 01～08（完全體 F01～F06 用同一套）
      const fi = clamp(a - 1 + Math.floor(Math.max(0, lt - lead) * fps), a - 1, b - 1), H = this.comboSeq[fi];
      // 敵機位置：每一下輕微後退，最後一擊依 finish 飛走
      let ex = 860, ey = 380 + 4 * Math.sin(lt * 4), rot = 0, ealpha = 1;
      hitT.forEach((ht, i) => { const d = lt - ht; if (d > 0 && i < hitT.length - 1) ex += 12 * (1 - Math.exp(-d * 10)); });
      const dl = lt - last;
      if (dl > 0) {
        if (S.finish === 'up') { const u = dl; ey -= 1400 * u * u + 260 * u; ex += 60 * u; rot = -400 * u; }
        else if (S.finish === 'off' || S.finish === 'boom') { ex += 1900 * dl * dl + 500 * dl; ey -= 120 * dl; rot = 260 * dl; }
        else if (S.finish === 'back') ex += 120 * (1 - Math.exp(-dl * 6));
        else if (S.finish === 'phoenix') ealpha = 1;
      }
      const flash = hitT.some(ht => lt >= ht && lt < ht + 0.05);
      const red = hitT.some(ht => lt >= ht + 0.05 && lt < ht + 0.25);
      // 雲雀：拳頭位置（reach，序列畫面座標）對準敵機左緣
      const k = this._comboK(S, E), reach = S.reach || [950, 300], tgtX = 860 - box[0] * 0.42 * ENEMY_UP, tgtY = 380 - box[1] * 0.1 * ENEMY_UP;
      let hx = tgtX - reach[0] * k, hy = tgtY - reach[1] * k;
      const dash = smooth(0, lead, lt);                       // 進場：從左邊一閃而入（殘影）
      const hx0 = hx - 420 * (1 - dash);
      if (dash < 1) for (let j = 3; j >= 1; j--) { c.save(); c.globalAlpha = 0.25 * j / 3; c.drawImage(H, hx0 - j * 60, hy, H.width * k, H.height * k); c.restore(); }
      // 2026-10-25 開發者：07／08 要先明鏡止水 → 連打時雲雀背後也要有光環（原本只在被拿掉的動作段才有）
      const HA = this.move.action && this.move.action.halo && this.haloImg ? this.move.action.halo : null;
      const drawH = () => { if (HA) this._moveHalo(HA, fi, lt, hx0, hy, k, false);
        if (S.finish === 'phoenix' && lt > last && this.cleanHold) {   // 2026-10-27 開發者選 A：鳳凰飛出後 0.1 秒淡入「圖片區擦掉鳳凰的乾淨出拳格」並停住（手完整、鳳凰整隻消失）
          const CH = this.cleanHold, u = smooth(0, 0.1, lt - last);
          if (u < 1) { c.save(); c.globalAlpha = 1 - u; c.drawImage(H, hx0, hy, H.width * k, H.height * k); c.restore(); }
          c.save(); c.globalAlpha = u; c.drawImage(CH, hx0, hy, CH.width * k, CH.height * k); c.restore();
        } else if (S.finish === 'phoenix' && lt > last) {   // 還沒有乾淨格的招式：舊做法（拳頭前方淡掉）
          const cut = tgtX - 10, fa = 1 - smooth(0, 0.15, lt - last);
          c.save(); c.beginPath(); c.rect(0, 0, cut, 720); c.clip(); c.drawImage(H, hx0, hy, H.width * k, H.height * k); c.restore();
          if (fa > 0.01) { c.save(); c.globalAlpha = fa; c.beginPath(); c.rect(cut, 0, W - cut, 720); c.clip(); c.drawImage(H, hx0, hy, H.width * k, H.height * k); c.restore(); }
        } else c.drawImage(H, hx0, hy, H.width * k, H.height * k);
        if (HA) this._moveHalo(HA, fi, lt, hx0, hy, k, true); };
      if (S.behind) drawH();   // 衝過敵機身旁（03）：雲雀畫在敵機後面
      if (!(S.finish === 'up' && dl > 0.6) && !((S.finish === 'off' || S.finish === 'boom') && dl > 0.5))
        this._drawEnemy(img, s, ex, ey, rot, ealpha, flash ? WHITE : (red ? RED : null), flash ? 0.6 : 0.35);
      if (!S.behind) drawH();
      // 命中特效
      const P = [tgtX + 10, tgtY];
      hitT.forEach((ht, i) => { const d = lt - ht; if (d < 0 || d > 0.6) return; const big = i === hitT.length - 1;
        const py = P[1] + ((i * 53) % 90 - 45);
        this._glow(P[0], py, big ? 60 : 34, YELLOW, (big ? 1.6 : 1.1) * Math.exp(-d * 8));
        c.save(); c.globalCompositeOperation = 'lighter'; c.strokeStyle = rgba(WHITE, Math.max(0, 1 - d / 0.2)); c.lineWidth = 4;
        c.beginPath(); c.ellipse(P[0], py, 20 + d * (big ? 700 : 380), 12 + d * (big ? 400 : 220), 0, 0, Math.PI * 2); c.stroke(); c.restore();
        this._sparks(P[0], py, d, big ? 40 : 18, 3000 + i, 0, 1.4, big ? 900 : 600, i % 2 ? ORANGE : YELLOW);
        this._hbHit(mv, i, hitT.length, P[0], py, d, big, E); });
      // 收尾特效
      if (dl > 0) {
        if (S.finish === 'up') {   // 昇龍：沖天火柱＋旋轉火焰
          const f = 1 - smooth(0.9, 1.4, dl);
          this._au('S_hb05_rise', P[0] + 50 + 40 * dl, P[1] + 160, 260 * (0.8 + 0.4 * smooth(0, 0.3, dl)), { ay: 1, h: 760 * smooth(0, 0.25, dl), rot: 0.12, alpha: 0.85 * f, blend: 'lighter' });   // 上升氣流：微微往右上斜，跟著敵機飛走的方向
          for (let i = 0; i < 30; i++) { const r = rng(3100 + i), u = (dl * 2 + r()) % 1, yy = lerp(P[1] + 120, -100, u), xx = P[0] + 40 + Math.sin(u * 12 + i) * 60;
            this._glow(xx, yy, 18 + 18 * r(), i % 2 ? ORANGE : YELLOW, 0.6 * f * (1 - u)); }
          this._line(P[0] + 40, P[1] + 140, P[0] + 60, -60, ORANGE, 0.9 * f, 26);
        }
        if (S.finish === 'boom' && dl > 0.35) this._explosion(Math.min(W - 60, ex), ey, dl - 0.35, 2.0, 3200, ORANGE);
        if ((S.finish === 'off' || S.finish === 'boom') && dl < 0.6) this._speedLines(lt, 1 - dl / 0.6, 41, -1);
        if (S.finish === 'phoenix') {   // 鳳凰飛撲：火鳥從雲雀飛向敵機 → 全屏爆炸
          const ph = this.img.hitSprite, u = smooth(0, 0.35, dl);
          if (ph && dl < 0.4) { const w = 420, x = lerp(hx + H.width * k * 0.6, ex, u), y = lerp(hy + H.height * k * 0.35, ey, u);
            for (let j = 3; j >= 0; j--) { c.save(); c.globalAlpha = j ? 0.25 : 1; c.globalCompositeOperation = 'lighter'; c.drawImage(ph, x - w / 2 - j * 50, y - w * ph.height / ph.width / 2, w, w * ph.height / ph.width); c.restore(); } }
          if (dl > 0.35) { const d2 = dl - 0.35; this._explosion(ex, ey, d2, 3.0, 3300, ORANGE); this._explosion(ex - 150, ey + 60, d2 - 0.08, 2.0, 3301, ORANGE); this._explosion(ex + 120, ey - 80, d2 - 0.15, 2.0, 3302, ORANGE);
            if (d2 < 0.5) { c.fillStyle = rgba([255, 230, 170], 0.9 * (1 - d2 / 0.5)); c.fillRect(0, 0, W, H); } }
        }
      }
    }

    // 2026-10-27 開發者：敵機至少比我方大 120%（看長邊：扁平敵機用寬度）。雲雀預設比原本 0.78 再縮 10%，還不夠就再縮
    _comboK(S, E) {
      const tg = this.target, base = (S.scale || 0.78) * 0.9;
      if (!S.body_h || !tg.vis || !E.img) return base;
      const ss = tg.stand_size || [1, 1], eLong = tg.vis[1] * E.s * Math.max(1, ss[0] / ss[1]);
      return Math.min(base, eLong / 1.2 / S.body_h);
    }

    // 雲雀每一擊的命中素材（依出招方向擺）：x,y＝命中點，d＝命中後經過秒數，n＝總擊數
    _hbHit(mv, i, n, x, y, d, big, E) {
      if (d < 0 || d > 0.6) return; const c = this.ctx, fade = 1 - smooth(0.12, 0.45, d), pop = 0.75 + 0.35 * smooth(0, 0.08, d);
      if (mv === '01') {          // 雀步連環拳：左右直拳略帶上下角度，最後一下上勾拳往上斜
        const rot = big ? -0.75 : (i % 2 ? -0.16 : 0.12);
        this._au('S_hb01_fist', x + 10, y, (big ? 300 : 210) * pop, { ax: 0.82, rot, alpha: 0.3 * fade });   // 2026-10-25 開發者：拳影淡化到 30%   // 2026-10-25 機械拳（實心，不用發光疊加）
      } else if (mv === '02') {   // 鷹爪擒拿：掌印貼在敵機正面（側面看壓扁），只畫在機體上
        const { img, s } = E; this._onEnemy(img, s, E.cx, E.cy, () => { const g = this.ctx; g.save(); g.translate(x + 6, y); g.rotate(-0.25 + i * 0.25); g.scale(0.45, 1);
          this._au('S_hb02_palm', 0, 0, 210 * pop, { alpha: fade }); g.restore(); });   // 2026-10-25 機械掌
      } else if (mv === '03') {   // 白鶴亮翅踢：弧光沿著左右輪流的踢腿弧線
        const rot = i % 2 ? Math.PI * 0.85 : -0.35;
        this._au('S_hb03_arc', x - 20, y - 10, (big ? 380 : 300) * pop, { rot, alpha: fade, blend: 'lighter' });
      } else if (mv === '05') {   // 雲雀鑽天掌：旋轉連擊，小弧光往上捲
        this._au('S_hb03_arc', x - 10, y, 220 * pop, { rot: -1.1 - i * 0.5, alpha: 0.8 * fade, blend: 'lighter' });
      } else if (mv === '06') {   // 隼落鐵山靠：衝擊波對準肩膀撞擊方向（往右），側面看壓扁
        c.save(); c.translate(x, y); c.rotate(Math.PI / 2); c.scale(1, 0.6);
        this._au('S_hb06_wave', 0, 0, (300 + 500 * d), { ay: 0.9, alpha: 1 - smooth(0.2, 0.6, d), blend: 'lighter' }); c.restore();
      } else if (mv === '07') {   // 朱雀神掌：貼身一掌的爆光，旋轉擴散
        this._au('S_hb07_burst', x + 20, y, (280 + 600 * d), { rot: d * 2, alpha: 1 - smooth(0.25, 0.6, d), blend: 'lighter' });
      }
    }

    // 火花（純函數）：從 (x,y) 往 dir 方向噴
    _sparks(x, y, age, n, seed, dir = 0, spread = 1.2, speed = 520, col = YELLOW) {
      if (age < 0 || age > 0.7) return; const r = rng(seed);
      for (let i = 0; i < n; i++) { const a = dir + (r() - 0.5) * spread, sp = speed * (0.4 + r()), l = 18 + 30 * r();
        const px = x + Math.cos(a) * sp * age, py = y + Math.sin(a) * sp * age + 500 * age * age;
        this._line(px, py, px - Math.cos(a) * l, py - Math.sin(a) * l, col, 1.2 * (1 - age / 0.7), 2.5); }
    }
    // 刀痕線（白芯＋外光）
    _slashLine(x0, y0, x1, y1, k, col = CYAN, w = 12) {
      if (k <= 0.01) return; this._line(x0, y0, x1, y1, col, 1.3 * k, w); this._line(x0, y0, x1, y1, WHITE, 1.4 * k, w * 0.3);
    }

    // ① 衝刺穿刺破壞點
    // AURORA 命中素材：以 (x,y) 為錨點畫，w＝寬、h＝高（省略照比例）；ax/ay＝錨點在圖上的比例
    _au(name, x, y, w, o = {}) { const im = this.auVfx && this.auVfx[name]; if (!im) return false; if (o.alpha != null && o.alpha <= 0.01) return true;
      const c = this.ctx, h = o.h || w * im.height / im.width;
      c.save(); c.globalAlpha = o.alpha == null ? 1 : o.alpha; if (o.blend) c.globalCompositeOperation = o.blend; c.translate(x, y); if (o.rot) c.rotate(o.rot);
      c.drawImage(im, -w * (o.ax == null ? 0.5 : o.ax), -h * (o.ay == null ? 0.5 : o.ay), w, h); c.restore(); return true; }
    // 素材爆炸：S_boom 4 張依序播（每張 0.11 秒），最後一張煙慢慢上飄淡出
    _boomAt(x, y, a, size) {
      const F = this.boomSpr; if (!F || F.length < 4 || a < 0 || a > 1.0) return false;
      const i = Math.min(3, Math.floor(a / 0.11)), im = F[i], k = size / Math.max(im.width, im.height) * (0.8 + 0.4 * Math.min(1, a / 0.2));
      const c = this.ctx; c.save(); c.globalAlpha = i < 3 ? 1 : 1 - smooth(0.4, 1.0, a);
      c.drawImage(im, x - im.width * k / 2, y - im.height * k / 2 - (i === 3 ? 60 * (a - 0.33) : 0), im.width * k, im.height * k); c.restore(); return true;
    }
    // 只畫在敵機身上：畫在暫存畫布，再用敵機圖當遮罩（破口、燒痕要貼著機體表面）
    _onEnemy(img, s, x, y, draw) { if (!img) { draw(this.ctx); return; }
      const cv = this._oeCv || (this._oeCv = document.createElement('canvas')); cv.width = W; cv.height = H; const g = cv.getContext('2d'), main = this.ctx;
      g.clearRect(0, 0, W, H); this.ctx = g; draw(g); g.globalCompositeOperation = 'destination-in'; g.drawImage(img, x - img.width * s / 2, y - img.height * s / 2, img.width * s, img.height * s); g.globalCompositeOperation = 'source-over';
      this.ctx = main; main.drawImage(cv, 0, 0); }
    _hsPierce(E, S) {
      const { lt, T, img, s, cx, cy, box } = E, c = this.ctx;
      const P = [cx - box[0] * 0.04, cy - box[1] * 0.06];
      // 衝刺光跡：從畫面左邊直貫穿過敵機
      const dk = smooth(T - 0.18, T, lt) * (1 - smooth(T + 0.1, T + 0.45, lt));
      if (dk > 0.01 && !this._au('S_au01_blade', P[0] + box[0] * 0.7 * dk, P[1], 700, { ax: 1, alpha: dk, blend: 'lighter' })) { this._line(-100, P[1], P[0] + box[0] * 0.7 * dk, P[1], CYAN, 1.2 * dk, 46); this._line(-100, P[1], P[0] + box[0] * 0.7 * dk, P[1], WHITE, 1.3 * dk, 12); }
      const fl = lt >= T && lt < T + 0.07 ? 0.7 : 0;
      const shudder = lt > T ? Math.sin(lt * 70) * 3 * Math.exp(-(lt - T) * 3) : 0;
      const late = smooth(1.9, 2.3, lt);
      this._drawEnemy(img, s, cx + shudder, cy, -2 * late, 1, fl ? WHITE : [20, 12, 8], fl || 0.25 * late);
      if (lt < T) return;
      const a = lt - T, g = smooth(0, 0.2, a);
      // 破壞點：龜裂由穿刺點往外擴散
      const r0 = rng(321);
      for (let i = 0; i < 9; i++) { const ang = (i / 9) * Math.PI * 2 + r0() * 0.4, len = (0.18 + 0.2 * r0()) * box[0] * g * (1 + 0.6 * late);
        let x = P[0], y = P[1];
        c.save(); c.strokeStyle = rgba([10, 10, 14], 0.85); c.lineWidth = 3; c.beginPath(); c.moveTo(x, y);
        for (let k = 1; k <= 4; k++) { x = P[0] + Math.cos(ang + (r0() - 0.5) * 0.5) * len * k / 4; y = P[1] + Math.sin(ang + (r0() - 0.5) * 0.5) * len * k / 4; c.lineTo(x, y); }
        c.stroke(); c.restore();
        this._line(P[0], P[1], x, y, CYAN, 0.5 * g + 0.8 * late, 2); }
      // 穿孔：黑洞＋青色邊光
      c.fillStyle = 'rgba(5,5,10,0.95)'; c.beginPath(); c.arc(P[0], P[1], 16 * g, 0, Math.PI * 2); c.fill();
      this._glow(P[0], P[1], 24, CYAN, 0.9 * g * (0.7 + 0.3 * Math.sin(lt * 25)));
      this._au('S_au01_pierce', P[0] - 30, P[1], 520 * (0.6 + 0.4 * g), { ax: 0.1, alpha: Math.exp(-a * 2.2), blend: 'lighter' });   // 刺穿光：從穿刺點往背面貫出
      // 背面噴出火花（往右）
      this._sparks(P[0] + 20, P[1], a, 26, 41, 0, 0.9, 700);
      this._sparks(P[0] + 20, P[1], a - 0.9, 12, 42, 0, 0.9, 500);
      this._sparks(P[0] + 20, P[1], a - 1.5, 12, 43, 0, 0.9, 500);
      // 破壞點最後爆出貫穿光
      const b = lt - 2.15;
      if (b > 0) this._au('S_au01_pierce', P[0] - 60, P[1], 900, { ax: 0.05, alpha: Math.exp(-b * 2.5), blend: 'lighter' });
      if (b > 0) { const k = Math.exp(-b * 3); this._line(P[0] - 60, P[1], W + 50, P[1], ICE, 1.4 * k, 70 * k + 10); this._glow(P[0], P[1], 60, WHITE, 1.3 * k); this._sparks(P[0], P[1], b, 40, 44, 0, 2.6, 800); }
      if (lt >= T && lt < T + 0.08) { c.fillStyle = rgba(WHITE, 0.6); c.fillRect(0, 0, W, H); }
    }

    // ② 由上而下一斬，機體從中剖半
    _hsCleave(E, S) {
      const { lt, T, img, s, cx, cy, box } = E, c = this.ctx;
      const top = [cx + 26, cy - box[1] * 0.78], bot = [cx - 26, cy + box[1] * 0.78];
      const dx = (bot[0] - top[0]) / (bot[1] - top[1]);
      const A = [top[0] - dx * 2000, top[1] - 2000], B = [bot[0] + dx * 2000, bot[1] + 2000];
      const SP = T + 0.65;   // 開始分離
      const fl = lt >= T && lt < T + 0.07 ? 0.7 : 0;
      if (lt < SP) {
        this._drawEnemy(img, s, cx, cy, 0, 1, fl ? WHITE : null, fl);
      } else {
        const d = lt - SP, piv = [cx, cy + box[1] * 0.5];
        const half = (sign, poly) => {
          c.save(); c.translate(sign * (26 * d + 50 * d * d), 70 * d * d);
          c.translate(piv[0], piv[1]); c.rotate(sign * (4 + 7 * d) * d * Math.PI / 180); c.translate(-piv[0], -piv[1]);
          c.beginPath(); c.moveTo(poly[0][0], poly[0][1]); for (const p of poly.slice(1)) c.lineTo(p[0], p[1]); c.closePath(); c.clip();
          this._drawEnemy(img, s, cx, cy, 0, 1, [20, 12, 8], clamp(0.15 * d, 0, 0.35));
          c.restore();
          // 切口發光（跟著半邊移動）
          c.save(); c.translate(sign * (26 * d + 50 * d * d), 70 * d * d);
          c.translate(piv[0], piv[1]); c.rotate(sign * (4 + 7 * d) * d * Math.PI / 180); c.translate(-piv[0], -piv[1]);
          this._line(top[0], top[1], bot[0], bot[1], CYAN, 0.9 * Math.exp(-d * 0.8), 8); this._line(top[0], top[1], bot[0], bot[1], ORANGE, 0.6 * Math.exp(-d), 3);
          c.restore();
        };
        half(-1, [[cx - 3000, A[1]], A, B, [cx - 3000, B[1]]]);
        half(1, [A, [cx + 3000, A[1]], [cx + 3000, B[1]], B]);
        // 切口落下的火花
        for (let k = 0; k < 4; k++) this._sparks(cx + (k - 1.5) * 8, cy + (k - 1.5) * box[1] * 0.3, (d % 0.7), 6, 60 + k + Math.floor(d / 0.7) * 7, Math.PI / 2, 1.6, 260, ORANGE);
      }
      // 刀痕：由上往下劃過
      const sd = clamp((lt - T + 0.1) / 0.1, 0, 1);
      if (lt >= T - 0.1) {
        const k = lt < SP ? 1 : Math.exp(-(lt - SP) * 4);
        const ex = top[0] + (bot[0] - top[0]) * sd, ey = top[1] + (bot[1] - top[1]) * sd;
        { const y0 = top[1] - 60, y1 = ey + 60 * sd, L2 = Math.hypot(ex - top[0], y1 - y0), ang = Math.atan2(y1 - y0, ex - top[0]);   // 青色斬痕素材沿刀路拉長
          if (!this._au('S_au02_slash', top[0], y0, Math.max(1, L2), { ax: 0, rot: ang, h: 150, alpha: k, blend: 'lighter' })) this._slashLine(top[0], top[1] - 60, ex, ey + 60 * sd, k, CYAN, 18); }
        if (lt >= T) { const a2 = lt - T; this._au('S_au02_xspark', cx, cy, 360 * (0.7 + 0.5 * smooth(0, 0.15, a2)), { alpha: Math.exp(-a2 * 3), blend: 'lighter' }); }
        if (lt < T + 0.15) this._glow(ex, ey, 40, WHITE, 1.2);
      }
      if (lt >= T && lt < T + 0.08) { c.fillStyle = rgba(WHITE, 0.6); c.fillRect(0, 0, W, H); }
    }

    // ③ 次元斬：七道斬光，機體碎成八塊分散
    _hsShatter(E, S) {
      const { lt, T, img, s, cx, cy, box } = E, c = this.ctx, PURPLE = [170, 90, 255];
      const SH = T + 0.85, N = 8;
      const cuts = [[-35, -0.25], [40, 0.1], [-70, 0.3], [15, -0.4], [75, -0.05], [-20, 0.42], [55, -0.3]];
      const fl = lt >= T && lt < SH && Math.floor(lt * 24) % 3 === 0 ? 0.35 : 0;
      if (lt < SH) {
        this._drawEnemy(img, s, cx, cy, 0, 1, fl ? WHITE : null, fl);
      } else {
        const d = lt - SH, r = rng(777);
        for (let k = 0; k < N; k++) {
          const a0 = (k / N) * Math.PI * 2 + (r() - 0.5) * 0.3, a1 = ((k + 1) / N) * Math.PI * 2 + (r() - 0.5) * 0.3, am = (a0 + a1) / 2;
          const v = 110 + 150 * r(), rot = (r() - 0.5) * 70;
          const ox = Math.cos(am) * v * d, oy = Math.sin(am) * v * d + 40 * d * d;
          c.save(); c.translate(ox, oy); c.translate(cx, cy); c.rotate(rot * d * Math.PI / 180); c.translate(-cx, -cy);
          c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(a0) * 2000, cy + Math.sin(a0) * 2000);
          c.lineTo(cx + Math.cos(am) * 2400, cy + Math.sin(am) * 2400); c.lineTo(cx + Math.cos(a1) * 2000, cy + Math.sin(a1) * 2000); c.closePath();
          c.save(); c.clip(); this._drawEnemy(img, s, cx, cy, 0, 1 - smooth(2.4, 2.9, lt) * 0.6, [30, 10, 50], clamp(0.2 * d, 0, 0.4)); c.restore();
          const ek = Math.exp(-d * 1.2);
          if (!(this.auVfx && this.auVfx.S_au03_rift)) this._line(cx, cy, cx + Math.cos(a0) * box[1] * 0.7, cy + Math.sin(a0) * box[1] * 0.7, PURPLE, 0.9 * ek, 5);
          c.restore();
        }
        for (let i = 0; i < 30; i++) { const rr = rng(880 + i), a = rr() * Math.PI * 2, sp = 80 + 260 * rr();
          this._glow(cx + Math.cos(a) * sp * d, cy + Math.sin(a) * sp * d, 3 + 3 * rr(), PURPLE, (1 - clamp(d / 1.8, 0, 1)) * 0.9); }
      }
      if (lt >= T) { const a3 = lt - T; this._au('S_au03_rift', cx, cy, box[0] * 1.6 * smooth(0, 0.5, a3), { rot: -0.35, alpha: lt < SH ? 0.95 : Math.exp(-(lt - SH) * 1.8), blend: 'lighter' }); }   // 次元裂縫
      if (lt >= SH) { const d3 = lt - SH; for (let i = 0; i < 6; i++) { const r = rng(990 + i), ang = r() * Math.PI * 2, v = 160 + 220 * r();   // 空間碎片往外飛散
        this._au('S_au03_shards', cx + Math.cos(ang) * v * d3, cy + Math.sin(ang) * v * d3, 180 + 120 * r(), { rot: (r() - 0.5) * 4 * d3 + ang, alpha: 1 - smooth(1.2, 2.0, d3), blend: 'lighter' }); } }
      // 七道斬光（逐一出現，留下紫色裂痕）
      cuts.forEach(([ang, off], i) => {
        const ti = T + i * 0.09; if (lt < ti) return;
        const a = ang * Math.PI / 180, L = box[1] * 1.0, ox = -Math.sin(a) * off * box[0], oy = Math.cos(a) * off * box[0] * 0.5;
        const x0 = cx + ox - Math.cos(a) * L, y0 = cy + oy - Math.sin(a) * L, x1 = cx + ox + Math.cos(a) * L, y1 = cy + oy + Math.sin(a) * L;
        const fresh = Math.exp(-(lt - ti) * 6), keep = lt < SH ? 0.8 : 0.8 * Math.exp(-(lt - SH) * 1.5);
        if (!(this.auVfx && this.auVfx.S_au03_rift)) { this._slashLine(x0, y0, x1, y1, fresh, ICE, 16);   // 2026-10-25 開發者：不要分割線，改用素材
          this._line(x0, y0, x1, y1, PURPLE, keep, 6); this._line(x0, y0, x1, y1, [20, 0, 40], keep, 2); }
        else this._au('S_au03_rift', (x0 + x1) / 2, (y0 + y1) / 2, L * 1.1, { rot: a, h: 90, alpha: fresh * 0.9, blend: 'lighter' });   // 每一斬：一道次元裂縫素材閃過
      });
      if (lt >= SH && lt < SH + 0.1) { c.fillStyle = rgba(WHITE, 0.7 * (1 - (lt - SH) / 0.1)); c.fillRect(0, 0, W, H); }
    }

    // ═════════ 超級系受擊（轟天巨神）v2，2026-10-21 開發者第二次指定 ═════════
    //   multi＝連打：每一拳一個擊破點，不同位置各自爆破        punch＝單一擊破點（火箭鐵拳）
    //   erupt＝地面爆破往上衝，敵機被炸飛起來                 ram＝轟天巨神半透明殘影整台衝撞，撞上引爆
    //   drill＝鑽頭從前胸鑽進去 → 停頓 → 從背後鑽出來           tornado＝不規則雲霧狀綠色龍捲
    //   flame＝猛烈火柱包裹燃燒                               freeze＝整塊冰封、冰刺、最後碎裂
    //   gold＝敵機身上亂數爆炸，金色火花紛飛籠罩整個螢幕
    _puff() {   // 柔邊雲霧圖（只做一次）
      if (this._puffImg) return this._puffImg;
      const cv = document.createElement('canvas'); cv.width = cv.height = 128; const g = cv.getContext('2d');
      const r = rng(4242);
      for (let i = 0; i < 9; i++) { const x = 64 + (r() - 0.5) * 40, y = 64 + (r() - 0.5) * 40, rr = 22 + r() * 26;
        const gr = g.createRadialGradient(x, y, 0, x, y, rr); gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.beginPath(); g.arc(x, y, rr, 0, Math.PI * 2); g.fill(); }
      return (this._puffImg = cv);
    }
    _tinted(img, col) {   // 把白色雲霧圖染色（依顏色快取）
      const key = col.join(','); this._tintCache = this._tintCache || {};
      if (this._tintCache[key]) return this._tintCache[key];
      const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height; const g = cv.getContext('2d');
      g.drawImage(img, 0, 0); g.globalCompositeOperation = 'source-in'; g.fillStyle = rgba(col, 1); g.fillRect(0, 0, cv.width, cv.height);
      return (this._tintCache[key] = cv);
    }
    _crater(x, y, a, size, seed) {   // 擊破點：凹陷＋放射裂痕＋發紅
      const c = this.ctx, g = smooth(0, 0.12, a), r0 = rng(seed);
      for (let i = 0; i < 9; i++) { const ang = i / 9 * Math.PI * 2 + r0() * 0.4, len = size * (1.2 + r0()) * g;
        let px = x, py = y; c.save(); c.strokeStyle = 'rgba(15,10,10,0.9)'; c.lineWidth = 3; c.beginPath(); c.moveTo(px, py);
        for (let j = 1; j <= 3; j++) { px = x + Math.cos(ang + (r0() - 0.5) * 0.6) * len * j / 3; py = y + Math.sin(ang + (r0() - 0.5) * 0.6) * len * j / 3; c.lineTo(px, py); }
        c.stroke(); c.restore(); }
      c.fillStyle = 'rgba(12,6,6,0.92)'; c.beginPath(); c.arc(x, y, size * 0.55 * g, 0, Math.PI * 2); c.fill();
      this._glow(x, y, size * 0.7, ORANGE, 0.9 * Math.exp(-a * 1.5) + 0.25);
    }

    _hsSuper(E, S) {
      const { lt, T, img, s, cx, cy, box } = E, c = this.ctx, k = S.kind, d = lt - T;
      const GOLD = [255, 200, 60], FIRE = [255, 110, 30], FROST = [170, 230, 255];
      const P = [cx + (S.px || -0.05) * box[0], cy + (S.py || -0.12) * box[1]];
      // ── 敵機位置：被炸飛（erupt）、被撞退（ram）、震動
      let ex = cx, ey = cy, rot = 0;
      if (k === 'erupt' && d > 0) { const u = Math.max(0, d - 0.12); ey = cy - (500 * u + 1500 * u * u); rot = -30 * Math.min(1, u); ex = cx + 40 * Math.min(1, u); }   // 2026-10-25：岩漿柱把敵機直接頂出畫面
      if (k === 'ram' && d > 0) ex = cx + 220 * (1 - Math.exp(-d * 4));
      if (d > 0 && d < 0.6) ex += Math.sin(lt * 90) * 7 * Math.exp(-d * 5);
      if ((k === 'multi' || k === 'gold') && d > -0.2) ex += Math.sin(lt * 70) * 4;
      // ── 敵機上色
      let tint = null, tk = 0;
      if (k === 'flame' && d > 0) { tint = [200, 50, 10]; tk = 0.2 + 0.3 * smooth(0, 1, d) + 0.08 * Math.sin(lt * 30); }
      else if (k === 'freeze' && d > 0) { tint = [120, 190, 235]; tk = 0.55 * smooth(0, 0.5, d); }
      else if (k === 'tornado' && d > 0) { tint = [50, 140, 40]; tk = 0.5 * smooth(0, 1, d); }
      else if (k === 'phoenix' && d > 0) { tint = [255, 110, 30]; tk = 0.25 + 0.25 * smooth(0, 0.6, d) + 0.08 * Math.sin(lt * 30); }
      else if (k === 'gold' && d > 0) { tint = [255, 220, 120]; tk = 0.35 + 0.15 * Math.sin(lt * 25); }
      if (d >= 0 && d < 0.05) { tint = WHITE; tk = 0.6; }
      const shatter = k === 'freeze' ? smooth(2.15, 2.2, d) : 0;
      const vanish = k === 'gold' ? 1 - smooth(2.3, 2.4, lt) : 1;   // 2026-10-25 開發者：框框的過渡降到 0.1 秒
      // 龍捲：後半圈雲霧畫在敵機後面
      if (k === 'tornado') this._tornado(E, d, ex, -1);
      if (vanish > 0.01 && shatter < 1 && k !== 'freeze') { c.save(); c.translate(ex, ey); c.rotate(rot * Math.PI / 180); c.translate(-ex, -ey);
        this._drawEnemy(img, s, ex, ey, 0, vanish, tint, tk); c.restore(); }
      const B = [ex - cx, ey - cy];   // 特效跟著敵機位移
      const at = (x, y) => [x + B[0], y + B[1]];

      if (k === 'multi') {                        // ① 連打：每拳一個擊破點，位置各不相同
        const N = S.hits || 7, t0 = T - 0.3, step = 1.25 / N, r = rng(3100);
        const pts = Array.from({ length: N }, () => [cx + (r() - 0.5) * box[0] * 0.7, cy + (r() - 0.65) * box[1] * 0.75]);
        pts.forEach((p, i) => { const a = lt - (t0 + i * step); if (a < 0) return; const q = at(p[0], p[1]);
          this._crater(q[0], q[1], a, 30, 3200 + i);
          this._au('S_ti10_dent', q[0], q[1], 70, { rot: i * 0.9, alpha: smooth(0, 0.05, a) });
          if (!this._boomAt(q[0], q[1], a, 230) && a < 0.4) this._au('S_ti10_fist', q[0] - 20, q[1], 160 + 260 * a, { alpha: 1 - a / 0.4 });   // 2026-10-25：改用爆炸素材
          this._explosion(q[0], q[1], a, 0.85, 3300 + i, ORANGE);
          if (a < 0.35) { c.save(); c.strokeStyle = rgba(WHITE, 0.9 * (1 - a / 0.35)); c.lineWidth = 6 * (1 - a / 0.35);
            c.beginPath(); c.ellipse(q[0], q[1], 12 + 120 * a, 30 + 380 * a, 0, 0, Math.PI * 2); c.stroke(); c.restore(); }   // B3：側面看的衝擊環
          if (a < 0.05) { c.fillStyle = rgba(WHITE, 0.35); c.fillRect(0, 0, W, H); } });
        const fa = lt - (t0 + N * step + 0.3); if (fa > 0) { const q = at(cx, cy); this._explosion(q[0], q[1], fa, 2.2, 3400, ORANGE); this._explosion(q[0] - 40, q[1] + 40, fa - 0.15, 1.6, 3401, ORANGE); }
      }

      else if (k === 'punch') {                   // ④ 火箭鐵拳：單一大擊破點
        if (d > -0.35 && d < 0.06) { const q0 = at(P[0], P[1]); this._au('S_ti13_rocket', lerp(-200, q0[0] + 40, smooth(-0.35, 0, d)), q0[1], 300, { ax: 0.85 }); }
        if (d < 0) return; const q = at(P[0], P[1]);
        if (!(this.boomSpr && this.boomSpr.length)) this._crater(q[0], q[1], d, 46, 321);
        this._boomAt(q[0], q[1], d, 380);   // 2026-10-25 開發者：凹痕太假 → 移除，改爆炸素材
        for (let i = 0; i < 3; i++) { const a = d - i * 0.08; if (a < 0 || a > 0.6) continue;
          c.save(); c.strokeStyle = rgba(WHITE, 0.9 * (1 - a / 0.6)); c.lineWidth = 8 * (1 - a / 0.6);
          c.beginPath(); c.ellipse(q[0], q[1], 16 + 230 * a, 40 + 700 * a, 0, 0, Math.PI * 2); c.stroke(); c.restore(); }   // B3：側面看的衝擊環
        this._sparks(q[0], q[1], d, 40, 330, 0, 2.6, 900);
        if (d > 1.2) this._explosion(q[0], q[1], d - 1.2, 2.0, 340, ORANGE);
        if (d < 0.08) { c.fillStyle = rgba(WHITE, 0.7); c.fillRect(0, 0, W, H); }
      }

      else if (k === 'erupt') {                   // ② 大車輪：地面爆破往上衝，敵機被炸飛
        const gy = cy + box[1] * 0.62;
        if (d > -0.5 && d < 0.35) { const u = smooth(-0.5, 0.05, d), wx = lerp(-200, cx - box[0] * 0.2, u), wr = 300;   // 火焰車輪滾進來
          this._au('S_ti11_wheel', wx, gy - wr * 0.42, wr, { rot: lt * 14, alpha: 1 - smooth(0.15, 0.35, d), blend: 'lighter' }); }
        for (let i = 3; i < 4; i++) { const r = rng(3500 + i), x = cx, a = d;   // 2026-10-25 開發者：只要一條
          if (a < 0) continue;
          // 爆破火柱往上衝
          if (a < 1.3) { const hgt = 2 * (520 + 120 * r()) * smooth(0, 0.25, a), w = 2 * (110 + 40 * r()), f = 1 - smooth(0.9, 1.3, a);   // 放大 200%
            if (!(this.auVfx && this.auVfx.S_ti11_lava)) { c.save(); c.globalCompositeOperation = 'lighter';   // 有岩漿柱素材就不畫程式火柱（2026-10-25：黃色梯形太突兀）
            const gr = c.createLinearGradient(0, gy, 0, gy - hgt); gr.addColorStop(0, rgba(YELLOW, 0.95 * f)); gr.addColorStop(0.5, rgba(FIRE, 0.7 * f)); gr.addColorStop(1, rgba(RED, 0));
            c.fillStyle = gr; c.beginPath(); c.moveTo(x - w / 2, gy); c.quadraticCurveTo(x - w * 0.2, gy - hgt * 0.6, x, gy - hgt); c.quadraticCurveTo(x + w * 0.2, gy - hgt * 0.6, x + w / 2, gy); c.fill(); c.restore(); }
            this._au('S_ti11_lava', x, gy + 10, w * 1.6 * 1.5, { ay: 1, h: hgt * 1.15 * 1.5, alpha: 0.65 * f }); }   // 2026-10-25：再放大 150%、透明度 65%
          this._explosion(x, gy - 20, a, 1.2, 3600 + i, ORANGE);
          // 碎石往上噴
          for (let j = 0; j < 8; j++) { const rr = rng(3700 + i * 10 + j), vx = (rr() - 0.5) * 300, vy = -(500 + 500 * rr()), px = x + vx * a, py = gy + vy * a + 900 * a * a;
            if (a > 1.4 || py > gy + 10) continue; c.fillStyle = '#4a3a30'; c.fillRect(px - 5, py - 4, 10 + 6 * rr(), 8); } }
        if (d > 0 && d < 0.1) { c.fillStyle = rgba(WHITE, 0.6); c.fillRect(0, 0, W, H); }
      }

      else if (k === 'ram') {                     // ③ 神角衝撞：轟天巨神半透明殘影整台撞上去
        const st = this.img.stand, ss = (this.attacker.stand_scale || 0.86) * 1.15;
        const tx = cx - box[0] * 0.55;                                   // 撞上時的位置
        const u = smooth(-0.45, 0, d), x = lerp(-450, tx, u), y = cy + 10;
        if (false && d < 0.25 && st) {   // 2026-10-25 開發者：不要 TITAN 機體虛影
          for (let i = 5; i >= 1; i--) { const uu = smooth(-0.45, 0, d - i * 0.04); this._sprite(st, lerp(-450, tx, uu), y, ss, 0, 0.12 * (6 - i) / 5, GOLD, 0.7); }
          this._sprite(st, x, y, ss, 0, 0.5 * (1 - smooth(0.05, 0.25, d)), GOLD, 0.25);       // 50% 半透明本體
          for (let i = 0; i < 6; i++) this._line(x - 300, y - 120 + i * 50, x - 40, y - 120 + i * 50, GOLD, 0.6 * u, 3);
          // 神角前端的雷電
          const hx = x + st.width * ss * 0.35, hy = y - st.height * ss * 0.38, r = rng(3900 + Math.floor(lt * 30));
          c.save(); c.strokeStyle = rgba([255, 240, 160], 0.9); c.lineWidth = 3; c.beginPath(); c.moveTo(hx, hy);
          let lx = hx, ly = hy; for (let i = 0; i < 6; i++) { lx += 20 + r() * 20; ly += (r() - 0.5) * 40; c.lineTo(lx, ly); } c.stroke(); c.restore();
        }
        if (d > -0.45 && d < 0.3) { const tip = at(P[0] - box[0] * 0.2, P[1]), u2 = smooth(-0.45, 0, d);
          const hx2 = lerp(-100, tip[0] + 60, u2), hw = 420 * (d > 0 ? 1 + 2 * d : 1), ha = d > 0 ? 1 - d / 0.3 : 1;
          this._au('S_ti12_horn', hx2, tip[1], hw, { ax: 0.85, alpha: 0.55 * ha, blend: 'lighter' });   // 半透明
          // 空氣灼燒裂光：沿著衝擊錐表面不斷迸出的鋸齒狀白金裂紋＋熱氣光暈
          c.save(); c.globalCompositeOperation = 'lighter';
          for (let i = 0; i < 7; i++) { const r = rng(4400 + i + Math.floor(lt * 24) * 7), x0 = hx2 - hw * (0.15 + 0.7 * r()), side = r() < 0.5 ? -1 : 1, y0 = tip[1] + side * hw * 0.12 * (0.3 + 0.7 * (hx2 - x0) / hw);
            c.strokeStyle = rgba(i % 2 ? [255, 245, 200] : [255, 190, 90], 0.85 * ha); c.lineWidth = 1.5 + 1.5 * r(); c.beginPath(); c.moveTo(x0, y0);
            let lx = x0, ly = y0; for (let j = 0; j < 4; j++) { lx -= 18 + 22 * r(); ly += side * (6 + 14 * r()) * (j % 2 ? -0.5 : 1); c.lineTo(lx, ly); } c.stroke(); }
          c.restore(); this._glow(hx2 - hw * 0.05, tip[1], hw * 0.12, [255, 200, 120], 0.6 * ha); }
        if (d >= 0) { const q = at(P[0] - box[0] * 0.2, P[1]);
          this._explosion(q[0], q[1], d, 2.4, 3950, ORANGE); this._explosion(q[0] + 60, q[1] - 50, d - 0.12, 1.6, 3951, GOLD);
          this._explosion(q[0] + 40, q[1] + 70, d - 0.25, 1.4, 3952, ORANGE);
          for (let i = 0; i < 3; i++) { const a = d - i * 0.07; if (a < 0 || a > 0.6) continue;
            c.save(); c.strokeStyle = rgba(GOLD, 0.9 * (1 - a / 0.6)); c.lineWidth = 10 * (1 - a / 0.6);
            c.beginPath(); c.ellipse(q[0], q[1], 20 + 270 * a, 50 + 800 * a, 0, 0, Math.PI * 2); c.stroke(); c.restore(); }   // B3：側面看的衝擊環
          if (d < 0.12) { c.fillStyle = rgba(WHITE, 0.8); c.fillRect(0, 0, W, H); } }
      }

      else if (k === 'drill') {                   // ⑤ 螺旋飛拳 v4：取動作段最後一格的飛拳（含尾焰、旋風環），做成半透明虛影，直線穿過敵機
        const sp = this.img.hitSprite, y = at(cx, P[1])[1];
        const front = at(cx - box[0] * 0.22, P[1])[0], back = at(cx + box[0] * 0.28, P[1])[0];
        const sc = (box[1] * 0.28) / (sp ? sp.height : 340), L = sp ? sp.width * sc : 200;   // 縮小：高度約敵機的 28%
        // 鑽頭尖端位置：飛進來 → 鑽入前胸 → 在體內停頓 → 從後背穿出飛走
        let tip;
        if (d < 0) tip = lerp(-L, front, smooth(-0.35, 0, d));
        else if (d < 0.35) tip = lerp(front, cx, smooth(0, 0.35, d));
        else if (d < 0.85) tip = cx + 6 * Math.sin(lt * 50);
        else tip = lerp(cx, back + L, smooth(0.85, 1.15, d)) + (d > 1.15 ? (d - 1.15) * 1600 : 0);
        const vis = 1 - smooth(1.4, 1.7, d);
        if (sp && vis > 0.01) {
          const drawGhost = (x, a) => {                                   // 虛擬化：加亮疊色＋半透明，敵機透得過來
            c.save(); c.globalCompositeOperation = 'lighter'; c.globalAlpha = a;
            c.translate(x - L / 2, y); c.scale(sc, sc * (1 + 0.05 * Math.sin(lt * 70))); c.drawImage(sp, -sp.width / 2, -sp.height / 2); c.restore(); };
          for (let i = 5; i >= 1; i--) drawGhost(tip - i * L * 0.18, 0.08 * (6 - i) * vis);    // 動態殘影（往後拖）
          drawGhost(tip, 0.55 * vis);                                                            // 本體：半透明
          this._au('S_ti14_spiral', tip + L * 0.15, y, L * 1.5, { ax: 0.97, h: sp.height * sc * 1.1 * (1 + 0.04 * Math.sin(lt * 60)), alpha: 0.85 * vis });   // 2026-10-25：螺旋穿刺光素材
          c.save(); c.globalAlpha = 0.25 * vis; c.translate(tip - L / 2, y); c.scale(sc, sc); c.drawImage(sp, -sp.width / 2, -sp.height / 2); c.restore();   // 一點實色，看得出金屬
          this._glow(tip - L * 0.1, y, sp.height * sc * 0.5, GOLD, 0.45 * vis);
        }
        // 前胸入口：鑽入時火花往回噴，留下洞
        if (d > -0.05) { const g = smooth(0, 0.15, d);
          if (d < 0.6) this._sparks(front, y, (lt * 4) % 0.5, 26, 4000 + Math.floor(lt * 4), Math.PI, 1.8, 760, YELLOW);
          if (!(this.auVfx && this.auVfx.S_ti14_entry) || !(this._onEnemy(img, s, ex, ey, () => { const c2 = this.ctx; c2.save(); c2.translate(front, y); c2.rotate(-0.12); c2.scale(0.42, 1);   // 2026-10-25：貼合機體斜面（側面看壓扁）
              this._au('S_ti14_entry', 0, 0, 150 * g, { rot: lt * 3 }); c2.restore(); }), true)) { c.fillStyle = 'rgba(8,5,5,0.9)'; c.beginPath(); c.ellipse(front, y, 22 * g, 28 * g, 0, 0, Math.PI * 2); c.fill(); }
          this._glow(front, y, 30, ORANGE, 0.6 + 0.3 * Math.sin(lt * 20)); }
        if (d > 0.35 && d < 0.85) { const q = at(cx, cy); this._glow(q[0], q[1], 60 + 25 * Math.sin(lt * 40), ORANGE, 0.5); }   // 體內鑽動
        // 後背出口：穿出時碎片＋火花往前噴
        if (d > 0.85) { const u = d - 0.85;
          const hasExit = !!(this.auVfx && this.auVfx.S_ti14_exit);
          if (hasExit) { const ew = 460 * (0.5 + 0.5 * smooth(0, 0.2, u)), ea = 1 - smooth(0.9, 1.4, u);
            c.save(); c.translate(back - 20, y); c.transform(1, -0.18, 0, 1, 0, 0); this._au('S_ti14_exit', 0, 0, ew, { ax: 0.12, h: ew * 330 / 560 * 0.8, alpha: ea }); c.restore(); }   // 斜切貼合背面
          if (!hasExit) { c.fillStyle = 'rgba(8,5,5,0.92)'; c.beginPath(); c.ellipse(back, y, 26, 32, 0, 0, Math.PI * 2); c.fill(); }
          this._sparks(back, y, u, 50, 4100, 0, 1.6, 900, YELLOW); this._sparks(back, y, u - 0.1, 30, 4101, 0, 1.2, 700, ORANGE);
          for (let i = 0; i < 14; i++) { const r = rng(4200 + i), px = back + (300 + 500 * r()) * u, py = y + (r() - 0.5) * 400 * u + 300 * u * u;
            if (u < 1.2 && !hasExit) { c.fillStyle = '#3a4252'; c.fillRect(px, py, 8 + 8 * r(), 6); } }
          if (u < 0.07) { c.fillStyle = rgba(WHITE, 0.55); c.fillRect(0, 0, W, H); } }
        if (d > 1.7) { const q = at(cx, cy); this._explosion(q[0], q[1], d - 1.7, 2.0, 4300, ORANGE); }
      }

      else if (k === 'tornado') { this._tornado(E, d, ex, 1);
        const g = smooth(-0.2, 0.4, d) * (1 - smooth(2.3, 2.8, lt));
        { let tx = ex, ty = cy; if (img) { const [bx, by] = this._alphaBox(img); tx = ex - img.width * s / 2 + bx * s; ty = cy - img.height * s / 2 + by * s; }   // 以敵機實際位置為中心
          this._au('S_ti15_tornado', tx + 12 * Math.sin(lt * 3), ty, Math.max(box[0] * 1.5, box[1] * 2.2 * 0.77), { h: box[1] * 2.2, alpha: 0.5 * g, rot: 0.04 * Math.sin(lt * 4) }); }   // 2026-10-25：1.5 倍、50%
        if (false && d > 0.6) for (let i = 0; i < 4; i++) { const r = rng(4500 + i), u = ((lt * 0.5 + r()) % 1);   // 2026-10-25 開發者：不要裝甲酸化圖案
          this._au('S_ti15_smoke', ex + (r() - 0.5) * box[0] * 0.7, cy - box[1] * 0.1 - u * 160, 110 + 60 * u, { ay: 1, alpha: 0.8 * (1 - u) * smooth(0.6, 1.0, d) }); } }

      else if (k === 'flame') {                   // ⑦ 熔火：火柱沖天、全身猛烈燃燒
        const g = smooth(-0.1, 0.35, d), f = 1 - smooth(2.4, 2.9, lt), q = at(cx, cy);
        this._glow(q[0], q[1] + box[1] * 0.2, box[1] * 0.55, FIRE, 0.45 * g * f);
        c.save(); c.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 80; i++) { const r = rng(600 + i), life = 0.45 + 0.35 * r(), a = (lt + r() * life) % life, u = a / life;
          const x = q[0] + (r() - 0.5) * box[0] * 1.3 * (1 - u * 0.4), y0 = q[1] + box[1] * (0.65 - 1.0 * r()) - u * (180 + 160 * r());
          const h = (60 + 110 * r()) * (1 - u * 0.4), w = 18 + 26 * r();
          const gr = c.createRadialGradient(x, y0, 0, x, y0, h);
          gr.addColorStop(0, rgba(YELLOW, 0.45 * (1 - u) * g * f)); gr.addColorStop(0.35, rgba(FIRE, 0.4 * (1 - u) * g * f)); gr.addColorStop(1, rgba(RED, 0));
          c.fillStyle = gr; c.beginPath(); c.ellipse(x, y0, w, h, 0, 0, Math.PI * 2); c.fill(); }
        // 火星往上飛
        for (let i = 0; i < 60; i++) { const r = rng(700 + i), life = 0.9, a = (lt + r() * life) % life;
          const x = q[0] + (r() - 0.5) * box[0] * 1.4 + Math.sin(lt * 5 + i) * 20, y = q[1] + box[1] * 0.5 - a * 600;
          c.fillStyle = rgba(YELLOW, (1 - a / life) * g * f); c.fillRect(x, y, 3, 6); }
        c.restore();
        for (let i = 0; i < 10; i++) { const r = rng(650 + i), a = (lt * 0.6 + r()) % 1;
          c.fillStyle = rgba([30, 22, 22], 0.4 * (1 - a) * g); c.beginPath(); c.arc(q[0] + (r() - 0.5) * box[0], q[1] - box[1] * 0.7 - a * 260, 40 + 70 * a, 0, Math.PI * 2); c.fill(); }
        if (d > 0 && d < 0.1) { c.fillStyle = rgba([255, 200, 120], 0.3); c.fillRect(0, 0, W, H); }
        if (this.auVfx && this.auVfx.S_hb04_fire && d > -0.05) {   // 離火焚燒：三團火焰貼著敵機往上燒，微微往右後方飄
          for (let i = 0; i < 3; i++) { const r = rng(4800 + i), fl = 0.9 + 0.12 * Math.sin(lt * (9 + i * 3) + i);
            this._au('S_hb04_fire', q[0] + (i - 1) * box[0] * 0.3, q[1] + box[1] * (0.45 - 0.15 * i), box[1] * (0.7 + 0.2 * r()) * fl, { ay: 1, rot: 0.08 + 0.05 * Math.sin(lt * 4 + i), alpha: 0.8 * g * f, blend: 'lighter' }); } }
        { const kr = smooth(-0.25, -0.05, d) * (1 - smooth(1.0, 1.3, d)), qy = at(cx, P[1])[1];   // 熔火熱線
          const th = 0.3; this._au('S_ti16_ray', cx + 40, qy, (cx + 120) / Math.cos(th), { ax: 1, rot: th, h: 150 * (0.9 + 0.1 * Math.sin(lt * 35)), alpha: kr, blend: 'lighter' });   // B3：照動作角度往右下斜約 17°
          // 2026-10-25 開發者第二輪：不要鐵漿流出（燒熔裝甲素材 S_ti16_melt 不再使用）
        }
      }

      else if (k === 'freeze') { this._freezeFX(E, d, ex, ey);
        const ki = smooth(-0.25, -0.05, d) * (1 - smooth(0.8, 1.1, d));
        { const th = 0.34, iy = cy - box[1] * 0.05; this._au('S_ti17_ice', cx + 40, iy, (cx + 120) / Math.cos(th), { ax: 1, rot: th, h: 140, alpha: ki, blend: 'lighter' }); }   // B3：照雙眼射出的角度往右下斜約 19°
        const ds = d - 2.2; if (ds > 0 && ds < 1.4) for (let i = 0; i < 8; i++) { const r = rng(4700 + i), ang = r() * Math.PI * 2, v = 250 + 450 * r();
          this._au('S_ti17_shard', ex + Math.cos(ang) * v * ds, ey + Math.sin(ang) * v * ds + 300 * ds * ds, 90 + 80 * r(), { rot: ang + ds * 6 * (r() - 0.5), alpha: 1 - smooth(0.9, 1.4, ds) }); } }

      else if (k === 'phoenix') {                 // 雲雀 09 朱雀涅槃拳・鳳凰：火鳥（雲雀化身）從左邊飛撲撞進敵機 → 火焰爆裂、火羽四散、全屏火光
        const ph = this.img.hitSprite, q = at(cx - box[0] * 0.1, cy - box[1] * 0.1);
        if (ph && d < 0.15) { const u = smooth(-0.45, 0, d), w = 620 * (0.8 + 0.4 * u), h = w * ph.height / ph.width, x = lerp(-w * 0.6, q[0], u), y = lerp(q[1] + 120, q[1], u);
          c.save(); c.globalCompositeOperation = 'lighter';
          for (let j = 5; j >= 0; j--) { c.globalAlpha = (j ? 0.12 * (6 - j) : 1) * (1 - smooth(0.05, 0.15, d)); c.drawImage(ph, x - w / 2 - j * 90 * (1 - 0.5 * u), y - h / 2 + j * 12, w, h); }   // 殘影往後拖
          c.restore(); this._speedLines(lt, 1 - smooth(-0.05, 0.1, d), 77, 1); }
        if (d >= 0) {
          this._explosion(q[0], q[1], d, 3.0, 9100, ORANGE); this._explosion(q[0] - 120, q[1] + 80, d - 0.12, 2.0, 9101, ORANGE); this._explosion(q[0] + 110, q[1] - 90, d - 0.24, 2.0, 9102, FIRE);
          for (let i = 0; i < 40; i++) { const r = rng(9200 + i), ang = r() * Math.PI * 2, sp = 300 + 800 * r(), a = d - 0.05;   // 火羽四散
            if (a < 0 || a > 1.6) continue; const x = q[0] + Math.cos(ang) * sp * a, y = q[1] + Math.sin(ang) * sp * a + 200 * a * a;
            this._glow(x, y, 10 + 10 * r(), i % 3 ? ORANGE : YELLOW, 1.1 * (1 - a / 1.6)); }
          for (let i = 0; i < 3; i++) { const a = d - i * 0.1; if (a < 0 || a > 0.7) continue;   // 衝擊火環
            c.save(); c.strokeStyle = rgba(i % 2 ? YELLOW : ORANGE, 0.9 * (1 - a / 0.7)); c.lineWidth = 12 * (1 - a / 0.7);
            c.beginPath(); c.ellipse(q[0], q[1], 60 + 900 * a, 40 + 560 * a, 0, 0, Math.PI * 2); c.stroke(); c.restore(); }
          if (d < 0.45) { c.fillStyle = rgba([255, 200, 120], 0.85 * (1 - d / 0.45)); c.fillRect(0, 0, W, H); }   // 全屏火光
          if (d > 1.6) this._explosion(q[0], q[1], d - 1.6, 2.4, 9300, ORANGE); }
      }

      else if (k === 'gold') {                    // ⑨ 天地終焉：敵機身上亂數爆炸，金色火花紛飛籠罩全螢幕
        const q = at(cx, cy);
        for (let i = 0; i < 26; i++) { const r = rng(8500 + i), t0 = 0.05 + i * 0.07, a = d - t0; if (a < 0) continue;
          const px = q[0] + (r() - 0.5) * box[0] * 0.9, py = q[1] + (r() - 0.5) * box[1] * 0.9;
          this._explosion(px, py, a, 0.6 + 0.5 * r(), 8600 + i, GOLD);
          // 每個爆炸點往四面八方噴出金色火花，一路飛到螢幕邊緣
          if (a < 1.6) for (let j = 0; j < 22; j++) { const rr = rng(8700 + i * 31 + j), ang = rr() * Math.PI * 2, sp = 500 + 900 * rr();
            const x = px + Math.cos(ang) * sp * a, y = py + Math.sin(ang) * sp * a + 120 * a * a, f = 1 - a / 1.6;
            this._line(x, y, x - Math.cos(ang) * 40, y - Math.sin(ang) * 40, j % 3 ? GOLD : [255, 250, 220], 1.2 * f, 3); } }
        { const db = d - 1.5; if (db > 0 && db < 1.2) this._au('S_ti18_boom', q[0], q[1] - box[1] * 0.1, (box[0] * 1.2) * (0.5 + 1.4 * smooth(0, 0.5, db)), { alpha: 1 - smooth(0.7, 1.2, db), blend: 'lighter' }); }   // 真紅大爆炸
        const wash = smooth(0.3, 1.2, d) * (1 - smooth(2.3, 2.9, lt));
        c.save(); c.globalCompositeOperation = 'lighter';
        const gr = c.createRadialGradient(q[0], q[1], 0, q[0], q[1], W); gr.addColorStop(0, rgba(GOLD, 0.35 * wash)); gr.addColorStop(0.6, rgba([230, 150, 30], 0.28 * wash)); gr.addColorStop(1, rgba([200, 90, 10], 0.22 * wash));
        c.fillStyle = gr; c.fillRect(0, 0, W, H); c.restore();
        if (d > 1.8 && d < 2.1) { c.fillStyle = rgba([255, 245, 210], 0.9 * (1 - (d - 1.8) / 0.3)); c.fillRect(0, 0, W, H); }
      }
    }

    // ⑧ 絕對零度：沿著敵機本身的外形，由下往上被冰塊包住、冒寒氣，最後連冰帶機碎裂（任何敵機外形都適用）
    _iceSil(img, pad, col) {   // 用敵機圖做「外擴的剪影」：把圖往四周各偏移 pad 疊畫，再整片填色
      const key = pad + '|' + col.join(','); img._ice = img._ice || {};
      if (img._ice[key]) return img._ice[key];
      const cv = document.createElement('canvas'); cv.width = img.width + pad * 2; cv.height = img.height + pad * 2; const g = cv.getContext('2d');
      for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; g.drawImage(img, pad + Math.cos(a) * pad, pad + Math.sin(a) * pad); }
      g.drawImage(img, pad, pad); g.globalCompositeOperation = 'source-in'; g.fillStyle = rgba(col, 1); g.fillRect(0, 0, cv.width, cv.height);
      return (img._ice[key] = cv);
    }
    _freezeFX(E, d, ex, ey) {
      const { lt, img, s, box } = E, c = this.ctx, FROST = [170, 230, 255];
      if (!img) return this._drawEnemy(img, s, ex, ey, 0, 1, FROST, 0.6);
      const PAD = Math.round(28 / s), w = img.width + PAD * 2, h = img.height + PAD * 2;
      // 1) 合成「冰封的敵機」到暫存畫布（以圖本身的座標）
      const cv = this._iceCv || (this._iceCv = document.createElement('canvas')); cv.width = w; cv.height = h; const g = cv.getContext('2d');
      const grow = smooth(0, 0.9, d);                               // 冰由下往上長
      g.clearRect(0, 0, w, h);
      g.drawImage(img, PAD, PAD);                                   // 原本的機體
      g.save(); g.beginPath(); g.rect(0, h * (1 - grow), w, h); g.clip();
      g.globalAlpha = 0.85; g.drawImage(this._iceSil(img, PAD, [235, 250, 255]), 0, 0);       // 外層白霜
      g.globalAlpha = 0.6;  g.drawImage(this._iceSil(img, Math.round(PAD * 0.6), [150, 205, 240]), PAD * 0.4, PAD * 0.4);   // 冰層
      g.globalAlpha = 0.75; g.drawImage(img, PAD, PAD);             // 冰裡的機體（看得到）
      g.globalCompositeOperation = 'source-atop'; g.globalAlpha = 0.45; g.fillStyle = rgba([120, 190, 240], 1); g.fillRect(0, 0, w, h);   // 整體偏冰藍
      // 冰面反光斜線、冰裂紋（只畫在冰上）
      g.globalAlpha = 0.7; g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = Math.max(2, 4 / s);
      for (let i = 0; i < 7; i++) { const x = w * (0.1 + i * 0.13); g.beginPath(); g.moveTo(x, 0); g.lineTo(x - h * 0.35, h); g.stroke(); }
      const crack = smooth(1.75, 2.15, d), r0 = rng(7400);
      if (crack > 0) { g.lineWidth = Math.max(2, 5 / s); g.strokeStyle = 'rgba(255,255,255,1)';
        for (let i = 0; i < 10; i++) { let x = w / 2, y = h / 2; g.beginPath(); g.moveTo(x, y); const a = r0() * Math.PI * 2;
          for (let j = 1; j <= 5; j++) { x = w / 2 + Math.cos(a + (r0() - 0.5) * 0.6) * w * 0.5 * crack * j / 5; y = h / 2 + Math.sin(a + (r0() - 0.5) * 0.6) * h * 0.5 * crack * j / 5; g.lineTo(x, y); } g.stroke(); } }
      g.restore();
      // 冰的前緣（正在往上長的那條線）發白光
      if (grow > 0 && grow < 1) { g.save(); g.globalCompositeOperation = 'source-atop'; const y = h * (1 - grow);
        const gr = g.createLinearGradient(0, y - 30 / s, 0, y + 30 / s); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.fillRect(0, y - 30 / s, w, 60 / s); g.restore(); }
      const SH = 2.2;   // 碎裂時間
      if (d < SH) {
        const sh = d > 0 && d < 0.5 ? Math.sin(lt * 80) * 5 * Math.exp(-d * 5) : 0;
        c.save(); c.translate(ex + sh, ey); c.scale(s, s); c.drawImage(cv, -w / 2, -h / 2); c.restore();
      } else {          // 2) 碎裂：把冰封的機體切成 12 塊往外飛
        const a = d - SH, N = 12, r = rng(7500);
        for (let k = 0; k < N; k++) { const a0 = k / N * Math.PI * 2 + (r() - 0.5) * 0.3, a1 = (k + 1) / N * Math.PI * 2 + (r() - 0.5) * 0.3, am = (a0 + a1) / 2;
          const v = 260 + 380 * r(), rot = (r() - 0.5) * 9, ox = Math.cos(am) * v * a, oy = Math.sin(am) * v * a + 420 * a * a;
          c.save(); c.globalAlpha = 1 - smooth(0.4, 0.8, a); c.translate(ex + ox, ey + oy); c.rotate(rot * a); c.scale(s, s);
          c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.cos(a0) * w, Math.sin(a0) * w); c.lineTo(Math.cos(am) * w * 1.2, Math.sin(am) * w * 1.2); c.lineTo(Math.cos(a1) * w, Math.sin(a1) * w); c.closePath(); c.clip();
          c.drawImage(cv, -w / 2, -h / 2); c.restore(); }
        for (let i = 0; i < 60; i++) { const rr = rng(7600 + i), ang = rr() * Math.PI * 2, sp = 200 + 900 * rr(), px = ex + Math.cos(ang) * sp * a, py = ey + Math.sin(ang) * sp * a + 300 * a * a;
          c.fillStyle = rgba([225, 245, 255], (1 - a / 0.9) * 0.9); c.fillRect(px, py, 4 + 5 * rr(), 4 + 5 * rr()); }
        if (a < 0.1) { c.fillStyle = rgba(WHITE, 0.7 * (1 - a / 0.1)); c.fillRect(0, 0, W, H); }
      }
      // 3) 寒氣：白霧貼著機體往上飄、往外散
      const puff = this._tinted(this._puff(), [225, 242, 255]), mist = smooth(0, 0.6, d) * (1 - smooth(2.6, 3.0, d));
      for (let i = 0; i < 26; i++) { const rr = rng(7700 + i), life = 1.6, u = ((lt * 0.6 + rr()) % 1);
        const px = ex + (rr() - 0.5) * box[0] * (1 + u), py = ey + box[1] * (0.5 - rr()) - u * 120, sz = (80 + 120 * rr()) * (0.6 + u);
        c.save(); c.globalAlpha = 0.45 * mist * (1 - u); c.drawImage(puff, px - sz / 2, py - sz / 2, sz, sz); c.restore(); }
      for (let i = 0; i < 40; i++) { const rr = rng(7800 + i), u = (lt * 0.4 + rr()) % 1;     // 細冰晶閃光
        const px = ex + (rr() - 0.5) * box[0] * 1.6, py = ey - box[1] * 0.8 + u * box[1] * 1.6;
        if ((Math.floor(lt * 12) + i) % 3 === 0) { c.fillStyle = rgba(WHITE, 0.9 * mist); c.fillRect(px, py, 3, 3); } }
      if (d > 0 && d < 0.12) { c.fillStyle = rgba([220, 245, 255], 0.35 * (1 - d / 0.12)); c.fillRect(0, 0, W, H); }
    }

    // ⑥ 酸蝕風暴：不規則雲霧狀的綠色龍捲（side＝-1 畫背面那半圈、1 畫前面那半圈＋外圍霧氣）
    _tornado(E, d, ex, side) {
      const { lt, cx, cy, box } = E, c = this.ctx, puff = this._puff();
      const g = smooth(-0.2, 0.5, d), f = 1 - smooth(2.3, 2.8, lt); if (g * f <= 0.01) return;
      const cols = [[60, 170, 50], [110, 210, 70], [40, 120, 40], [150, 230, 110]];
      const base = cy + box[1] * 0.7, top = cy - box[1] * 1.0, N = 320;
      for (let i = 0; i < N; i++) { const r = rng(5000 + i), h = r();
        const y = base - (base - top) * h;
        // 不規則：每一層的中心各自擺動，半徑忽大忽小
        const wob = Math.sin(h * 7 + lt * 2.3 + r() * 6) * 40 + Math.sin(h * 13 - lt * 3.1) * 18;
        const rad = box[0] * (0.22 + 0.45 * h) * (0.8 + 0.4 * r()) * g;
        const th = lt * (5 + 3 * (1 - h)) + r() * Math.PI * 2, z = Math.sin(th);
        if ((side < 0 && z > 0) || (side > 0 && z <= 0)) continue;
        const x = ex + wob + Math.cos(th) * rad, sz = (45 + 60 * r()) * (0.6 + h * 0.7);
        c.save(); c.globalAlpha = (side < 0 ? 0.45 : 0.75) * g * f * (0.6 + 0.4 * r()) * (this.auVfx && this.auVfx.S_ti15_tornado ? 0.5 : 1);   // 2026-10-25：落葉 50%
        c.drawImage(this._tinted(puff, cols[i % 4]), x - sz / 2, y - sz * 0.35, sz, sz * 0.7); c.restore(); }
      if (side > 0) {   // 外圍雲霧、捲起的碎屑
        for (let i = 0; i < 26; i++) { const r = rng(5400 + i), a = lt * (0.6 + r()) + r() * 6.3, rad = box[0] * (1.0 + 0.6 * r());
          const x = ex + Math.cos(a) * rad, y = cy + box[1] * (0.6 - 1.4 * r()), sz = 140 + 160 * r();
          c.save(); c.globalAlpha = 0.25 * g * f * (this.auVfx && this.auVfx.S_ti15_tornado ? 0.5 : 1); c.drawImage(this._tinted(puff, [90, 180, 80]), x - sz / 2, y - sz / 2, sz, sz); c.restore(); }
        for (let i = 0; i < 30; i++) { const r = rng(5500 + i), a = lt * (4 + 3 * r()) + r() * 6.3, h = (lt * 0.3 + r()) % 1, rad = box[0] * (0.3 + 0.7 * h);
          c.fillStyle = rgba([40, 60, 30], 0.8 * g * f); c.fillRect(ex + Math.cos(a) * rad, base - (base - top) * h, 6, 4); }
      }
    }

    // ④～⑨ 射擊：子彈／光束／散射／飛彈／巨型光束／全武裝
    _hsShots(E, S) {
      const { lt, T, img, s, cx, cy, box } = E, c = this.ctx, L = this.dmg || 0, kind = S.kind, fin = S.finale || 99;
      const pts = this.move.hit.points.map(p => [cx + p[0] * box[0] / 2, cy + p[1] * box[1] / 2]);
      const hits = [];   // {t, p:[x,y], kind}
      const add = (k, n, t0, t1, seed) => { const r = rng(seed); for (let i = 0; i < n; i++) { const p = pts[Math.floor(r() * pts.length)];
        hits.push({ t: t0 + (t1 - t0) * (i / Math.max(1, n - 1)) + (r() - 0.5) * 0.04, p: [p[0] + (r() - 0.5) * 40, p[1] + (r() - 0.5) * 40], k }); } };
      const has = k => kind === k || kind === 'all';
      if (has('bullets')) add('bullet', kind === 'all' ? 24 : (S.count || 30), T, T + 1.3, 11);
      if (has('scatter')) add('scatter', S.count || 9, T + (kind === 'all' ? 0.3 : 0), T + (kind === 'all' ? 0.9 : 1.0), 22);
      if (has('missiles')) add('missile', S.count || 14, T + (kind === 'all' ? 0.5 : 0.1), T + (kind === 'all' ? 1.5 : 1.6), 33);
      const beamOn = has('beam') ? [T, T + 1.25] : null;
      const megaOn = has('megabeam') ? (kind === 'all' ? [T + 1.0, fin] : [T, fin]) : null;
      // 敵機（命中時閃白；受傷越重越焦黑；等級 5 終結後消失）
      let fl = 0; for (const h of hits) if (lt >= h.t && lt < h.t + 0.05) fl = 0.35;
      const inMega = megaOn && lt >= megaOn[0] && lt < megaOn[1];
      const burn = clamp(0.1 * L * clamp((lt - T) / 1.5, 0, 1), 0, 0.5);
      const vanish = L >= 5 ? 1 - clamp((lt - fin - 0.3) / 0.5, 0, 1) : 1;
      if (vanish > 0) this._drawEnemy(img, s, cx, cy, 0, vanish, inMega ? ICE : fl ? WHITE : [25, 15, 10], inMega ? 0.55 : fl || burn);
      // 光束（第 5 招）
      if (beamOn && lt >= beamOn[0] && lt < beamOn[1] + 0.15) { const k = smooth(beamOn[0], beamOn[0] + 0.08, lt) * (1 - smooth(beamOn[1], beamOn[1] + 0.15, lt));
        const y = cy - box[1] * 0.05;
        if (!this._au('S_au05_beam', cx + 40, y, cx + 90, { ax: 1, h: 170 * (0.9 + 0.1 * Math.sin(lt * 40)), alpha: k, blend: 'lighter' })) { this._line(-50, y, cx, y, CYAN, 1.3 * k, 38); this._line(-50, y, cx, y, WHITE, 1.4 * k, 12); }
        { const bs = 260 + 40 * Math.sin(lt * 30); this._au('S_au05_burst', cx - 10, y, bs * 0.5, { h: bs, alpha: 0.9 * k, blend: 'lighter' }); }   // B3：側面看壓扁
        this._glow(cx - 20, y, 50 + 10 * Math.sin(lt * 40), CYAN, 1.2 * k); this._sparks(cx - 10, y, (lt - beamOn[0]) % 0.6, 10, 500 + Math.floor((lt - beamOn[0]) / 0.6), 0, 2.4, 420); }
      // 巨型光束（第 8 招）：粗到吞沒整台
      if (megaOn && lt >= megaOn[0] && lt < megaOn[1] + 0.3) { const k = smooth(megaOn[0], megaOn[0] + 0.12, lt) * (1 - smooth(megaOn[1], megaOn[1] + 0.3, lt));
        const w = box[1] * 0.95 * (0.9 + 0.1 * Math.sin(lt * 30));
        this._au('S_au08_plasma', -40, cy, W + 120, { ax: 0, h: w * 1.25, alpha: 0.5 * k, blend: 'lighter' });   // 2026-10-25 開發者：透明度 50%   // 等離子光柱素材（底下程式光調淡，保留亮度）
        c.save(); c.globalCompositeOperation = 'lighter'; if (this.auVfx && this.auVfx.S_au08_plasma) c.globalAlpha = 0.5;
        const g = c.createLinearGradient(0, cy - w / 2, 0, cy + w / 2); g.addColorStop(0, rgba(CYAN, 0)); g.addColorStop(0.25, rgba(CYAN, 0.7 * k)); g.addColorStop(0.5, rgba(WHITE, 0.95 * k)); g.addColorStop(0.75, rgba(CYAN, 0.7 * k)); g.addColorStop(1, rgba(CYAN, 0));
        c.fillStyle = g; c.fillRect(0, cy - w / 2, W, w); c.restore();
        for (let i = 0; i < 8; i++) { const rr = rng(600 + i + Math.floor(lt * 10)); this._line(rr() * W, cy + (rr() - 0.5) * w, rr() * W + 200, cy + (rr() - 0.5) * w, ICE, 0.6 * k, 2); } }
      // 各種彈道與命中
      hits.forEach((h, i) => { const d = lt - h.t;
        if (h.k === 'bullet') {
          if (d > -0.08 && d < 0) { const u = 1 + d / 0.08, bx = h.p[0] - 300 * (1 - u), by = h.p[1] - 20 * (1 - u);
            if (!this._au('S_au04_tracer', bx, by, 150, { ax: 1, rot: Math.atan2(20, 300) })) this._line(bx - 60, by, bx, by, ORANGE, 1.2, 4); }
          if (d >= 0) { if (d < 0.15) this._glow(h.p[0], h.p[1], 14, ORANGE, 1.2 * (1 - d / 0.15)); this._sparks(h.p[0], h.p[1], d, 5, 1000 + i, Math.PI, 1.6, 300);
            if (!this._au('S_au04_hole', h.p[0], h.p[1], 22, { rot: i })) { c.fillStyle = 'rgba(15,12,10,0.9)'; c.beginPath(); c.arc(h.p[0], h.p[1], 3.5, 0, Math.PI * 2); c.fill(); } }
        } else if (h.k === 'scatter') {
          if (d > -0.12 && d < 0.1) { const k = d < 0 ? 1 + d / 0.12 : 1 - d / 0.1, y0 = h.p[1] + ((i * 3) % 7 - 3) * 170;   // B3：扇形約 ±30°
            if (!(this.auVfx && this.auVfx.S_au06_orb)) this._line(-50, y0, h.p[0], h.p[1], CYAN, 0.7 * k, 6);
            if (d < 0) { const u = 1 + d / 0.12, ang = Math.atan2(h.p[1] - y0, h.p[0] + 50), ox = lerp(-50, h.p[0], u), oy = lerp(y0, h.p[1], u);
              this._line(ox - Math.cos(ang) * 90, oy - Math.sin(ang) * 90, ox, oy, CYAN, 0.5, 4);   // 短殘光
              this._au('S_au06_orb', ox, oy, 170, { ax: 0.8, rot: ang, blend: 'lighter' }); } }
          if (d >= 0 && d < 0.3) { const y0 = h.p[1] + ((i * 3) % 7 - 3) * 170, fs = 200 + 300 * d; this._au('S_au06_flash', h.p[0], h.p[1], fs * 0.5, { h: fs, rot: Math.atan2(h.p[1] - y0, h.p[0] + 50), alpha: 1 - d / 0.3, blend: 'lighter' }); }   // B3：命中閃光順著光彈方向壓扁
          if (d >= 0) this._explosion(h.p[0], h.p[1], d, 0.7 + 0.1 * L, 2000 + i, CYAN);
        } else if (h.k === 'missile') {
          if (d > -0.35 && d < 0) { const u = 1 + d / 0.35, sx = -80, sy = -60 + (i % 4) * 30, mx = (sx + h.p[0]) / 2, my = -120;
            const q = (a, b, m) => (1 - u) * (1 - u) * a + 2 * (1 - u) * u * m + u * u * b; const x = q(sx, h.p[0], mx), y = q(sy, h.p[1], my);
            const u2 = Math.max(0, u - 0.12), x2 = (1 - u2) * (1 - u2) * sx + 2 * (1 - u2) * u2 * mx + u2 * u2 * h.p[0], y2 = (1 - u2) * (1 - u2) * sy + 2 * (1 - u2) * u2 * my + u2 * u2 * h.p[1];
            if (this.auVfx && this.auVfx.S_au07_missile) {
              for (let j = 1; j <= 5; j++) { const uj = Math.max(0, u - j * 0.05), xj = (1 - uj) * (1 - uj) * sx + 2 * (1 - uj) * uj * mx + uj * uj * h.p[0], yj = (1 - uj) * (1 - uj) * sy + 2 * (1 - uj) * uj * my + uj * uj * h.p[1];
                c.fillStyle = rgba([235, 235, 235], 0.35 * (1 - j / 6)); c.beginPath(); c.arc(xj, yj, 5 + j * 2.5, 0, Math.PI * 2); c.fill(); }   // 小煙團
              this._au('S_au07_missile', x, y, 170, { ax: 0.85, rot: Math.atan2(y - y2, x - x2) });
            } else { this._line(x2, y2, x, y, [230, 230, 230], 0.8, 5); this._glow(x, y, 8, ORANGE, 1.2); } }
          if (d >= 0) this._explosion(h.p[0], h.p[1], d, 0.9 + 0.1 * L, 3000 + i, ORANGE);
        } });
      // 第 5 招光束結束時的爆炸
      if (beamOn) { const db = lt - beamOn[1]; if (db >= 0 && db < 0.6) this._au('S_au05_burst', cx - 10, cy - box[1] * 0.05, 300 + 500 * db, { alpha: 1 - db / 0.6, blend: 'lighter' });
        this._explosion(cx - 10, cy - box[1] * 0.05, lt - beamOn[1], 1.4 + 0.1 * L, 4000, ORANGE); }
      // 受傷分級特效（冒煙、起火、電弧、碎片、連鎖爆炸、火球）
      this._damageFX(lt, cx, cy, box, pts, { impacts: hits.map((h, i) => ({ t: h.t, p: i % pts.length })), finale: fin < 99 ? fin : null });
      if (L >= 4 && fin < 99) { const d = lt - fin, len = L >= 5 ? 0.6 : 0.3; if (d >= 0 && d < len) { c.fillStyle = rgba(WHITE, 0.9 * (1 - d / len)); c.fillRect(0, 0, W, H); } }
    }

    // ── 受傷分級特效（data/damage_tiers.json）：純函數，任何時刻都畫得出來 ──
    _damageFX(lt, cx, cy, box, pts, Hd) {
      const L = this.dmg || 0; if (!L) return;
      const c = this.ctx, first = Hd.impacts.length ? Math.min(...Hd.impacts.map(h => h.t)) : 0, age = lt - first;
      if (age < 0) return;
      const grow = clamp(age / 1.2, 0, 1), fin = Hd.finale || 99;
      // 黑煙（等級 1 起）：從機體各處往上冒
      for (let i = 0; i < 4 * L; i++) { const r = rng(5000 + i), p = pts[i % pts.length], period = 1.1 + r();
        const u = ((age + r() * period) % period) / period;
        const x = p[0] + (r() - 0.5) * 40 + 30 * u, y = p[1] - 140 * u, rad = (16 + 26 * u) * (0.8 + 0.1 * L);
        c.fillStyle = rgba([40, 38, 38], 0.5 * grow * (1 - u)); c.beginPath(); c.arc(x, y, rad, 0, Math.PI * 2); c.fill(); }
      // 起火（等級 2 起）
      if (L >= 2) for (let i = 0; i < 2 * L; i++) { const r = rng(6000 + i), p = pts[(i * 3) % pts.length];
        const fl = 0.7 + 0.3 * Math.sin(lt * (18 + r() * 10) + i);
        this._glow(p[0] + (r() - 0.5) * 30, p[1] + (r() - 0.5) * 30, (22 + 10 * L) * fl, ORANGE, 0.9 * grow * fl);
        this._glow(p[0] + (r() - 0.5) * 20, p[1] - 12 * fl, (10 + 4 * L) * fl, YELLOW, 0.8 * grow); }
      // 電弧短路（等級 3 起）
      if (L >= 3) for (let i = 0; i < L; i++) { const r = rng(7000 + i * 13 + Math.floor(lt * 12));
        if (r() < 0.45) continue; const p = pts[Math.floor(r() * pts.length)];
        c.save(); c.globalCompositeOperation = 'lighter'; c.strokeStyle = rgba(ICE, 0.9 * grow); c.lineWidth = 2; c.beginPath();
        let x = p[0], y = p[1]; c.moveTo(x, y);
        for (let k = 0; k < 6; k++) { x += (r() - 0.5) * 60; y += (r() - 0.5) * 60; c.lineTo(x, y); }
        c.stroke(); c.restore(); }
      // 碎片飛散（等級 3 起）：每次命中噴出裝甲碎片
      if (L >= 3) Hd.impacts.forEach((h, j) => { const d = lt - h.t; if (d < 0 || d > 1.2 || j % 2) return; const r = rng(8000 + j);
        for (let i = 0; i < L; i++) { const a = -Math.PI * (0.1 + 0.8 * r()), sp = 300 + 300 * r(), p = pts[h.p % pts.length];
          const x = p[0] + Math.cos(a) * sp * d + 120 * d, y = p[1] + Math.sin(a) * sp * d + 600 * d * d;
          c.save(); c.translate(x, y); c.rotate(d * 12 + i); c.fillStyle = rgba([50, 50, 55], 1 - d / 1.2); c.fillRect(-7, -4, 14, 8); c.restore(); } });
      // 終結連鎖大爆炸（等級 4 起）
      if (L >= 4) for (let i = 0; i < 3 + 2 * (L - 4); i++) { const r = rng(9000 + i);
        this._explosion(cx + (r() - 0.5) * box[0], cy + (r() - 0.5) * box[1], lt - fin - 0.12 * i, 1.6 + 0.4 * (L - 4), 9100 + i, ORANGE); }
      // 巨大火球吞沒（等級 5）
      if (L >= 5) { const d = lt - fin; if (d > 0.05) { const k = clamp(d / 0.4, 0, 1), f = 1 - clamp((d - 1.2) / 0.8, 0, 1);
        this._glow(cx, cy, 380 * k, ORANGE, 1.1 * f); this._glow(cx, cy, 220 * k, YELLOW, 1.2 * f); this._glow(cx, cy, 110 * k, WHITE, 1.3 * f); } }
    }
    _unusedHitTail() {
    }
    // 敵機佔位幅（等敵機動畫補上後，於 enemies.json 填入 sprite 即自動替換）
    _placeholder(cx, cy, box, flash, red, kb) {
      const c = this.ctx, w = box[0], h = box[1];
      c.save(); c.translate(cx, cy); c.rotate(-Math.min(10, kb * 0.08) * Math.PI / 180);
      c.fillStyle = flash ? 'rgba(255,255,255,0.85)' : red ? `rgba(200,40,40,${0.35 + red})` : 'rgba(60,70,90,0.55)';
      // 簡易人形剪影
      c.beginPath(); c.ellipse(0, -h * 0.38, w * 0.13, h * 0.09, 0, 0, Math.PI * 2); c.fill();
      c.fillRect(-w * 0.28, -h * 0.28, w * 0.56, h * 0.36);
      c.fillRect(-w * 0.42, -h * 0.26, w * 0.12, h * 0.34); c.fillRect(w * 0.30, -h * 0.26, w * 0.12, h * 0.34);
      c.fillRect(-w * 0.22, h * 0.08, w * 0.17, h * 0.42); c.fillRect(w * 0.05, h * 0.08, w * 0.17, h * 0.42);
      c.setLineDash([10, 8]); c.strokeStyle = '#f87171'; c.lineWidth = 3; c.strokeRect(-w / 2, -h / 2, w, h); c.setLineDash([]);
      c.fillStyle = '#fecaca'; c.font = 'bold 20px "Microsoft JhengHei"'; c.textAlign = 'center';
      c.fillText(`敵機佔位 ${this.targetId}`, 0, -h / 2 - 12);
      c.font = '16px "Microsoft JhengHei"'; c.fillText(this.target.name || '', 0, h / 2 + 24);
      c.restore();
    }
  }
  global.BattleAnimPlayer = BattleAnimPlayer;
})(window);
