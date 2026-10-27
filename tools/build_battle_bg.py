# -*- coding: utf-8 -*-
"""
把「戰鬥背景_SDXL抽卡」的圖整理成遊戲用的戰鬥背景庫（v4，2026-10-21）

為什麼要轉一次：
- 抽卡資料夾的 PNG 每張約 2 MB，網頁一次讀太慢 → 轉成 JPG（品質 90，每張約 0.3 MB）。
- 檔名改成固定的 01.jpg～10.jpg，遊戲程式不用知道種子號碼。
- 同一種場景有 v2（重跑版）而且滿 10 張，就優先用 v2。
- 開發者抽卡後，想換掉某張：把喜歡的圖複製進 `戰鬥背景_SDXL抽卡/<場景>_精選/`（放幾張都可以），
  再重跑本程式，「精選」資料夾會優先於其他版本。

用法：python -X utf8 tools/build_battle_bg.py
輸出：assets/battle_bg/<場景代號>/01.jpg… 以及 assets/battle_bg/manifest.json（每種場景有幾張）
"""
import glob
import json
import os

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.dirname(HERE)
SRC = os.path.join(os.path.dirname(GAME), "美術設定與動畫素材", "戰鬥背景_SDXL抽卡")
OUT = os.path.join(GAME, "assets", "battle_bg")

# 場景代號 ← 抽卡資料夾名稱
SCENES = {
    "SKY": "01_天空", "LAND": "02_陸地", "DESERT": "03_沙漠", "CITY": "04_都市", "SHELTER": "05_避難所",
    "GRASS": "06_草原", "SEA": "07_海面", "DEEPSEA": "08_深海", "SPACE": "09_太空", "DEEPSPACE": "10_深空",
}


def pick_source(folder):
    """優先順序：精選 → v2（滿 10 張）→ 原版"""
    for cand, need in ((folder + "_精選", 1), (folder + "_v2", 10), (folder, 1)):
        files = sorted(glob.glob(os.path.join(SRC, cand, "*.png")))
        if len(files) >= need:
            return cand, files
    return None, []


def main():
    manifest = {}
    for key, folder in SCENES.items():
        cand, files = pick_source(folder)
        if not files:
            print(f"!! {key}：找不到 {folder} 的圖，略過")
            continue
        dst = os.path.join(OUT, key)
        os.makedirs(dst, exist_ok=True)
        # 不刪任何檔案：直接覆蓋 01.jpg 起的檔名；張數變少時多出來的舊檔留著，但遊戲只照 manifest 的張數抽
        for i, f in enumerate(files, 1):
            Image.open(f).convert("RGB").save(os.path.join(dst, f"{i:02d}.jpg"), quality=90)
        manifest[key] = {"count": len(files), "source": cand}
        print(f"{key:10s} ← {cand}（{len(files)} 張）")
    with open(os.path.join(OUT, "manifest.json"), "w", encoding="utf-8") as fp:
        json.dump(manifest, fp, ensure_ascii=False, indent=1)
    print("完成：", os.path.join(OUT, "manifest.json"))


if __name__ == "__main__":
    main()
