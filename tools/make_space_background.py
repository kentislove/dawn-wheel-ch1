# -*- coding: utf-8 -*-
"""
宇宙地形背景產生器（佔位用）
給 1-3～1-5 的宇宙、殘骸地形使用。輸出到演出播放器的背景資料夾（只新增檔案，不覆蓋舊檔）：
  SPACE_far.png   遠景：星空、星雲、遠方的殖民衛星
  SPACE_near.png  近景：漂浮殘骸（透明背景）
尺寸與其他地形相同：2400×900。日後可直接用美術背景替換同名檔案。
執行：python make_space_background.py
"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, '..', '..', '美術設定與動畫素材', '極光鋼機_AURORA',
                                    '招式演出_v2_即時合成', 'assets', 'backgrounds'))
W, H = 2400, 900
rng = np.random.default_rng(1128)


def far():
    y = np.linspace(0, 1, H)[:, None]
    base = np.zeros((H, W, 3), np.float32)
    base[..., 0] = 4 + 10 * y
    base[..., 1] = 8 + 14 * y
    base[..., 2] = 24 + 40 * y
    img = Image.fromarray(base.clip(0, 255).astype(np.uint8))
    # 星雲
    neb = Image.new('RGB', (W, H), (0, 0, 0))
    d = ImageDraw.Draw(neb)
    for _ in range(14):
        cx, cy, r = rng.integers(0, W), rng.integers(80, 600), rng.integers(120, 320)
        col = [(40, 70, 140), (70, 40, 120), (20, 90, 120)][rng.integers(0, 3)]
        d.ellipse([cx - r, cy - r * 0.6, cx + r, cy + r * 0.6], fill=col)
    neb = neb.filter(ImageFilter.GaussianBlur(90))
    img = Image.blend(img, neb, 0.45)
    d = ImageDraw.Draw(img)
    # 星星
    for _ in range(1600):
        x, yy = rng.integers(0, W), rng.integers(0, H)
        b = int(rng.integers(120, 256))
        s = 1 if rng.random() < 0.9 else 2
        d.ellipse([x, yy, x + s, yy + s], fill=(b, b, min(255, b + 20)))
    # 遠方的殖民衛星（長圓筒）
    d.rounded_rectangle([1500, 230, 2050, 300], radius=35, fill=(70, 86, 110), outline=(130, 160, 190), width=3)
    for i in range(1530, 2030, 40):
        d.line([i, 236, i, 294], fill=(95, 115, 140), width=2)
    d.rectangle([1600, 255, 1950, 275], fill=(255, 214, 140))
    return img


def near():
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for _ in range(26):
        cx, cy = rng.integers(0, W), rng.integers(560, 880)
        r = rng.integers(30, 110)
        n = rng.integers(5, 9)
        ang = np.sort(rng.uniform(0, 2 * np.pi, n))
        pts = [(cx + r * rng.uniform(0.6, 1.1) * np.cos(a), cy + r * 0.6 * rng.uniform(0.6, 1.1) * np.sin(a)) for a in ang]
        g = int(rng.integers(45, 85))
        d.polygon(pts, fill=(g, g + 6, g + 18, 255), outline=(g + 50, g + 60, g + 80, 255))
    # 殖民地外壁鋼架殘骸
    for _ in range(6):
        x, y = rng.integers(0, W), rng.integers(600, 820)
        d.line([x, y, x + rng.integers(120, 300), y - rng.integers(-40, 60)], fill=(110, 125, 150, 255), width=8)
    return img


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for name, fn in (('SPACE_far.png', far), ('SPACE_near.png', near)):
        p = os.path.join(OUT, name)
        if os.path.exists(p):
            print('已存在，不覆蓋：', p)
            continue
        fn().save(p)
        print('輸出：', p)
