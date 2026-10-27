# -*- coding: utf-8 -*-
"""
一鍵啟動《破曉因果之輪》第一大關（v10 地圖物件去影子）
為什麼需要它：遊戲要讀取演出播放器的 JSON 與圖片，瀏覽器禁止直接用「雙擊 index.html」(file://) 的方式讀取，
所以要先在本機開一個小型網頁伺服器。
v7 的改變：
  - 只開放「本版資料夾」：演出素材已經壓縮後放在 anim/ 裡，不再讀上層的原始素材 → 這就是將來要放上網站的樣子。
  - 安靜模式：不再每讀一張圖就印一行（待修正清單第二項第 4 點）。
  - 連接埠 8810（v10；v9＝8809、v6＝8800、v7＝8807、v8＝8808），同時開也不會打架。
用法：對著這個檔案按兩下（或在命令列執行 python 啟動遊戲.py），瀏覽器會自動打開遊戲。
      加上 --no-browser 就不自動開瀏覽器。
關閉：把跑出來的黑色命令視窗關掉即可。
"""
import functools
import http.server
import mimetypes
import os
import sys
import threading
import webbrowser

PORT = 8810
HERE = os.path.dirname(os.path.abspath(__file__))
mimetypes.add_type('image/webp', '.webp')   # 舊版 Python 在 Windows 上可能不認得 .webp


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):      # 只印錯誤（4xx／5xx），正常讀檔不印
        if len(args) > 1 and str(args[1])[:1] in '45':
            super().log_message(fmt, *args)


handler = functools.partial(QuietHandler, directory=HERE)
server = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), handler)
url = f'http://localhost:{PORT}/index.html'
print('遊戲網址：', url)
print('關閉這個視窗就會停止遊戲伺服器。')
if '--no-browser' not in sys.argv:
    threading.Timer(1.0, lambda: webbrowser.open(url)).start()
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
