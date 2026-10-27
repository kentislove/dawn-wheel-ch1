# -*- coding: utf-8 -*-
"""
網頁發布素材產生器（v7 建立、v8 擴充）：只挑「第一大關」會用到的演出素材，壓成 WebP 品質 85，放進本版的 anim/assets/。
v8：加入敵機 E01～E04 的出招演出、我方受擊／防禦／迴避序列、敵機防禦／迴避序列、全部特效圖（vfx）。

為什麼要這支腳本：
  原始演出素材有 9.1 GB 的 PNG，網頁版放不上去。這支腳本「照遊戲實際讀檔的規則」找出第一大關會用到的圖，
  只轉那些，其他一律不碰。原始 PNG 完全不改、不刪（之後重新生圖、重新壓都要用原圖）。

規則（開發者 2026-10-25 決定）：
  - 格式：WebP 品質 85（透明圖保留透明）
  - 切入圖（cutin_start / cutin_end）寬度超過 1376 的縮成 1376×768（遊戲畫面只有 1280×720，看不出差別）
  - 其餘圖片維持原尺寸

用法：python tools/build_web_assets.py          （已經轉過、而且原圖沒更新的檔案會跳過）
輸出：anim/assets/**.webp、anim/preload_manifest.json（每一招要預先下載的檔案清單）、終端機印出容量統計
"""
import json
import os
import sys
from concurrent.futures import ProcessPoolExecutor

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
V7 = os.path.dirname(HERE)
SRC = os.path.join(os.path.dirname(V7), '美術設定與動畫素材', '極光鋼機_AURORA', '招式演出_v2_即時合成')
DST = os.path.join(V7, 'anim')

# ── 第一大關會用到的東西（對照 js/data.js 的 anim、js/stages.js 出場的機體） ──
MOVES = [f'AURORA_0{i}_v4' for i in (1, 2, 3, 4, 5, 7, 8, 9)] + ['AURORA_06_v5'] + [f'TITAN_{i}' for i in range(10, 19)]
ENEMY_MOVES = [f'E0{e}_0{m}' for e in (1, 2, 3, 4) for m in (1, 2, 3)]    # v8：敵方出招演出
ATTACKERS = {'AURORA': 'LEONA', 'TITAN-X': 'KAI'}            # 演出用機體 ID → 駕駛員
TARGETS = ['E01', 'E02', 'E03', 'E04', 'PLACEHOLDER']          # 我方只會打到這幾種敵機（砲台等用佔位幅）
AURORA_VFX = ['S_au01_blade', 'S_au01_pierce', 'S_au02_slash', 'S_au02_xspark', 'S_au03_rift', 'S_au03_shards', 'S_au04_tracer',
              'S_au04_hole', 'S_au05_beam', 'S_au05_burst', 'S_au06_orb', 'S_au06_flash', 'S_au07_missile', 'S_au08_plasma']
CUTIN_MAX_W = 1376
QUALITY = 85


def load_json(rel):
    with open(os.path.join(SRC, rel), encoding='utf-8') as f:
        return json.load(f)


def collect(obj, out, skip=()):
    """把 JSON 裡所有 'assets/...' 開頭的字串收集起來（檔案或資料夾都算）。"""
    if isinstance(obj, str):
        if obj.startswith('assets/'):
            out.add(obj)
    elif isinstance(obj, dict):
        for k, v in obj.items():
            if k not in skip:
                collect(v, out, skip)
    elif isinstance(obj, list):
        for v in obj:
            collect(v, out, skip)


def expand(paths):
    """資料夾展開成底下所有檔案；只留真的存在的。"""
    files = set()
    for p in paths:
        full = os.path.join(SRC, p)
        if os.path.isdir(full):
            for r, _, fs in os.walk(full):
                for f in fs:
                    files.add(os.path.relpath(os.path.join(r, f), SRC).replace('\\', '/'))
        elif os.path.isfile(full):
            files.add(p)
    return files


def refs_for_move(move_id):
    """一招會讀到的素材（含 terrain_variants、骨骼 rig 檔、受擊樣式）。"""
    refs, seen, queue = set(), set(), [move_id]
    hit_styles = load_json('data/hit_styles.json').get('styles', {})
    while queue:
        m = queue.pop()
        if m in seen:
            continue
        seen.add(m)
        mv = load_json(f'data/moves/{m}.json')
        collect(mv, refs)
        queue += list((mv.get('terrain_variants') or {}).values())
        if mv.get('rig'):
            collect(load_json(mv['rig']), refs)
        for key in (m, mv.get('id')):
            if key in hit_styles:
                collect(hit_styles[key], refs)
    if move_id.startswith('AURORA_'):
        refs |= {f'assets/vfx/{k}' for k in AURORA_VFX}
    return refs


