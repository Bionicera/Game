# 彩虹星河 · Rainbow Galaxy

## 📱 手机浏览器开发测试

<a href="https://cdn.jsdelivr.net/gh/Bionicera/Game@main/Portrait%20Breakout.html">
  <img src="https://img.shields.io/badge/%E6%89%8B%E6%9C%BA%E6%B5%8F%E8%A7%88%E5%99%A8-%E7%AB%8B%E5%8D%B3%E8%BF%90%E8%A1%8C-16a34a?style=for-the-badge" alt="手机浏览器打开游戏：立即运行">
</a>

直接打开：[彩虹星河 · Rainbow Galaxy](https://cdn.jsdelivr.net/gh/Bionicera/Game@main/Portrait%20Breakout.html)

如果刚提交了代码但手机仍显示旧版本，点击这里刷新试玩文件的 CDN 缓存：[刷新测试页面缓存](https://purge.jsdelivr.net/gh/Bionicera/Game@main/Portrait%20Breakout.html)，然后重新打开上面的游戏链接。

> 这是跟随 `main` 分支的开发测试入口，不是正式发布版本，也没有配置 GitHub Pages。为了让频繁调试更方便，更新代码后可先刷新 CDN 缓存再在手机上重载页面。

## 游戏说明

当前仓库包含一个独立 HTML 游戏文件：`Portrait Breakout.html`。游戏使用原生 HTML、CSS 和 Canvas JavaScript 实现，不需要安装依赖或启动构建工具。

- **竖屏优先**：针对手机视口设计，横屏时会显示旋转设备提示。
- **触屏操作**：在游戏画布上按住并左右滑动，控制挡板；点击画布发球。
- **自动驾驶**：点击右上角的 `Auto`，体验自动接球和自动瞄准。
- **其他操作**：可暂停、重新开始或切换全屏；开局时可选择挡板形状。
- **本地记录**：最高分和挡板形状保存在当前浏览器的本地存储中。

## 本地运行

下载或克隆仓库后，在浏览器中打开 `Portrait Breakout.html` 即可运行。该游戏是单文件实现，没有外部运行时依赖。

## 文件

- [Portrait Breakout.html](./Portrait%20Breakout.html) — 竖屏打砖块游戏源码
