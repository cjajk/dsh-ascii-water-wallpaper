/**
 * ASCII 水纹动态背景插件 —— 浏览器半。
 *
 * 职责：
 *  1. 在 DSH 所有 UI 之下（#root 之前）插入全屏 canvas，绘制 ASCII 水纹。
 *  2. 通过 theme.overrideTokens 把上层组件的背景 token 调成半透明，
 *     让底层水纹从组件后透出；透明度由「uiOpacity」滑块实时调节。
 *  3. 通过 ctx.configForms 读取并实时响应该插件自己的可调配置。
 *
 * 算法沿用参考 HTML 的流场（domain-warp 涡流）、Ripple 涟漪类、
 * Particle 悬浮粒子、depthBands 分层；交互迁移为窗口级监听，
 * 因此光标划过任意 UI 组件都会带出水纹，符合「桌面壁纸」语义。
 */

window.__ModuleLoader__.load({
  id: '@local/ascii-water-wallpaper',
  factory() {
    'use strict'

    const ID = '@local/ascii-water-wallpaper'
    const NS = 'ascii-water' // cordis.patch.yml 内的行 id = 配置命名空间
    const CANVAS_ID = 'ascii-water-bg'
    const FONT = 'ui-monospace, Menlo, Consolas, "Courier New", monospace'

    /* ---------- 固定常量（非配置项，与参考 HTML 对齐） ---------- */
    const MAX_COLS = 250
    const DPR_CAP = 2
    const CHARSET = [' ', '.', "'", ':', ';', '~', '-', '=', '+', '*', '#', '%', '@']
    const RIPPLE_CHARSET = ['.', ':', '~', 'o', 'O', '0']
    const DEPTH_BANDS = [
      { top: 0.0, bottom: 0.34, scale: 0.7, alpha: 0.15, speed: 0.5, cut: 0.12, cap: 6 },
      { top: 0.34, bottom: 0.68, scale: 0.9, alpha: 0.21, speed: 0.78, cut: 0.12, cap: 7 },
      { top: 0.68, bottom: 1.0, scale: 1.16, alpha: 0.27, speed: 1.08, cut: 0.12, cap: 8 },
    ]

    /* ---------- 配置默认值（与 index.js 的 Config 保持一致） ---------- */
    const DEFAULTS = Object.freeze({
      bgColor: '#000000',
      charColor: '#ffffff',
      fontSize: 14,
      waterSpeed: 0.35,
      rippleRadius: 220,
      clickRippleScale: 1.85,
      maxRipples: 12,
      trailGap: 12,
      trailScale: 0.38,
      particleCount: 34,
      uiOpacity: 0.85,
    })

    /* ---------- 小工具 ---------- */
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
    const lerp = (a, b, t) => a + (b - a) * t
    const rand = (a, b) => a + Math.random() * (b - a)
    const TAU = Math.PI * 2

    function clampByte(n) { return clamp(Math.round(n), 0, 255) }

    /** 解析 #rrggbb / #rgb / rgb() 颜色为 [r,g,b]。无法解析时退回白色。 */
    function parseColor(input) {
      const s = String(input ?? '#ffffff').trim()
      if (s.startsWith('#')) {
        let hex = s.slice(1)
        if (hex.length === 3) hex = hex.replace(/./g, c => c + c)
        if (/^[0-9a-fA-F]{6}$/.test(hex)) {
          const n = parseInt(hex, 16)
          return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
        }
      }
      const m = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/.exec(s)
      if (m) return [clampByte(m[1]), clampByte(m[2]), clampByte(m[3])]
      return [255, 255, 255]
    }

    /** 用当前字符颜色叠加 alpha，得到半透明 rgba 字符串。 */
    function rgbaWithAlpha(charRgb, alpha) {
      return `rgba(${charRgb[0]},${charRgb[1]},${charRgb[2]},${alpha.toFixed(3)})`
    }

    const reducedMotion = () =>
      typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches

    /* ============================================================
     *  渲染引擎（流场 / 涟漪 / 粒子 / 分层，移植自参考 HTML）
     * ============================================================ */
    function createEngine(canvas) {
      const g = canvas.getContext('2d', { alpha: false })
      const state = {
        cfg: { ...DEFAULTS },
        W: 0, H: 0, DPR: 1, UI: 1,
        bands: DEPTH_BANDS.map(b => ({ ...b, boost: null })),
        ripples: [],
        particles: [],
        pointer: {
          x: 0, y: 0, lastX: 0, lastY: 0, active: false,
          travel: 0, lastMoveT: 0, lastTrailT: 0, lastIdleT: 0,
        },
        last: 0, elapsed: 0, running: false, raf: 0,
      }

      const cfgGet = key => state.cfg[key]

      /* ----- 流场：域扭曲 + 涡流偏转 + 相位调制 + 疏密斑块 ----- */
      function hash2(x, y) {
        const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
        return s - Math.floor(s)
      }

      function waterField(x, y, t) {
        const ws = cfgGet('waterSpeed')
        const tt = t * ws
        const wx = x + 36 * Math.sin(y * 0.016 + tt * 0.8) + 26 * Math.sin((x + y) * 0.006 - tt * 0.5)
        const wy = y + 34 * Math.sin(x * 0.016 - tt * 0.5) + 12 * Math.sin(x * 0.045 + tt * 0.9)
        const ang = 0.8 * Math.sin(x * 0.0035 + y * 0.0045 + tt * 0.25) + 0.4 * Math.sin(y * 0.008 - tt * 0.4)
        const ca = Math.cos(ang), sa = Math.sin(ang)
        const u = wx * ca + wy * sa
        const v = -wx * sa + wy * ca
        const pm = 2.2 * Math.sin(u * 0.016 + tt * 0.7) + 1.2 * Math.sin(v * 0.008 - tt * 0.5)
        const p1 = v * 0.07 + u * 0.02 - tt * 2.0 + pm
        const p2 = v * 0.03 - u * 0.03 + tt * 1.3 + pm * 0.8
        let n = Math.pow(0.5 + 0.5 * Math.sin(p1), 8)
          + Math.pow(0.5 + 0.5 * Math.sin(p2), 11) * 0.26
        const mask = 0.42 + 0.58 * (0.5 + 0.5 * Math.sin(x * 0.005 - y * 0.006 + tt * 0.4))
        n *= mask
        n *= 0.55 + 0.45 * hash2(x * 0.12, y * 0.12)
        return n
      }

      function flowAngle(x, y, t) {
        return Math.sin(x * 0.012 - y * 0.017 + t * 0.35) * 1.1 + Math.sin(y * 0.02 + t * 0.22) * 0.6
      }

      /* ----- 涟漪 ----- */
      class Ripple {
        constructor(cx, cy, strength, big, scale) {
          this.x = cx; this.y = cy; this.r = 0
          const k = scale || 1
          this.maxR = (big
            ? cfgGet('rippleRadius') * cfgGet('clickRippleScale')
            : cfgGet('rippleRadius') * 0.62) * k * state.UI
          this.speed = (big ? 200 : 140) * (0.72 + 0.28 * k) * state.UI
          this.big = !!big
          this.base = strength
          this.strength = strength
          this.band = big ? 16 : 10 * clamp(0.7 + 0.3 * k, 0.8, 1.3)
          this.wob = rand(0, TAU)
          this.alive = true
        }
        update(dt) {
          this.r += this.speed * dt
          const p = this.r / this.maxR
          this.strength = this.base * clamp(1.25 - 1.15 * p, 0, 1) * 0.9
          if (p >= 1) this.alive = false
        }
        boost(x, y, t) {
          const dx = x - this.x, dy = y - this.y
          const lim = this.maxR + 30
          if (dx < -lim || dx > lim || dy < -lim || dy > lim) return 0
          const d = Math.sqrt(dx * dx + dy * dy)
          const wob = Math.sin(d * 0.045 + this.wob + t * 2.6) * 5
            + Math.sin(dx * 0.02 + dy * 0.015 + t * 1.7) * 3
          const dr = d - this.r - wob
          const band = this.band
          const gp = Math.exp(-(dr * dr) / (2 * band * band))
          const r2 = d - this.r * 0.55
          const g2 = Math.exp(-(r2 * r2) / (2 * (band * 1.4) * (band * 1.4))) * 0.12
          const ang = Math.atan2(dy, dx)
          const arcs = 0.58 + 0.42 * Math.sin(ang * 4.0 + this.wob * 2 + t * 1.1)
          return (gp + g2) * this.strength * arcs
        }
      }

      function spawnRipple(x, y, strength, big, scale) {
        const max = cfgGet('maxRipples')
        if (state.ripples.length >= max) state.ripples.shift()
        state.ripples.push(new Ripple(x, y, strength, big, scale))
      }

      /* ----- 悬浮颗粒 ----- */
      class Particle {
        constructor() { this.reset(true) }
        reset(anywhere) {
          const { W, H } = state
          this.x = rand(0, W)
          this.y = anywhere ? rand(0, H) : rand(H * 0.7, H)
          this.depth = Math.random() < 0.55 ? 0 : (Math.random() < 0.7 ? 1 : 2)
          this.phase = rand(0, TAU)
          this.ch = Math.random() < 0.6 ? '.' : "'"
        }
        update(dt, t) {
          const a = flowAngle(this.x, this.y, t)
          const band = DEPTH_BANDS[this.depth]
          this.x += Math.cos(a) * 9 * dt * band.speed
          this.y += Math.sin(a) * 3 * dt + Math.sin(t * 0.7 + this.phase) * 3 * dt
          const { W, H } = state
          if (this.x < -8) this.x = W + 8
          if (this.x > W + 8) this.x = -8
          if (this.y < -8) this.y = H + 8
          if (this.y > H + 8) this.y = -8
        }
        draw(t, charRgb) {
          const band = DEPTH_BANDS[this.depth]
          const a = clamp((0.09 + 0.05 * Math.sin(t * 0.9 + this.phase)) * band.alpha * 1.8, 0.03, 0.32)
          g.font = Math.round(cfgGet('fontSize') * band.scale * 0.8) + 'px ' + FONT
          g.fillStyle = rgbaWithAlpha(charRgb, a)
          g.fillText(this.ch, this.x, this.y)
        }
      }

      /* ----- 分层网格布局（DPR / 超宽屏自动缩放字符） ----- */
      function layout() {
        const winW = window.innerWidth
        const winH = window.innerHeight
        state.DPR = Math.min(window.devicePixelRatio || 1, DPR_CAP)
        state.W = winW
        state.H = winH
        canvas.width = Math.floor(winW * state.DPR)
        canvas.height = Math.floor(winH * state.DPR)
        canvas.style.width = winW + 'px'
        canvas.style.height = winH + 'px'
        g.setTransform(state.DPR, 0, 0, state.DPR, 0, 0)
        state.UI = clamp(Math.min(winW, winH) / 900, 0.5, 1.15)

        for (const b of state.bands) {
          b.fontPx = Math.max(8, Math.round(cfgGet('fontSize') * b.scale))
          g.font = b.fontPx + 'px ' + FONT
          b.cw = Math.round(g.measureText('M').width * 100) / 100 || b.fontPx * 0.6
          b.ch = b.fontPx * 1.02
          b.y0 = Math.round(b.top * winH)
          b.y1 = Math.round(b.bottom * winH)
          b.rows = Math.max(1, Math.floor((b.y1 - b.y0) / b.ch))
          b.cols = Math.max(1, Math.ceil(winW / b.cw))
          if (b.cols > MAX_COLS) {
            const k = b.cols / MAX_COLS
            b.fontPx = Math.round(b.fontPx * k)
            g.font = b.fontPx + 'px ' + FONT
            b.cw = Math.round(g.measureText('M').width * 100) / 100 || b.fontPx * 0.6
            b.ch = b.fontPx * 1.02
            b.rows = Math.max(1, Math.floor((b.y1 - b.y0) / b.ch))
            b.cols = Math.max(1, Math.ceil(winW / b.cw))
          }
          b.boost = new Float32Array(b.rows * b.cols)
        }
      }

      /* ----- 涟漪场局部计算（避开全屏遍历） ----- */
      function buildRippleFields(t) {
        for (let bi = 0; bi < state.bands.length; bi++) state.bands[bi].boost.fill(0)
        for (let i = 0; i < state.ripples.length; i++) {
          const rp = state.ripples[i]
          const R = rp.maxR + 40
          for (let bi = 0; bi < state.bands.length; bi++) {
            const b = state.bands[bi]
            const c0 = Math.max(0, Math.floor((rp.x - R) / b.cw))
            const c1 = Math.min(b.cols - 1, Math.ceil((rp.x + R) / b.cw))
            const r0 = Math.max(0, Math.floor((rp.y - R - b.y0) / b.ch))
            const r1 = Math.min(b.rows - 1, Math.ceil((rp.y + R - b.y0) / b.ch))
            for (let r = r0; r <= r1; r++) {
              const y = b.y0 + r * b.ch + b.ch * 0.55
              const off = r * b.cols
              for (let c = c0; c <= c1; c++) {
                const x = c * b.cw + b.cw * 0.5
                const dx = x - rp.x, dy = y - rp.y
                const d2 = dx * dx + dy * dy
                const lo = Math.max(0, rp.r - rp.band * 4)
                const hi = rp.r + rp.band * 4
                if (d2 < lo * lo || d2 > hi * hi) continue
                const v = rp.boost(x, y, t)
                if (v > b.boost[off + c]) b.boost[off + c] = v
              }
            }
          }
        }
      }

      /* ----- 水体（整行字符串绘制，base + 高光两层） ----- */
      function drawWater(t, charRgb) {
        const rchars = RIPPLE_CHARSET
        for (let bi = 0; bi < state.bands.length; bi++) {
          const b = state.bands[bi]
          g.font = b.fontPx + 'px ' + FONT
          g.textAlign = 'left'
          g.textBaseline = 'middle'
          for (let r = 0; r < b.rows; r++) {
            const y = b.y0 + r * b.ch + b.ch * 0.55
            const off = r * b.cols
            let base = '', hi = ''
            let baseHas = false, hiHas = false

            for (let c = 0; c < b.cols; c++) {
              const x = c * b.cw + b.cw * 0.5
              const bst = b.boost[off + c]

              let n = waterField(x, y, t)
              if (bst > 0.3) {
                const idx = Math.floor(clamp((bst - 0.3) / 0.7, 0, 1) * (rchars.length - 1))
                base += ' '
                hi += rchars[idx]
                hiHas = true
                continue
              }
              n = Math.min(1, n + bst * 0.9)
              if (n < b.cut) { base += ' '; hi += ' '; continue }

              const k = (n - b.cut) / (1 - b.cut)
              let idx = Math.floor(k * b.cap)
              if (idx > 0 && Math.random() < 0.14) idx -= 1
              idx = clamp(idx, 0, b.cap)
              base += CHARSET[idx]
              baseHas = true
              if (k > 0.85) { hi += CHARSET[clamp(idx + 1, 0, b.cap)]; hiHas = true }
              else hi += ' '
            }

            if (baseHas) {
              g.fillStyle = rgbaWithAlpha(charRgb, b.alpha)
              g.fillText(base, 0, y)
            }
            if (hiHas) {
              g.fillStyle = rgbaWithAlpha(charRgb, clamp(b.alpha + 0.22, 0, 0.9))
              g.fillText(hi, 0, y)
            }
          }
        }
      }

      /* ----- 交互（窗口级，覆盖上层 UI） ----- */
      function onMove(x, y) {
        const p = state.pointer
        const dx = x - p.lastX, dy = y - p.lastY
        const dist = Math.hypot(dx, dy)
        const now = performance.now()
        p.x = x; p.y = y; p.active = true
        p.lastX = x; p.lastY = y
        p.travel += dist
        p.lastMoveT = now
        if (reducedMotion()) return
        if (dist > 0.6 && p.travel >= cfgGet('trailGap') && now - p.lastTrailT > 55) {
          p.travel = 0
          p.lastTrailT = now
          const speedK = clamp(dist / 18, 0.35, 1)
          spawnRipple(x, y, 0.46 + 0.3 * speedK, false, cfgGet('trailScale'))
        }
      }
      function onDown(x, y) {
        const p = state.pointer
        p.x = x; p.y = y; p.active = true
        p.lastX = x; p.lastY = y
        p.lastMoveT = performance.now()
        spawnRipple(x, y, 1.0, true)
      }
      function updateHoverRipple(now) {
        const p = state.pointer
        if (!p.active || reducedMotion()) return
        if (now - p.lastMoveT < 900) return
        if (now - p.lastIdleT < 1300) return
        p.lastIdleT = now
        spawnRipple(p.x, p.y, 0.62, false, 0.3)
      }

      function isTouch(e) { return e.type.indexOf('touch') === 0 }
      const onMouseMove = e => onMove(e.clientX, e.clientY)
      const onTouchMove = e => { const t = e.touches[0]; if (t) onMove(t.clientX, t.clientY) }
      let lastTouchT = 0
      const onDownEvt = e => {
        if (isTouch(e)) {
          lastTouchT = performance.now()
          const t = e.touches[0]; if (t) onDown(t.clientX, t.clientY)
        } else {
          if (performance.now() - lastTouchT < 700) return // 抑制 touch 之后合成的 mousedown，避免双击涟漪
          onDown(e.clientX, e.clientY)
        }
      }
      const onPointerIdle = () => { state.pointer.active = false }

      function onResize() { layout() }
      function onVisibility() {
        if (document.hidden) {
          state.running = false
          cancelAnimationFrame(state.raf)
        } else if (!state.running && state.started) {
          state.running = true
          state.last = performance.now()
          state.raf = requestAnimationFrame(frame)
        }
      }

      /* ----- 主循环 ----- */
      function frame(now) {
        if (!state.running) return
        let dt = (now - state.last) / 1000
        state.last = now
        dt = clamp(dt, 0, 0.05)
        if (reducedMotion()) dt *= 0.35
        state.elapsed += dt
        const t = state.elapsed
        const charRgb = parseColor(cfgGet('charColor'))

        g.setTransform(state.DPR, 0, 0, state.DPR, 0, 0)
        g.fillStyle = cfgGet('bgColor')
        g.fillRect(0, 0, state.W, state.H)

        for (let i = state.ripples.length - 1; i >= 0; i--) {
          state.ripples[i].update(dt)
          if (!state.ripples[i].alive) state.ripples.splice(i, 1)
        }
        updateHoverRipple(now)
        buildRippleFields(t)

        g.textAlign = 'center'
        g.textBaseline = 'middle'
        for (const p of state.particles) { p.update(dt, t); p.draw(t, charRgb) }

        drawWater(t, charRgb)

        state.raf = requestAnimationFrame(frame)
      }

      /* ----- 对外接口 ----- */
      return {
        start() {
          layout()
          state.particles = []
          for (let i = 0; i < cfgGet('particleCount'); i++) state.particles.push(new Particle())
          state.started = true
          state.running = true
          state.last = performance.now()

          window.addEventListener('resize', onResize)
          window.addEventListener('mousemove', onMouseMove)
          window.addEventListener('mousedown', onDownEvt)
          window.addEventListener('touchstart', onDownEvt, { passive: true })
          window.addEventListener('touchmove', onTouchMove, { passive: true })
          window.addEventListener('touchend', onPointerIdle)
          window.addEventListener('touchcancel', onPointerIdle)
          document.addEventListener('visibilitychange', onVisibility)

          state.raf = requestAnimationFrame(frame)
        },
        stop() {
          state.running = false
          state.started = false
          cancelAnimationFrame(state.raf)
          window.removeEventListener('resize', onResize)
          window.removeEventListener('mousemove', onMouseMove)
          window.removeEventListener('mousedown', onDownEvt)
          window.removeEventListener('touchstart', onDownEvt)
          window.removeEventListener('touchmove', onTouchMove)
          window.removeEventListener('touchend', onPointerIdle)
          window.removeEventListener('touchcancel', onPointerIdle)
          document.removeEventListener('visibilitychange', onVisibility)
        },
        setConfig(next) {
          const cfg = state.cfg
          let relayout = false
          for (const key of Object.keys(DEFAULTS)) {
            if (key === 'uiOpacity') continue // 透明度不属于画布算法
            const value = next[key]
            if (value === undefined) continue
            if (value !== cfg[key]) {
              if (key === 'fontSize') relayout = true
              cfg[key] = value
            }
          }
          if (next.particleCount !== undefined && next.particleCount !== state.particles.length) {
            const target = clamp(Math.floor(next.particleCount), 0, 200)
            while (state.particles.length < target) state.particles.push(new Particle())
            state.particles.length = target
          }
          if (relayout) layout()
        },
      }
    }

    /* ============================================================
     *  上层组件半透明：采样当前主题基础色，再按 uiOpacity 调低不透明度
     * ============================================================ */
    const SURFACE_TOKENS = [
      '--dsw-alias-bg-base',
      '--dsw-alias-bg-layer-1',
      '--dsw-alias-bg-layer-2',
      '--dsw-alias-bg-overlay',
      '--dsw-specific-sidebar-fill',
    ]

    function sampleBasePalette(body) {
      const hadDark = body.hasAttribute('data-ds-dark-theme')
      const palette = {}
      for (const name of SURFACE_TOKENS) {
        body.removeAttribute('data-ds-dark-theme')
        const light = getComputedStyle(body).getPropertyValue(name).trim()
        body.setAttribute('data-ds-dark-theme', '')
        const dark = getComputedStyle(body).getPropertyValue(name).trim()
        palette[name] = { light, dark }
      }
      if (hadDark) body.setAttribute('data-ds-dark-theme', '')
      else body.removeAttribute('data-ds-dark-theme')
      return palette
    }

    function opacify(color, pct) {
      if (!color || color.includes('var(')) return null
      return `color-mix(in srgb, ${color} ${pct}%, transparent)`
    }

    return {
      inject: ['configForms', 'theme'],
      apply(ctx) {
        const form = ctx.configForms.get(NS)

        let basePalette = null
        let disposeTokens = null

        const applyTransparency = (opacity) => {
          const pct = Math.round(clamp(opacity, 0, 1) * 100)
          if (!basePalette) basePalette = sampleBasePalette(document.body)
          const tokens = {}
          for (const name of SURFACE_TOKENS) {
            const pair = basePalette[name] || { light: '#ffffff', dark: '#101113' }
            const light = opacify(pair.light, pct) || `rgba(255,255,255,${clamp(opacity, 0, 1)})`
            const dark = opacify(pair.dark, pct) || `rgba(16,17,19,${clamp(opacity, 0, 1)})`
            tokens[name] = { light, dark }
          }
          if (disposeTokens) disposeTokens()
          disposeTokens = ctx.theme.overrideTokens(ID, tokens)
        }

        ctx.effect(() => {
          // 1. 注入全局样式：#root 抬到背景层之上
          const styleTag = document.createElement('style')
          styleTag.dataset.plugin = ID
          styleTag.textContent = `
            #root { position: relative; z-index: 1; }
            #${CANVAS_ID} {
              position: fixed; top: 0; left: 0; margin: 0; padding: 0;
              width: 100%; height: 100%; z-index: 0;
              pointer-events: none; touch-action: none; background: #000;
            }
          `
          document.head.appendChild(styleTag)

          // 2. 创建底层全屏 canvas，插到 #root 之前
          const canvas = document.createElement('canvas')
          canvas.id = CANVAS_ID
          const root = document.getElementById('root')
          document.body.insertBefore(canvas, root || null)

          // 3. 引擎 + 配置订阅
          const engine = createEngine(canvas)
          const readConfig = () => form.getSnapshot().value ?? DEFAULTS
          const applyAll = () => {
            const cfg = readConfig()
            engine.setConfig(cfg)
            // 首次 config 就绪时（异步）再进行透明度采样，主题样式必然已注入
            applyTransparency(cfg.uiOpacity ?? DEFAULTS.uiOpacity)
          }

          engine.start()
          engine.setConfig(readConfig())

          // 首帧后再套用透明度，确保主题基础色已就绪
          let rafInit = requestAnimationFrame(applyAll)
          const unsubscribe = form.subscribe(() => {
            cancelAnimationFrame(rafInit)
            applyAll()
          })

          return () => {
            cancelAnimationFrame(rafInit)
            unsubscribe()
            engine.stop()
            if (canvas.parentNode) canvas.parentNode.removeChild(canvas)
            if (styleTag.parentNode) styleTag.parentNode.removeChild(styleTag)
            if (disposeTokens) { disposeTokens(); disposeTokens = null }
          }
        })
      },
    }
  },
})
