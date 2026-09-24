# ECHO Reactive Wallpaper

这是一个可直接导入 Wallpaper Engine 的 Web 壁纸模板。

1. 保持整个 `echo-web-wallpaper` 文件夹独立，不要把它放在包含大量文件的目录中。
2. 打开 Wallpaper Engine，选择“壁纸编辑器 / 创建壁纸”。
3. 把 `index.html` 拖入创建窗口并保存。
4. 启动 ECHO；壁纸右上角显示 `ECHO PCM LIVE` 后，32 段频谱即已接通。

视频壁纸不能运行 JavaScript，因此无法直接连接 ECHO。需要音乐联动时，请使用这个 Web 壁纸，或把 `wallpaper.js` 的连接逻辑合并到其他 Web 壁纸中。

桥地址固定为 `http://127.0.0.1:47668/events`，只在本机访问。
