// Pixel-art renderer: sprites, arcade maze walls and an animated canvas Board.
// Everything is drawn on a 16px-per-tile logical grid, scaled by an integer R, so it stays crisp.
(function (root) {
  'use strict';
  const cv = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });
  const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const C = { pac: '#ffe600', dot: '#ffb8ae', red: '#ff2d2d', pink: '#ffb8ff', cyan: '#00f0ff', orange: '#ffb852', wall: '#2a3bff', green: '#7dff7a' };

  // ---------- sprites ----------
  // Pac-Man per pixel so the mouth wedge stays crisp. dir 0 right, 1 down, 2 left, 3 up.
  const PAC = [0, 1, 2, 3].map(d => [0, 0.14, 0.27].map(a => {
    const c = cv(13, 13), x = c.getContext('2d'); x.fillStyle = C.pac;
    for (let py = 0; py < 13; py++) for (let px = 0; px < 13; px++) {
      const dx = px + .5 - 6.5, dy = py + .5 - 6.5;
      if (dx * dx + dy * dy > 6.6 * 6.6) continue;
      let an = Math.atan2(dy, dx) - d * Math.PI / 2; an = Math.atan2(Math.sin(an), Math.cos(an));
      if (a && Math.abs(an) < a * Math.PI && dx * dx + dy * dy > .6) continue;
      x.fillRect(px, py, 1, 1);
    }
    return c;
  }));
  const pacFrame = (dir, t) => PAC[dir][[0, 1, 2, 1][Math.floor(t / 55) % 4]];

  const BODY = ['.....####.....', '...########...', '..##########..', '.############.', '.############.', '.############.',
    '##############', '##############', '##############', '##############', '##############', '##############'];
  const SKIRT = [['##.###..###.##', '#...##..##...#'], ['####.####.####', '.##...##...##.']];
  const ghostCache = new Map();
  function ghost(color, dir, t, scared) {
    const fr = Math.floor(t / 140) % 2, k = color + dir + fr + !!scared;
    if (ghostCache.has(k)) return ghostCache.get(k);
    const c = cv(14, 14), x = c.getContext('2d');
    x.fillStyle = scared ? '#2121de' : color;
    [...BODY, ...SKIRT[fr]].forEach((r, y) => [...r].forEach((ch, xx) => ch === '#' && x.fillRect(xx, y, 1, 1)));
    if (scared) { x.fillStyle = C.dot; [[4, 6], [9, 6], [3, 10], [5, 9], [7, 10], [9, 9], [11, 10]].forEach(([a, b]) => x.fillRect(a, b, 1, 1)); }
    else {
      const [ox, oy] = [[1, 0], [0, 1], [-1, 0], [0, -1]][dir];
      x.fillStyle = '#fff'; for (const ex of [2, 8]) { x.fillRect(ex + 1 + ox, 3 + oy, 2, 5); x.fillRect(ex + ox, 4 + oy, 4, 3); }
      x.fillStyle = '#1f39ff'; for (const ex of [2, 8]) x.fillRect(ex + 1 + ox * 2, 5 + oy * 2, 2, 2);
    }
    ghostCache.set(k, c); return c;
  }
  // sprite into a small <canvas> element (for HTML icons)
  function icon(el, kind, color) {
    el.width = 14; el.height = 14; const x = el.getContext('2d'); x.clearRect(0, 0, 14, 14);
    if (kind === 'pac') x.drawImage(PAC[0][2], 0.5, 0.5); else x.drawImage(ghost(color, 2, 0), 0, 0);
  }

  // ---------- arcade walls: double line traced at fixed distances from the open area ----------
  function wallBitmap(m, color) {
    const T = 16, W = m.w + 2, H = m.h + 2, c = cv(W * T, H * T), x = c.getContext('2d'), im = x.createImageData(W * T, H * T);
    const wall = (tx, ty) => { const bx = tx - 1, by = ty - 1; return bx < 0 || by < 0 || bx >= m.w || by >= m.h || !!m.walls[by * m.w + bx]; };
    const [r, g, b] = rgb(color);
    for (let py = 0; py < H * T; py++) for (let px = 0; px < W * T; px++) {
      const tx = px / T | 0, ty = py / T | 0; if (!wall(tx, ty)) continue;
      let d = 99; const cx = px + .5, cy = py + .5;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const nx = tx + ox, ny = ty + oy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || wall(nx, ny)) continue;
        d = Math.min(d, Math.hypot(Math.max(nx * T - cx, 0, cx - (nx + 1) * T), Math.max(ny * T - cy, 0, cy - (ny + 1) * T)));
      }
      if ((d >= 2 && d < 3.1) || (d >= 6 && d < 7.1)) im.data.set([r, g, b, 255], (py * W * T + px) * 4);
    }
    x.putImageData(im, 0, 0); return c;
  }

  // ---------- depth layers (sample on stages 2 + 4) ----------
  // Painted once per maze: floor -> wall shadow -> wall side face -> wall top -> neon lines (drawn live on top).
  // Walls read as raised blocks standing on a lit floor instead of flat lines on black.
  const LITE = !!root.PAC_LITE, depth = { on: !LITE };
  function depthBitmap(m) {
    const T = 16, W = m.w + 2, H = m.h + 2, c = cv(W * T, H * T), x = c.getContext('2d');
    const wall = (tx, ty) => { const bx = tx - 1, by = ty - 1; return bx < 0 || by < 0 || bx >= m.w || by >= m.h || !!m.walls[by * m.w + bx]; };
    // wall mass: wall tiles shrunk 2px away from any open tile (same edge as the outer neon line)
    const mass = cv(W * T, H * T), mx = mass.getContext('2d'), im = mx.createImageData(W * T, H * T);
    for (let py = 0; py < H * T; py++) for (let px = 0; px < W * T; px++) {
      const tx = px / T | 0, ty = py / T | 0; if (!wall(tx, ty)) continue;
      let d = 99; const cx = px + .5, cy = py + .5;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const nx = tx + ox, ny = ty + oy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || wall(nx, ny)) continue;
        d = Math.min(d, Math.hypot(Math.max(nx * T - cx, 0, cx - (nx + 1) * T), Math.max(ny * T - cy, 0, cy - (ny + 1) * T)));
      }
      if (d >= 2) im.data.set([255, 255, 255, 255], (py * W * T + px) * 4);
    }
    mx.putImageData(im, 0, 0);
    const tint = (col, a = 1) => { const t = cv(W * T, H * T), tx = t.getContext('2d'); tx.drawImage(mass, 0, 0); tx.globalCompositeOperation = 'source-in'; tx.globalAlpha = a; tx.fillStyle = col; tx.fillRect(0, 0, t.width, t.height); return t; };
    // 1 floor: lit from the centre, faint tile grid
    const g = x.createRadialGradient(W * T / 2, H * T * .42, 0, W * T / 2, H * T / 2, Math.max(W, H) * T * .7);
    g.addColorStop(0, '#101a5a'); g.addColorStop(.6, '#070b30'); g.addColorStop(1, '#02030f');
    x.fillStyle = g; x.fillRect(0, 0, W * T, H * T);
    x.fillStyle = 'rgba(80,110,255,.07)';
    for (let ty = 0; ty < H; ty++) for (let tx = 0; tx < W; tx++) if (!wall(tx, ty)) { x.fillRect(tx * T, ty * T, T, 1); x.fillRect(tx * T, ty * T, 1, T); }
    // 2 soft shadow cast down-right onto the floor
    x.save(); x.filter = 'blur(3px)'; x.drawImage(tint('#000', .75), 4, 6); x.restore();
    // 3 side face (the block's front, seen from above at an angle) + 4 top face with a light rim
    x.drawImage(tint('#0b1490'), 0, 4); x.drawImage(tint('#1a2cc8'), 0, 2);
    const top = tint('#050a3a'), tt = top.getContext('2d');
    tt.globalCompositeOperation = 'source-atop';
    const tg = tt.createLinearGradient(0, 0, 0, H * T); tg.addColorStop(0, 'rgba(90,120,255,.22)'); tg.addColorStop(1, 'rgba(0,0,0,.1)');
    tt.fillStyle = tg; tt.fillRect(0, 0, W * T, H * T);
    x.drawImage(top, 0, 0);
    return c;
  }
  // glow sprite for dots (pre-rendered, drawn additively)
  const HALO = (() => { const c = cv(32, 32), x = c.getContext('2d'), g = x.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,184,174,.75)'); g.addColorStop(.35, 'rgba(255,140,120,.25)'); g.addColorStop(1, 'rgba(255,120,100,0)');
    x.fillStyle = g; x.fillRect(0, 0, 32, 32); return c; })();

  // ---------- Board ----------
  // Actors glide toward their target tile; walk() drives them along a path and eats dots from `mask`.
  class Board {
    constructor(canvas, m, R, o = {}) {
      Object.assign(this, { canvas, m, R, o, x: canvas.getContext('2d'), K: m.dots.length });
      canvas.width = (m.w + 2) * 16 * R; canvas.height = (m.h + 2) * 16 * R;
      canvas.style.width = canvas.width + 'px'; canvas.style.height = canvas.height + 'px';
      this.wallB = wallBitmap(m, C.wall); this.wallW = wallBitmap(m, '#ffffff');
      if (o.depth && !LITE) this.depthB = depthBitmap(m);
      this.big = this.K > 30; this.ALL = this.big ? 0 : (1 << this.K) - 1; this.token = 0;
      this.actors = []; this.pac = this.add('pac');
      this.reset();
    }
    tl(i) { return [(i % this.m.w + 1) * 16, ((i / this.m.w | 0) + 1) * 16]; }
    cpt(i) { const [a, b] = this.tl(i); return [a + 8, b + 8]; }
    // Manhattan "L" between two tiles, as logical points
    ell(a, b) { const [ax, ay] = this.cpt(a), [bx, by] = this.cpt(b); return [[ax, ay], [bx, ay], [bx, by]]; }
    pathPts(path) { return path.map(i => this.cpt(i)); }
    add(kind, color, alpha = 1) {
      const a = { kind, color, alpha, x: 0, y: 0, tx: 0, ty: 0, dir: 0, v: .3, hidden: false };
      this.actors.push(a); this.put(a, this.m.start); return a;
    }
    put(a, pos) { const [x, y] = this.tl(pos); Object.assign(a, { x, y, tx: x, ty: y, pos }); }
    aim(a, pos, v) {
      const [x, y] = this.tl(pos), dx = x - a.tx, dy = y - a.ty;
      if (dx || dy) a.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 0 : 2) : (dy > 0 ? 1 : 3);
      a.tx = x; a.ty = y; a.pos = pos; if (v) a.v = v;
    }
    stop() { this.token++; }
    reset() {
      this.token++; this.mask = this.ALL; this.eaten = new Set(); this.tints = new Map(); this.labels = new Map(); this.lines = []; this.marks = []; this.flashT = 0;
      this.actors.forEach(a => this.put(a, this.m.start));
    }
    eat(pos) {
      const k = this.m.dots.indexOf(pos);
      if (k >= 0 && this.big) { if (this.eaten.has(k)) return -1; this.eaten.add(k); return k; }
      if (k >= 0 && (this.mask >> k) & 1) { this.mask &= ~(1 << k); return k; }
      return -1;
    }
    async walk(a, path, ms, { eat = true, onStep } = {}) {
      const tok = this.token; this.put(a, path[0]);
      for (let k = 1; k < path.length; k++) {
        this.aim(a, path[k], 16 / ms);
        await sleep(ms);
        if (tok !== this.token) return false;
        const ate = eat ? this.eat(path[k]) : -1;
        onStep && onStep(k, path[k], ate);
      }
      return true;
    }
    // animated pixel line through logical points: style 'solid' | 'dots'
    line(pts, color, { w = 2, style = 'solid', dur = 0 } = {}) {
      const L = { pts, color, w, style, t0: performance.now(), dur };
      this.lines.push(L); return L;
    }
    mark(pos, kind) { this.marks.push({ pos, kind, t: performance.now() }); }
    flash() { this.flashT = performance.now(); }

    render(t, dt) {
      const { x, R, m } = this;
      x.clearRect(0, 0, this.canvas.width, this.canvas.height);
      const D = this.depthB && depth.on; this.D = D;
      if (D) x.drawImage(this.depthB, 0, 0, this.canvas.width, this.canvas.height);
      this.tints.forEach((c, i) => { const [a, b] = this.tl(i); x.fillStyle = c; x.fillRect((a + 1) * R, (b + 1) * R, 14 * R, 14 * R); });
      for (let i = 0; i < m.w * m.h; i++) if (m.cost[i] > 1) {
        const [a, b] = this.tl(i); x.fillStyle = 'rgba(255,45,45,.45)';
        for (let yy = 1; yy < 15; yy += 2) for (let xx = 1 + (yy >> 1) % 2; xx < 15; xx += 2) x.fillRect((a + xx) * R, (b + yy) * R, R, R);
      }
      const fl = this.flashT && t - this.flashT < 1600 && Math.floor((t - this.flashT) / 200) % 2 === 0;
      x.drawImage(fl ? this.wallW : this.wallB, 0, 0, this.canvas.width, this.canvas.height);
      if (this.o.under) this.o.under(this, t);
      this.lines.forEach(L => this.drawLine(L, t));
      m.dots.forEach((i, k) => {
        if (this.big ? this.eaten.has(k) : !((this.mask >> k) & 1)) return;
        const [a, b] = this.tl(i);
        if (D) { // pulsing glow + a darker lower half so the pellet looks round
          const p = .75 + .25 * Math.sin(t / 260 + k * 1.7), z = 22 * p;
          x.globalCompositeOperation = 'lighter'; x.drawImage(HALO, (a + 8 - z / 2) * R, (b + 8 - z / 2) * R, z * R, z * R); x.globalCompositeOperation = 'source-over';
          x.fillStyle = 'rgba(0,0,0,.45)'; x.fillRect((a + 6) * R, (b + 8) * R, 4 * R, 3 * R);
          x.fillStyle = C.dot; x.fillRect((a + 6) * R, (b + 5) * R, 4 * R, 4 * R);
          x.fillStyle = '#fff'; x.fillRect((a + 6) * R, (b + 5) * R, R, R);
        } else { x.fillStyle = C.dot; x.fillRect((a + 6) * R, (b + 6) * R, 4 * R, 4 * R); }
        if (this.o.tags) this.txt(a + 8, b + 3, 'd' + k, C.dot, 5);
      });
      if (this.o.extra) this.o.extra(this, t);
      this.labels.forEach((l, i) => { const [a, b] = this.tl(i); this.txt(a + 8, b + 8.5 + (l.dy || 0), l.s, l.c, l.size || 6); });
      this.marks = this.marks.filter(mk => t - mk.t < 700);
      this.marks.forEach(mk => {
        const [a, b] = this.tl(mk.pos), u = (t - mk.t) / 700;
        if (mk.kind === 'x') {
          x.fillStyle = `rgba(255,45,45,${1 - u})`;
          for (let k = 3; k < 13; k++) { x.fillRect((a + k) * R, (b + k) * R, 2 * R, 2 * R); x.fillRect((a + 15 - k) * R, (b + k) * R, 2 * R, 2 * R); }
        } else {
          const g = Math.round(u * 6); x.strokeStyle = `rgba(255,230,0,${1 - u})`; x.lineWidth = R;
          x.strokeRect((a + 4 - g) * R, (b + 4 - g) * R, (8 + 2 * g) * R, (8 + 2 * g) * R);
        }
      });
      if (this.o.ghostAt != null) { const [a, b] = this.tl(this.o.ghostAt); this.spr(ghost(C.orange, 2, t), a + 1, b + 1); }
      this.actors.forEach(a => {
        if (a.hidden) return;
        const step = a.v * dt;
        a.x += Math.max(-step, Math.min(step, a.tx - a.x)); a.y += Math.max(-step, Math.min(step, a.ty - a.y));
        const moving = a.x !== a.tx || a.y !== a.ty || a.chomp;
        if (D) { // contact shadow on the floor; the sprite floats 2px above it and bobs while moving
          const bob = moving ? Math.abs(Math.sin(t / 90)) * 1.5 : 0;
          x.globalAlpha = a.alpha * (.55 - bob * .1); x.fillStyle = '#000';
          x.beginPath(); x.ellipse((a.x + 8) * R, (a.y + 14.5) * R, (5.5 - bob * .6) * R, 1.8 * R, 0, 0, 7); x.fill(); x.globalAlpha = 1;
          if (a.kind === 'pac') this.spr(moving ? pacFrame(a.dir, t) : PAC[a.dir][1], a.x + 1.5, a.y - .5 - bob, a.alpha);
          else this.spr(ghost(a.color, a.dir, t, a.scared), a.x + 1, a.y - 1 - bob, a.alpha);
          return;
        }
        if (a.kind === 'pac') this.spr(moving ? pacFrame(a.dir, t) : PAC[a.dir][1], a.x + 1.5, a.y + 1.5, a.alpha);
        else this.spr(ghost(a.color, a.dir, t, a.scared), a.x + 1, a.y + 1, a.alpha);
      });
    }
    spr(img, lx, ly, alpha = 1) { const R = this.R; this.x.globalAlpha = alpha; this.x.drawImage(img, Math.round(lx) * R, Math.round(ly) * R, img.width * R, img.height * R); this.x.globalAlpha = 1; }
    txt(lx, ly, s, color, size) {
      const x = this.x, R = this.R;
      x.font = `${size * R}px 'Press Start 2P'`; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillStyle = '#000'; x.fillText(s, lx * R + R, ly * R + R); x.fillStyle = color; x.fillText(s, lx * R, ly * R);
    }
    drawLine(L, t) {
      const { x, R } = this, p = L.dur ? Math.min(1, (t - L.t0) / L.dur) : 1;
      const seg = []; let total = 0;
      for (let k = 1; k < L.pts.length; k++) { const [ax, ay] = L.pts[k - 1], [bx, by] = L.pts[k], d = Math.hypot(bx - ax, by - ay); seg.push([ax, ay, bx, by, d]); total += d; }
      let left = total * p, pos = 0; x.fillStyle = L.color;
      const gap = L.style === 'dots' ? 4 : 1, off = L.style === 'dots' ? (t / 60) % 4 : 0;
      for (const [ax, ay, bx, by, d] of seg) {
        for (let s = (L.style === 'dots' ? (4 - (pos % 4) + off) % 4 : 0); s <= d && s <= left; s += gap) {
          const px = Math.round(ax + (bx - ax) * s / d - L.w / 2), py = Math.round(ay + (by - ay) * s / d - L.w / 2);
          x.fillRect(px * R, py * R, L.w * R, L.w * R);
        }
        left -= d; pos += d; if (left < 0) break;
      }
    }
  }

  root.PacGfx = { C, PAC, pacFrame, ghost, icon, wallBitmap, depthBitmap, depth, Board, sleep, cv };
})(window);
