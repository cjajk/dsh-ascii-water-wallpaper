/**
 * ASCII 水纹动态背景插件 —— Host 半。
 *
 * 渲染逻辑全部在浏览器半（client.js）完成；Host 半只声明可编辑的
 * Config schema。DSH 的 settings 域会据该 schema 在「插件详情/设置」面板
 * 自动生成一个可调节表单，所有字段均为 volatile，修改后即时生效、无需重挂载。
 *
 * @module @local/ascii-water-wallpaper
 */
import z from '@deepseek-ai/schemastery'

/** 背景底色（任意 CSS 颜色，默认纯黑）。 */
const bgColor = () => z.string().default('#000000').description('背景底色 Background color')
/** 字符颜色（任意 CSS 颜色，默认白）。 */
const charColor = () => z.string().default('#ffffff').description('字符颜色 Character color')

/** 数值字段：范围 + 步进 + 默认值，并标记为滑块控件。 */
const slider = (dflt, min, max, step) =>
  z.number().step(step).min(min).max(max).default(dflt).role('slider')

export const Config = z.object({
  bgColor: bgColor().volatile(),
  charColor: charColor().volatile(),
  fontSize: slider(14, 8, 40, 1).description('基础字符字号 Base font size (px)').volatile(),
  waterSpeed: slider(0.35, 0, 2, 0.05).description('水流流动速度 Water flow speed').volatile(),
  rippleRadius: slider(220, 40, 600, 5).description('涟漪扩散半径 Ripple radius (px)').volatile(),
  clickRippleScale: slider(1.85, 1, 4, 0.05).description('点击涟漪强度倍数 Click ripple strength multiplier').volatile(),
  maxRipples: slider(12, 1, 40, 1).description('最大同时涟漪数 Max simultaneous ripples').volatile(),
  trailGap: slider(12, 2, 80, 1).description('轨迹涟漪间距 Trail ripple gap (px)').volatile(),
  trailScale: slider(0.38, 0.1, 1, 0.01).description('轨迹涟漪缩放 Trail ripple scale').volatile(),
  particleCount: slider(34, 0, 200, 1).description('悬浮颗粒数量 Floating particle count').volatile(),
  uiOpacity: z.percent().default(0.85).description('上层组件整体半透明透明度 UI layer opacity (0-1)').volatile(),
})

/** Host 半无运行时行为；客户端负责渲染。 */
export function apply() {}
