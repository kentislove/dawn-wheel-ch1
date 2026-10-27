# -*- coding: utf-8 -*-
"""
網頁版音效／音樂產生器（v12 建立）：把音樂區做好的 WAV 母帶轉成網頁用 MP3，放進本版的 assets/audio/。

為什麼要這支腳本：
  音樂區的母帶是 WAV（一個音效約 0.2～0.5 MB、一首音樂約 3.5 MB），直接放網站太大；轉成 MP3 後約剩 1/8。
  原始 WAV 完全不改、不刪（之後重做音效、重新轉檔都要用原檔）。

來源（音樂區 2026-10-23 開發者決定）：
  - 機體音效：第一批試作\\機體音效_組合版（AI＋程式合成）
  - 介面音效：第一批試作\\介面音效
  - 音樂：第一批試作\\音樂（A／B 兩版都轉，遊戲裡可切換，讓開發者在遊戲畫面裡選）

循環音樂的接縫：MP3 開頭會多一小段編碼空白，所以把每首 WAV 的「真正長度」寫進 manifest.json，
  遊戲用 Web Audio 播放時只循環這一段，接縫不會卡一下。

用法：python tools/build_audio.py      （已經轉過、而且原檔沒更新的會跳過）
輸出：assets/audio/se/*.mp3、assets/audio/ui/*.mp3、assets/audio/bgm/*.mp3、assets/audio/manifest.json
"""
import json
import os
import subprocess
import wave

HERE = os.path.dirname(os.path.abspath(__file__))
V12 = os.path.dirname(HERE)
SRC = os.path.join(os.path.dirname(V12), '美術設定與動畫素材', '音效與音樂', '第一批試作')
DST = os.path.join(V12, 'assets', 'audio')
FF = r'C:/Users/admin/AppData/Local/Programs/Python/Python312/Lib/site-packages/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe'
JOBS = [('機體音效_組合版', 'se', '128k'), ('介面音效', 'ui', '128k'), ('音樂', 'bgm', '160k')]


def wav_seconds(p):
    with wave.open(p) as w:
        return w.getnframes() / w.getframerate()


manifest = {}
total = 0
for sub, kind, rate in JOBS:
    src_dir, out_dir = os.path.join(SRC, sub), os.path.join(DST, kind)
    os.makedirs(out_dir, exist_ok=True)
    for f in sorted(os.listdir(src_dir)):
        if not f.lower().endswith('.wav'):
            continue
        key = f[:-4]
        src, out = os.path.join(src_dir, f), os.path.join(out_dir, key + '.mp3')
        if not (os.path.exists(out) and os.path.getmtime(out) >= os.path.getmtime(src)):
            subprocess.run([FF, '-y', '-loglevel', 'error', '-i', src, '-c:a', 'libmp3lame', '-b:a', rate, out], check=True)
        manifest[f'{kind}/{key}'] = round(wav_seconds(src), 4)
        total += os.path.getsize(out)
with open(os.path.join(DST, 'manifest.json'), 'w', encoding='utf-8') as fp:
    json.dump(manifest, fp, ensure_ascii=False, indent=1)
print(f'完成：{len(manifest)} 個檔，合計 {total / 1e6:.1f} MB → {DST}')
