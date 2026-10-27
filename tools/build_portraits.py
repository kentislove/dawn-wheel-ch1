# -*- coding: utf-8 -*-
"""
網頁版人物頭像產生器（v12 建立）：把圖片區的頭像（1024～2048 px 的 PNG）縮成 256×256 WebP，放進本版。

為什麼要這支腳本：
  對話框頭像只有 84 px，原圖一張 1～4 MB；縮成 256 px（高解析度螢幕也夠清楚）後一張約 15 KB。
  原始 PNG 完全不改、不刪。

輸出：
  assets/portraits/<代碼>.webp        對話框用（全部表情）
  anim/assets/portraits/<代碼>.webp   戰鬥演出台詞框用（播放器讀 anim/ 底下）
用法：python tools/build_portraits.py
"""
import os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
V12 = os.path.dirname(HERE)
SRC = os.path.join(os.path.dirname(V12), '美術設定與動畫素材', '人物頭像與事件插圖', '頭像')
OUTS = [os.path.join(V12, 'assets', 'portraits'), os.path.join(V12, 'anim', 'assets', 'portraits')]
SKIP = ('MOTHER_',)        # 媽媽只存在回憶、不露臉：參考圖不放進遊戲

n = 0
for d in OUTS:
    os.makedirs(d, exist_ok=True)
for f in sorted(os.listdir(SRC)):
    if not f.lower().endswith('.png') or f.startswith(SKIP):
        continue
    im = Image.open(os.path.join(SRC, f)).convert('RGB').resize((256, 256), Image.LANCZOS)
    for d in OUTS:
        out = os.path.join(d, f[:-4] + '.webp')
        if not os.path.exists(out):        # 不覆蓋已存在的檔案（anim 裡原本就有的 LEONA／KAI_determined 保留）
            im.save(out, 'WEBP', quality=85)
    n += 1
print(f'完成：{n} 張頭像')
