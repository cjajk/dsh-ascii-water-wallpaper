window.__ModuleLoader__.load({
  id: '@local/ascii-water-wallpaper',
  factory() {
    'use strict';

    const ID = '@local/ascii-water-wallpaper';
    const NS = 'ascii-water';
    const CANVAS_ID = 'ascii-water-bg';
    const FONT = 'ui-monospace, Menlo, Consolas, Courier New, monospace';
    const MAX_COLS = 250;
    const DPR_CAP = 2;

    // 水纹梯度字符：从暗到亮
    const CHARSET = [' ', '.', "'", ':', ';', '~', '-', '=', '+', '*', '#', '%', '@'];
    // 涟漪专用字符
    const RIPPLE_CHARSET = ['.', ':', '~', 'o', 'O', '0'];

    // 三层水纹：远近不同尺度、透明度、流速
    const DEPTH_BANDS = [
      { top: 0, bottom: 0.34, scale: 0.7, alpha: 0.15, speed: 0.5, cut: 0.12, cap: 6 },
      { top: 0.34, bottom: 0.68, scale: 0.9, alpha: 0.21, speed: 0.78, cut: 0.12, cap: 7 },
      { top: 0.68, bottom: 1, scale: 1.16, alpha: 0.27, speed: 1.08, cut: 0.12, cap: 8 }
    ];

    const DEFAULTS = Object.freeze({
      bgColor: '#000000',
      charColor: '#ffffff',
      fontSize: 14,
      waterSpeed: 0.35,
      rippleRadius: 220,
      clickRippleScale: 1.9,
      maxRipples: 16,
      trailGap: 12,
      trailScale: 0.38,
      particleCount: 34,
      uiOpacity: 0.72,
      swimFish: true,
      fishCount: 8,
      clockMode: 1,
      baitEnabled: true,
      leadEnabled: true
    });

    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const lerp = (a, b, t) => a + (b - a) * t;
    const rand = (a, b) => a + Math.random() * (b - a);
    const TAU = Math.PI * 2;
    const wrapPi = a => {
      a %= TAU;
      if (a > Math.PI) a -= TAU;
      else if (a < -Math.PI) a += TAU;
      return a;
    };

    function clampByte(n) {
      return clamp(Math.round(n), 0, 255);
    }

    const HEX_SET = '0123456789abcdefABCDEF';

    // 支持 #rgb / #rrggbb / rgb() / rgba()，失败回退白色
    function parseColor(input) {
      const s = String(input === undefined || input === null ? '#ffffff' : input).trim();
      if (s.charAt(0) === '#') {
        let hex = s.slice(1);
        if (hex.length === 3) {
          let out = '';
          for (let i = 0; i < 3; i++) out += hex.charAt(i) + hex.charAt(i);
          hex = out;
        }
        if (hex.length === 6) {
          let ok = true;
          for (let i = 0; i < 6; i++) if (HEX_SET.indexOf(hex.charAt(i)) < 0) ok = false;
          if (ok) {
            const n = parseInt(hex, 16);
            return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
          }
        }
      }
      const body = readFnColor(s);
      if (body) return [clampByte(body[0]), clampByte(body[1]), clampByte(body[2])];
      return [255, 255, 255];
    }

    // 解析 rgb()/rgba() 的三个通道；无正则实现，避免转义麻烦
    function readFnColor(s) {
      if (s.indexOf('rgb') !== 0) return null;
      const open = s.indexOf('(');
      const close = s.lastIndexOf(')');
      if (open < 0 || close < open) return null;
      const parts = s.slice(open + 1, close).split(',');
      if (parts.length < 3) return null;
      const nums = [];
      for (let i = 0; i < 3; i++) {
        const v = parseFloat(parts[i]);
        if (!isFiniteNum(v)) return null;
        nums.push(v);
      }
      return nums;
    }

    function isFiniteNum(v) {
      return typeof v === 'number' && v === v && v !== Infinity && v !== -Infinity;
    }

    function rgbaWithAlpha(charRgb, alpha) {
      return 'rgba(' + charRgb[0] + ',' + charRgb[1] + ',' + charRgb[2] + ',' + clamp(alpha, 0, 1).toFixed(3) + ')';
    }

    const reducedMotion = () =>
      typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function createEngine(canvas) {
      const ctx = canvas.getContext('2d', { alpha: false });
      const cfg = Object.assign({}, DEFAULTS);

      let W = 0, H = 0, DPR = 1, UI = 1;
      let running = false, started = false, raf = 0, last = 0, elapsed = 0;
      let rm = reducedMotion();
      let charRgb = [255, 255, 255];

      const bands = DEPTH_BANDS.map(b => Object.assign({}, b, { boost: null }));

      // ---- 三角函数查表：把每帧数万次 Math.sin 降为数组访问 ----
      const SIN_N = 4096, SIN_MASK = SIN_N - 1, SIN_SCALE = SIN_N / TAU;
      const SIN = new Float32Array(SIN_N);
      for (let i = 0; i < SIN_N; i++) SIN[i] = Math.sin(i / SIN_SCALE);
      const sinT = a => SIN[((a * SIN_SCALE) | 0) & SIN_MASK];

      const SIN_HALF = new Float32Array(SIN_N);
      for (let i = 0; i < SIN_N; i++) SIN_HALF[i] = 0.5 + 0.5 * SIN[i];
      const halfSin = a => SIN_HALF[((a * SIN_SCALE) | 0) & SIN_MASK];

      // p^8 / p^11 同样查表，这是水纹锐脊的关键
      const POW_N = 1024;
      const POW8 = new Float32Array(POW_N + 1);
      const POW11 = new Float32Array(POW_N + 1);
      for (let i = 0; i <= POW_N; i++) {
        const v = i / POW_N;
        POW8[i] = Math.pow(v, 8);
        POW11[i] = Math.pow(v, 11);
      }

      const ripples = [];
      const particles = [];
      const baits = [];
      const waves = [];

      const fishGrid = {
        px: 10, cw: 6, ch: 10, cols: 0, rows: 0,
        cell: null, lvl: null, mask: null, rowMin: null, rowMax: null,
        rMin: 0, rMax: -1, any: false
      };

      const timeGrid = {
        cell: null, lvl: null, rowMin: null, rowMax: null,
        rMin: 0, rMax: -1, any: false
      };

      const clock = {
        mode: 0, lastMode: 1, on: false, fade: 0, dirty: true, snap: true,
        str: '', cols: 0, rows: 0, col0: 0, row0: 0,
        cur: null, tgt: null, ux: null, uy: null, vx: null, vy: null, fx: null, fy: null, rb: null
      };
      const CLK_SS = 4;
      let clockCv = null;

      const pointer = { x: 0, y: 0, lastX: 0, lastY: 0, active: false, travel: 0, lastMoveT: 0, lastTrailT: 0, lastIdleT: 0 };
      const lead = { active: false, t: 0, rippleT: 0 };
      const press = { down: false, x0: 0, y0: 0, t0: 0, moved: false, baits: [] };
      let holdTimer = 0, holdX = 0, holdY = 0, holdDone = false;

      const schools = [];
      const fishes = [];

      function layout() {
        const winW = window.innerWidth;
        const winH = window.innerHeight;
        DPR = Math.min(window.devicePixelRatio || 1, DPR_CAP);
        W = winW; H = winH;
        canvas.width = Math.floor(winW * DPR);
        canvas.height = Math.floor(winH * DPR);
        canvas.style.width = winW + 'px';
        canvas.style.height = winH + 'px';
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
        UI = clamp(Math.min(winW, winH) / 900, 0.5, 1.15);

        for (const b of bands) {
          b.fontPx = Math.max(8, Math.round(cfg.fontSize * b.scale));
          ctx.font = b.fontPx + 'px ' + FONT;
          b.cw = Math.round(ctx.measureText('M').width * 100) / 100 || b.fontPx * 0.6;
          b.ch = b.fontPx * 1.02;
          b.y0 = Math.round(b.top * winH);
          b.y1 = Math.round(b.bottom * winH);
          b.rows = Math.max(1, Math.floor((b.y1 - b.y0) / b.ch));
          b.cols = Math.max(1, Math.ceil(winW / b.cw));
          if (b.cols > MAX_COLS) {
            const k = b.cols / MAX_COLS;
            b.fontPx = Math.round(b.fontPx * k);
            ctx.font = b.fontPx + 'px ' + FONT;
            b.cw = Math.round(ctx.measureText('M').width * 100) / 100 || b.fontPx * 0.6;
            b.ch = b.fontPx * 1.02;
            b.rows = Math.max(1, Math.floor((b.y1 - b.y0) / b.ch));
            b.cols = Math.max(1, Math.ceil(winW / b.cw));
          }
          b.boost = new Float32Array(b.rows * b.cols);
        }
        layoutFishGrid();
      }

      function layoutFishGrid() {
        const g = fishGrid;
        g.px = clamp(Math.round(cfg.fontSize * 0.64 * clamp(UI, 0.75, 1.1)), 7, 12);
        ctx.font = g.px + 'px ' + FONT;
        g.cw = Math.round(ctx.measureText('M').width * 100) / 100 || g.px * 0.6;
        g.ch = g.px * 1.02;
        g.cols = Math.ceil(W / g.cw) + 2;
        g.rows = Math.ceil(H / g.ch) + 2;
        const n = g.cols * g.rows;
        g.cell = new Uint8Array(n);
        g.lvl = new Uint8Array(n);
        g.mask = new Uint8Array(n);
        g.rowMin = new Int16Array(g.rows);
        g.rowMax = new Int16Array(g.rows);

        const tg = timeGrid;
        tg.cell = new Uint8Array(n);
        tg.lvl = new Uint8Array(n);
        tg.rowMin = new Int16Array(g.rows);
        tg.rowMax = new Int16Array(g.rows);
        tg.any = false;
        tg.rMin = g.rows;
        tg.rMax = -1;
        clock.dirty = true;
        clock.snap = true;
      }

      function hash2(x, y) {
        const s = sinT(x * 127.1 + y * 311.7) * 43758.5453;
        return s - Math.floor(s);
      }

      // 域扭曲 + 两次高次幂正弦取脊，模拟焦散亮线
      function waterField(x, y, t) {
        const tt = t * cfg.waterSpeed;
        const wx = x + 36 * sinT(y * 0.016 + tt * 0.8) + 26 * sinT((x + y) * 0.006 - tt * 0.5);
        const wy = y + 34 * sinT(x * 0.016 - tt * 0.5) + 12 * sinT(x * 0.045 + tt * 0.9);
        const ang = 0.8 * sinT(x * 0.0035 + y * 0.0045 + tt * 0.25) + 0.4 * sinT(y * 0.008 - tt * 0.4);
        const ca = sinT(ang + Math.PI * 0.5), sa = sinT(ang);
        const u = wx * ca + wy * sa;
        const v = -wx * sa + wy * ca;
        const pm = 2.2 * sinT(u * 0.016 + tt * 0.7) + 1.2 * sinT(v * 0.008 - tt * 0.5);
        const p1 = v * 0.07 + u * 0.02 - tt * 2 + pm;
        const p2 = v * 0.03 - u * 0.03 + tt * 1.3 + pm * 0.8;
        const i1 = clamp(Math.round(halfSin(p1) * POW_N), 0, POW_N);
        const i2 = clamp(Math.round(halfSin(p2) * POW_N), 0, POW_N);
        let n = POW8[i1] + POW11[i2] * 0.26;
        const mask = 0.42 + 0.58 * (0.5 + 0.5 * sinT(x * 0.005 - y * 0.006 + tt * 0.4));
        n *= mask;
        n *= 0.55 + 0.45 * hash2(x * 0.12, y * 0.12);
        return n;
      }

      function flowAngle(x, y, t) {
        return sinT(x * 0.012 - y * 0.017 + t * 0.35) * 1.1 + sinT(y * 0.02 + t * 0.22) * 0.6;
      }

      class Ripple {
        constructor(cx, cy, strength, big, scale) {
          this.x = cx;
          this.y = cy;
          this.r = 0;
          const k = scale || 1;
          this.maxR = (big ? cfg.rippleRadius * cfg.clickRippleScale : cfg.rippleRadius * 0.62) * k * UI;
          this.speed = (big ? 200 : 140) * (0.72 + 0.28 * k) * UI;
          this.big = !!big;
          this.base = strength;
          this.strength = strength;
          this.band = big ? 16 : 10 * clamp(0.7 + 0.3 * k, 0.8, 1.3);
          this.wob = rand(0, TAU);
          this.alive = true;
        }

        update(dt) {
          this.r += this.speed * dt;
          const p = this.r / this.maxR;
          this.strength = this.base * clamp(1.25 - 1.15 * p, 0, 1) * 0.9;
          if (p >= 1) this.alive = false;
        }

        boost(x, y, t) {
          const dx = x - this.x, dy = y - this.y;
          const lim = this.maxR + 30;
          if (dx < -lim || dx > lim || dy < -lim || dy > lim) return 0;
          const d = Math.sqrt(dx * dx + dy * dy);
          const wob = sinT(d * 0.045 + this.wob + t * 2.6) * 5 + sinT(dx * 0.02 + dy * 0.015 + t * 1.7) * 3;
          const dr = d - this.r - wob;
          const band = this.band;
          const gp = Math.exp(-(dr * dr) / (2 * band * band));
          const r2 = d - this.r * 0.55;
          const g2 = Math.exp(-(r2 * r2) / (2 * (band * 1.4) * (band * 1.4))) * 0.12;
          const ang = Math.atan2(dy, dx);
          const arcs = 0.58 + 0.42 * sinT(ang * 4 + this.wob * 2 + t * 1.1);
          return (gp + g2) * this.strength * arcs;
        }
      }

      function spawnRipple(x, y, strength, big, scale) {
        const max = Math.max(1, cfg.maxRipples);
        if (ripples.length >= max) ripples.shift();
        ripples.push(new Ripple(x, y, strength, big, scale));
      }

      class Particle {
        constructor() { this.reset(true); }
        reset(anywhere) {
          this.x = rand(0, W);
          this.y = anywhere ? rand(0, H) : rand(H * 0.7, H);
          this.depth = Math.random() < 0.55 ? 0 : Math.random() < 0.7 ? 1 : 2;
          this.phase = rand(0, TAU);
          this.ch = Math.random() < 0.6 ? '.' : "'";
        }
        update(dt, t) {
          const a = flowAngle(this.x, this.y, t);
          const band = DEPTH_BANDS[this.depth];
          this.x += Math.cos(a) * 9 * dt * band.speed;
          this.y += Math.sin(a) * 3 * dt + Math.sin(t * 0.7 + this.phase) * 3 * dt;
          if (this.x < -8) this.x = W + 8;
          if (this.x > W + 8) this.x = -8;
          if (this.y < -8) this.y = H + 8;
          if (this.y > H + 8) this.y = -8;
        }
        draw(t) {
          const band = DEPTH_BANDS[this.depth];
          const a = clamp((0.09 + 0.05 * Math.sin(t * 0.9 + this.phase)) * band.alpha * 1.8, 0.03, 0.32);
          ctx.font = Math.round(cfg.fontSize * band.scale * 0.8) + 'px ' + FONT;
          ctx.fillStyle = rgbaWithAlpha(charRgb, a);
          ctx.fillText(this.ch, this.x, this.y);
        }
      }

      function syncParticles() {
        const target = clamp(Math.floor(cfg.particleCount), 0, 200);
        while (particles.length < target) particles.push(new Particle());
        particles.length = target;
      }

      // ---- 投饵 / 引鱼 手势 ----
      function startLead() {
        if (lead.active) return;
        lead.active = true;
        lead.t = 0;
        lead.rippleT = 0;
        holdDone = true;
        clearTimeout(holdTimer);
        for (const bt of press.baits) {
          const i = baits.indexOf(bt);
          if (i >= 0) baits.splice(i, 1);
        }
        press.baits.length = 0;
        spawnRipple(pointer.x, pointer.y, 0.7, false, 0.55);
      }

      function onMove(x, y) {
        const dx = x - pointer.lastX, dy = y - pointer.lastY;
        const dist = Math.hypot(dx, dy);
        const now = performance.now();
        pointer.x = x;
        pointer.y = y;
        pointer.active = true;
        pointer.lastX = x;
        pointer.lastY = y;
        pointer.travel += dist;
        pointer.lastMoveT = now;

        if (press.down && !lead.active) {
          if (!press.moved && Math.hypot(x - press.x0, y - press.y0) > 18) press.moved = true;
          if (press.moved && cfg.leadEnabled && now - press.t0 >= 320) startLead();
        }

        if (rm) return;
        if (dist > 0.6 && pointer.travel >= cfg.trailGap && now - pointer.lastTrailT > 55) {
          pointer.travel = 0;
          pointer.lastTrailT = now;
          const speedK = clamp(dist / 18, 0.35, 1);
          spawnRipple(x, y, 0.46 + 0.3 * speedK, false, cfg.trailScale);
        }
      }

      function onDown(x, y) {
        pointer.x = x;
        pointer.y = y;
        pointer.active = true;
        pointer.lastX = x;
        pointer.lastY = y;
        pointer.lastMoveT = performance.now();
        spawnRipple(x, y, 0.42, false, 0.32);

        holdX = x;
        holdY = y;
        holdDone = false;
        press.down = true;
        press.x0 = x;
        press.y0 = y;
        press.t0 = performance.now();
        press.moved = false;
        press.baits.length = 0;
        lead.active = false;
        clearTimeout(holdTimer);
        if (!cfg.baitEnabled) return;

        holdTimer = setTimeout(function tick() {
          if (!press.down || lead.active) return;
          if (press.moved) {
            if (cfg.leadEnabled) startLead();
            return;
          }
          holdDone = true;
          if (baits.length < 3) press.baits.push(addBait(holdX, holdY));
          if (press.down) holdTimer = setTimeout(tick, 320);
        }, 320);
      }

      function onUp(x, y) {
        if (!press.down) return;
        press.down = false;
        clearTimeout(holdTimer);
        const wasLead = lead.active;
        lead.active = false;
        if (!holdDone && !press.moved) {
          spawnRipple(x, y, 1, true);
          scatterFish(x, y);
          clockSplash(x, y);
        }
        if (wasLead) spawnRipple(pointer.x, pointer.y, 0.5, false, 0.5);
        holdDone = false;
      }

      function cancelPress() {
        press.down = false;
        lead.active = false;
        holdDone = false;
        clearTimeout(holdTimer);
      }

      function updateHoverRipple(now) {
        if (!pointer.active || rm) return;
        if (now - pointer.lastMoveT < 900) return;
        if (now - pointer.lastIdleT < 1300) return;
        pointer.lastIdleT = now;
        spawnRipple(pointer.x, pointer.y, 0.62, false, 0.3);
      }

      // ---- 锦鲤：17 关节骨骼链 + 行波摆尾 + 字符栅格化 ----
      const KOI_N = 17;
      const FISH_LENGTH = 185;
      const toCodes = a => a.map(s => s.charCodeAt(0));
      const BODY_RAMP = toCodes(['.', ':', '-', '=', '+', '*', '#', '%', '@']);
      const FIN_RAMP = toCodes(["'", '.', ':', '-', '~', '=']);
      const TAIL_RAMP = toCodes(['.', ':', '-', '~', '=', '+']);
      const RIPPLE_CODES = toCodes(RIPPLE_CHARSET);

      // 沿体长 s 的宽度剖面（含尾鳍分叉）
      const WIDTH_PTS = [
        [0, 0], [0.015, 0.38], [0.05, 0.62], [0.1, 0.8], [0.18, 0.94],
        [0.3, 1], [0.42, 0.97], [0.55, 0.8], [0.66, 0.56], [0.74, 0.34],
        [0.8, 0.24], [0.84, 0.42], [0.9, 0.8], [0.96, 1.08], [1, 1.25]
      ];
      const WIDTH_LUT = (() => {
        const n = 129;
        const out = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          const s = i / (n - 1);
          let k = 0;
          while (k < WIDTH_PTS.length - 2 && s > WIDTH_PTS[k + 1][0]) k++;
          const a = WIDTH_PTS[k], b = WIDTH_PTS[k + 1];
          out[i] = lerp(a[1], b[1], clamp((s - a[0]) / (b[0] - a[0]), 0, 1));
        }
        return out;
      })();

      function widthAt(s) {
        const f = clamp(s, 0, 1) * 128;
        const i = Math.min(127, f | 0);
        return WIDTH_LUT[i] + (WIDTH_LUT[i + 1] - WIDTH_LUT[i]) * (f - i);
      }

      function fishExt(c, r) {
        const g = fishGrid;
        if (c < g.rowMin[r]) g.rowMin[r] = c;
        if (c > g.rowMax[r]) g.rowMax[r] = c;
        if (r < g.rMin) g.rMin = r;
        if (r > g.rMax) g.rMax = r;
        g.any = true;
      }

      function fishPut(c, r, code, lvl) {
        const g = fishGrid;
        if (c < 0 || r < 0 || c >= g.cols || r >= g.rows) return;
        const i = r * g.cols + c;
        if (lvl >= g.lvl[i]) {
          g.lvl[i] = lvl;
          g.cell[i] = code;
        }
        const ra = r > 0 ? r - 1 : 0, rb = r < g.rows - 1 ? r + 1 : r;
        const ca = c > 1 ? c - 2 : 0, cb = c < g.cols - 2 ? c + 2 : g.cols - 1;
        for (let rr = ra; rr <= rb; rr++) {
          const o = rr * g.cols;
          for (let cc = ca; cc <= cb; cc++) g.mask[o + cc] = 1;
        }
        fishExt(c, r);
      }

      function fishShadow(c, r) {
        const g = fishGrid;
        if (c < 0 || r < 0 || c >= g.cols || r >= g.rows) return;
        const i = r * g.cols + c;
        if (g.lvl[i] !== 0) return;
        g.lvl[i] = 1;
        g.cell[i] = 46;
        fishExt(c, r);
      }

      // 花纹变体：青花 / 锦鲤 / 素色 / 斑点
      function pickVariant() {
        const r = Math.random();
        return r < 0.42 ? 0 : r < 0.7 ? 1 : r < 0.88 ? 2 : 3;
      }

      class Koi {
        constructor(sc, x, y, h, size) {
          this.sc = sc;
          this.size = size;
          this.pace = rand(0.9, 1.1) * (0.9 + 0.2 * size);
          this.freq = 1 / Math.sqrt(size);
          this.agile = clamp(1 / Math.sqrt(size), 0.85, 1.35);
          this.variant = pickVariant();
          this.seed = Math.random() * 10;
          this.x = x;
          this.y = y;
          this.h = h;
          this.v = rand(20, 40) * UI;
          this.av = 0;
          this.phase = rand(0, TAU);
          this.finPh = rand(0, TAU);
          this.panic = 0;
          this.panicDir = 0;
          this.flee = 0;
          this.wakeT = rand(0, 1.2);
          this.bobPh = rand(0, TAU);
          this.sgx = 0;
          this.sgy = 0;
          this.feed = 0;
          this.hit = 0;
          this.waveCool = 0;
          this.L = FISH_LENGTH * this.size * UI;
          const seg = this.L / (KOI_N - 1);
          this.j = [];
          this.r = [];
          for (let i = 0; i < KOI_N; i++) {
            this.j.push({ x: x - Math.cos(h) * seg * i, y: y - Math.sin(h) * seg * i });
            this.r.push({ x: 0, y: 0 });
          }
          this.tx = new Float32Array(KOI_N);
          this.ty = new Float32Array(KOI_N);
          this.cum = new Float32Array(KOI_N);
          this.total = 1;
          const m = KOI_N - 1;
          this.sax = new Float32Array(m);
          this.say = new Float32Array(m);
          this.svx = new Float32Array(m);
          this.svy = new Float32Array(m);
          this.sil = new Float32Array(m);
          this.sln = new Float32Array(m);
        }

        update(dt, t) {
          const sc = this.sc, N = KOI_N;
          const L = FISH_LENGTH * this.size * UI;
          this.L = L;
          const seg = L / (N - 1);
          const vRef = 70 * UI;
          const isLeader = sc.members[0] === this;
          const scatterK = sc.scatterT > 0 ? 0.1 + 0.9 * (1 - clamp(sc.scatterT / 2.8, 0, 1)) : 1;
          let target = sc.speed * this.pace * UI;

          const dcx = sc.cx - this.x, dcy = sc.cy - this.y;
          const dc = Math.hypot(dcx, dcy);
          if (!isLeader && sc.members.length > 1) {
            if (dc > L * 2.4) target *= 1.35;
            else if (dc < L * 0.9) target *= 0.88;
          }

          if (lead.active) {
            const gdx = sc.gx - this.x, gdy = sc.gy - this.y;
            const gd = Math.sqrt(gdx * gdx + gdy * gdy);
            const near = 70 * UI;
            target = (gd < near ? 24 + 14 * (gd / near) : Math.min(125, 38 + (gd - near) * 0.55)) * UI * this.pace;
          }

          let sx = 0, sy = 0;
          const add = (vx, vy, w) => {
            const m = Math.hypot(vx, vy);
            if (m > 1e-6 && w > 0) {
              sx += (vx / m) * w;
              sy += (vy / m) * w;
            }
          };

          const wn = Math.sin(t * 0.43 + this.seed * 3.1) * 0.7 + Math.sin(t * 1.07 + this.seed * 7.7) * 0.4;
          add(Math.cos(this.h + wn * 0.7), Math.sin(this.h + wn * 0.7), 0.55);

          // 投饵吸引
          let feed = 0;
          if (baits.length && !lead.active) {
            let bd = 1e18, bvx = 0, bvy = 0;
            for (let i = 0; i < baits.length; i++) {
              const bt = baits[i];
              const dx2 = bt.x - this.x, dy2 = bt.y - this.y;
              const d2 = dx2 * dx2 + dy2 * dy2;
              if (d2 < bd) { bd = d2; bvx = dx2; bvy = dy2; }
            }
            const R = 620 * UI;
            if (bd < R * R) {
              const d = Math.sqrt(bd);
              const w = Math.pow(1 - d / R, 0.55);
              add(bvx, bvy, 5.6 * w + 0.7);
              feed = d < 46 * UI * 1.35 ? 1 : 0;
            }
          }
          this.feed = feed;

          if (isLeader && sc.mood !== 'rest') {
            add(sc.gx - this.x, sc.gy - this.y, sc.mood === 'dash' ? 1.5 : 1.1);
          }
          if (lead.active) add(sc.gx - this.x, sc.gy - this.y, isLeader ? 2.6 : 1.1);
          if (sc.members.length > 1) {
            add(dcx, dcy, clamp(dc / (L * 1.6), 0, 1.4) * (isLeader ? 0.35 : 0.95) * scatterK);
            add(sc.ax, sc.ay, (isLeader ? 0.2 : 0.75) * scatterK);
          }

          // 同类分离
          const sepR = L * 0.3 * (1 - 0.65 * this.feed);
          for (let fi = 0; fi < fishes.length; fi++) {
            const o = fishes[fi];
            if (o === this) continue;
            let bd = 1e9, bx = 0, by = 0;
            for (let k = 0; k < N; k += 4) {
              const p = o.j[k];
              const ddx = this.x - p.x, ddy = this.y - p.y;
              const d = Math.hypot(ddx, ddy);
              if (d < bd) { bd = d; bx = ddx; by = ddy; }
            }
            if (bd < sepR) add(bx, by, 2 * (1 - bd / sepR));
          }

          const sgMag = Math.sqrt(this.sgx * this.sgx + this.sgy * this.sgy);
          if (sgMag > 6) add(-this.sgx, -this.sgy, Math.min(1.7, sgMag / 80));

          // 边界回推
          const m = 70 * UI + L * 0.35;
          let bx = 0, by = 0;
          if (this.x < m) bx = (m - this.x) / m;
          else if (this.x > W - m) bx = -(this.x - (W - m)) / m;
          if (this.y < m) by = (m - this.y) / m;
          else if (this.y > H - m) by = -(this.y - (H - m)) / m;
          if (bx || by) { sx += bx * 2.6; sy += by * 2.6; }

          // 靠近光标受惊
          let flee = 0;
          if (pointer.active && !lead.active) {
            const R = 190 * UI;
            const pts = [this.j[0], this.j[5], this.j[10]];
            let md = 1e9, mx = 0, my = 0;
            for (let k = 0; k < pts.length; k++) {
              const ddx = pts[k].x - pointer.x, ddy = pts[k].y - pointer.y;
              const d = Math.hypot(ddx, ddy);
              if (d < md) { md = d; mx = ddx; my = ddy; }
            }
            if (md < R) {
              flee = (1 - md / R) * (1 - 0.8 * this.feed);
              if (flee > 0.02) add(mx, my, 3.4 * Math.pow(flee, 0.7) + 0.4 * flee);
            }
          }
          this.flee = flee;

          // 点击惊散
          if (this.panic > 0) {
            const zig = Math.sin(t * 9 + this.seed * 5) * 0.35;
            add(Math.cos(this.panicDir + zig), Math.sin(this.panicDir + zig), 3.5 * clamp(this.panic / 0.8, 0, 1));
            this.panic -= dt;
          }

          let desired = this.h;
          if (sx * sx + sy * sy > 1e-6) desired = Math.atan2(sy, sx);
          const diff = wrapPi(desired - this.h);
          const ratio0 = clamp(this.v / vRef, 0, 1.6);
          let maxTurn = (0.7 + 1.4 * Math.min(ratio0, 1.2) + 1.5 * flee) * this.agile;
          if (this.panic > 0) maxTurn = 4.2;
          const rate = clamp(diff * 2.6, -maxTurn, maxTurn);
          this.av += (rate - this.av) * Math.min(1, dt * 5);
          this.h += this.av * dt;

          if (this.feed > 0.35) target *= lerp(1, 0.55, this.feed);
          if (this.panic > 0) target = Math.max(target, (110 + 60 * clamp(this.panic, 0, 1.2)) * UI);
          if (flee > 0) target = Math.max(target, (60 + 55 * flee) * UI);
          const acc = target > this.v ? (this.panic > 0 ? 6 : 1.6) : 2.2;
          this.v += (target - this.v) * Math.min(1, dt * acc);
          this.x += (Math.cos(this.h) * this.v + this.sgx) * dt;
          this.y += (Math.sin(this.h) * this.v + this.sgy) * dt;

          const sgDecay = Math.exp(-dt * 1.9);
          this.sgx *= sgDecay;
          this.sgy *= sgDecay;

          // 骨骼链跟随，限制每节转角
          const j = this.j;
          j[0].x = this.x;
          j[0].y = this.y;
          let prevAng = this.h + Math.PI;
          for (let i = 1; i < N; i++) {
            const a = j[i - 1], b = j[i];
            const dx = b.x - a.x, dy = b.y - a.y;
            let ang = dx === 0 && dy === 0 ? prevAng : Math.atan2(dy, dx);
            let d = wrapPi(ang - prevAng);
            const lim = i < 2 ? 0.55 : i > 12 ? 0.46 : 0.34;
            if (d > lim) d = lim;
            else if (d < -lim) d = -lim;
            ang = prevAng + d;
            b.x = a.x + Math.cos(ang) * seg;
            b.y = a.y + Math.sin(ang) * seg;
            prevAng = ang;
          }

          const vn = this.v / UI;
          this.phase += dt * (1.4 + 0.075 * vn) * this.freq;
          this.finPh += dt * (2.2 + 0.03 * vn) * this.freq;
          this.hit *= Math.exp(-dt * 3.3);
          if (this.waveCool > 0) this.waveCool -= dt;

          if (waves.length && this.waveCool <= 0) {
            for (let wi = 0; wi < waves.length; wi++) {
              const wv = waves[wi];
              const dxw = this.x - wv.cx, dyw = this.y - wv.cy;
              const dw = Math.sqrt(dxw * dxw + dyw * dyw) || 1;
              const e = Math.abs(dw - wv.r);
              if (e < wv.width * 1.5) {
                const push = 250 * (1 - e / (wv.width * 1.5));
                this.sgx += (dxw / dw) * push;
                this.sgy += (dyw / dw) * push;
                this.hit = 0.6;
                this.av += rand(-1.3, 1.3);
                this.waveCool = 0.32;
                break;
              }
            }
          }

          this.bobPh += dt * (1.6 - 0.5 * Math.min(1, this.v / (70 * UI)));
          this.wakeT -= dt;
          if (this.wakeT <= 0) {
            const k = clamp(this.v / (110 * UI), 0, 1);
            this.wakeT = lerp(1.5, 0.55, k);
            if (!rm && this.v > 10) {
              const tp = this.j[KOI_N - 1];
              spawnRipple(tp.x, tp.y, 0.34 * (0.75 + 0.45 * k), false, 0.72 + 0.28 * k);
            }
          }
        }

        // 由中轴生成带行波摆动的左右轮廓，并缓存线段数据供光栅化复用
        pose() {
          const N = KOI_N, j = this.j, r = this.r;
          const ratio = clamp(this.v / (70 * UI), 0, 1.3);
          const A = this.L * 0.075 * (0.22 + 0.78 * ratio) * (1 + 1.5 * this.hit);
          const kw = 0.34;
          for (let i = 0; i < N; i++) {
            const a = j[i > 0 ? i - 1 : 0], b = j[i < N - 1 ? i + 1 : N - 1];
            let tx = b.x - a.x, ty = b.y - a.y;
            const tl = Math.hypot(tx, ty) || 1;
            tx /= tl;
            ty /= tl;
            this.tx[i] = tx;
            this.ty[i] = ty;
            const env = 0.1 + 0.9 * Math.pow(i / (N - 1), 1.7);
            const off = A * env * Math.sin(this.phase - i * kw);
            const bob = Math.sin(this.bobPh + i * 0.18) * this.L * 0.019 * (1 - 0.5 * ratio);
            r[i].x = j[i].x - ty * (off + bob);
            r[i].y = j[i].y + tx * (off + bob);
          }
          this.cum[0] = 0;
          for (let k = 0; k < N - 1; k++) {
            const vx = r[k + 1].x - r[k].x, vy = r[k + 1].y - r[k].y;
            const l2 = vx * vx + vy * vy;
            this.sax[k] = r[k].x;
            this.say[k] = r[k].y;
            this.svx[k] = vx;
            this.svy[k] = vy;
            this.sil[k] = l2 > 1e-6 ? 1 / l2 : 0;
            this.sln[k] = Math.sqrt(l2);
            this.cum[k + 1] = this.cum[k] + this.sln[k];
          }
          this.total = this.cum[N - 1];
        }

        raster() {
          const g = fishGrid, N = KOI_N, r = this.r;
          this.pose();
          const total = this.total;
          if (total < 1) return;
          const Wm = this.L * 0.085;
          const cum = this.cum;

          let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
          for (let i = 0; i < N; i++) {
            if (r[i].x < x0) x0 = r[i].x;
            if (r[i].x > x1) x1 = r[i].x;
            if (r[i].y < y0) y0 = r[i].y;
            if (r[i].y > y1) y1 = r[i].y;
          }
          const pad = Wm * 1.4;
          const c0 = Math.max(0, Math.floor((x0 - pad) / g.cw));
          const c1 = Math.min(g.cols - 1, Math.floor((x1 + pad) / g.cw));
          const r0 = Math.max(0, Math.floor((y0 - pad) / g.ch));
          const r1 = Math.min(g.rows - 1, Math.floor((y1 + pad) / g.ch));

          const ax = this.sax, ay = this.say, vx = this.svx, vy = this.svy, il = this.sil, sln = this.sln;
          const minW = g.ch * 0.42;
          const soft = g.cw * 0.9;
          const seed = this.seed, variant = this.variant;
          const LX = -0.45, LY = -0.65, LZ = 0.62;

          for (let rr = r0; rr <= r1; rr++) {
            const py = rr * g.ch + g.ch * 0.55;
            for (let cc = c0; cc <= c1; cc++) {
              const px = cc * g.cw + g.cw * 0.5;

              // 只需要在包围盒内做一次最近线段搜索
              let bd = 1e18, bk = 0, bt = 0, braw = 0, bc = 0, bex = 0, bey = 0;
              for (let k = 0; k < N - 1; k++) {
                const qx = px - ax[k], qy = py - ay[k];
                const raw = (qx * vx[k] + qy * vy[k]) * il[k];
                const tt = raw < 0 ? 0 : raw > 1 ? 1 : raw;
                const ex = qx - vx[k] * tt, ey = qy - vy[k] * tt;
                const d2 = ex * ex + ey * ey;
                if (d2 < bd) {
                  bd = d2; bk = k; bt = tt; braw = raw;
                  bc = vx[k] * qy - vy[k] * qx;
                  bex = ex; bey = ey;
                }
              }

              const d = Math.sqrt(bd);
              if (d > Wm * 1.3) continue;
              if (bk === N - 2 && braw > 1) continue;
              if (bk === 0 && braw < 0) continue;

              const s = clamp((cum[bk] + bt * sln[bk]) / total, 0, 1);
              const wRaw = widthAt(s) * Wm;
              let wb = wRaw;
              if (s > 0.03 && s < 0.8 && wb < minW) wb = minW;
              const cover = clamp((wb - d) / soft + 0.5, 0, 1);
              if (cover < 0.32) continue;

              const latA = wb > 0.01 ? clamp(d / wb, 0, 1) : 0;
              const latN = (bc >= 0 ? 1 : -1) * latA;
              const il2 = sln[bk] > 0.001 ? 1 / sln[bk] : 0;
              const tx = vx[bk] * il2, ty = vy[bk] * il2;
              const atx = Math.abs(tx), aty = Math.abs(ty);
              // 边缘字符按朝向挑选：竖边 / 横边 / 斜向
              const edgeCh = aty < 0.38 ? 45 : atx < 0.38 ? 124 : tx * ty > 0 ? 92 : 47;

              if (s < 0.8) {
                let nx = 0, ny = 0;
                if (d > 0.001) { nx = (bex / d) * latA; ny = (bey / d) * latA; }
                const nz = Math.sqrt(Math.max(0, 1 - latA * latA));
                const dif = clamp(nx * LX + ny * LY + nz * LZ, 0, 1);
                const shade = 0.16 + 0.84 * dif;

                // 花纹权重窗，两端淡出，避免躯干与尾部硬切
                const pw = clamp(Math.min((s - 0.04) / 0.05, (0.86 - s) / 0.07), 0, 1);
                const pa = Math.sin(s * 13 + seed * 6.1) + 0.8 * Math.sin(s * 5.7 + seed * 3.3 + latN * 2.1) + 0.5 * Math.sin(latN * 3 + s * 8 + seed);
                let tone;
                if (variant === 0) {
                  tone = 1 - 0.6 * clamp((pa - 0.3) * 3, 0, 1) * pw;
                } else if (variant === 1) {
                  tone = 0.36 + 0.64 * clamp((pa - 0.1) * 2.4, 0, 1) * pw;
                } else if (variant === 2) {
                  tone = 0.92 - 0.1 * clamp((pa - 0.3) * 3, 0, 1) * pw;
                } else {
                  const ps = Math.sin(s * 31 + seed * 2) * Math.sin(latN * 5 + s * 17 + seed);
                  tone = 0.95 - 0.5 * clamp((ps - 0.25) * 4, 0, 1) * pw;
                }

                let v = 0.12 + 0.88 * tone * shade;
                v += 0.3 * Math.pow(dif, 14);
                v += 0.22 * this.hit;
                const gl = (s - 0.2) / 0.02;
                v -= 0.14 * Math.exp(-gl * gl);
                v += (hash2(Math.floor(s * 70), Math.floor(latN * 5 + 5)) - 0.5) * 0.05;
                v *= 0.55 + 0.45 * cover;
                v = clamp(v, 0.04, 1);

                if (latA > 0.78) {
                  const lit = nx * LX + ny * LY > 0.1;
                  const lv = 2 + (lit ? 1 : 0) + (tone > 0.6 ? 1 : 0);
                  fishPut(cc, rr, edgeCh, lv);
                } else {
                  const idx = clamp(Math.floor(v * BODY_RAMP.length), 0, BODY_RAMP.length - 1);
                  fishPut(cc, rr, BODY_RAMP[idx], 1 + clamp(Math.floor(v * 5), 0, 4));
                }
                if (cover > 0.7 && s > 0.02) fishShadow(cc + 2, rr + 1);
              } else {
                // 尾鳍：半透明扇形
                if (s > 0.9) {
                  const nt = clamp((s - 0.9) / 0.1, 0, 1) * 0.62;
                  if (d < wRaw * nt) continue;
                }
                const ray = 0.5 + 0.5 * Math.sin(latN * 6 + s * 14);
                let v = 0.14 + 0.32 * ray + 0.1 * cover;
                v *= 0.6 + 0.4 * cover;
                if (latA > 0.9) {
                  fishPut(cc, rr, edgeCh, 2);
                } else {
                  const idx = clamp(Math.floor((v / 0.6) * TAIL_RAMP.length), 0, TAIL_RAMP.length - 1);
                  fishPut(cc, rr, TAIL_RAMP[idx], 1 + clamp(Math.floor((v / 0.6) * 3), 0, 2));
                }
              }
            }
          }

          const ratio = clamp(this.v / (70 * UI), 0, 1);
          const flap = 0.28 + 0.18 * (1 - ratio);
          this.fin(3, 0.85, this.L * 0.16, lerp(0.95, 0.32, ratio) + flap * Math.sin(this.finPh), Wm);
          this.fin(8, 0.8, this.L * 0.11, lerp(0.8, 0.3, ratio) + flap * 0.8 * Math.sin(this.finPh + 1.4), Wm);
        }

        // 胸鳍/腹鳍：三角形重心插值填充
        fin(k, rootK, len, ang, Wm) {
          const g = fishGrid, r = this.r;
          const s = this.cum[k] / this.total;
          const Tx = this.tx[k], Ty = this.ty[k];
          const nx = -Ty, ny = Tx;
          const edge = widthAt(s) * Wm * rootK;
          const ca = Math.cos(ang), sa = Math.sin(ang);

          for (let side = -1; side <= 1; side += 2) {
            const rx = r[k].x + nx * edge * side, ry = r[k].y + ny * edge * side;
            const bx = rx + (Tx * ca + nx * side * sa) * len;
            const by = ry + (Ty * ca + ny * side * sa) * len;
            const cx = rx + Tx * len * 0.55 + nx * side * len * 0.06;
            const cy = ry + Ty * len * 0.55 + ny * side * len * 0.06;
            const den = (by - cy) * (rx - cx) + (cx - bx) * (ry - cy);
            if (Math.abs(den) < 1e-4) continue;

            const xa = Math.min(rx, bx, cx) - g.cw, xb = Math.max(rx, bx, cx) + g.cw;
            const ya = Math.min(ry, by, cy) - g.ch, yb = Math.max(ry, by, cy) + g.ch;
            const c0 = Math.max(0, Math.floor(xa / g.cw)), c1 = Math.min(g.cols - 1, Math.floor(xb / g.cw));
            const r0 = Math.max(0, Math.floor(ya / g.ch)), r1 = Math.min(g.rows - 1, Math.floor(yb / g.ch));

            for (let rr = r0; rr <= r1; rr++) {
              const py = rr * g.ch + g.ch * 0.55;
              for (let cc = c0; cc <= c1; cc++) {
                const px = cc * g.cw + g.cw * 0.5;
                const lA = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / den;
                const lB = ((cy - ry) * (px - cx) + (rx - cx) * (py - cy)) / den;
                const lC = 1 - lA - lB;
                const m = Math.min(lA, lB, lC);
                if (m < -0.06) continue;
                const u = clamp(lB, 0, 1);
                if (m < 0) {
                  fishPut(cc, rr, FIN_RAMP[1], 1);
                  continue;
                }
                const idx = clamp(Math.floor((1 - u) * (FIN_RAMP.length - 1) + 0.2), 0, FIN_RAMP.length - 1);
                fishPut(cc, rr, FIN_RAMP[idx], 1 + (1 - u > 0.6 ? 2 : 1 - u > 0.3 ? 1 : 0));
              }
            }
          }
        }
      }

      // ---- 投饵 ----
      function addBait(x, y) {
        const bt = { x: x, y: y, t: 0, life: 7.5, eaten: 0, ph: rand(0, TAU), rippleT: 0.3 };
        baits.push(bt);
        while (baits.length > 3) baits.shift();
        spawnRipple(x, y, 0.66, false, 0.55);
        spawnRipple(x, y, 0.4, false, 0.3);
        return bt;
      }

      function updateBaits(dt, t) {
        if (!baits.length) return;
        const eatR = 46 * UI;
        for (let i = baits.length - 1; i >= 0; i--) {
          const b = baits[i];
          b.t += dt;
          b.life -= dt;
          b.y += Math.sin(b.t * 1.1 + b.ph) * 2.6 * dt;
          b.rippleT -= dt;
          if (b.rippleT <= 0) {
            b.rippleT = 0.85 + rand(0, 0.4);
            spawnRipple(b.x + rand(-9, 9), b.y + rand(-6, 6), 0.26, false, 0.2);
          }
          let eat = 0;
          for (let fi = 0; fi < fishes.length; fi++) {
            const f = fishes[fi];
            const dx = f.x - b.x, dy = f.y - b.y;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < eatR) eat += (1 - d / eatR) * 0.8;
          }
          b.eaten += eat * dt;
          if (b.eaten >= 1 || b.life <= 0) {
            spawnRipple(b.x, b.y, 0.3, false, 0.24);
            baits.splice(i, 1);
          }
        }
      }

      function paintBaits(t) {
        if (!baits.length) return;
        const g = fishGrid;
        ctx.font = g.px + 'px ' + FONT;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (let bi = 0; bi < baits.length; bi++) {
          const b = baits[bi];
          const left = clamp(1 - b.eaten, 0, 1);
          const n = Math.max(2, Math.round(7 * left));
          for (let i = 0; i < n; i++) {
            const a = b.ph + i * 2.399 + t * 0.85;
            const rr = (5 + i * 2.4) * (0.55 + 0.45 * left);
            const px = b.x + Math.cos(a) * rr;
            const py = b.y + Math.sin(a) * rr * 0.72;
            const al = (0.4 + 0.36 * left) * (0.68 + 0.32 * Math.sin(t * 3.4 + i));
            ctx.fillStyle = rgbaWithAlpha(charRgb, al);
            ctx.fillText(i % 2 ? '.' : '*', px, py);
          }
        }
      }

      // ---- 鱼群情绪状态机 ----
      const MOODS = [
        { name: 'cruise', w: 0.42, sp: [52, 72], t: [4, 8] },
        { name: 'glide', w: 0.26, sp: [18, 30], t: [3, 6] },
        { name: 'rest', w: 0.18, sp: [0, 3], t: [2.2, 4.6] },
        { name: 'dash', w: 0.14, sp: [100, 125], t: [0.9, 1.6] }
      ];

      function pickMood(sc, forced) {
        const M = MOODS;
        let m = null;
        if (forced) {
          m = M.find(x => x.name === forced);
        } else {
          let tot = 0;
          for (const x of M) if (x.name !== sc.mood) tot += x.w;
          let r = Math.random() * tot;
          for (const x of M) {
            if (x.name === sc.mood) continue;
            r -= x.w;
            if (r <= 0) { m = x; break; }
          }
        }
        if (!m) m = M[0];
        sc.mood = m.name;
        sc.speed = rand(m.sp[0], m.sp[1]);
        sc.moodT = rand(m.t[0], m.t[1]);
      }

      function pickGoal(sc, avoidX, avoidY) {
        const ld = sc.members[0];
        const rx = avoidX === undefined ? ld.x : avoidX;
        const ry = avoidY === undefined ? ld.y : avoidY;
        const span = Math.min(W, H);
        let bx = W / 2, by = H / 2, bs = -1;
        for (let i = 0; i < 5; i++) {
          const x = rand(W * 0.12, W * 0.88), y = rand(H * 0.14, H * 0.86);
          const score = Math.hypot(x - rx, y - ry) + rand(0, 0.35 * span);
          if (score > bs) { bs = score; bx = x; by = y; }
        }
        sc.gx = bx;
        sc.gy = by;
      }

      function fishGroupsFor(count) {
        const n = clamp(Math.round(count), 0, 24);
        if (!cfg.swimFish || n <= 0) return [];
        if (n <= 2) return [n];
        const a = Math.max(1, Math.round(n * 0.5));
        const b = Math.max(1, Math.round(n * 0.28));
        const c = n - a - b;
        return c > 0 ? [a, b, c] : c === 0 ? [a, b] : [n];
      }

      function initFish() {
        schools.length = 0;
        fishes.length = 0;
        baits.length = 0;
        lead.active = false;
        press.baits.length = 0;
        const groups = fishGroupsFor(cfg.fishCount);
        if (!groups.length) return;
        const L = FISH_LENGTH * UI;

        groups.forEach(n => {
          const sc = { members: [], mood: '', speed: 50, moodT: 0, gx: 0, gy: 0, cx: 0, cy: 0, ax: 1, ay: 0, scatterT: 0 };
          const cx = rand(W * 0.2, W * 0.8), cy = rand(H * 0.2, H * 0.8);
          const h = rand(0, TAU);
          for (let i = 0; i < n; i++) {
            const back = i === 0 ? 0 : L * (0.55 + 0.35 * i);
            const side = i === 0 ? 0 : (i % 2 ? 1 : -1) * L * 0.4 * Math.ceil(i / 2);
            const x = cx - Math.cos(h) * back - Math.sin(h) * side;
            const y = cy - Math.sin(h) * back + Math.cos(h) * side;
            const smin = 0.55, smax = 1.35;
            const size = i === 0 ? rand(lerp(smin, smax, 0.55), smax) : rand(smin, lerp(smin, smax, 0.78));
            const f = new Koi(sc, x, y, h + rand(-0.15, 0.15), size);
            sc.members.push(f);
            fishes.push(f);
          }
          pickMood(sc, 'cruise');
          pickGoal(sc);
          schools.push(sc);
        });
      }

      function updateFish(dt, t) {
        for (const sc of schools) {
          sc.moodT -= dt;
          if (sc.moodT <= 0) pickMood(sc);
          if (sc.scatterT > 0) sc.scatterT -= dt;

          let cx = 0, cy = 0, ax = 0, ay = 0;
          for (const f of sc.members) {
            cx += f.x;
            cy += f.y;
            ax += Math.cos(f.h);
            ay += Math.sin(f.h);
          }
          const n = sc.members.length;
          sc.cx = cx / n;
          sc.cy = cy / n;
          sc.ax = ax / n;
          sc.ay = ay / n;

          const ld = sc.members[0];
          if (Math.hypot(sc.gx - ld.x, sc.gy - ld.y) < 100 * UI + ld.L * 0.4) pickGoal(sc);
        }

        // 有饵时改朝饵游
        if (baits.length) {
          for (let si = 0; si < schools.length; si++) {
            const sc = schools[si];
            let best = null, bd = 1e18;
            for (let bi = 0; bi < baits.length; bi++) {
              const bt = baits[bi];
              const d = Math.hypot(bt.x - sc.cx, bt.y - sc.cy);
              if (d < bd) { bd = d; best = bt; }
            }
            if (best) {
              sc.gx = best.x;
              sc.gy = best.y;
              sc.moodT = Math.max(sc.moodT, 0.6);
              if (sc.mood === 'rest') pickMood(sc, 'glide');
            }
          }
        }

        if (lead.active) {
          lead.t += dt;
          for (let si = 0; si < schools.length; si++) {
            const sc = schools[si];
            const ang = lead.t * 0.32 + si * (TAU / schools.length);
            const orbit = (92 + 34 * si) * UI;
            sc.gx = clamp(pointer.x + Math.cos(ang) * orbit, 30, W - 30);
            sc.gy = clamp(pointer.y + Math.sin(ang) * orbit * 0.8, 30, H - 30);
            sc.moodT = Math.max(sc.moodT, 0.8);
            if (sc.mood === 'rest') pickMood(sc, 'glide');
            if (sc.scatterT > 0.2) sc.scatterT = 0.2;
          }
          lead.rippleT -= dt;
          if (lead.rippleT <= 0) {
            lead.rippleT = 0.6;
            if (!rm) spawnRipple(pointer.x, pointer.y, 0.34, false, 0.28);
          }
        }

        for (const f of fishes) f.update(dt, t);
      }

      function scatterFish(x, y) {
        const R = 560 * UI;
        for (const sc of schools) {
          let hit = false;
          for (const f of sc.members) {
            const dx = f.x - x, dy = f.y - y;
            const d = Math.hypot(dx, dy);
            const k = clamp(1 - d / R, 0, 1);
            if (k < 0.04) continue;
            hit = true;
            f.panic = Math.max(f.panic, 1.2 + 1.3 * k + rand(0, 0.5));
            f.panicDir = Math.atan2(dy, dx) + rand(-0.6, 0.6);
            f.v = Math.max(f.v, (100 + 90 * k) * UI);
            f.av += rand(-3, 3) * k;
          }
          if (hit) {
            sc.scatterT = 2.8;
            pickMood(sc, 'cruise');
            pickGoal(sc, x, y);
          }
        }
      }

      function buildFishGrid() {
        const g = fishGrid;
        g.cell.fill(0);
        g.lvl.fill(0);
        g.mask.fill(0);
        g.rowMin.fill(g.cols);
        g.rowMax.fill(-1);
        g.rMin = g.rows;
        g.rMax = -1;
        g.any = false;
        for (const f of fishes) f.raster();
      }

      // 每行只发 5 次 fillText（按亮度分层），而不是逐字符
      function paintFish() {
        const g = fishGrid;
        if (!g.any) return;
        const A = [0.24, 0.4, 0.58, 0.78, 0.97];
        const NL = A.length;
        const fills = A.map(a => rgbaWithAlpha(charRgb, a));
        ctx.font = g.px + 'px ' + FONT;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const strs = new Array(NL), has = new Array(NL);

        for (let r = g.rMin; r <= g.rMax; r++) {
          const c0 = g.rowMin[r], c1 = g.rowMax[r];
          if (c1 < c0) continue;
          const off = r * g.cols;
          const y = r * g.ch + g.ch * 0.55;
          for (let k = 0; k < NL; k++) { strs[k] = ''; has[k] = false; }
          for (let c = c0; c <= c1; c++) {
            const l = g.lvl[off + c];
            const ch = l ? String.fromCharCode(g.cell[off + c]) : ' ';
            for (let k = 0; k < NL; k++) strs[k] += k === l - 1 ? ch : ' ';
            if (l) has[l - 1] = true;
          }
          const x = c0 * g.cw;
          for (let k = 0; k < NL; k++) {
            if (has[k]) {
              ctx.fillStyle = fills[k];
              ctx.fillText(strs[k], x, y);
            }
          }
        }
      }

      function buildRippleFields(t) {
        for (let bi = 0; bi < bands.length; bi++) bands[bi].boost.fill(0);
        for (let i = 0; i < ripples.length; i++) {
          const rp = ripples[i];
          const R = rp.maxR + 40;
          for (let bi = 0; bi < bands.length; bi++) {
            const b = bands[bi];
            const c0 = Math.max(0, Math.floor((rp.x - R) / b.cw));
            const c1 = Math.min(b.cols - 1, Math.ceil((rp.x + R) / b.cw));
            const r0 = Math.max(0, Math.floor((rp.y - R - b.y0) / b.ch));
            const r1 = Math.min(b.rows - 1, Math.ceil((rp.y + R - b.y0) / b.ch));
            for (let r = r0; r <= r1; r++) {
              const y = b.y0 + r * b.ch + b.ch * 0.55;
              const off = r * b.cols;
              for (let c = c0; c <= c1; c++) {
                const x = c * b.cw + b.cw * 0.5;
                const dx = x - rp.x, dy = y - rp.y;
                const d2 = dx * dx + dy * dy;
                const lo = Math.max(0, rp.r - rp.band * 4);
                const hi = rp.r + rp.band * 4;
                if (d2 < lo * lo || d2 > hi * hi) continue;
                const v = rp.boost(x, y, t);
                if (v > b.boost[off + c]) b.boost[off + c] = v;
              }
            }
          }
        }
      }

      function drawWater(t) {
        const rchars = RIPPLE_CHARSET;
        const fg = fishGrid;
        const fgOn = fg.any;
        const invW = 1 / fg.cw, invH = 1 / fg.ch;

        for (let bi = 0; bi < bands.length; bi++) {
          const b = bands[bi];
          ctx.font = b.fontPx + 'px ' + FONT;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          for (let r = 0; r < b.rows; r++) {
            const y = b.y0 + r * b.ch + b.ch * 0.55;
            const off = r * b.cols;
            let base = '', hi = '';
            let baseHas = false, hiHas = false;

            for (let c = 0; c < b.cols; c++) {
              const x = c * b.cw + b.cw * 0.5;

              // 鱼体所在格留空，边缘格压暗形成光晕
              let halo = false;
              if (fgOn) {
                const fx = (x * invW) | 0, fy = (y * invH) | 0;
                if (fx < fg.cols && fy < fg.rows) {
                  const gi = fy * fg.cols + fx;
                  if (fg.mask[gi]) { base += ' '; hi += ' '; continue; }
                  halo = (fx > 0 && fg.mask[gi - 1] === 1) ||
                    (fx + 1 < fg.cols && fg.mask[gi + 1] === 1) ||
                    (fy > 0 && fg.mask[gi - fg.cols] === 1) ||
                    (fy + 1 < fg.rows && fg.mask[gi + fg.cols] === 1);
                }
              }

              const bst = b.boost[off + c];
              let n = waterField(x, y, t);
              if (halo) n *= 0.58;

              // 涟漪用独立字符集叠在亮层
              if (bst > 0.3) {
                const idx = Math.floor(clamp((bst - 0.3) / 0.7, 0, 1) * (rchars.length - 1));
                base += ' ';
                hi += rchars[idx];
                hiHas = true;
                continue;
              }

              n = Math.min(1, n + bst * 0.9);
              if (n < b.cut) { base += ' '; hi += ' '; continue; }
              const k = (n - b.cut) / (1 - b.cut);
              let idx = Math.floor(k * b.cap);
              if (idx > 0 && Math.random() < 0.14) idx -= 1;
              idx = clamp(idx, 0, b.cap);
              base += CHARSET[idx];
              baseHas = true;
              if (k > 0.85) {
                hi += CHARSET[clamp(idx + 1, 0, b.cap)];
                hiHas = true;
              } else hi += ' ';
            }

            if (baseHas) {
              ctx.fillStyle = rgbaWithAlpha(charRgb, b.alpha);
              ctx.fillText(base, 0, y);
            }
            if (hiHas) {
              ctx.fillStyle = rgbaWithAlpha(charRgb, clamp(b.alpha + 0.22, 0, 0.9));
              ctx.fillText(hi, 0, y);
            }
          }
        }
      }

      // ---- 水面时钟：字形栅格化 + 弹簧网格 ----
      function clockString() {
        const d = new Date();
        const p = n => (n < 10 ? '0' : '') + n;
        const hm = p(d.getHours()) + ':' + p(d.getMinutes());
        return clock.mode === 2 ? hm + ':' + p(d.getSeconds()) : hm;
      }

      function clockBuild(str) {
        const g = fishGrid, C = clock;
        if (!clockCv) clockCv = document.createElement('canvas');
        const c2 = clockCv.getContext('2d', { willReadFrequently: true });
        c2.setTransform(1, 0, 0, 1, 0, 0);
        c2.font = '700 100px ' + FONT;
        const mw = c2.measureText(str).width || 480;
        const fs = Math.min((100 * W * 0.8) / mw, H * 0.4, 280);
        const tw = (mw * fs) / 100, th = fs * 0.76;
        const PAD = 10;
        const cols = Math.ceil(tw / g.cw) + 2 + PAD * 2;
        const rows = Math.ceil(th / g.ch) + 2 + PAD * 2;
        C.col0 = Math.round((W * 0.5) / g.cw - cols / 2);
        C.row0 = Math.round((H * 0.5) / g.ch - rows / 2);

        if (C.cols !== cols || C.rows !== rows || !C.cur) {
          C.cols = cols;
          C.rows = rows;
          const n = cols * rows;
          C.cur = new Float32Array(n);
          C.tgt = new Float32Array(n);
          C.ux = new Float32Array(n);
          C.uy = new Float32Array(n);
          C.vx = new Float32Array(n);
          C.vy = new Float32Array(n);
          C.fx = new Float32Array(n);
          C.fy = new Float32Array(n);
          C.rb = new Float32Array(n);
          C.snap = true;
        }

        clockCv.width = cols * CLK_SS;
        clockCv.height = rows * CLK_SS;
        c2.setTransform(CLK_SS / g.cw, 0, 0, CLK_SS / g.ch, 0, 0);
        c2.font = '700 ' + fs + 'px ' + FONT;
        c2.textAlign = 'center';
        c2.textBaseline = 'alphabetic';
        c2.fillStyle = '#fff';
        c2.strokeStyle = '#fff';
        c2.lineWidth = fs * 0.03;
        c2.lineJoin = 'round';
        const bx = (cols * g.cw) / 2, by = (rows * g.ch) / 2 + fs * 0.36;
        c2.fillText(str, bx, by);
        c2.strokeText(str, bx, by);

        const img = c2.getImageData(0, 0, clockCv.width, clockCv.height).data;
        const S = CLK_SS, W4 = clockCv.width, inv = 1 / (S * S * 255), tgt = C.tgt;
        for (let j = 0; j < rows; j++) {
          for (let i = 0; i < cols; i++) {
            let sum = 0;
            for (let yy = 0; yy < S; yy++) {
              let o = ((j * S + yy) * W4 + i * S) * 4 + 3;
              for (let xx = 0; xx < S; xx++, o += 4) sum += img[o];
            }
            tgt[j * cols + i] = sum * inv;
          }
        }

        if (C.snap) {
          C.cur.set(tgt);
          C.ux.fill(0);
          C.uy.fill(0);
          C.vx.fill(0);
          C.vy.fill(0);
          C.rb.fill(0);
          C.snap = false;
        }
      }

      function clockSplash(x, y) {
        const C = clock, g = fishGrid;
        if (C.fade <= 0.05 || !C.vx || !C.cur) return;
        const cw = g.cw, ch = g.ch;
        const x0 = C.col0 * cw, y0 = C.row0 * ch;
        const R = 120 * UI;
        if (x + R < x0 || x - R > x0 + C.cols * cw || y + R < y0 || y - R > y0 + C.rows * ch) return;
        const KX = 6.3 / cw, KY = 6.3 / ch;
        const i0 = Math.max(0, Math.floor((x - R - x0) / cw));
        const i1 = Math.min(C.cols - 1, Math.floor((x + R - x0) / cw));
        const j0 = Math.max(0, Math.floor((y - R - y0) / ch));
        const j1 = Math.min(C.rows - 1, Math.floor((y + R - y0) / ch));
        for (let j = j0; j <= j1; j++) {
          const dy = y0 + (j + 0.5) * ch - y;
          for (let i = i0; i <= i1; i++) {
            const dx = x0 + (i + 0.5) * cw - x;
            const d2 = dx * dx + dy * dy;
            if (d2 > R * R) continue;
            const d = Math.sqrt(d2) + 1;
            const w = 1 - d / R;
            const imp = 48 * w * w;
            const id = j * C.cols + i;
            C.vx[id] += (dx / d) * imp * KX;
            C.vy[id] += (dy / d) * imp * KY;
          }
        }
      }

      function clockForces(t) {
        const g = fishGrid, C = clock, cols = C.cols, rows = C.rows;
        const fx = C.fx, fy = C.fy, rb = C.rb;
        fx.fill(0);
        fy.fill(0);
        rb.fill(0);
        const cw = g.cw, ch = g.ch;
        const KX = 6.3 / cw, KY = 6.3 / ch;
        const x0 = C.col0 * cw, y0 = C.row0 * ch;
        const bw = cols * cw, bh = rows * ch;

        // 鱼身经过把字形推开
        for (let fi = 0; fi < fishes.length; fi++) {
          const f = fishes[fi];
          const Wm = f.L * 0.085;
          const sp = clamp(f.v / (70 * UI), 0, 1.5);
          const amp = 30 * (0.5 + 0.5 * Math.min(1.3, f.size)) * (0.6 + 0.6 * sp) * (1 + 1.2 * f.hit);
          const hx = Math.cos(f.h), hy = Math.sin(f.h);
          for (let k = 0; k < KOI_N; k += 2) {
            const pt = f.r[k];
            if (pt.x < x0 - 120 || pt.x > x0 + bw + 120 || pt.y < y0 - 120 || pt.y > y0 + bh + 120) continue;
            const R = Wm * widthAt(k / (KOI_N - 1)) + Wm * 1.9 + 8 * UI;
            const i0 = Math.max(0, Math.floor((pt.x - R - x0) / cw));
            const i1 = Math.min(cols - 1, Math.floor((pt.x + R - x0) / cw));
            const j0 = Math.max(0, Math.floor((pt.y - R - y0) / ch));
            const j1 = Math.min(rows - 1, Math.floor((pt.y + R - y0) / ch));
            for (let j = j0; j <= j1; j++) {
              const dy = y0 + (j + 0.5) * ch - pt.y;
              for (let i = i0; i <= i1; i++) {
                const dx = x0 + (i + 0.5) * cw - pt.x;
                const d2 = dx * dx + dy * dy;
                if (d2 > R * R) continue;
                const d = Math.sqrt(d2) + 0.5;
                const w = 1 - d / R;
                const a = amp * w * w;
                const id = j * cols + i;
                fx[id] += ((dx / d) * a + hx * a * 0.45 * sp) * KX;
                fy[id] += ((dy / d) * a + hy * a * 0.45 * sp) * KY;
              }
            }
          }
        }

        // 涟漪波峰把字形点亮并推挤
        for (let ri = 0; ri < ripples.length; ri++) {
          const rp = ripples[ri];
          const spread = rp.big ? rp.band * 4.2 : rp.band * 3;
          const lo = Math.max(0, rp.r - spread), hi = rp.r + spread;
          if (rp.x + hi < x0 || rp.x - hi > x0 + bw || rp.y + hi < y0 || rp.y - hi > y0 + bh) continue;
          const i0 = Math.max(0, Math.floor((rp.x - hi - x0) / cw));
          const i1 = Math.min(cols - 1, Math.floor((rp.x + hi - x0) / cw));
          const j0 = Math.max(0, Math.floor((rp.y - hi - y0) / ch));
          const j1 = Math.min(rows - 1, Math.floor((rp.y + hi - y0) / ch));
          const bigK = rp.big ? 4.4 : 1.15;
          const bandW = rp.big ? rp.band * 1.45 : rp.band;
          for (let j = j0; j <= j1; j++) {
            const py = y0 + (j + 0.5) * ch, dy = py - rp.y;
            for (let i = i0; i <= i1; i++) {
              const px = x0 + (i + 0.5) * cw, dx = px - rp.x;
              const d2 = dx * dx + dy * dy;
              if (d2 < lo * lo || d2 > hi * hi) continue;
              const v = rp.boost(px, py, t);
              if (v < 0.02) continue;
              const d = Math.sqrt(d2) + 0.5;
              const id = j * cols + i;
              const dr = d - rp.r;
              const waveDir = rp.big ? 1 - 0.55 * clamp(-dr / bandW, 0, 1) : 1;
              const force = v * 78 * bigK * waveDir;
              fx[id] += (dx / d) * force * KX;
              fy[id] += (dy / d) * force * KY;
              const glow = v * (rp.big ? 1.25 : 0.45);
              if (glow > rb[id]) rb[id] = glow;
            }
          }
        }

        // 光标周围轻微骚动
        if (pointer.active || lead.active) {
          const R = 56 * UI;
          const moving = performance.now() - pointer.lastMoveT < 350;
          const amp = moving ? 34 : 10;
          if (pointer.x > x0 - R && pointer.x < x0 + bw + R && pointer.y > y0 - R && pointer.y < y0 + bh + R) {
            const i0 = Math.max(0, Math.floor((pointer.x - R - x0) / cw));
            const i1 = Math.min(cols - 1, Math.floor((pointer.x + R - x0) / cw));
            const j0 = Math.max(0, Math.floor((pointer.y - R - y0) / ch));
            const j1 = Math.min(rows - 1, Math.floor((pointer.y + R - y0) / ch));
            for (let j = j0; j <= j1; j++) {
              const dy = y0 + (j + 0.5) * ch - pointer.y;
              for (let i = i0; i <= i1; i++) {
                const dx = x0 + (i + 0.5) * cw - pointer.x;
                const d2 = dx * dx + dy * dy;
                if (d2 > R * R) continue;
                const d = Math.sqrt(d2) + 0.5;
                const w = 1 - d / R;
                const a = amp * w * w;
                const id = j * cols + i;
                fx[id] += (dx / d) * a * KX;
                fy[id] += (dy / d) * a * KY;
              }
            }
          }
        }
      }

      // 弹簧 + 邻域耦合积分（显式欧拉，必要时分裂子步）
      function clockStep(dt) {
        const C = clock, cols = C.cols, rows = C.rows;
        const ux = C.ux, uy = C.uy, vx = C.vx, vy = C.vy, fx = C.fx, fy = C.fy;
        const k = 14, kc = 46, c = 2.6;
        const sub = dt > 0.028 ? 2 : 1, h = dt / sub, LIM = 9;
        for (let sIt = 0; sIt < sub; sIt++) {
          for (let j = 0; j < rows; j++) {
            const o = j * cols;
            for (let i = 0; i < cols; i++) {
              const id = o + i;
              const l = i > 0 ? id - 1 : id, r = i < cols - 1 ? id + 1 : id;
              const u = j > 0 ? id - cols : id, d = j < rows - 1 ? id + cols : id;
              vx[id] += (fx[id] - k * ux[id] - c * vx[id] + kc * (ux[l] + ux[r] + ux[u] + ux[d] - 4 * ux[id])) * h;
              vy[id] += (fy[id] - k * uy[id] - c * vy[id] + kc * (uy[l] + uy[r] + uy[u] + uy[d] - 4 * uy[id])) * h;
            }
          }
          for (let id = 0, n = cols * rows; id < n; id++) {
            let x = ux[id] + vx[id] * h, y = uy[id] + vy[id] * h;
            if (x > LIM) { x = LIM; vx[id] = 0; }
            else if (x < -LIM) { x = -LIM; vx[id] = 0; }
            if (y > LIM) { y = LIM; vy[id] = 0; }
            else if (y < -LIM) { y = -LIM; vy[id] = 0; }
            ux[id] = x;
            uy[id] = y;
          }
        }
      }

      function tput(c, r, code, lvl) {
        const g = fishGrid, tg = timeGrid;
        if (c < 0 || r < 0 || c >= g.cols || r >= g.rows) return;
        const i = r * g.cols + c;
        if (lvl >= tg.lvl[i]) {
          tg.lvl[i] = lvl;
          tg.cell[i] = code;
        }
        if (c < tg.rowMin[r]) tg.rowMin[r] = c;
        if (c > tg.rowMax[r]) tg.rowMax[r] = c;
        if (r < tg.rMin) tg.rMin = r;
        if (r > tg.rMax) tg.rMax = r;
        tg.any = true;
      }

      function updateClock(dt, t) {
        const g = fishGrid, tg = timeGrid, C = clock;
        if (tg.any) {
          tg.lvl.fill(0);
          tg.rowMin.fill(g.cols);
          tg.rowMax.fill(-1);
          tg.rMin = g.rows;
          tg.rMax = -1;
          tg.any = false;
        }
        if (C.on) C.fade = Math.min(1, C.fade + dt / 1.4);
        else C.fade = Math.max(0, C.fade - dt / 1);
        if (C.fade <= 0) return;

        const str = clockString();
        if (C.dirty || str !== C.str) {
          clockBuild(str);
          C.str = str;
          C.dirty = false;
        }

        clockForces(t);
        clockStep(dt);

        const cols = C.cols, rows = C.rows, cur = C.cur, tgt = C.tgt, ux = C.ux, uy = C.uy, rb = C.rb;
        const mk = 1 - Math.exp(-dt * 9);
        for (let i = 0, n = cols * rows; i < n; i++) cur[i] += (tgt[i] - cur[i]) * mk;

        const gx = Math.sin(t * 0.37) * 0.9 + Math.sin(t * 0.91 + 2) * 0.25;
        const gy = Math.sin(t * 0.53 + 1.3) * 0.55;
        const fade = C.fade, FL = g.lvl;
        const LX = -0.45, LY = -0.65;

        for (let j = 1; j < rows - 1; j++) {
          const gr = C.row0 + j;
          if (gr < 0 || gr >= g.rows) continue;
          for (let i = 1; i < cols - 1; i++) {
            const gc = C.col0 + i;
            if (gc < 0 || gc >= g.cols) continue;
            const id = j * cols + i;
            const rBoost = rb[id];

            const wvx = 0.46 * Math.sin(j * 0.55 + t * 1.25) + 0.22 * Math.sin(j * 1.35 - t * 2.1 + i * 0.12);
            const wvy = 0.34 * Math.sin(i * 0.3 + t * 1.5) + 0.16 * Math.sin(i * 0.75 - t * 2.4 + j * 0.2);
            const sx = i - ux[id] - gx - wvx, sy = j - uy[id] - gy - wvy;
            const x0 = Math.floor(sx), y0 = Math.floor(sy);
            if (x0 < 1 || y0 < 1 || x0 >= cols - 2 || y0 >= rows - 2) continue;
            const fx = sx - x0, fy = sy - y0, b = y0 * cols + x0;
            const a = (cur[b] * (1 - fx) + cur[b + 1] * fx) * (1 - fy) + (cur[b + cols] * (1 - fx) + cur[b + cols + 1] * fx) * fy;
            if (a < (rBoost > 0.42 ? 0.05 : 0.1)) continue;

            const gi = gr * g.cols + gc;
            if (FL[gi] > 1) continue;
            const nearFish = g.mask[gi] === 1;
            const vis = clamp(fade * 1.6 - hash2(gc * 1.37, gr * 2.11) * 0.6, 0, 1);
            if (vis <= 0) continue;

            const nb = Math.round(sy) * cols + Math.round(sx);
            const gX = cur[nb + 1] - cur[nb - 1], gY = cur[nb + cols] - cur[nb - cols];
            const lit = clamp(-(gX * LX + gY * LY) * 1.5, -0.8, 0.9);
            const dd = Math.sqrt(ux[id] * ux[id] + uy[id] * uy[id]);

            let v = a * (0.6 + 0.3 * Math.sin(t * 1.6 + gc * 0.31 + gr * 0.47) * 0.5 + 0.15);
            v += lit * 0.32 * a;
            v *= 0.86 + 0.14 * Math.sin(t * 2.3 + gc * 0.55 + gr * 0.9);
            v += Math.min(0.28, dd * 0.08);
            v += rBoost * 0.58;

            // 自上而下扫描的亮带
            let ph = (gc * 0.8 + gr * 1.6 - t * 22) % 220;
            if (ph < 0) ph += 220;
            v += 0.17 * Math.exp(-((ph - 30) * (ph - 30)) / 90) * (a > 0.3 ? 1 : 0);

            if (nearFish) v *= 0.36;
            v *= vis;
            if (v < 0.11) continue;
            v = Math.min(v, 1);

            let chCode;
            if (rBoost > 0.42 && a < 0.72) {
              const rIdx = clamp(Math.floor(clamp((rBoost - 0.3) / 0.7, 0, 1) * (RIPPLE_CODES.length - 1)), 0, RIPPLE_CODES.length - 1);
              chCode = RIPPLE_CODES[rIdx];
            } else {
              const idx = clamp(Math.floor(v * BODY_RAMP.length), 0, BODY_RAMP.length - 1);
              chCode = BODY_RAMP[idx];
            }
            tput(gc, gr, chCode, 1 + clamp(Math.floor(v * 5), 0, 4));
            g.mask[gi] = 1;

            if (v > 0.5 && gc + 2 < g.cols && gr + 1 < g.rows) {
              const si = (gr + 1) * g.cols + gc + 2;
              if (tg.lvl[si] === 0 && FL[si] === 0) tput(gc + 2, gr + 1, 46, 1);
            }
          }
        }
      }

      function paintClock() {
        const g = fishGrid, tg = timeGrid;
        if (!tg.any) return;
        const A = [0.18, 0.32, 0.48, 0.66, 0.84];
        const NL = A.length;
        const fills = A.map(a => rgbaWithAlpha(charRgb, a));
        ctx.font = g.px + 'px ' + FONT;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const strs = new Array(NL), has = new Array(NL);

        for (let r = tg.rMin; r <= tg.rMax; r++) {
          const c0 = tg.rowMin[r], c1 = tg.rowMax[r];
          if (c1 < c0) continue;
          const off = r * g.cols, y = r * g.ch + g.ch * 0.55;
          for (let k = 0; k < NL; k++) { strs[k] = ''; has[k] = false; }
          for (let c = c0; c <= c1; c++) {
            const l = tg.lvl[off + c];
            const ch = l ? String.fromCharCode(tg.cell[off + c]) : ' ';
            for (let k = 0; k < NL; k++) strs[k] += k === l - 1 ? ch : ' ';
            if (l) has[l - 1] = true;
          }
          const x = c0 * g.cw;
          for (let k = 0; k < NL; k++) {
            if (has[k]) {
              ctx.fillStyle = fills[k];
              ctx.fillText(strs[k], x, y);
            }
          }
        }
      }

      function setClockMode(mode, silent) {
        const m = clamp(Math.round(Number(mode) || 0), 0, 2);
        const wasOn = clock.on;
        clock.mode = m;
        if (m !== 0) clock.lastMode = m;
        clock.on = m !== 0;
        if (clock.on) {
          clock.dirty = true;
          clock.snap = true;
        }
        if (!silent && !rm && W && H) {
          spawnRipple(W * 0.5, H * 0.5, clock.on ? 0.9 : 0.6, true, clock.on ? 0.9 : 0.6);
        }
        return wasOn !== clock.on;
      }

      // 鱼尾扫过水面留痕
      function fishWakeField() {
        for (let fi = 0; fi < fishes.length; fi++) {
          const f = fishes[fi];
          const ratio = clamp(f.v / (70 * UI), 0, 1);
          if (ratio < 0.18) continue;
          const tail = f.j[KOI_N - 1];
          const bx = -Math.cos(f.h), by = -Math.sin(f.h);
          for (let bi = 0; bi < bands.length; bi++) {
            const b = bands[bi];
            if (tail.y < b.y0 - b.ch * 3 || tail.y > b.y1 + b.ch * 3) continue;
            for (let k = 1; k <= 3; k++) {
              const px = tail.x + bx * k * b.cw * 1.3;
              const py = tail.y + by * k * b.ch * 0.9;
              if (py < b.y0 || py > b.y1) continue;
              const col = Math.floor(px / b.cw);
              const row = Math.floor((py - b.y0) / b.ch);
              if (col < 0 || col >= b.cols || row < 0 || row >= b.rows) continue;
              const idx = row * b.cols + col;
              const v = (0.28 - k * 0.07) * (0.45 + 0.55 * ratio);
              if (b.boost[idx] < v) b.boost[idx] = v;
            }
          }
        }
      }

      function frame(now) {
        if (!running) return;
        let dt = (now - last) / 1000;
        last = now;
        dt = clamp(dt, 0, 0.05);
        if (rm) dt *= 0.35;
        elapsed += dt;
        const t = elapsed;

        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
        ctx.fillStyle = cfg.bgColor;
        ctx.fillRect(0, 0, W, H);

        for (let i = ripples.length - 1; i >= 0; i--) {
          ripples[i].update(dt);
          if (!ripples[i].alive) ripples.splice(i, 1);
        }
        updateHoverRipple(now);
        buildRippleFields(t);
        updateBaits(dt, t);
        updateFish(dt, t);
        buildFishGrid();
        updateClock(dt, t);
        fishWakeField();

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (const p of particles) {
          p.update(dt, t);
          p.draw(t);
        }

        drawWater(t);
        paintClock();
        paintFish();
        paintBaits(t);

        raf = requestAnimationFrame(frame);
      }

      function isTouch(e) {
        return e.type.indexOf('touch') === 0;
      }

      const onMouseMove = e => onMove(e.clientX, e.clientY);
      const onTouchMove = e => {
        const t = e.touches[0];
        if (t) onMove(t.clientX, t.clientY);
      };

      let lastTouchT = -1e9;

      // 输入框内按下不投饵、不惊散，只在记录光标
      function isTextTarget(e) {
        const el = e.target;
        if (!el || !el.tagName) return false;
        const tag = el.tagName.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
        return el.isContentEditable === true;
      }

      const onDownEvt = e => {
        if (isTouch(e)) {
          lastTouchT = performance.now();
          const t = e.touches[0];
          if (t) onDown(t.clientX, t.clientY);
          return;
        }
        if (performance.now() - lastTouchT < 700) return;
        if (isTextTarget(e)) {
          pointer.x = e.clientX;
          pointer.y = e.clientY;
          pointer.active = true;
          return;
        }
        onDown(e.clientX, e.clientY);
      };

      const onUpEvt = e => {
        if (isTouch(e)) {
          const t0 = e.changedTouches && e.changedTouches[0];
          onUp(t0 ? t0.clientX : pointer.x, t0 ? t0.clientY : pointer.y);
          pointer.active = false;
        } else {
          onUp(e.clientX, e.clientY);
        }
      };

      const onTouchEnd = e => onUpEvt(e);
      const onPointerIdle = () => { pointer.active = false; };
      const onLeave = () => { pointer.active = false; };

      let resizeTimer = 0;
      const onResize = () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          layout();
          initFish();
        }, 110);
      };

      const onVisibility = () => {
        if (document.hidden) {
          running = false;
          cancelAnimationFrame(raf);
        } else if (!running && started) {
          running = true;
          last = performance.now();
          raf = requestAnimationFrame(frame);
        }
      };

      return {
        start() {
          rm = reducedMotion();
          charRgb = parseColor(cfg.charColor);
          layout();
          syncParticles();
          initFish();
          setClockMode(cfg.clockMode, true);
          started = true;
          running = true;
          last = performance.now();
          elapsed = 0;
          window.addEventListener('resize', onResize);
          window.addEventListener('mousemove', onMouseMove);
          window.addEventListener('mousedown', onDownEvt);
          window.addEventListener('touchstart', onDownEvt, { passive: true });
          window.addEventListener('touchmove', onTouchMove, { passive: true });
          window.addEventListener('touchend', onTouchEnd);
          window.addEventListener('touchcancel', onPointerIdle);
          window.addEventListener('mouseup', onUpEvt);
          window.addEventListener('blur', cancelPress);
          document.addEventListener('mouseleave', onLeave);
          document.addEventListener('visibilitychange', onVisibility);
          raf = requestAnimationFrame(frame);
        },
        stop() {
          running = false;
          started = false;
          cancelAnimationFrame(raf);
          clearTimeout(holdTimer);
          clearTimeout(resizeTimer);
          window.removeEventListener('resize', onResize);
          window.removeEventListener('mousemove', onMouseMove);
          window.removeEventListener('mousedown', onDownEvt);
          window.removeEventListener('touchstart', onDownEvt);
          window.removeEventListener('touchmove', onTouchMove);
          window.removeEventListener('touchend', onTouchEnd);
          window.removeEventListener('touchcancel', onPointerIdle);
          window.removeEventListener('mouseup', onUpEvt);
          window.removeEventListener('blur', cancelPress);
          document.removeEventListener('mouseleave', onLeave);
          document.removeEventListener('visibilitychange', onVisibility);
        },
        setConfig(next) {
          let relayout = false;
          let refish = false;
          let clockChanged = false;
          for (const key of Object.keys(DEFAULTS)) {
            if (key === 'uiOpacity') continue;
            const value = next[key];
            if (value === undefined || value === null) continue;
            if (value === cfg[key]) continue;
            cfg[key] = value;
            if (key === 'fontSize') relayout = true;
            if (key === 'fishCount' || key === 'swimFish') refish = true;
            if (key === 'clockMode') clockChanged = true;
            if (key === 'charColor') charRgb = parseColor(value);
          }
          if (next.particleCount !== undefined) syncParticles();
          if (relayout) {
            layout();
            refish = true;
          }
          if (refish) initFish();
          if (clockChanged) setClockMode(cfg.clockMode, false);
        }
      };
    }

    const SURFACE_TOKENS = [
      '--dsw-alias-bg-base',
      '--dsw-alias-bg-layer-1',
      '--dsw-alias-bg-layer-2',
      '--dsw-alias-bg-overlay',
      '--dsw-specific-sidebar-fill'
    ];

    function parseAnyColor(value) {
      const s = String(value === undefined || value === null ? '' : value).trim();
      if (!s || s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
      if (s.charAt(0) === '#') {
        const rgb = parseColor(s);
        return { r: rgb[0], g: rgb[1], b: rgb[2], a: 1 };
      }
      if (s.indexOf('rgb') !== 0) return null;
      const open = s.indexOf('(');
      const close = s.lastIndexOf(')');
      if (open < 0 || close < open) return null;
      const parts = s.slice(open + 1, close).split(',');
      if (parts.length < 3) return null;
      const r = parseFloat(parts[0]);
      const g = parseFloat(parts[1]);
      const b = parseFloat(parts[2]);
      if (!isFiniteNum(r) || !isFiniteNum(g) || !isFiniteNum(b)) return null;
      let a = 1;
      if (parts.length > 3 && parts[3] !== undefined) {
        const raw = parts[3].trim();
        const pct = raw.charAt(raw.length - 1) === '%';
        const v = parseFloat(raw);
        if (isFiniteNum(v)) a = pct ? v / 100 : v;
      }
      return { r: clampByte(r), g: clampByte(g), b: clampByte(b), a: clamp(a, 0, 1) };
    }

    const cssRgba = (c, alpha) => 'rgba(' + c.r + ', ' + c.g + ', ' + c.b + ', ' + clamp(alpha, 0, 1).toFixed(3) + ')';

    function readSurfaceColors() {
      const style = getComputedStyle(document.body);
      const bodyBg = parseAnyColor(style.backgroundColor);
      const base = bodyBg && bodyBg.a > 0 ? bodyBg : { r: 18, g: 20, b: 24, a: 1 };
      const colors = {};
      for (const name of SURFACE_TOKENS) {
        const parsed = parseAnyColor(style.getPropertyValue(name));
        colors[name] = parsed && parsed.a > 0 ? parsed : base;
      }
      return colors;
    }

    const panelOriginal = new Map();
    const PANEL_MIN_AREA = 1e4;

    // DSH 的界面面板用大量不透明底色，这里统一压成半透明让水纹透出
    function sweepPanels(alpha) {
      for (const el of panelOriginal.keys()) {
        if (!el.isConnected) panelOriginal.delete(el);
      }
      const nodes = document.body.querySelectorAll('*');
      for (let i = 0; i < nodes.length; i++) {
        const el = nodes[i];
        if (!(el instanceof HTMLElement) || el.id === CANVAS_ID) continue;
        let orig = panelOriginal.get(el);
        if (!orig) {
          if (el.offsetWidth * el.offsetHeight < PANEL_MIN_AREA) continue;
          const cs = getComputedStyle(el);
          if (cs.backgroundImage !== 'none') continue;
          const c = parseAnyColor(cs.backgroundColor);
          if (!c || c.a < 1) continue;
          orig = { r: c.r, g: c.g, b: c.b };
          panelOriginal.set(el, orig);
        }
        el.style.setProperty('background-color', cssRgba(orig, alpha));
      }
    }

    function restorePanels() {
      for (const el of panelOriginal.keys()) el.style.removeProperty('background-color');
      panelOriginal.clear();
    }

    return {
      inject: ['configForms'],
      apply(ctx) {
        const form = ctx.configForms.get(NS);
        let currentAlpha = clamp(DEFAULTS.uiOpacity, 0, 1);
        let styleTag = null;
        let sweepRaf = 0;
        let sweepTimer = 0;
        let observer = null;
        let themeObserver = null;

        const readFreshSurfaces = () => {
          if (!styleTag) return readSurfaceColors();
          const saved = styleTag.textContent;
          styleTag.textContent = '';
          const colors = readSurfaceColors();
          styleTag.textContent = saved;
          return colors;
        };

        const scheduleSweep = () => {
          if (sweepRaf) return;
          sweepRaf = requestAnimationFrame(() => {
            sweepRaf = 0;
            sweepPanels(currentAlpha);
          });
        };

        const applyOpacity = opacity => {
          const next = Number(opacity);
          currentAlpha = clamp(Number.isFinite(next) ? next : DEFAULTS.uiOpacity, 0, 1);
          if (!styleTag) return;
          const colors = readFreshSurfaces();
          const tokenDecls = SURFACE_TOKENS.map(name => name + ': ' + cssRgba(colors[name], currentAlpha) + ' !important;').join(' ');
          styleTag.textContent = [
            ':root, body, body * { ' + tokenDecls + ' }',
            'html, body { background: transparent !important; }',
            '#' + CANVAS_ID + ' { position: fixed; inset: 0; margin: 0; padding: 0; width: 100%; height: 100%; z-index: -1; pointer-events: none; touch-action: none; background: #000; }'
          ].join(' ');
          scheduleSweep();
        };

        ctx.effect(() => {
          styleTag = document.createElement('style');
          styleTag.dataset.plugin = ID;
          document.head.appendChild(styleTag);

          const canvas = document.createElement('canvas');
          canvas.id = CANVAS_ID;
          const root = document.getElementById('root');
          document.body.insertBefore(canvas, root || null);

          const engine = createEngine(canvas);
          const readConfig = () => {
            const snap = form.getSnapshot();
            return (snap && snap.value) || DEFAULTS;
          };

          const applyAll = () => {
            const cfgNow = readConfig();
            engine.setConfig(cfgNow);
            applyOpacity(cfgNow.uiOpacity === undefined ? DEFAULTS.uiOpacity : cfgNow.uiOpacity);
          };

          engine.setConfig(readConfig());
          engine.start();

          let rafInit = requestAnimationFrame(applyAll);
          const unsubscribe = form.subscribe(() => {
            cancelAnimationFrame(rafInit);
            applyAll();
          });

          observer = new MutationObserver(() => {
            if (sweepTimer) return;
            sweepTimer = setTimeout(() => {
              sweepTimer = 0;
              scheduleSweep();
            }, 350);
          });
          observer.observe(document.body, { childList: true, subtree: true });

          themeObserver = new MutationObserver(() => {
            applyOpacity(currentAlpha);
          });
          themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-ds-dark-theme'] });

          return () => {
            cancelAnimationFrame(rafInit);
            if (sweepRaf) cancelAnimationFrame(sweepRaf);
            if (sweepTimer) clearTimeout(sweepTimer);
            if (observer) {
              observer.disconnect();
              observer = null;
            }
            if (themeObserver) {
              themeObserver.disconnect();
              themeObserver = null;
            }
            unsubscribe();
            engine.stop();
            restorePanels();
            if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
            if (styleTag && styleTag.parentNode) styleTag.parentNode.removeChild(styleTag);
            styleTag = null;
          };
        });
      }
    };
  }
});