def convert(rel):
    """把一個原始檔轉到 v7。回傳 (原大小, 新大小)。"""
    src = os.path.join(SRC, rel)
    is_img = rel.lower().endswith('.png')
    out_rel = rel[:-4] + '.webp' if is_img else rel
    dst = os.path.join(DST, out_rel)
    if os.path.exists(dst) and os.path.getmtime(dst) >= os.path.getmtime(src):
        return os.path.getsize(src), os.path.getsize(dst)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    if not is_img:
        with open(src, 'rb') as a, open(dst, 'wb') as b:
            b.write(a.read())
    else:
        im = Image.open(src)
        im.load()
        name = os.path.basename(rel).lower()
        if name.startswith('cutin_') and im.width > CUTIN_MAX_W:
            im = im.resize((CUTIN_MAX_W, round(im.height * CUTIN_MAX_W / im.width)), Image.LANCZOS)
        if im.mode not in ('RGB', 'RGBA'):
            im = im.convert('RGBA' if 'A' in im.mode or im.mode == 'P' else 'RGB')
        im.save(dst, 'webp', quality=QUALITY, method=4)
    return os.path.getsize(src), os.path.getsize(dst)


def main():
    chars, enemies = load_json('data/characters.json'), load_json('data/enemies.json')
    common = {'assets/backgrounds', 'assets/vfx'}             # v8：敵方招式的專屬受擊特效會用到各種 vfx，整個資料夾都放
    per_unit = {}
    for u, pilot in ATTACKERS.items():
        s = set()
        collect(chars['units'][u], s)                           # v8：含受擊／防禦／迴避序列（敵方出招時播）
        collect(chars['pilots'][pilot], s)
        per_unit[u] = expand(s)
    per_target = {}
    for t in TARGETS:
        s = set()
        collect(enemies['units'].get(t, {}), s)                 # v8：含敵機防禦／迴避序列（我方沒打中時播迴避）
        per_target[t] = expand(s)
    per_move = {m: expand(refs_for_move(m)) for m in MOVES + ENEMY_MOVES}
    common = expand(common)

    every = set(common).union(*per_move.values(), *per_target.values(), *per_unit.values())
    print(f'第一大關要轉的檔案：{len(every)} 個（原始資料夾不動）')
    with ProcessPoolExecutor(max(2, (os.cpu_count() or 4) - 1)) as ex:
        sizes = dict(zip(sorted(every), ex.map(convert, sorted(every), chunksize=8)))
    a = sum(s[0] for s in sizes.values())
    b = sum(s[1] for s in sizes.values())
    print(f'原始 {a / 1e6:,.1f} MB → 壓縮後 {b / 1e6:,.1f} MB（{b / a * 100:.1f}%）')

    web = lambda rel: 'anim/' + (rel[:-4] + '.webp' if rel.lower().endswith('.png') else rel)
    manifest = {
        '_說明': '預先下載清單（tools/build_web_assets.py 產生）。遊戲進關卡時，依本關我方招式與敵機，在背景先下載這些檔案。',
        'common': sorted(web(r) for r in common),
        'moves': {m: sorted(web(r) for r in fs) for m, fs in per_move.items()},
        'targets': {t: sorted(web(r) for r in fs) for t, fs in per_target.items()},
        'units': {u: sorted(web(r) for r in fs) for u, fs in per_unit.items()},
        'bytes': {'moves': {m: sum(sizes[r][1] for r in fs) for m, fs in per_move.items()},
                  'targets': {t: sum(sizes[r][1] for r in fs) for t, fs in per_target.items()}},
    }
    with open(os.path.join(DST, 'preload_manifest.json'), 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)
    for m in MOVES + ENEMY_MOVES:
        print(f'  {m:14s} {manifest["bytes"]["moves"][m] / 1e6:6.1f} MB')
    for t in TARGETS:
        print(f'  {t:14s} {manifest["bytes"]["targets"][t] / 1e6:6.1f} MB')


if __name__ == '__main__':
    sys.exit(main())
