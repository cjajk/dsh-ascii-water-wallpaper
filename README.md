# ASCII 水纹壁纸（DSH 桌面背景主题插件）

在 DeepSeek Harness（DSH）桌面壳的最底层渲染一个全屏 ASCII 水纹动态背景，作为「桌面壁纸」。算法移植自参考 `ASCII水纹.html` 的流场（域扭曲涡流）、Ripple 涟漪类、Particle 悬浮粒子与三层 depthBands 分层，并适配 DSH 的插件环境。

![预览](docs/preview.svg)

## 特性

- 黑色底色 + 由暗到亮的 ASCII 字符水纹，含水流流动与涡流扭曲动画。
- 三层纵深（远景 / 中景 / 近景），字符大小、透明度、流速随深度区分。
- 鼠标移动 → 轨迹涟漪；鼠标点击 → 冲击涟漪；光标静止 → 呼吸式小涟漪。
- 少量缓慢漂浮的颗粒字符。
- 涟漪只做环带局部计算（非全屏遍历），自动处理 DPR 与超宽屏字符缩放。
- 支持触屏（touch 滑动 / 点击同样触发涟漪）。
- 页面隐藏时暂停渲染；尊重系统「减弱动画」。
- 上层界面（面板、任务框、侧栏、抽屉）整体半透明，背景动画从组件后透出。

## 安装

**方式一：从 GitHub 克隆后本地安装**

```
git clone https://github.com/cjajk/dsh-ascii-water-wallpaper.git
```

然后在 DSH 的 **Plugins（插件）** 面板选择 **Add plugin（添加插件）**，指向克隆下来的目录；或在 Agent 中运行：

```
plugin_manager install_bundle <克隆目录的绝对路径>
```

**方式二：直接从本地目录安装**

把本目录（含 `package.json`、`cordis.patch.yml`）指向 Plugins 面板 Add plugin，或使用上面的 `install_bundle` 命令。

安装后在插件行或设置中开启即可，背景立即出现在所有窗口之下。

> 仓库按 bundle 结构发布，无需 `npm install`：运行期依赖由 DSH 宿主提供（`@deepseek-ai/schemastery` 等），`node_modules` 不入库。

## 可配置项

全部参数通过插件设置面板实时调节（volatile，即时生效）：

| 参数 | 说明 |
| --- | --- |
| `bgColor` | 背景底色 |
| `charColor` | 字符颜色 |
| `fontSize` | 基础字符字号（px） |
| `waterSpeed` | 水流流动速度 |
| `rippleRadius` | 涟漪扩散半径（px） |
| `clickRippleScale` | 点击涟漪强度倍数 |
| `maxRipples` | 最大同时涟漪数 |
| `trailGap` | 轨迹涟漪间距（px） |
| `trailScale` | 轨迹涟漪缩放 |
| `particleCount` | 悬浮颗粒数量 |
| `uiOpacity` | 所有界面面板/任务框的不透明度（1=不透明，0.7 左右开始明显透出背景，0=完全透明） |

## 半透明是怎么做的

v1.1 起不再依赖主题服务的 `overrideTokens`（该接口不生效时界面会一点也不透，背景被完全盖住），改成两路同时生效：

1. **改写 surface token**：把 `--dsw-alias-bg-base`、`--dsw-alias-bg-layer-1/2`、`--dsw-alias-bg-overlay`、`--dsw-specific-sidebar-fill` 直接写成 `rgba(主题底色, uiOpacity) !important`，并把 `#root`、`html`、`body` 的底色置为透明。
2. **面板扫描**：遍历已渲染的元素，凡是「不透明背景 + 无渐变/图片背景」的，把同一种颜色就地换成同色半透明（原始色记在内存里，卸载时还原）。挂载新面板时由 `MutationObserver` 增量补扫，所以新开的任务框也会跟着变透。

## 文件结构

- `index.js` —— Host 半，声明 `Config` 配置 schema。
- `client.js` —— 浏览器半，画布渲染引擎 + 半透明化 + 配置订阅。
- `cordis.patch.yml` —— 插件注册行（`id: ascii-water` 即配置命名空间）。
- `locale/`、`icon.svg`、`docs/` —— 插件元信息与详情页素材。

## 已知可优化点

- 流场逐格逐帧重算（1920×1080 约 2.1 万格，本机纯计算约 5.8 ms/帧），低端设备可考虑降帧或半分辨率插值。
- 主题明暗切换后不会重新采样上层底色，半透明底色会沿用启动时采到的调色板。
- 字符抖动使用逐帧随机，视觉上有轻微噪点，可改为按格哈希以获得稳定纹理。

## 许可

MIT
