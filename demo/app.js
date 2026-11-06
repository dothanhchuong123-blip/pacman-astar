(function () {
  'use strict';
  const E = window.PacEngine, G = window.PacGfx, { Board, sleep, C } = G;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const fmt = n => Math.round(n).toLocaleString('en-US');
  const stage = $('#stage');
  const scale = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--s')) || 1;

  function countTo(el, to, ms = 700, f = fmt) {
    const from = parseFloat(el.dataset.v || '0') || 0, t0 = performance.now();
    el.dataset.v = to; cancelAnimationFrame(el._raf);
    const tick = now => {
      const p = Math.min(1, (now - t0) / ms);
      el.textContent = f(from + (to - from) * (Math.floor(p * 12) / 12));
      if (p < 1) el._raf = requestAnimationFrame(tick);
    };
    el._raf = requestAnimationFrame(tick);
  }

  // ---------- mazes used by the demos (all verified with engine.js) ----------
  const MAZES = {
    hook: ['P---#---.--', '-##-#-##-#-', '-.-------#.', '-#-##.##-#-', '-------.---', '-##-#-##-#-', '.---#---.--'],
    trap: ['----.', '#---.', '-----', '-----', '.P---'],
    trace: ['.---#', '##---', '----.', '#-.--', '--#-P'],
    race: ['--#----', '-----.-', '---.--.', '-#-----', '---..--', '----P.-', '-------'],
    ghost: ['--.----', '-------', '--#----', '---#-#-', '-Px---.', '-#x####', '-.x-#--'],
    row: ['P...'],
    relax: ['P------', '-#--##.', '#-#---#', '-#---#.', '.----#.', '.--#---', '#---##-'], // seed 144: far 13 < MST 14 < MAZE 28 < h* 29 < Σ 35
    duel: ['.-----.', '-#---#-', '.-.P.-.', '-#G#-#-', '.-----.'],          // one ghost: minimax tree + live games
    pocket: ['--.-.--', '-#---#-', '---G---', '###P###', '###-###', '#######'], // cornered: minimax 0%, expectimax 69%
    arena: ['-.#------', '#.----###', '-##-#----', '.-#-P-#--', '.-------.', '-##.-#--#', '#-------.'], // seed 78: every lesson at once
  };
  const maze = name => E.makeMaze(MAZES[name]);

  // the arcade font draws arrows and math signs as specks: swap them for pixel glyphs (also in text added later)
  const GLYPH = { '→': 'gl ar', '≤': 'gl le', '≥': 'gl ge', '⇒': 'gl im', '≈': 'gl ap', '✓': 'ck', '✗': 'xx', '✕': 'xx' };
  const GLYPH_RE = /[→≤≥⇒≈✓✗✕]/;
  function glyphs(root) {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), hits = [];
    for (let n = w.nextNode(); n; n = w.nextNode()) if (GLYPH_RE.test(n.data) && !n.parentElement.closest('.mono, .code, #notes, button, .qa p')) hits.push(n);
    hits.forEach(n => {
      const f = document.createDocumentFragment();
      n.data.split(/([→≤≥⇒≈✓✗✕])/).forEach(part => {
        if (GLYPH[part]) f.appendChild(Object.assign(document.createElement('i'), { className: GLYPH[part] }));
        else if (part) f.appendChild(document.createTextNode(part));
      });
      n.replaceWith(f);
    });
  }
  glyphs(document.getElementById('stage'));
  new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => {
    if (n.nodeType === 3 && GLYPH_RE.test(n.data) && n.parentElement) glyphs(n.parentElement);
    else if (n.nodeType === 1) glyphs(n);
  }))).observe(document.getElementById('stage'), { childList: true, subtree: true });

  // sprite icons in the HTML
  $$('canvas[data-i]').forEach(c => G.icon(c, c.dataset.i === 'pac' ? 'pac' : 'ghost', c.dataset.i));

  // ---------- stage-space helpers for popups and flying chips ----------
  function stagePt(el) {
    const s = scale(), sr = stage.getBoundingClientRect(), r = el.getBoundingClientRect();
    return [(r.left + r.width / 2 - sr.left) / s, (r.top + r.height / 2 - sr.top) / s];
  }
  function tilePt(b, i) {
    const s = scale(), sr = stage.getBoundingClientRect(), r = b.canvas.getBoundingClientRect(), [cx, cy] = b.cpt(i);
    const k = r.width / s / (b.canvas.width / b.R);
    return [(r.left - sr.left) / s + cx * k, (r.top - sr.top) / s + cy * k];
  }
  function popup(text, at, color) {
    const p = document.createElement('div'); p.className = 'pop'; p.textContent = text; if (color) p.style.color = color;
    p.style.left = at[0] + 'px'; p.style.top = at[1] - 20 + 'px'; p.style.transform = 'translateX(-50%)';
    stage.appendChild(p);
    p.animate([{ transform: 'translate(-50%,6px) scale(.6)', opacity: 0 }, { transform: 'translate(-50%,0)', opacity: 1, offset: .2 }, { transform: 'translate(-50%,-44px)', opacity: 0 }],
      { duration: 1100, easing: 'steps(10)' }).onfinish = () => p.remove();
  }
  function fly(text, from, to, delay = 0) {
    const c = document.createElement('div'); c.className = 'chip'; c.textContent = text;
    c.style.left = from[0] + 'px'; c.style.top = from[1] + 'px'; c.style.opacity = 0; stage.appendChild(c);
    const dx = to[0] - from[0], dy = to[1] - from[1];
    c.animate([{ transform: 'translate(-50%,-50%) scale(.4)', opacity: 1 },
      { transform: `translate(calc(-50% + ${dx / 2}px), calc(-50% + ${dy / 2 - 90}px)) scale(1.1)`, opacity: 1, offset: .5 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.8)`, opacity: 1 }],
    { duration: 520, delay, easing: 'cubic-bezier(.3,.1,.3,1)', fill: 'both' }).onfinish = () => c.remove();
  }

  // ---------- attract-mode corridor (title + end slide) ----------
  function corridor(canvas) {
    const m = E.makeMaze(['-' + '.'.repeat(24) + '-']), t0 = performance.now();
    let ph = 0;
    const b = new Board(canvas, m, 3, {
      extra(bd, t) { // power pellets at both ends
        [0, 25].forEach(i => {
          const [a, y] = bd.tl(i), R = bd.R;
          if ((i === 0 ? ph > a - 8 : ph > a - 4) || Math.floor(t / 250) % 2) return;
          bd.x.fillStyle = C.dot; bd.x.fillRect((a + 5) * R, (y + 4) * R, 6 * R, 8 * R); bd.x.fillRect((a + 4) * R, (y + 5) * R, 8 * R, 6 * R);
        });
      },
    });
    const gh = [C.red, C.pink, C.cyan].map(c => b.add('ghost', c));
    return {
      board: b,
      tick(t) {
        const L = 26 * 16, sp = 0.085, cyc = (L + 140) / sp;
        ph = ((t - t0) % cyc) * sp - 40;
        let mask = 0; m.dots.forEach((i, k) => { if (b.tl(i)[0] + 8 > ph + 10) mask |= 1 << k; }); b.mask = mask;
        const scared = ph > b.tl(25)[0] + 8, px = scared ? L + 12 - (ph - L) : ph;
        Object.assign(b.pac, { x: px - 1.5, tx: px - 1.5, y: 16, ty: 16, dir: scared ? 2 : 0, chomp: true });
        gh.forEach((g, k) => {
          const gx = scared ? px + 26 + k * 20 + (ph - L) * 0.6 : ph - 34 - k * 20;
          Object.assign(g, { x: gx - 1, tx: gx - 1, y: 16, ty: 16, dir: 0, scared });
        });
      },
    };
  }

  // ---------- slides ----------
  const LITE = !!window.PAC_LITE;
  if (LITE) document.body.classList.add('flat');
  const S = {};
  // slides build their boards / mazes / searches the first time they are needed (a warm-up fills the next one while idle)
  const lazy = (id, make) => Object.defineProperty(S, id, { configurable: true, enumerable: true, get() { const v = make(); Object.defineProperty(S, id, { value: v, enumerable: true }); return v; } });

  // logo row (slide 2): smooth, small, no frame
  (() => {
    $$('.logos').forEach(row => {
      ['neu', 'fda', 'nct'].forEach(n => {
        const lg = document.createElement('div'); lg.className = 'lg';
        const c = document.createElement('canvas'); c.width = c.height = 96; lg.appendChild(c); row.appendChild(lg);
        const im = new Image();
        im.onload = () => { const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(im, 0, 0, 96, 96); };
        im.src = `logos/${n}.png`;
      });
    });
  })();

  // 1 · title: PDF-style slide with heavy glitch → click → Pac-Man material → character select
  lazy('s-title', () => {
    const st = corridor($('#titleStrip'));
    const NAMES = [['DO THANH CHUONG', '#ffe600'], ['TRAN QUOC HOANG CUONG', '#ff2d2d'], ['NGUYEN HOANG HAI', '#00f0ff'], ['HOANG TRUNG KIEN', '#ffb8ff']];
    const roster = $('#roster'), msg = $('#pickMsg');
    roster.innerHTML = NAMES.map(([n, c], k) => `<div class="pick" style="top:${k * 72}px;--c:${c}"><span class="nm">${n}</span></div>`).join('');
    const picks = $$('.pick', roster);
    let idx = 0, timer = null, locked = false, lastN = -1, enteredAt = 0;
    function paint() {
      picks.forEach((p, k) => { p.classList.toggle('sel', k === idx); p.classList.toggle('dim', locked && k !== idx); p.classList.toggle('lock', locked && k === idx); });
    }
    function spin(on) {
      clearInterval(timer); timer = null;
      if (on) timer = setInterval(() => { idx = (idx + 1) % NAMES.length; paint(); }, 650);
    }
    function show(n) {
      locked = n >= 2;
      if (n >= 1) { if (!locked) { idx = 0; spin(true); } else { spin(false); idx = 0; } }
      else spin(false);
      msg.className = 'abs t18' + (locked ? '' : ' blink y');
      msg.style.color = locked ? NAMES[0][1] : '';
      msg.textContent = locked ? 'DO THANH CHUONG · PLAYER 1 READY!' : 'CHOOSE YOUR PLAYER';
      paint();
    }

    // ---- glitch canvas ----
    const W = 1600, H = 1000, K = window.PAC_LITE ? 1 : 2, cv = $('#glc'), x = cv.getContext('2d');
    cv.width = W * K; cv.height = H * K;
    const mk = () => Object.assign(document.createElement('canvas'), { width: W * K, height: H * K });
    let A0 = null, sprites = [];
    const rnd = (a, b) => a + Math.random() * (b - a), pick = arr => arr[(Math.random() * arr.length) | 0];
    const loadImg = n => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = `logos/${n}.png`; });
    Promise.all([loadImg('neu'), loadImg('fda'), loadImg('nct'), document.fonts ? document.fonts.ready : 0]).then(([neu, fda, nct]) => {
      const A = mk(), a = A.getContext('2d'); a.scale(K, K);
      a.fillStyle = '#fff'; a.fillRect(0, 0, W, H);
      a.fillStyle = '#152847'; a.fillRect(0, 0, W, 232);
      const fit = (im, cx, cy, sz) => im && a.drawImage(im, cx - sz / 2, cy - sz / 2, sz, sz);
      fit(neu, 150, 92, 150); fit(fda, 800, 118, 196); fit(nct, 1450, 116, 230);
      a.textAlign = 'center'; a.fillStyle = '#fff'; a.font = '26px Helvetica,Arial,sans-serif'; a.fillText('Intro to AI', 150, 206);
      a.fillStyle = '#152847'; a.font = 'bold 72px "Times New Roman",Times,serif'; a.fillText('Introduction to Artificial Intelligence', 800, 430);
      a.fillStyle = '#000'; a.font = 'italic bold 42px "Times New Roman",Times,serif'; a.fillText('Pac-Man Pathfinding with A*', 800, 520);
      a.fillStyle = '#111'; a.font = '32px "Times New Roman",Times,serif';
      ['Do Thanh Chuong', 'Tran Quoc Hoang Cuong', 'Nguyen Hoang Hai', 'Hoang Trung Kien'].forEach((n, i) => a.fillText(n, 800, 612 + i * 50));
      a.font = 'italic 30px "Times New Roman",Times,serif'; a.fillStyle = '#152847'; a.fillText('Instructor: Trong-Nghia Nguyen', 800, 842);
      a.fillStyle = '#152847'; a.fillRect(330, 888, 940, 3); [330, 1270].forEach(px => { a.beginPath(); a.arc(px, 889.5, 7, 0, 7); a.fill(); });
      a.textAlign = 'right'; a.font = 'italic 28px "Times New Roman",Times,serif'; a.fillStyle = '#8a7f70'; a.fillText('2026-11', 1550, 962);
      A0 = A;
      sprites = [['pac', 'pac'], ['ghost', '#ff2d2d'], ['ghost', '#ffb8ff'], ['ghost', '#00f0ff'], ['ghost', '#ffb852']].map(([k, c]) => { const o = document.createElement('canvas'); G.icon(o, k, c); return o; });
    });

    // brick glitch: the PDF "world" is cut into 50px maze bricks; some flip into Pac-Man bricks, a click sweeps the whole wall away
    const BS = 50, CW = W / BS, CH = H / BS;
    const th = Array.from({ length: CW * CH }, (_, i) => (i % CW) / CW * 0.62 + Math.random() * 0.3);
    const brickPac = (cx, cy, kind) => {
      x.fillStyle = '#03051a'; x.fillRect(cx, cy, BS, BS);
      x.strokeStyle = '#2a3bff'; x.lineWidth = 4; x.strokeRect(cx + 3, cy + 3, BS - 6, BS - 6);
      x.lineWidth = 2; x.strokeRect(cx + 11, cy + 11, BS - 22, BS - 22);
      if (kind < 0.35) { x.fillStyle = '#ffb8ae'; x.fillRect(cx + 21, cy + 21, 8, 8); }
      else if (kind < 0.5 && sprites.length) { x.imageSmoothingEnabled = false; x.drawImage(pick(sprites), cx + 8, cy + 8, BS - 16, BS - 16); }
      else if (kind < 0.62) { x.fillStyle = '#ffe600'; x.fillRect(cx + 11, cy + 11, BS - 22, BS - 22); }
    };
    const cell = (c, r) => { x.drawImage(A0, c * BS * K, r * BS * K, BS * K, BS * K, c * BS, r * BS, BS, BS); };
    // u: 0..1 sweep progress (null = idle flicker only)
    // idle frames only repaint the bricks that glitched last time (same pixels, ~1000x fewer blits)
    let clean = false, dirty = [];
    function draw(u, hot) {
      x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'source-over'; x.scale(K, K);
      if (u === null && clean) {
        for (const [c, r] of dirty) for (let cc = Math.max(0, c - 1); cc <= Math.min(CW - 1, c + 1); cc++) cell(cc, r);
        dirty = [];
      } else {
        x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, cv.width, cv.height); x.scale(K, K);
        if (u === null) { x.drawImage(A0, 0, 0, W, H); clean = true; dirty = []; }
        else {
          clean = false;
          for (let r = 0; r < CH; r++) for (let c = 0; c < CW; c++) {
            const t = th[r * CW + c];
            if (u > t + 0.14) continue;                    // brick gone: the Pac-Man world shows through
            if (u > t) { brickPac(c * BS, r * BS, Math.random()); continue; } // brick flipping
            cell(c, r);
          }
        }
      }
      // idle: a few bricks flip, swap places or invert
      const n = u === null ? (hot ? 14 : 3) : 0;
      for (let i = 0; i < n; i++) {
        const c = (Math.random() * CW) | 0, r = (Math.random() * CH) | 0, m = Math.random(); dirty.push([c, r]);
        if (m < 0.45) brickPac(c * BS, r * BS, Math.random());
        else if (m < 0.8) { const sc = Math.max(0, Math.min(CW - 1, c + ((Math.random() * 7) | 0) - 3)); x.drawImage(A0, sc * BS * K, r * BS * K, BS * K, BS * K, c * BS + rnd(-10, 10), r * BS, BS, BS); }
        else { cell(c, r); x.globalCompositeOperation = 'difference'; x.fillStyle = '#fff'; x.fillRect(c * BS, r * BS, BS, BS); x.globalCompositeOperation = 'source-over'; }
      }
    }

    let mode = 'pdf', t0 = 0, nextBurst = 0, lastDraw = 0, burstFwd = true;
    const DUR = 1100;
    function burst(fwd) { mode = 'burst'; burstFwd = fwd; t0 = performance.now(); cv.style.display = ''; }
    function tick(t) {
      st.tick(t);
      if (!A0 || mode === 'off') return;
      if (mode === 'pdf') {
        if (t - lastDraw < 110) return; lastDraw = t;
        if (t > nextBurst) { nextBurst = t + rnd(1400, 2600); burstUntil = t + 260; }
        draw(null, t < burstUntil);
      } else {
        const u = Math.min(1, (t - t0) / DUR);
        if (t - lastDraw >= 50) { lastDraw = t; draw(burstFwd ? u : 1 - u); }
        if (u >= 1) { if (burstFwd) { mode = 'off'; cv.style.display = 'none'; } else { mode = 'pdf'; } }
      }
    }
    let burstUntil = 0;
    return {
      boards: [st.board], tick,
      enter() { mode = 'pdf'; cv.style.display = ''; enteredAt = performance.now(); lastN = -1; show(0); },
      leave() { spin(false); },
      build(n) {
        if (n >= 1 && mode !== 'off' && !(mode === 'burst' && burstFwd)) burst(true);
        else if (n === 0 && mode !== 'pdf' && !(mode === 'burst' && !burstFwd)) burst(false);
        show(n);
        // click while the arrow is cycling: it picks Chuong, flashes, then moves on to slide 2
        if (n === 2 && lastN === 1 && performance.now() - enteredAt > 80) setTimeout(() => { if (cur === slides.indexOf($('#s-title')) && build === 2) next(); }, 1400);
        lastN = n;
      },
    };
  });

  // 2 · hook
  lazy('s-hook', () => {
    const m = maze('hook'), pM = E.astar(m, 'mst').path, pS = E.astar(m, 'sum').path;
    const DP = { depth: true }, solo = new Board($('#hookSolo'), m, 4, DP), A = new Board($('#hookA'), m, 3, DP), B = new Board($('#hookB'), m, 3, DP);
    A.pac.hidden = true; const red = A.add('ghost', C.red);
    let run = 0, build2 = false;
    async function loop(my) {
      while (my === run) {
        solo.reset(); await sleep(600); if (my !== run) return;
        solo.line(solo.pathPts(pM), 'rgba(255,230,0,.25)', { style: 'dots', w: 2 });
        if (!(await solo.walk(solo.pac, pM, 150))) return;
        await sleep(1500);
      }
    }
    async function race(my) {
      A.reset(); B.reset(); $('#hookAn').textContent = 0; $('#hookBn').textContent = 0; $('#hookAb').textContent = ''; $('#hookBb').textContent = '';
      await sleep(500); if (my !== run) return;
      const ms = 120;
      A.line(A.pathPts(pS), 'rgba(255,45,45,.55)', { style: 'dots', dur: pS.length * ms });
      B.line(B.pathPts(pM), 'rgba(255,230,0,.5)', { style: 'dots', dur: pM.length * ms });
      A.walk(red, pS, ms, { onStep: k => { $('#hookAn').textContent = k; } }).then(ok => { if (ok) $('#hookAb').textContent = `+${pS.length - pM.length} WASTED`; });
      B.walk(B.pac, pM, ms, { onStep: k => { $('#hookBn').textContent = k; } }).then(ok => { if (ok) { $('#hookBb').innerHTML = '<span class="blink">OPTIMAL!</span>'; B.flash(); } });
    }
    return {
      get boards() { return build2 ? [A, B] : [solo]; },
      enter() {}, leave() { run++; [solo, A, B].forEach(b => b.stop()); },
      build(n) {
        const was = build2; build2 = n >= 2;
        if (n === 0 || (n === 1 && was)) { run++; loop(run); }
        if (n === 2) { run++; solo.stop(); race(run); }
      },
    };
  });

  // 3 · state
  lazy('s-state', () => {
    const m = maze('trap'), K = m.dots.length, path = E.bfs(m).path;
    const b = new Board($('#stateBoard'), m, 4, { tags: true });
    const mini = (el, dots) => {
      const mm = E.makeMaze(MAZES.trap.map((r, y) => [...r].map((ch, x) => {
        const i = y * 5 + x;
        if (i === 12) return 'P';
        if (ch === '.' || ch === 'P') return dots.includes(i) ? '.' : '-';
        return ch;
      }).join('')));
      return new Board(el, mm, 2);
    };
    const mA = mini($('#miniA'), [4, 9, 20]), mB = mini($('#miniB'), [20]);
    let run = 0, cur = 0;
    function bits(mask, hit) {
      const el = $('#stateBits');
      if (!el.children.length) el.innerHTML = Array.from({ length: K }, (_, j) => `<div class="mbit"><div class="cell"></div><span>d${K - 1 - j}</span></div>`).join('');
      $$('.cell', el).forEach((c, j) => {
        const k = K - 1 - j, on = (mask >> k) & 1;
        c.textContent = on; c.className = 'cell ' + (on ? 'one' : 'zero') + (k === hit ? ' hit' : '');
      });
    }
    async function count(my) {
      b.reset(); let n = 0;
      for (let i = 0; i < m.w * m.h; i++) {
        if (m.walls[i]) continue;
        await sleep(55); if (my !== run) return;
        b.labels.set(i, { s: String(++n), c: C.cyan, size: 5, dy: 4 });
      }
    }
    async function loop(my) {
      while (my === run) {
        b.reset(); bits(b.ALL); $('#stateEv').innerHTML = '';
        await sleep(700); if (my !== run) return;
        const ok = await b.walk(b.pac, path, 420, {
          onStep: (k, cell, ate) => {
            if (ate < 0) return;
            bits(b.mask, ate); popup('CHOMP!', tilePt(b, cell));
            $('#stateEv').innerHTML = `ATE d${ate} → mask &amp; ~(1&lt;&lt;${ate})<br><span class="w">mask = ${b.mask.toString(2).padStart(K, '0')}</span>`;
          },
        });
        if (!ok) return;
        await sleep(1600);
      }
    }
    const k = $('#kSlider');
    const upd = () => { const v = +k.value; $('#kLabel').textContent = 'k = ' + v; $('#kSup').textContent = v; countTo($('#stateCount'), 25 * Math.pow(2, v), 350); };
    k.addEventListener('input', upd); upd();
    return {
      get boards() { return cur === 1 ? [b, mA, mB] : [b]; },
      enter() { bits(b.ALL); },
      leave() { run++; b.stop(); },
      async build(n) {
        cur = n;
        if (n === 0) { run++; count(run); return; }
        if (n === 1) { run++; b.labels.clear(); loop(run); }
        if (n === 2) {
          $('#morphA').style.display = ''; $('#morphB').style.display = 'none';
          await sleep(900);
          $('#morphA').style.display = 'none'; const mb = $('#morphB'); mb.style.display = ''; mb.classList.remove('typed'); void mb.offsetWidth; mb.classList.add('typed');
        }
      },
    };
  });

  // 4 · trace
  const CODE = [
    '<span class="k">def</span> <span class="f">astar</span>(start, dots, h):',
    '    s = (start, ALL_DOTS)        <span class="cm"># mask 0b11…1</span>',
    '    g = {s: <span class="nu">0</span>}',
    '    open_ = [(h(s), h(s), <span class="nu">0</span>, s)] <span class="cm"># f,h,g,s</span>',
    '    <span class="k">while</span> open_:',
    '        f, _, gc, cur = <span class="f">heappop</span>(open_)',
    '        <span class="k">if</span> gc &gt; g[cur]: <span class="k">continue</span> <span class="cm"># stale</span>',
    '        pos, mask = cur',
    '        <span class="k">if</span> mask == <span class="nu">0</span>:',
    '            <span class="k">return</span> <span class="f">rebuild</span>(cur)',
    '        <span class="k">for</span> nxt <span class="k">in</span> <span class="f">neighbors</span>(pos):',
    '            m  = mask &amp; ~<span class="f">bit</span>(nxt)  <span class="cm"># eat</span>',
    '            ns = (nxt, m)',
    '            ng = gc + <span class="f">cost</span>(nxt)',
    '            <span class="k">if</span> ng &lt; g.<span class="f">get</span>(ns, INF):',
    '                g[ns] = ng; parent[ns] = cur',
    '                <span class="f">heappush</span>(open_, (ng+h(ns), h(ns), ng, ns))',
    '    <span class="k">return</span> <span class="k">None</span>',
  ];
  const FOCUS = { 1: [2, 8, 12, 13], 2: [4, 6, 17], 3: [7, 15] };
  // plain-words meaning of each code line, shown in the code header while it runs
  const TIP = ['', 'START STATE', 'COST SO FAR', 'OPEN LIST', 'LOOP', 'POP LOWEST F', 'OLD COPY? SKIP', 'UNPACK STATE', 'ALL DOTS EATEN?', 'DONE!',
    'TRY EACH MOVE', 'EAT THE DOT', 'NEW STATE', 'NEW G', 'CHEAPER?', 'SAVE IT', 'PUSH F = G + H', 'NO PATH'];
  function buildCode(el, lines, gutter) {
    lines.forEach((h, i) => el.insertAdjacentHTML('beforeend', `<div class="ln"><span class="no">${i + 1}</span>${gutter ? '<span class="gd"></span>' : ''}${h}</div>`));
    return $$('.ln', el);
  }

  lazy('s-trace', () => {
    const m = maze('trace'), K = m.dots.length, ALL = (1 << K) - 1;
    const EV = E.astar(m, 'sum', { trace: true }).trace;
    const lineEls = buildCode($('#tLines'), CODE, true), ipC = $('#tIP'), ipX = ipC.getContext('2d');
    const xyS = i => `${i % m.w},${i / m.w | 0}`, bin = v => v.toString(2).padStart(K, '0'), keyOf = (p, k) => p * (1 << K) + k;
    let S_, curLine = 0, ipTimer = 0, sayT = 0, playT = 0, typed = false, spd = 1; // spd: 1 or 2 (2X button)
    const b = new Board($('#traceBoard'), m, 4, {
      depth: true,
      extra(bd, t) { // open-list tiles: marching dashed outline + lowest f
        if (!S_ || S_.walking || S_.done) return;
        const best = new Map(); S_.open.forEach(o => { if (!best.has(o.pos) || best.get(o.pos) > o.f) best.set(o.pos, o.f); });
        best.forEach((f, i) => {
          const [a, y] = bd.tl(i), R = bd.R, x = bd.x;
          x.strokeStyle = C.pac; x.lineWidth = R; x.setLineDash([2 * R, 2 * R]); x.lineDashOffset = -t / 40;
          x.strokeRect((a + 1.5) * R, (y + 1.5) * R, 13 * R, 13 * R); x.setLineDash([]);
          bd.txt(a + 8, y + 12, String(f), C.pac, 4);
        });
      },
    });

    function setLine(n) {
      const prev = lineEls[curLine - 1];
      if (prev) { prev.classList.remove('on'); prev.classList.add('trail'); setTimeout(() => prev.classList.remove('trail'), 500); }
      curLine = n; const el = lineEls[n - 1]; if (!el) return;
      $('#tTip').innerHTML = TIP[n - 1] ? `› LINE ${n}: <b>${TIP[n - 1]}</b>` : '';
      el.classList.remove('trail'); void el.offsetWidth; el.classList.add('on');
      ipC.style.transform = `translateY(${(n - 1) * 32 + 2}px)`;
      const d = $('.gd', el); d.classList.remove('back'); d.classList.add('eaten');
      setTimeout(() => { d.classList.remove('eaten'); d.classList.add('back'); }, 30);
    }
    function runLines(seq, done) {
      clearTimeout(ipTimer); let k = 0;
      const go = () => { setLine(seq[k]); if (++k < seq.length) ipTimer = setTimeout(go, 85 / spd); else done && done(); };
      go();
    }
    function say(s) {
      clearInterval(sayT); const el = $('#tMsg'); let n = 0; el.textContent = '';
      sayT = setInterval(() => { n += LITE ? 6 : 2; el.textContent = s.slice(0, n); if (n >= s.length) clearInterval(sayT); }, LITE ? 40 : 16);
    }
    function setW(sel, html, hot) {
      const box = $(sel), old = box.querySelector('span.in, span:not(.out)');
      if (old && old.innerHTML === html) { box.classList.toggle('hot', !!hot); return; }
      if (old) { old.className = 'out'; setTimeout(() => old.remove(), 230); }
      box.insertAdjacentHTML('beforeend', `<span class="in">${html}</span>`);
      box.classList.toggle('hot', !!hot);
    }
    const miniBits = v => `<span class="bits">${Array.from({ length: K }, (_, i) => `<i class="${(v >> (K - 1 - i)) & 1 ? '' : 'x'}"></i>`).join('')}</span>`;
    const bitsHtml = v => `${miniBits(v)} <small style="font-size:13px;color:var(--dim)">${bin(v)}</small>`;

    const RANK = ['1ST', '2ND', '3RD', '4TH', '5TH', '6TH'], RC = [C.pac, C.orange, C.red, C.pink, C.cyan, C.green];
    function renderTable(list, total) {
      const box = $('#tRows'), s = scale();
      const before = LITE ? new Map() : new Map($$('.tr:not(.gone)', box).map(r => [r.dataset.k, r.getBoundingClientRect().top]));
      const keep = new Set(list.map(e => `${e.pos}|${e.mask}|${e.g}`));
      $$('.tr:not(.gone)', box).forEach(r => {
        if (!keep.has(r.dataset.k)) { const top = r.offsetTop; r.classList.add('gone'); r.style.top = top + 'px'; setTimeout(() => r.remove(), 360); }
      });
      list.forEach((e, k) => {
        const id = `${e.pos}|${e.mask}|${e.g}`;
        let r = box.querySelector(`.tr[data-k="${id}"]:not(.gone)`);
        if (!r) { r = document.createElement('div'); r.className = 'tr new'; r.dataset.k = id; }
        r.innerHTML = `<span class="r" style="color:${RC[k]}">${RANK[k]}</span><span class="w">${e.f}</span><span class="c">${e.h}</span><span class="o">${e.g}</span><span style="font-size:12px">(${xyS(e.pos)}) ${miniBits(e.mask)}</span>`;
        box.appendChild(r);
      });
      $$('.tr:not(.gone)', box).forEach(r => {
        const y0 = before.get(r.dataset.k); if (y0 == null) return;
        const dy = (y0 - r.getBoundingClientRect().top) / s; if (Math.abs(dy) < 1) return;
        r.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 300, easing: 'steps(6)' });
      });
      $('#tMore').textContent = total > list.length ? `+ ${total - list.length} MORE` : '';
    }
    const rowEl = e => $(`#tRows .tr[data-k="${e.pos}|${e.mask}|${e.g}"]:not(.gone)`);

    function reset() {
      clearTimeout(ipTimer); stopPlay();
      S_ = { i: -1, open: new Map(), walking: false, done: false };
      b.reset(); b.pac.v = .25;
      lineEls.forEach(l => l.classList.remove('on', 'trail')); curLine = 0; ipC.style.transform = 'translateY(-60px)';
      $('#tRows').innerHTML = ''; $('#tMore').textContent = ''; $('#tBanner').style.display = 'none'; $('#tExp').textContent = '0';
      ['#wPos', '#wMask', '#wG', '#wH', '#wF'].forEach(s => ($(s).innerHTML = '')); evt(0); $('#tTip').innerHTML = '';
      say('PAC-MAN MUST EAT ALL 3 DOTS. PRESS STEP TO RUN THE CODE ONE EVENT AT A TIME.');
    }
    function evt(n) { $('#tEvt').textContent = `${String(n).padStart(2, '0')}/${EV.length}`; $('#tEvBar').style.transform = `scaleX(${n / EV.length})`; }
    function step() {
      if (S_.walking || S_.done) return false;
      const e = EV[++S_.i]; if (!e) return false;
      evt(S_.i + 1);
      if (e.t === 'init') {
        runLines([1, 2, 3, 4]);
        S_.open.set(keyOf(e.pos, e.mask), { f: e.h, pos: e.pos });
        renderTable(e.open, S_.open.size);
        setW('#wPos', `(${xyS(e.pos)})`); setW('#wMask', bitsHtml(e.mask)); setW('#wG', '0'); setW('#wH', String(e.h), true); setW('#wF', String(e.h));
        say(`START: ALL 3 DOTS LEFT, MASK 111. H = SUM OF DISTANCES = ${e.h}. REMEMBER 13.`);
        popup('h = ' + e.h, tilePt(b, e.pos), C.cyan);
      } else if (e.t === 'pop' || e.t === 'stale') {
        const c = e.cur, r = $('#tRows .tr');
        if (r) fly(`f=${c.f}`, stagePt(r), tilePt(b, c.pos));
        if (e.t === 'stale') {
          runLines([5, 6, 7]); b.mark(c.pos, 'x');
          say(`POP (${xyS(c.pos)}) G=${c.g}... BUT A CHEAPER COPY WAS ALREADY USED. STALE, SKIP IT.`);
        } else {
          runLines([5, 6, 7, 8, 9]);
          const k = keyOf(c.pos, c.mask); if (S_.open.get(k) && S_.open.get(k).f === c.f) S_.open.delete(k);
          b.tints.set(c.pos, 'rgba(40,64,255,.45)'); b.mask = c.mask; b.aim(b.pac, c.pos);
          $('#tExp').textContent = e.expanded;
          setW('#wPos', `(${xyS(c.pos)})`); setW('#wMask', bitsHtml(c.mask)); setW('#wG', String(c.g)); setW('#wH', String(c.h)); setW('#wF', String(c.f), true);
          say(`POP THE LOWEST F: (${xyS(c.pos)}) WITH F = ${c.g} + ${c.h} = ${c.f}. EXPAND IT.`);
        }
        renderTable(e.open, S_.open.size);
      } else if (e.t === 'push') {
        runLines(e.ate ? [11, 12] : [11, 12, 13, 14, 15, 16, 17], e.ate ? () => { popup('CHOMP!', stagePt(lineEls[11])); setTimeout(() => runLines([13, 14, 15, 16, 17]), 380 / spd); } : null);
        const k = keyOf(e.pos, e.mask), prev = S_.open.get(k);
        if (!prev || prev.f > e.f) S_.open.set(k, { f: e.f, pos: e.pos });
        b.mark(e.pos, 'ring');
        setW('#wPos', `(${xyS(e.pos)})`); setW('#wMask', bitsHtml(e.mask), e.ate); setW('#wG', String(e.g)); setW('#wH', String(e.h)); setW('#wF', String(e.f), true);
        say(e.ate ? `STEP TO (${xyS(e.pos)}) EATS A DOT! MASK ${bin(b.mask)} -> ${bin(e.mask)}. F = ${e.g}+${e.h} = ${e.f}. PUSH.`
          : `TRY (${xyS(e.pos)}): G = ${e.g}, H = ${e.h}, F = ${e.f}. BEST SO FAR FOR THIS STATE: PUSH IT.`);
        renderTable(e.open, S_.open.size);
        const r = rowEl(e); fly(`f=${e.f}`, tilePt(b, e.pos), r ? stagePt(r) : stagePt($('#tMore')), e.ate ? 450 : 200);
      } else if (e.t === 'skip') {
        runLines([11, 12, 13, 14, 15]); b.mark(e.pos, 'x');
        setW('#wPos', `(${xyS(e.pos)})`); setW('#wG', String(e.g), true);
        say(`TRY (${xyS(e.pos)}): G = ${e.g}, BUT WE ALREADY REACHED IT FOR ${e.old}. NO GAIN. IGNORE.`);
      } else if (e.t === 'goal') {
        runLines([5, 6, 7, 8, 9, 10]); setW('#wMask', bitsHtml(0), true);
        say(`MASK == 0. EVERY DOT IS EATEN IN THIS STATE. COST ${e.cur.g}. NOW PAC-MAN WALKS IT FOR REAL.`);
        stopPlay(); S_.walking = true;
        setTimeout(async () => {
          if (!S_.walking) return;
          b.tints.clear(); b.mask = ALL; b.lines = [];
          b.line(b.pathPts(e.path), 'rgba(125,255,122,.7)', { style: 'dots', dur: e.path.length * 170 / spd });
          const ok = await b.walk(b.pac, e.path, 170 / spd, { onStep: (k, cell, ate) => ate >= 0 && popup('+1', tilePt(b, cell), C.dot) });
          if (!ok) return;
          S_.walking = false; S_.done = true; b.flash(); $('#tBanner').style.display = 'block';
          say('STAGE CLEAR. TRUE COST 10, BUT H GUESSED 13 AT THE START. H OVERESTIMATED.');
        }, 1200 / spd);
      }
      return true;
    }
    function stopPlay() { clearInterval(playT); playT = 0; $('#tPlayL').textContent = 'AUTO'; }
    $('#tStep').onclick = () => { stopPlay(); step(); };
    $('#tPlay').onclick = () => {
      if (playT) return stopPlay();
      if (S_.done) reset();
      $('#tPlayL').textContent = 'PAUSE'; step(); startTimer();
    };
    function startTimer() { clearInterval(playT); playT = setInterval(() => { if (!step()) stopPlay(); }, 760 / spd); }
    $('#tFast').onclick = () => { // 1X <-> 2X; keeps playing at the new speed
      spd = spd === 1 ? 2 : 1; $('#tFastL').textContent = spd + 'X SPEED'; $('#tFast').classList.toggle('on', spd === 2);
      if (playT) startTimer();
    };
    $('#tReset').onclick = reset;
    return {
      boards: [b],
      tick(t) { ipX.clearRect(0, 0, 13, 13); ipX.drawImage(G.pacFrame(0, t), 0, 0); },
      enter() {
        reset();
        if (!typed) { typed = true; lineEls.forEach((l, j) => { l.classList.add('typing'); setTimeout(() => { l.classList.remove('typing'); l.classList.add('typed'); }, 100 + j * 50); }); }
      },
      leave() { stopPlay(); clearTimeout(ipTimer); b.stop(); if (S_) S_.walking = false; },
      build(n) {
        if (n > 0) stopPlay();
        $('#tCode').classList.toggle('focus', n > 0);
        lineEls.forEach((l, j) => l.classList.toggle('f', (FOCUS[n] || []).includes(j + 1)));
      },
    };
  });

  // 5 · heuristic
  lazy('s-heur', () => {
    const rm = maze('row'), rb = new Board($('#rowBoard'), rm, 4);
    const tm = maze('trap'), ta = new Board($('#trapA'), tm, 3), tb = new Board($('#trapB'), tm, 3);
    ta.pac.hidden = true; const red = ta.add('ghost', C.red);
    const pa = E.astar(tm, 'sum').path, pb = E.astar(tm, 'mst').path;
    let run = 0, cur = 0;
    async function rowDemo(my) {
      rb.reset(); [1, 2, 3].forEach(k => ($('#hx' + k).style.visibility = 'hidden'));
      $('#hTrue').style.opacity = 0; $('#stamp').classList.remove('go');
      for (let k = 1; k <= 3; k++) {
        await sleep(500); if (my !== run) return;
        rb.line([rb.cpt(0), rb.cpt(k)].map(([x, y], j) => [x, y - 3 - k * 2 + (j ? 0 : 0)]), 'rgba(255,45,45,.9)', { style: 'dots', dur: 350 });
        rb.labels.set(k, { s: String(k), c: C.red, size: 5, dy: -5 });
        $('#hx' + k).style.visibility = '';
      }
      await sleep(800); if (my !== run) return;
      if (!(await rb.walk(rb.pac, [0, 1, 2, 3], 320))) return;
      $('#hTrue').style.opacity = 1;
      await sleep(500); if (my !== run) return;
      $('#stamp').classList.add('go');
    }
    async function trap(my) {
      ta.reset(); tb.reset(); $('#trapAn').textContent = 0; $('#trapBn').textContent = 0;
      await sleep(400); if (my !== run) return;
      ta.line(ta.pathPts(pa), 'rgba(255,45,45,.6)', { style: 'dots', dur: pa.length * 240 });
      tb.line(tb.pathPts(pb), 'rgba(255,230,0,.55)', { style: 'dots', dur: pb.length * 240 });
      ta.walk(red, pa, 240, { onStep: k => ($('#trapAn').textContent = k) });
      tb.walk(tb.pac, pb, 240, { onStep: k => ($('#trapBn').textContent = k) }).then(ok => ok && tb.flash());
    }
    $('#trapRun').onclick = () => { run++; trap(run); };
    return {
      get boards() { return cur >= 2 ? [rb, ta, tb] : [rb]; },
      enter() {}, leave() { run++; [rb, ta, tb].forEach(x => x.stop()); },
      build(n) { cur = n; if (n === 1) { run++; rowDemo(run); } if (n === 2) { trap(run); } },
    };
  });

  // 6 · MST
  lazy('s-mst', () => {
    const m = maze('race'), b = new Board($('#mstBoard'), m, 4);
    const ALL = b.ALL, rem = E.remaining(m, ALL);
    const near = Math.min(...rem.map(d => E.manhattan(m, m.start, d))), tree = E.mstWeight(m, rem);
    $('#mSum').textContent = E.H.sum(m, m.start, ALL); $('#mNear').textContent = near; $('#mTree').textContent = tree;
    $('#mMst').textContent = near + tree; $('#mOpt').textContent = E.bfs(m).cost;
    buildCode($('#mstCode'), [
      '<span class="k">def</span> <span class="f">h_mst</span>(pos, mask):',
      '    left = <span class="f">dots_in</span>(mask)',
      '    <span class="k">if not</span> left: <span class="k">return</span> <span class="nu">0</span>',
      '    near = <span class="f">min</span>(<span class="f">manhattan</span>(pos, d) <span class="k">for</span> d <span class="k">in</span> left)',
      '    <span class="k">return</span> near + <span class="f">prim_mst</span>(left)   <span class="cm"># k ≤ 10: µs</span>',
    ]);
    let run = 0;
    async function draw(my) {
      b.reset();
      rem.forEach(d => b.line(b.ell(m.start, d), 'rgba(255,45,45,.8)', { style: 'dots', dur: 500 }));
      await sleep(1500); if (my !== run) return;
      b.lines = [];
      for (const [a, c] of E.mstEdges(m, rem)) {
        b.line(b.ell(a, c), C.cyan, { w: 2, dur: 350 }); await sleep(380); if (my !== run) return;
      }
      const nd = rem.reduce((p, d) => (E.manhattan(m, m.start, d) < E.manhattan(m, m.start, p) ? d : p));
      b.line(b.ell(m.start, nd), C.pac, { w: 3, dur: 350 });
    }
    $('#mstRun').onclick = () => { run++; draw(run); };
    return { boards: [b], enter() { run++; draw(run); }, leave() { run++; b.stop(); }, build() {} };
  });

  // corridor route between two tiles (BFS), for drawing along real hallways
  function hall(m, a, c) {
    const prev = new Int32Array(m.w * m.h).fill(-1), q = [a]; prev[a] = a;
    for (let h = 0; h < q.length && prev[c] < 0; h++) for (const u of E.neighbors(m, q[h])) if (prev[u] < 0) { prev[u] = q[h]; q.push(u); }
    const out = []; for (let x = c; x !== a; x = prev[x]) out.push(x); out.push(a);
    return out.reverse();
  }
  // sprite for a search: Pac-Man (optionally faded), a ghost, or a frightened ghost
  function drawIcon(el, s) {
    el.width = 14; el.height = 14; const x = el.getContext('2d'); x.clearRect(0, 0, 14, 14);
    if (s.pac) { x.globalAlpha = s.alpha || 1; x.drawImage(G.PAC[0][2], 0.5, 0.5); } else x.drawImage(G.ghost(s.color, 2, 0, s.scared), 0, 0);
  }
  const rgbOf = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)).join(',');

  // 7 · relaxed problems
  lazy('s-relax', () => {
    const m = maze('relax'), b = new Board($('#relaxBoard'), m, 4), ALL = b.ALL, rem = E.remaining(m, ALL);
    const hstar = E.bfs(m).cost;
    const ROWS = [
      { b: 1, name: 'UCS', h: 'zero', c: '#6a74b8', rule: 'h = 0 · KNOWS NOTHING' },
      { b: 1, name: 'FARTHEST', h: 'far', c: C.orange, rule: 'ONLY THE FARTHEST DOT COUNTS' },
      { b: 1, name: 'MST', h: 'mst', c: C.cyan, rule: 'WALK THROUGH WALLS + JUMP BACK TO EATEN DOTS' },
      { b: 2, name: 'MAZE-MST', h: 'maze', c: C.green, rule: 'KEEP THE WALLS, STILL JUMP BACK' },
      { b: 3, name: 'Σ DIST', h: 'sum', c: C.red, rule: 'NOT A RELAXATION: SHARED STEPS COUNTED TWICE' },
    ].map(r => ({ ...r, v: E.H[r.h](m, m.start, ALL), x: r.h === 'zero' ? E.bestFirst(m, 'ucs') : E.bestFirst(m, 'astar', r.h) }));
    const top = Math.max(...ROWS.map(r => r.v)) * 1.1, pct = v => (100 * v / top).toFixed(1);
    const R = Object.fromEntries(ROWS.map(r => [r.h, r]));
    $('#rl1').textContent = R.mst.v; $('#rl2').textContent = hstar; $('#rl3').textContent = R.maze.v;
    $('#rl4').textContent = R.mst.x.expanded; $('#rl5').textContent = R.maze.x.expanded;
    $('#ladder').innerHTML = `<div class="hstar" data-build="1" style="left:calc(168px + (100% - 306px) * ${hstar / top})"><span>h* = ${hstar}</span></div>` +
      ROWS.map(r => `<div class="lad" data-build="${r.b}"><span style="color:${r.c}">${r.name}</span>
        <div class="tk" style="--c:${r.c}"><i data-w="${pct(r.v)}"></i><b style="left:${pct(r.v)}%">${r.v}</b></div>
        <span class="x">${fmt(r.x.expanded)}${r.x.cost > hstar ? ` <span class="r">+${r.x.cost - hstar}</span>` : ''}</span><span class="rule">${r.rule}</span></div>`).join('');
    // MST over true corridor distances (Prim), returned as pairs of dot cells
    function mazeEdges() {
      const dd = E.dotDist(m), K = m.dots.length, used = new Uint8Array(K), best = new Array(K).fill(E.INF), from = new Array(K).fill(-1), out = [];
      best[0] = 0;
      for (let it = 0; it < K; it++) {
        let j = -1; for (let k = 0; k < K; k++) if (!used[k] && (j < 0 || best[k] < best[j])) j = k;
        used[j] = 1; if (from[j] >= 0) out.push([m.dots[from[j]], m.dots[j]]);
        for (let k = 0; k < K; k++) if (!used[k] && dd[j][k] < best[k]) { best[k] = dd[j][k]; from[k] = j; }
      }
      return out;
    }
    let run = 0;
    async function draw(n, my) {
      b.reset();
      if (n === 0) { $('#relaxKey').innerHTML = `TRUE SHORTEST ROUTE FROM HERE: <span class="g">${hstar}</span> STEPS.<br><span class="d">WHICH h GETS CLOSEST WITHOUT GOING OVER?</span>`; return; }
      if (n === 1) {
        $('#relaxKey').innerHTML = '<span style="display:inline-block;width:28px;height:5px;vertical-align:middle;background:var(--cyan)"></span> <span class="c">MST</span> STRAIGHT THROUGH WALLS<br><span style="display:inline-block;width:28px;height:5px;vertical-align:middle;background:var(--pac)"></span> <span class="y">NEAREST DOT</span>';
        for (const [a, c] of E.mstEdges(m, rem)) { b.line(b.ell(a, c), C.cyan, { w: 2, dur: 350 }); await sleep(380); if (my !== run) return; }
        const nd = rem.reduce((p, d) => (E.manhattan(m, m.start, d) < E.manhattan(m, m.start, p) ? d : p));
        b.line(b.ell(m.start, nd), C.pac, { w: 3, dur: 350 });
        return;
      }
      $('#relaxKey').innerHTML = '<span style="display:inline-block;width:28px;height:5px;vertical-align:middle;background:var(--green)"></span> <span class="g">MST</span> ALONG REAL CORRIDORS<br><span style="display:inline-block;width:28px;height:5px;vertical-align:middle;background:var(--pac)"></span> <span class="y">NEAREST DOT</span> BY CORRIDOR';
      for (const [a, c] of mazeEdges()) { b.line(b.pathPts(hall(m, a, c)), C.green, { w: 2, dur: 450 }); await sleep(470); if (my !== run) return; }
      const T = E.toDots(m); let k0 = 0; T.forEach((t, k) => { if (t[m.start] < T[k0][m.start]) k0 = k; });
      b.line(b.pathPts(hall(m, m.start, m.dots[k0])), C.pac, { w: 3, dur: 400 });
    }
    return {
      boards: [b],
      enter() {}, leave() { run++; b.stop(); },
      build(n) {
        $$('#ladder .tk i').forEach((el, k) => (el.style.width = ROWS[k].b <= n ? el.dataset.w + '%' : '0'));
        if (n <= 2) { run++; draw(n, run); }
      },
    };
  });

  // 8 · arena: nine searches on a maze the audience draws
  lazy('s-arena', () => {
    const W = 9, Hh = 7, MAXD = 10, CAP = 2e5;
    const LINE = [
      { grp: 'BLIND', name: 'BFS', color: C.cyan, run: m => E.bfs(m) },
      { name: 'DFS', color: '#b06cff', run: m => E.dfs(m) },
      { name: 'UCS', color: C.green, run: m => E.bestFirst(m, 'ucs', 'zero', { cap: CAP }) },
      { grp: 'INFORMED', name: 'GREEDY', color: C.orange, run: m => E.bestFirst(m, 'gbfs', 'maze', { cap: CAP }) },
      { name: 'A* Σ', color: C.red, run: m => E.bestFirst(m, 'astar', 'sum', { cap: CAP }) },
      { name: 'A* MST', pac: true, alpha: .55, color: C.pac, run: m => E.bestFirst(m, 'astar', 'mst', { cap: CAP }) },
      { name: 'A* MAZE', pac: true, color: C.pac, run: m => E.bestFirst(m, 'astar', 'maze', { cap: CAP }) },
      { name: 'WA* ×2', color: '#ffffff', run: m => E.bestFirst(m, 'wastar', 'maze', { w: 2, cap: CAP }) },
      { name: 'IDA*', color: '#2121de', scared: true, run: m => E.idastar(m, 'maze', { cap: CAP }) },
    ];
    let walls, dots, start, m, b, res = [], sel = 6, tool = 'wall', run = 0, raf = 0, seed = 0;

    function load(rows) {
      walls = new Uint8Array(W * Hh); dots = new Set(); start = 0;
      rows.forEach((r, y) => [...r].forEach((c, x) => {
        const i = y * W + x;
        if (c === '#') walls[i] = 1; else if (c === '.') dots.add(i); else if (c === 'P') start = i;
      }));
    }
    function rows() {
      const out = [];
      for (let y = 0; y < Hh; y++) { let s = ''; for (let x = 0; x < W; x++) { const i = y * W + x; s += walls[i] ? '#' : i === start ? 'P' : dots.has(i) ? '.' : '-'; } out.push(s); }
      return out;
    }
    // walls are baked into a bitmap, so every edit gets a fresh Board
    function rebuild() {
      run++; cancelAnimationFrame(raf); if (b) b.stop();
      m = E.makeMaze(rows());
      b = new Board($('#edBoard'), m, 4, {
        under(bd) { // faint floor tiles so the audience sees where they can draw
          const x = bd.x, R = bd.R; x.fillStyle = 'rgba(42,59,255,.22)';
          for (let i = 0; i < m.w * m.h; i++) if (!m.walls[i]) { const [a, c] = bd.tl(i); x.fillRect((a + 7) * R, (c + 7) * R, 2 * R, 2 * R); }
        },
      });
      b.walkers = LINE.map(s => (s.pac ? null : b.add('ghost', s.color)));
      b.walkers.forEach((w, k) => { if (w) { w.hidden = true; w.scared = !!LINE[k].scared; } });
      const K = m.dots.length, open = m.walls.length - m.walls.reduce((a, c) => a + c, 0);
      $('#edInfo').innerHTML = `DOTS <span class="dt">${K}/${MAXD}</span> · STATES <span class="w">${open} × 2<sup style="font-size:9px">${K}</sup> = ${fmt(open * 2 ** K)}</span>`;
    }
    function solve() {
      res = LINE.map(s => s.run(m));
      const best = res[0].path ? res[0].cost : null, maxE = Math.max(...res.map(r => r.expanded), 1);
      $$('#lbRows .lr').forEach((row, k) => {
        const r = res[k], st = $('.stp', row);
        if (r.timeout) st.innerHTML = '<span class="r">GAVE UP</span>';
        else if (!r.path) st.innerHTML = '<span class="d">NO PATH</span>';
        else st.innerHTML = r.cost === best ? `<span class="w">${r.cost}</span> <span class="g"><i class="ck"></i></span>` : `<span class="w">${r.cost}</span> <span class="r">+${r.cost - best}</span>`;
        countTo($('.n', row), r.expanded, 500);
        $('.fill', row).style.width = (100 * Math.log10(r.expanded + 1) / Math.log10(maxE + 1)).toFixed(1) + '%';
        countTo($('.mem', row), r.mem, 500);
      });
    }
    // replay one search: heat map of expansions, then the walker follows its route
    async function play(k) {
      const my = ++run; cancelAnimationFrame(raf);
      b.reset(); b.pac.hidden = !LINE[k].pac; b.pac.alpha = LINE[k].alpha || 1;
      b.walkers.forEach((w, j) => { if (w) w.hidden = j !== k; });
      const r = res[k], walker = LINE[k].pac ? b.pac : b.walkers[k], rgb = rgbOf(LINE[k].color);
      const counts = new Map(); let maxC = 1; r.order.forEach(p => { const c = (counts.get(p) || 0) + 1; counts.set(p, c); maxC = Math.max(maxC, c); });
      const seen = new Map(), PER = Math.max(1, Math.ceil(r.order.length / 45));
      let f = 0;
      await new Promise(done => {
        const tick = () => {
          if (my !== run) return;
          const upto = Math.min(r.order.length, ++f * PER);
          for (let j = (f - 1) * PER; j < upto; j++) {
            const p = r.order[j], c = (seen.get(p) || 0) + 1; seen.set(p, c);
            b.tints.set(p, `rgba(${rgb},${(.12 + .55 * c / maxC).toFixed(2)})`);
          }
          if (upto < r.order.length) raf = requestAnimationFrame(tick); else done();
        };
        raf = requestAnimationFrame(tick);
      });
      if (my !== run || !r.path) return;
      const ms = Math.min(120, 4200 / r.path.length);
      b.line(b.pathPts(r.path), `rgba(${rgb},.7)`, { style: 'dots', dur: r.path.length * ms });
      if (await b.walk(walker, r.path, ms)) b.flash();
    }

    $('#lbRows').innerHTML = LINE.map((s, k) => `${s.grp ? `<div class="grp">${s.grp}</div>` : ''}
      <div class="lr${k === sel ? ' sel' : ''}" data-k="${k}"><canvas class="sp"></canvas><span style="color:${s.pac ? 'var(--pac)' : s.scared ? '#7d8bff' : s.color}">${s.name}</span>
      <span class="stp">–</span><span class="xb" style="--c:${s.scared ? '#7d8bff' : s.color}"><span class="n">0</span><span class="tk"><span class="fill"></span></span></span><span class="mem num">0</span></div>`).join('');
    $$('#lbRows .lr').forEach(row => {
      drawIcon($('canvas', row), LINE[+row.dataset.k]);
      row.onclick = () => { sel = +row.dataset.k; $$('#lbRows .lr').forEach(r => r.classList.toggle('sel', r === row)); play(sel); };
    });

    // drawing on the board: tap or drag
    const cv = $('#edBoard');
    let painting = null;
    function tileAt(e) {
      const r = cv.getBoundingClientRect(), lx = (e.clientX - r.left) / r.width * (W + 2), ly = (e.clientY - r.top) / r.height * (Hh + 2);
      const x = Math.floor(lx) - 1, y = Math.floor(ly) - 1;
      return x < 0 || y < 0 || x >= W || y >= Hh ? -1 : y * W + x;
    }
    function apply(i) {
      if (i < 0) return false;
      if (tool === 'pac') { if (start === i) return false; walls[i] = 0; dots.delete(i); start = i; return true; }
      if (i === start) return false;
      if (tool === 'wall') {
        if (painting.v == null) painting.v = walls[i] ? 0 : 1;
        if (walls[i] === painting.v) return false;
        walls[i] = painting.v; if (painting.v) dots.delete(i); return true;
      }
      if (painting.v == null) painting.v = dots.has(i) ? 0 : 1;
      if (painting.v ? dots.has(i) || dots.size >= MAXD : !dots.has(i)) return false;
      walls[i] = 0; painting.v ? dots.add(i) : dots.delete(i); return true;
    }
    cv.addEventListener('pointerdown', e => {
      e.preventDefault(); cv.setPointerCapture(e.pointerId);
      painting = { v: null, last: tileAt(e), changed: false };
      if (apply(painting.last)) { painting.changed = true; rebuild(); }
    });
    cv.addEventListener('pointermove', e => {
      if (!painting || tool === 'pac') return;
      const i = tileAt(e); if (i === painting.last) return; painting.last = i;
      if (apply(i)) { painting.changed = true; rebuild(); }
    });
    const finish = () => { if (painting && painting.changed) { solve(); play(sel); } painting = null; };
    cv.addEventListener('pointerup', finish); cv.addEventListener('pointercancel', finish);

    $$('#edTool button').forEach(bt => (bt.onclick = () => { tool = bt.dataset.t; $$('#edTool button').forEach(x => x.classList.toggle('on', x === bt)); }));
    $('#edClear').onclick = () => { walls.fill(0); dots.clear(); rebuild(); solve(); play(sel); };
    $('#edRand').onclick = () => {
      let mm; const rand = E.rng(500 + ++seed);
      do { mm = E.randomMaze(rand, W, Hh, 7, 0.24); } while (!E.bfs(mm).path);
      walls = mm.walls; dots = new Set(mm.dots); start = mm.start; rebuild(); solve(); play(sel);
    };

    load(MAZES.arena); rebuild();
    // QR for https://pacmanchuong.vercel.app/#play (29×29, level M; rows base-36)
    const QR = ['8twz9b','4j5etd','6gql3x','6gzh3x','6ggz8d','4ivk8x','8tz2pr','134e8','6cx557','4bhpm9','4kfls6','5z9asx','7w3nyk','47m53b','n85vb','16bdn6','539qyi','3naazy','5ww4ac','1fxxic','2ftiik','nllr','8ubzoa','4jdf6j','6goohg','6h6y7t','6h01et','4ituxm','8u5elm'];
    { const q = $('#qrC'), x = q.getContext('2d'); q.width = q.height = 29; x.fillStyle = '#000';
      QR.forEach((r, y) => [...parseInt(r, 36).toString(2).padStart(29, '0')].forEach((c, k) => c === '1' && x.fillRect(k, y, 1, 1))); }
    return {
      get boards() { return [b]; },
      enter() { solve(); play(sel); }, leave() { run++; cancelAnimationFrame(raf); b.stop(); }, build() {},
    };
  });

  // 8 · trials: the board replays every maze as it is solved (slow, then a blur), the mosaic keeps the score
  lazy('s-trials', () => {
    const CFG = [[5, 5, 3, 3], [5, 5, 5, 3], [7, 7, 6, 2]]; // w, h, dots, pixel scale of the live board
    const SLOW = 1, MED = 6, MS_SLOW = 2600, MS_MED = 450, RATE = 70; // first maze in full, next few quick, then RATE mazes / s
    const mo = $('#mosaic'); mo.innerHTML = '<i></i>'.repeat(500);
    const cells = $$('i', mo), cv = $('#tBoard'), verdict = $('#tVerdict');
    let cfg = 1, raf = 0, bd = null, t = null, sel = -1, running = false;
    const pad = n => String(n).padStart(4, '0');
    function setCfg() { // a fresh Board per size; the maze is swapped in place per trial
      const [w, h, k, R] = CFG[cfg], m = E.makeMaze(Array.from({ length: h }, (_, y) => (y ? '.'.repeat(w) : '-' + '.'.repeat(w - 1))));
      bd = new Board(cv, m, R); bd.pac.hidden = false;
    }
    function show(i, ms) { // draw trial i: red = Σ path, yellow dots = optimal; ms > 0 animates the lines in
      const e = t.log[i], m = e.m;
      Object.assign(bd, { m, K: m.dots.length, ALL: (1 << m.dots.length) - 1 });
      bd.wallB = bd.wallW = G.wallBitmap(m, C.wall); bd.reset();
      bd.lines = [bd.line(bd.pathPts(e.aPath), C.red, { w: 3, dur: ms * .45 })];
      if (ms) setTimeout(() => { if (bd.m === m) bd.lines.push(bd.line(bd.pathPts(e.bPath), C.pac, { w: 2, style: 'dots', dur: ms * .35 })); }, ms * .45);
      else bd.lines.push(bd.line(bd.pathPts(e.bPath), C.pac, { w: 2, style: 'dots' }));
      $('#tCur').textContent = pad(i + 1);
      verdict.innerHTML = e.extra > 0 ? `<span class="r">Σ ${e.aCost}</span> · <span class="y">BEST ${e.bCost}</span> · <span class="r">+${e.extra}</span>` : `<span class="g">BOTH ${e.bCost} ✓</span>`;
    }
    function stats() {
      const n = t.n; $('#tN').textContent = n;
      $('#tPct').textContent = Math.round(100 * t.subopt / n);
      $('#tExtra').textContent = '+' + (t.subopt ? (t.extra / t.subopt).toFixed(1) : 0);
      $('#tWorst').textContent = '+' + t.worst;
      $('#tMst').textContent = `${n - t.mstSubopt} / ${n}`;
      const avg = [t.exp.bfs / n, t.exp.sum / n, t.exp.mst / n, t.exp.maze / n];
      avg.forEach((v, j) => { $('#tB' + j).textContent = fmt(v); $('#tBar' + j).style.transform = `scaleX(${Math.max(.01, v / avg[0])})`; });
    }
    function paint(from, to) { for (let j = from; j < to; j++) cells[j].className = (t.log[j].extra > 0 ? 'bad' : 'ok') + ' new'; }
    function run() {
      cancelAnimationFrame(raf); cells.forEach(c => (c.className = '')); sel = -1; running = true; $('#trialSkip').style.visibility = '';
      setCfg(); const [w, h, k] = CFG[cfg]; t = E.trialRunner(2026, w, h, k, 0.2);
      let t0 = performance.now(), fast0 = 0, lastShow = 0;
      const tick = now => {
        const from = t.n; let upto;
        if (from < SLOW) upto = 1;
        else if (from < MED) upto = now - t0 > MS_SLOW + (from - SLOW) * MS_MED ? from + 1 : from; // one at a time
        else { if (!fast0) fast0 = now; upto = Math.min(500, MED + Math.floor((now - fast0) * RATE / 1000)); }
        if (upto > from) {
          t.run(upto - from); paint(from, t.n);
          // lite: in the fast blur, redraw the board / numbers ~5x a second instead of every frame
          if (!LITE || t.n <= MED || now - lastShow > 200 || t.n >= 500) { lastShow = now; stats(); show(t.n - 1, t.n <= SLOW ? MS_SLOW : t.n <= MED ? MS_MED : 0); }
        }
        if (t.n < 500) raf = requestAnimationFrame(tick); else finish();
      };
      raf = requestAnimationFrame(tick);
    }
    function finish() { running = false; $('#trialSkip').style.visibility = 'hidden'; pick(t.log.reduce((bi, e, i) => (e.extra > t.log[bi].extra ? i : bi), 0)); } // end on the worst maze
    function skip() { // solve the rest at once (same seed, same numbers), then land on the worst maze
      if (!running || !t) return;
      cancelAnimationFrame(raf); const from = t.n; t.run(500 - from); paint(from, t.n); stats(); finish();
    }
    function pick(i) {
      if (running || !t || i >= t.n) return;
      if (sel >= 0) cells[sel].classList.remove('sel');
      sel = i; cells[i].classList.add('sel'); show(i, 900);
    }
    cells.forEach((c, i) => (c.onclick = () => pick(i)));
    $$('#trialSeg button').forEach(bt => (bt.onclick = () => {
      cfg = +bt.dataset.cfg; $$('#trialSeg button').forEach(x => x.classList.toggle('on', x === bt)); run();
    }));
    $('#trialGo').onclick = run; $('#trialSkip').onclick = skip;
    return { get boards() { return bd ? [bd] : []; }, enter: run, leave() { cancelAnimationFrame(raf); running = false; }, build() {} };
  });

  // 10 · trade-off map: time vs memory vs quality
  lazy('s-trade', () => {
    // averages over 300 random 9×7 mazes with 8 dots, seed 2026 (engine.js FAMILY)
    const D = [
      { n: 'BFS', e: 6263, m: 6941, ok: 300, color: C.cyan, b: 0, ox: 0, oy: 22, t: 'LEVEL BY LEVEL. OPTIMAL WHEN EVERY STEP COSTS 1, BUT TOUCHES EVERYTHING CLOSER THAN THE GOAL.' },
      { n: 'UCS', e: 6263, m: 7622, ok: 300, color: C.green, b: 0, ox: 0, oy: -22, t: 'DIJKSTRA = A* WITH h = 0. OPTIMAL WITH ANY COSTS. HERE: SAME WORK AS BFS, PLUS A HEAP.' },
      { n: 'DFS', e: 161, m: 257, ok: 0, color: '#b06cff', b: 0, ox: 0, oy: 0, t: 'DIVES DEEP. FINDS *A* ROUTE FAST, NEVER THE SHORTEST: 0 / 300.' },
      { n: 'A* Σ', e: 138, m: 313, ok: 6, color: C.red, b: 1, ox: -22, oy: 0, t: 'SAME WORK AS MST, BUT THE WRONG ANSWER 98% OF THE TIME. OVERESTIMATING BOUGHT NOTHING.' },
      { n: 'A* MST', e: 142, m: 314, ok: 300, pac: true, alpha: .55, b: 1, ox: 22, oy: 0, t: 'OPTIMAL 300 / 300 WITH 44× FEWER STATES THAN BFS.' },
      { n: 'A* MAZE', e: 48, m: 149, ok: 300, pac: true, b: 1, ox: 0, oy: 0, t: 'OPTIMAL 300 / 300. 130× FEWER STATES THAN BFS, 3× FEWER THAN MST.' },
      { n: 'GREEDY', e: 30, m: 106, ok: 198, color: C.orange, b: 2, ox: -22, oy: 0, t: 'f = h. IGNORES WHAT IT ALREADY PAID. FASTEST, BUT ONLY 198 / 300 SHORTEST. NO GUARANTEE.' },
      { n: 'WA* ×2', e: 31, m: 108, ok: 239, color: '#ffffff', b: 2, ox: 22, oy: 0, t: 'f = g + 2h. GUARANTEED ≤ 2× OPTIMAL. IN PRACTICE 239 / 300 EXACT WITH 36% LESS WORK THAN A*.' },
      { n: 'IDA*', e: 528, m: 25, ok: 300, color: '#2121de', scared: true, b: 2, ox: 0, oy: 0, t: 'DEPTH-FIRST UNDER A GROWING f LIMIT. REMEMBERS ONLY ITS PATH: 25 STATES. PAYS 11× THE WORK.' },
    ];
    const INTRO = [
      ['BLIND SEARCH', 'c', 'NO h. BFS AND UCS ARE OPTIMAL BUT HUGE. DFS IS SMALL BUT WRONG.'],
      ['SAME A*, DIFFERENT h', 'y', 'THE HEURISTIC MOVES YOU DOWN AND LEFT. Σ GOT THERE BY CHEATING.'],
      ['BREAK A RULE ON PURPOSE', 'p', 'GIVE UP SOME QUALITY FOR SPEED, OR SOME SPEED FOR MEMORY.'],
    ];
    const cv = $('#tradeMap'), W = 968, H = 724, DPR = 2, x = cv.getContext('2d');
    cv.width = W * DPR; cv.height = H * DPR; cv.style.width = W + 'px'; cv.style.height = H + 'px';
    const L = 120, Rr = 930, T = 50, B = 640, lo = 1.2, hi = 4.05;
    const px = v => L + (Math.log10(v) - lo) / (hi - lo) * (Rr - L), py = v => B - (Math.log10(v) - lo) / (hi - lo) * (B - T);
    let cur = 0, sel = -1;
    const font = s => `${s}px 'Press Start 2P'`;
    // place every label once (fixed across builds): try right, left, above, below, then further out, avoiding sprites and other labels
    const pos = D.map(d => [px(d.e) + d.ox, py(d.m) + d.oy]);
    const boxes = pos.map(([cx, cy]) => [cx - 22, cy - 22, 44, 44]);
    boxes.push([L + 10, B - 32, 150, 28], [Rr - 250, T + 4, 140, 28]); // corner captions
    const hit = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
    D.forEach((d, k) => {
      const [cx, cy] = pos[k], w = Math.max(d.n.length * 13, 160) + 6, h = 32;
      const cand = [];
      for (const r of [0, 1, 2, 3]) cand.push([cx + 28 + r * 10, cy - 16 - r * 18], [cx - 28 - w - r * 10, cy - 16 - r * 18], [cx + 28 + r * 10, cy - 16 + r * 18], [cx - 28 - w - r * 10, cy - 16 + r * 18], [cx - w / 2, cy - 60 - r * 20], [cx - w / 2, cy + 28 + r * 20]);
      const ok = c => c[0] > L + 6 && c[0] + w < W - 4 && c[1] > T - 10 && c[1] + h < B - 4 && !boxes.some(b => hit([c[0], c[1], w, h], b));
      const c = cand.find(ok) || cand[0];
      d.lab = [c[0], c[1], w, h]; boxes.push(d.lab);
    });
    function card() {
      const [h, c, p] = INTRO[cur];
      const items = D.map((d, k) => [d, k]).filter(([d]) => d.b === cur);
      $('#tradeCard').innerHTML = `<h3 class="${c}">${h}</h3><p>${p}</p>` +
        items.map(([d, k]) => `<p style="${sel === k ? 'background:rgba(255,230,0,.12);outline:2px solid var(--pac);outline-offset:6px' : ''}"><span style="color:${d.pac ? 'var(--pac)' : d.scared ? '#7d8bff' : d.color}">${d.n}</span> · ${d.t}</p>`).join('') +
        '<div class="t13 d lh" style="position:absolute;left:30px;bottom:26px">300 RANDOM 9×7 MAZES · 8 DOTS<br>SEED 2026 · TAP A SPRITE</div>';
    }
    function tick(t) {
      x.setTransform(DPR, 0, 0, DPR, 0, 0); x.clearRect(0, 0, W, H); x.imageSmoothingEnabled = false;
      x.textBaseline = 'middle';
      // grid
      for (const v of [10, 100, 1000, 10000]) {
        x.fillStyle = '#1b2470';
        for (let s = T; s < B; s += 8) x.fillRect(px(v), s, 2, 4);
        for (let s = L; s < Rr; s += 8) x.fillRect(s, py(v), 4, 2);
        x.fillStyle = '#6a74b8'; x.font = font(11); x.textAlign = 'center'; x.fillText(fmt(v), px(v), B + 22);
        x.textAlign = 'right'; x.fillText(fmt(v), L - 14, py(v));
      }
      x.fillStyle = '#2a3bff'; x.fillRect(L, B, Rr - L, 3); x.fillRect(L, T, 3, B - T);
      x.font = font(12); x.fillStyle = '#dfe6ff'; x.textAlign = 'right'; x.fillText('TIME: STATES EXPANDED', Rr, B + 56);
      x.textAlign = 'left'; x.fillText('MEMORY: MOST STATES HELD AT ONCE', L, T - 30);
      x.font = font(11); x.fillStyle = '#7dff7a'; x.fillText('FAST + SMALL', L + 16, B - 18);
      x.fillStyle = '#ff2d2d'; x.textAlign = 'right'; x.fillText('SLOW + HUGE', Rr - 110, T + 18);
      D.forEach((d, k) => {
        if (d.b > cur) return;
        const [cx, cy] = pos[k], fresh = d.b === cur;
        if (d.ox || d.oy) { x.fillStyle = '#6a74b8'; x.fillRect(px(d.e) - 3, py(d.m) - 3, 6, 6); }
        const spr = d.pac ? G.PAC[0][2] : G.ghost(d.color, 2, t, d.scared);
        x.globalAlpha = d.alpha || 1; x.drawImage(spr, cx - 21, cy - 21, 42, 42); x.globalAlpha = 1;
        if (k === sel && Math.floor(t / 250) % 2) { x.strokeStyle = C.pac; x.lineWidth = 3; x.strokeRect(cx - 28, cy - 28, 56, 56); }
        const [lx, ly] = d.lab; x.textAlign = 'left';
        x.font = font(13); x.fillStyle = d.pac ? C.pac : d.scared ? '#7d8bff' : d.color; x.globalAlpha = fresh ? 1 : .55;
        x.fillText(d.n, lx + 3, ly + 8);
        x.font = font(10); x.fillStyle = d.ok === 300 ? C.green : C.red; x.fillText(`${d.ok}/300 SHORTEST`, lx + 3, ly + 26);
        x.globalAlpha = 1;
      });
    }
    cv.addEventListener('pointerup', e => {
      const r = cv.getBoundingClientRect(), mx = (e.clientX - r.left) / r.width * W, my = (e.clientY - r.top) / r.height * H;
      let best = -1, bd = 60;
      D.forEach((d, k) => { if (d.b > cur) return; const dd = Math.hypot(pos[k][0] - mx, pos[k][1] - my); if (dd < bd) { bd = dd; best = k; } });
      if (best >= 0) { sel = best; if (D[best].b !== cur) { /* older group: show its card */ } card(); }
    });
    return { boards: [], tick, enter() {}, leave() {}, build(n) { cur = n; sel = -1; card(); } };
  });

  // 11 · it's a TSP
  lazy('s-tsp', () => {
    const m = maze('hook'), b = new Board($('#tspBoard'), m, 4), r = E.astar(m, 'maze');
    const order = []; { let mask = b.ALL; r.path.forEach(c => { const k = m.dots.indexOf(c); if (k >= 0 && (mask >> k) & 1) { mask &= ~(1 << k); order.push(c); } }); }
    buildCode($('#hkCode'), [
      '<span class="k">def</span> <span class="f">held_karp</span>(d, k):   <span class="cm"># d = corridor dist</span>',
      '    B = {(<span class="nu">1</span>&lt;&lt;i, i): d[P][i] <span class="k">for</span> i <span class="k">in</span> <span class="f">range</span>(k)}',
      '    <span class="k">for</span> S <span class="k">in</span> <span class="f">range</span>(<span class="nu">1</span>, <span class="nu">1</span>&lt;&lt;k):   <span class="cm"># dot sets</span>',
      '        <span class="k">for</span> j <span class="k">in</span> <span class="f">bits</span>(S):      <span class="cm"># last dot</span>',
      '            R = S &amp; ~(<span class="nu">1</span>&lt;&lt;j)',
      '            <span class="k">for</span> i <span class="k">in</span> <span class="f">bits</span>(R):',
      '                c = B[R, i] + d[i][j]',
      '                B[S, j] = <span class="f">min</span>(B.<span class="f">get</span>((S, j), INF), c)',
      '    <span class="k">return</span> <span class="f">min</span>(B[ALL, j] <span class="k">for</span> j <span class="k">in</span> <span class="f">range</span>(k))',
    ]);
    const X = '<i class="xx"></i>', COLS = [10, 14, 18, 24, 40, 60];
    const ROWS = [['BFS', 'c', ['34 MS', '1.2 S', X, X, X, X]], ['HELD-KARP', 'o', ['2 MS', '9 MS', '0.2 S', X, X, X]], ['A* MAZE', 'y', ['1 MS', '5 MS', '5 MS', '10 MS', '0.2 S', X]]];
    $('#wallTable').innerHTML = '<span class="hd">DOTS</span>' + COLS.map(c => `<span class="hd">${c}</span>`).join('') +
      ROWS.map(([n, c, v]) => `<span class="nm ${c}">${n}</span>` + v.map(s => `<span class="${s === X ? 'no' : 'ok'}">${s}</span>`).join('')).join('');
    let run = 0;
    async function show(my) {
      b.reset(); b.labels.clear();
      $('#tspOrder').innerHTML = `ORDER: ${order.map((c, k) => `<span class="y">${k + 1}</span>`).join(' → ')} · <span class="g">${r.cost} STEPS</span>`;
      await sleep(300); if (my !== run) return;
      b.line(b.pathPts(r.path), 'rgba(255,230,0,.45)', { style: 'dots', dur: r.path.length * 90 });
      await b.walk(b.pac, r.path, 90, { onStep: (k, cell, ate) => { if (ate >= 0) b.labels.set(cell, { s: String(order.indexOf(cell) + 1), c: '#fff', size: 7, dy: 0 }); } });
    }
    return { boards: [b], enter() { run++; show(run); }, leave() { run++; b.stop(); }, build() {} };
  });

  // 12 · 220 dots: from searching states to searching routes
  lazy('s-tour', () => {
    const m = E.makeMaze(E.ARCADE), TM = E.tourMatrix(m);
    // same seeds as the offline measurements: random 4,186 · greedy 309 · 2-opt 293 · annealing 256
    const RND = E.randomTour(TM, E.rng(7)), GR = E.greedyTour(TM), HC = E.twoOpt(TM, GR);
    const SA_OPTS = { T0: 3, steps: 2e6 }, PER_FRAME = 7000;
    let tour = null, run = 0, raf = 0, sa = null, spark = [];
    const b = new Board($('#tourBoard'), m, 2, { under: drawTour });

    function drawTour(bd, t) {
      if (!tour) return;
      const x = bd.x, R = bd.R, o = tour.ord, n = o.length;
      const p = tour.dur ? Math.min(1, (t - tour.t0) / tour.dur) : 1, upto = Math.max(1, Math.floor(p * (n - 1)));
      x.strokeStyle = typeof tour.color === 'function' ? tour.color() : tour.color; x.lineWidth = R; x.lineJoin = 'round';
      x.globalAlpha = tour.alpha == null ? .85 : tour.alpha;
      x.beginPath();
      for (let i = 0; i <= upto; i++) { const [cx, cy] = bd.cpt(TM.pts[o[i]]); i ? x.lineTo(cx * R, cy * R) : x.moveTo(cx * R, cy * R); }
      x.stroke(); x.globalAlpha = 1;
    }
    const show = (ord, color, dur = 1200) => { tour = { ord, color, t0: performance.now(), dur }; };

    function sparkDraw() {
      const c = $('#saSpark'); c.width = 256; c.height = 75; const x = c.getContext('2d');
      x.fillStyle = '#0b0f33'; x.fillRect(0, 0, 256, 75);
      const lo = 240, hi = 420, yv = v => Math.round(74 - (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo) * 72);
      x.fillStyle = 'rgba(125,255,122,.5)'; x.fillRect(0, yv(256), 256, 1);
      x.fillStyle = C.pink;
      spark.forEach((v, i) => x.fillRect(Math.round(i / (SA_OPTS.steps / PER_FRAME) * 255), yv(v), 2, 2));
    }
    function anneal() {
      const my = ++run; cancelAnimationFrame(raf);
      sa = E.annealer(TM, RND, E.rng(4), SA_OPTS); spark = [];
      const heat = () => Math.log(sa.T / .05) / Math.log(3 / .05);
      tour = { ord: sa.ord, color: () => { const u = heat(); return `rgb(255,${Math.round(230 - 120 * u)},${Math.round(255 * (1 - u))})`; }, dur: 0 };
      const tick = () => {
        if (my !== run) return;
        sa.step(PER_FRAME); spark.push(sa.len);
        $('#lenS').textContent = fmt(sa.len); $('#saT').textContent = sa.T.toFixed(2);
        $('#saG').style.width = (100 * heat()).toFixed(1) + '%';
        $('#saW').textContent = fmt(sa.accWorse); sparkDraw();
        if (sa.done < sa.steps) { raf = requestAnimationFrame(tick); return; }
        $('#lenS').innerHTML = `${fmt(sa.bestLen)} <span class="g"><i class="ck"></i></span>`;
        walkIt(my);
      };
      raf = requestAnimationFrame(tick);
    }
    async function walkIt(my) {
      tour = { ord: sa.best, color: C.pink, dur: 0, alpha: .55 };
      await sleep(500); if (my !== run) return;
      b.reset(); tour = { ord: sa.best, color: C.pink, dur: 0, alpha: .3 };
      if (await b.walk(b.pac, E.tourPath(m, TM, sa.best), 26)) b.flash();
    }
    (function numberLine() {
      const X = v => ((v - 210) / (320 - 210) * 100).toFixed(2) + '%';
      const P = [[220, 'dim', 'd', '1 DOT/STEP', 1], [226, 'green', 'g', 'A* PROOF', 0], [256, 'pink', 'p', 'ANNEALING', 1], [293, 'cyan', 'c', 'HILL CLIMB', 0], [309, 'orange', 'o', 'GREEDY', 1]];
      $('#nl').innerHTML = `<div class="ax"></div><div class="zone" style="left:${X(226)};width:calc(${X(256)} - ${X(226)})"></div>` +
        P.map(([v, col, c, s, below]) => `<div class="tk" style="left:${X(v)};background:var(--${col})"></div>
          <div class="lab ${c}" style="left:${X(v)};top:${below ? 88 : 0}px">${below ? `<span class="w">${v}</span><br>${s}` : `${s}<br><span class="w">${v}</span>`}</div>`).join('');
    })();

    return {
      boards: [b],
      enter() {}, leave() { run++; cancelAnimationFrame(raf); b.stop(); },
      build(n) {
        if (n < 4) { run++; cancelAnimationFrame(raf); b.reset(); $('#lenS').textContent = '–'; }
        if (n < 3) $('#stuck').textContent = '';
        if (n === 0) tour = null;
        if (n === 1) { show(RND, C.red, 1500); countTo($('#lenR'), E.tourLen(TM, RND), 1500); }
        if (n === 2) { show(GR, C.orange); countTo($('#lenG'), E.tourLen(TM, GR)); }
        if (n === 3) { show(HC, C.cyan); countTo($('#lenH'), E.tourLen(TM, HC)); setTimeout(() => { if (tour && tour.ord === HC) $('#stuck').textContent = 'STUCK: NO SINGLE SWAP HELPS'; }, 900); }
        if (n === 4) anneal();
      },
    };
  });

  // 9 · ghosts
  lazy('s-ghost', () => {
    const m = maze('ghost'), b = new Board($('#ghostBoard'), m, 4, { ghostAt: 37 });
    const bfsG = b.add('ghost', C.cyan, .9), rb = E.bfs(m), ra = E.astar(m, 'mst');
    let run = 0;
    function zero() { ['#gB', '#gBc', '#gA', '#gAc'].forEach(s => ($(s).textContent = 0)); }
    async function go(my) {
      b.reset(); zero();
      await sleep(300); if (my !== run) return;
      b.line(b.pathPts(rb.path), 'rgba(0,240,255,.6)', { style: 'dots', dur: rb.path.length * 210 });
      b.line(b.pathPts(ra.path), 'rgba(255,230,0,.6)', { style: 'dots', dur: ra.path.length * 210 });
      let cb = 0, ca = 0;
      b.walk(bfsG, rb.path, 210, { eat: false, onStep: (k, cell) => {
        cb += m.cost[cell]; $('#gB').textContent = k; $('#gBc').textContent = cb;
        if (m.cost[cell] > 1) popup('+10', tilePt(b, cell), C.red);
      } });
      b.walk(b.pac, ra.path, 210, { onStep: (k, cell) => { ca += m.cost[cell]; $('#gA').textContent = k; $('#gAc').textContent = ca; } });
    }
    $('#ghostRun').onclick = () => { run++; go(run); };
    return {
      boards: [b],
      enter() { b.reset(); zero(); }, leave() { run++; b.stop(); },
      build(n) { if (n === 1) { run++; go(run); } },
    };
  });

  // ---------- game trees: ▲ MAX (Pac-Man) · ▼ MIN (ghost) · ● CHANCE (random ghost) · leaf values ----------
  class GameTree {
    constructor(canvas, w, h, R = 4) {
      Object.assign(this, { canvas, R, W: w / R, H: h / R, x: canvas.getContext('2d'), root: null });
      canvas.width = w; canvas.height = h; canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    }
    // leaves spread evenly; parents centred over their children
    set(root) {
      const leaves = [], walk = (n, d) => { n.d = d; n.kids = n.kids || []; if (!n.kids.length) leaves.push(n); n.kids.forEach(k => walk(k, d + 1)); };
      walk(root, 0);
      const depth = Math.max(...leaves.map(l => l.d)), gap = this.W / leaves.length;
      leaves.forEach((l, i) => (l.x = Math.round(gap * (i + .5))));
      const place = n => { if (n.kids.length) { n.kids.forEach(place); n.x = Math.round((n.kids[0].x + n.kids[n.kids.length - 1].x) / 2); } n.y = Math.round(10 + n.d * (this.H - 26) / depth); };
      place(root); this.root = root;
    }
    each(f, n = this.root) { if (!n) return; f(n); n.kids.forEach(k => this.each(f, k)); }
    seg(ax, ay, bx, by, color, w) {
      const { x, R } = this, n = Math.max(Math.abs(bx - ax), Math.abs(by - ay)); x.fillStyle = color;
      for (let k = 0; k <= n; k++) x.fillRect(Math.round(ax + (bx - ax) * k / n - w / 2) * R, Math.round(ay + (by - ay) * k / n - w / 2) * R, w * R, w * R);
    }
    txt(lx, ly, s, color, size) {
      const { x, R } = this; x.font = `${size * R}px 'Press Start 2P'`; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillStyle = '#000'; x.fillText(s, lx * R + R, ly * R + R); x.fillStyle = color; x.fillText(s, lx * R, ly * R);
    }
    shape(n, t) {
      const { x, R } = this, c = n.pruned ? '#2b3266' : n.type === 'max' ? C.pac : n.type === 'min' ? C.red : C.cyan;
      x.fillStyle = c;
      if (n.type === 'max' || n.type === 'min') for (let r = 0; r < 7; r++) { const w = n.type === 'max' ? r : 6 - r; x.fillRect((n.x - w) * R, (n.y - 3 + r) * R, (2 * w + 1) * R, R); }
      else if (n.type === 'chance') for (let r = -3; r <= 3; r++) { const w = r * r > 4 ? 1 : r * r > 1 ? 2 : 3; x.fillRect((n.x - w) * R, (n.y + r) * R, (2 * w + 1) * R, R); }
      if (n.peek && Math.floor(t / 150) % 2) { x.strokeStyle = C.cyan; x.lineWidth = R; x.strokeRect((n.x - 8.5) * R, (n.y - 7.5) * R, 17 * R, 15 * R); }
    }
    render(t) {
      const { x } = this; if (!this.root) return;
      x.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.each(p => p.kids.forEach(k => {
        const col = k.pruned ? '#1b2470' : k.hl ? C.pac : '#2a3bff';
        this.seg(p.x, p.y + 5, k.x, k.y - (k.kids.length || k.type !== 'leaf' && k.type !== 'term' ? 5 : 4), col, k.hl ? 2 : 1);
        // move label on a black chip, most of the way down the edge
        const f = .62, lx = Math.round(p.x + (k.x - p.x) * f), ly = Math.round(p.y + 5 + (k.y - p.y - 10) * f), half = k.edge.length * 2 + 1;
        this.x.fillStyle = '#03051a'; this.x.fillRect((lx - half) * this.R, (ly - 3) * this.R, 2 * half * this.R, 6 * this.R);
        this.txt(lx, ly, k.edge, k.pruned ? '#2b3266' : k.hl ? C.pac : '#6a74b8', 4);
      }));
      this.each(n => {
        const v = n.show ? (n.label != null ? n.label : fmtV(n.val)) : '?';
        if (n.type === 'leaf' || n.type === 'term') {
          const bad = n.show && n.val < -400, col = n.pruned ? '#2b3266' : bad ? C.red : n.show ? '#fff' : '#6a74b8';
          if (n.peek && Math.floor(t / 150) % 2) { x.strokeStyle = C.cyan; x.lineWidth = this.R; x.strokeRect((n.x - 11.5) * this.R, (n.y - 6.5) * this.R, 23 * this.R, 13 * this.R); }
          this.txt(n.x, n.y, n.pruned ? 'X' : v, col, 5);
          if (n.type === 'term') this.txt(n.x, n.y + 8, 'CAUGHT', C.red, 3);
          if (n.deep && !n.pruned) for (let k = -1; k <= 1; k++) this.seg(n.x, n.y + 5, n.x + k * 4, n.y + 10, '#1b2470', 1);
        } else {
          this.shape(n, t);
          if (n.show) n.d ? this.txt(n.x - 6 - v.length * 2.5, n.y, v, n.hl ? C.pac : '#fff', 5) : this.txt(n.x + 8 + v.length * 2.5, n.y, v, C.pac, 5);
        }
      });
    }
  }
  const fmtV = v => (Number.isInteger(v) ? String(v) : v.toFixed(1));
  const MOVE_NAME = (m, from, to) => (to === from - m.w ? 'UP' : to === from + 1 ? 'RIGHT' : to === from + m.w ? 'DOWN' : 'LEFT');

  // replay a game trace on a board: one agent moves per entry; ghosts are actors gh[k]
  async function replay(b, gh, trace, ms, alive) {
    b.reset(); b.pac.hidden = false; b.put(b.pac, trace[0].p); gh.forEach((g, k) => { g.hidden = false; b.put(g, trace[0].g[k]); });
    for (let i = 1; i < trace.length; i++) {
      const a = trace[i - 1], s = trace[i];
      if (s.p !== a.p) b.aim(b.pac, s.p, 16 / ms); else s.g.forEach((q, k) => q !== a.g[k] && b.aim(gh[k], q, 16 / ms));
      await sleep(ms); if (!alive()) return null;
      if (s.p !== a.p) b.eat(s.p);
      if (s.over < 0) { b.mark(s.p, 'x'); popup('CAUGHT', tilePt(b, s.p), C.red); await sleep(250); b.pac.hidden = true; }
      if (s.over > 0) b.flash();
    }
    return trace[trace.length - 1];
  }

  // 11 · minimax: the real tree of a real position, then alpha-beta, then live games
  lazy('s-minimax', () => {
    const m = E.makeGame(MAZES.duel), s0 = E.gameStart(m), b = new Board($('#duelBoard'), m, 5);
    const gh = b.add('ghost', C.red), pp = b.add('pac'), pg = b.add('ghost', C.red);
    pp.hidden = pg.hidden = true;
    const tree = new GameTree($('#mmTree'), 704, 368);
    let run = 0;
    function pose() {
      b.reset(); b.pac.hidden = false; b.put(gh, s0.g[0]); gh.hidden = false;
      pp.hidden = pg.hidden = true; pp.alpha = pg.alpha = .45;
    }
    function fresh() {
      const root = { type: 'max', kids: [] };
      for (const to of E.gameMoves(m, s0, 0)) {
        const s1 = E.gameApply(m, s0, 0, to), n = { type: 'min', edge: MOVE_NAME(m, s0.p, to), to, kids: [] };
        for (const q of E.gameMoves(m, s1, 1)) n.kids.push({ type: 'leaf', edge: MOVE_NAME(m, s1.g[0], q), to, q, val: E.gameEval(m, E.gameApply(m, s1, 1, q)) });
        root.kids.push(n);
      }
      tree.set(root); return root;
    }
    // walk the tree like the code does; with prune=true, stop a MIN node once it can't beat alpha
    async function solve(prune, my, fast) {
      const root = fresh(), z = fast ? 0 : 1; if (!fast) pose();
      let alpha = -Infinity;
      for (const n of root.kids) {
        n.peek = !fast; if (!fast) { pp.hidden = false; b.put(pp, s0.p); b.aim(pp, n.to, .05); }
        await sleep(450 * z); if (my !== run) return;
        let v = Infinity;
        for (const [j, l] of n.kids.entries()) {
          l.peek = !fast; if (!fast) { pg.hidden = false; b.put(pg, s0.g[0]); b.aim(pg, l.q, .05); }
          await sleep(520 * z); if (my !== run) return;
          l.peek = false; l.show = true; v = Math.min(v, l.val);
          if (prune && v <= alpha) {
            n.kids.slice(j + 1).forEach(r => (r.pruned = true));
            n.label = '<=' + fmtV(v); break;
          }
        }
        n.val = v; n.show = true; n.peek = false; if (!fast) pg.hidden = true;
        n.kids.forEach(l => { if (!l.pruned && l.val === v) l.hl = true; });
        alpha = Math.max(alpha, v);
        await sleep(300 * z); if (my !== run) return;
      }
      root.val = alpha; root.show = true;
      const best = root.kids.find(n => n.val === alpha); best.hl = true;
      if (fast) return;
      pp.hidden = true;
      b.line([b.cpt(s0.p), b.cpt(best.to)], C.pac, { w: 3, dur: 300 }); b.mark(best.to, 'o');
    }
    function table() {
      const rows = [3, 4, 5, 6].map(d => { const a = E.gameDecide(m, s0, d, 'minimax'), c = E.gameDecide(m, s0, d, 'alphabeta'); return [d, a.nodes, c.nodes]; });
      $('#abTable').innerHTML = '<span class="h">DEPTH</span><span class="h" style="text-align:right">MINIMAX</span><span class="h" style="text-align:right">ALPHA-BETA</span><span></span>' +
        rows.map(([d, a, c]) => `<span class="d">${d} ROUNDS</span><span class="v">${fmt(a)}</span><span class="v c">${fmt(c)}</span><span class="g" style="text-align:right">${Math.round(a / c)}×</span>`).join('') +
        '<span class="t13 d" style="grid-column:1/5">SAME MOVE, SAME VALUE, EVERY DEPTH.</span>';
    }
    async function live(my) {
      const rand = E.rng(2026); let w = 0, l = 0;
      $('#mmW').textContent = 0; $('#mmL').textContent = 0;
      while (my === run) {
        const g = E.playGame(m, 'alphabeta', 3, 'chase', rand);
        const end = await replay(b, [gh], g.trace, 130, () => my === run);
        if (!end) return;
        if (end.over > 0) $('#mmW').textContent = ++w; else if (end.over < 0) $('#mmL').textContent = ++l;
        await sleep(900);
      }
    }
    table();
    return {
      boards: [b, tree],
      enter() {}, leave() { run++; b.stop(); },
      build(n) {
        run++;
        if (n === 0) { pose(); fresh(); }
        if (n === 1) solve(false, run);
        if (n === 2) solve(true, run);
        if (n === 3) { solve(true, run, true); live(run); }
      },
    };
  });

  // 12 · expectimax: a cornered Pac-Man; same tree with MIN nodes, then with CHANCE nodes
  lazy('s-expecti', () => {
    const m = E.makeGame(MAZES.pocket), s0 = E.gameStart(m), b = new Board($('#pocketBoard'), m, 5), gh = b.add('ghost', C.red);
    const tree = new GameTree($('#exTree'), 704, 368), DEPTH = 3;
    let run = 0;
    // a seeded random-ghost game that expectimax wins (the 69% case), found once at load
    let winSeed = 1;
    for (let sd = 1; sd < 200; sd++) { const g = E.playGame(m, 'expectimax', DEPTH, 'random', E.rng(sd)); if (g.over > 0 && g.t >= 6) { winSeed = sd; break; } }
    function pose() { b.reset(); b.pac.hidden = false; b.put(gh, s0.g[0]); gh.hidden = false; $('#pkInfo').textContent = ''; }
    function fresh(kind) {
      const { V } = E.gameSearch(m, DEPTH, kind), root = { type: 'max', kids: [] };
      for (const to of E.gameMoves(m, s0, 0)) {
        const s1 = E.gameApply(m, s0, 0, to), edge = MOVE_NAME(m, s0.p, to);
        if (s1.over) { root.kids.push({ type: 'term', edge, to, val: s1.score }); continue; }
        const n = { type: kind === 'expectimax' ? 'chance' : 'min', edge, to, kids: [] };
        for (const q of E.gameMoves(m, s1, 1)) {
          const s2 = E.gameApply(m, s1, 1, q);
          n.kids.push({ type: 'leaf', edge: q === s1.p - m.w ? 'IN' : MOVE_NAME(m, s1.g[0], q), deep: !s2.over, val: s2.over ? s2.score : Math.round(V(s2, 0, 1) * 10) / 10 });
        }
        const vs = n.kids.map(k => k.val);
        n.val = kind === 'expectimax' ? vs.reduce((a, c) => a + c, 0) / vs.length : Math.min(...vs);
        root.kids.push(n);
      }
      root.val = Math.max(...root.kids.map(n => n.val));
      tree.set(root); return root;
    }
    async function show(kind, my) {
      $('#exTitle').textContent = (kind === 'expectimax' ? 'EXPECTIMAX' : 'MINIMAX') + ' · 3 ROUNDS AHEAD';
      const root = fresh(kind); pose();
      for (const n of root.kids) {
        n.peek = true; await sleep(350); if (my !== run) return;
        for (const l of n.kids) { l.peek = true; await sleep(380); if (my !== run) return; l.peek = false; l.show = true; }
        n.peek = false; n.show = true;
        n.kids.forEach(l => { if (kind !== 'expectimax' && l.val === n.val) l.hl = true; });
        await sleep(350); if (my !== run) return;
      }
      root.show = true; root.kids.find(n => n.val === root.val).hl = true;
      await sleep(700); if (my !== run) return;
      await play(kind, my);
    }
    async function play(kind, my) {
      const g = E.playGame(m, kind, DEPTH, 'random', E.rng(kind === 'expectimax' ? winSeed : 1));
      $('#pkInfo').textContent = '';
      const end = await replay(b, [gh], g.trace, 260, () => my === run);
      if (!end) return;
      $('#pkInfo').innerHTML = end.over > 0 ? `<span class="g">ESCAPED · ALL DOTS IN ${end.t} MOVES</span>` : `<span class="r">CAUGHT AT MOVE ${end.t}</span>`;
    }
    $('#pkMM').onclick = () => { run++; play('minimax', run); };
    $('#pkEX').onclick = () => { run++; play('expectimax', run); };
    return {
      boards: [b, tree],
      enter() {}, leave() { run++; b.stop(); },
      build(n) {
        run++;
        if (n === 0) show('minimax', run);
        if (n === 1) show('expectimax', run);
        if (n === 2) { fresh('expectimax'); tree.each(k => (k.show = true)); tree.root.kids.find(k => k.val === tree.root.val).hl = true; pose(); }
      },
    };
  });

  // 10 · end
  lazy('s-end', () => {
    const st = corridor($('#endStrip'));
    let cur = 0;
    return { get boards() { return cur >= 6 ? [st.board] : []; }, tick: st.tick, enter() {}, leave() {}, build(n) { cur = n; } };
  });

  // 11 · backup Q&A
  const QA = [
    ['TIME & MEMORY?', 'Worst case every exact search touches every state: O(N·2ᵏ) time and memory. A good h doesn’t change the worst case, it shrinks what you explore: 6,263 → 48 states on 9×7 mazes with 8 dots.'],
    ['IS YOUR h CONSISTENT?', 'Yes, measured: 0 violations of h(n) ≤ 1 + h(n′) over 8.8M moves in 600 mazes, for both MST versions. Σ broke it 2.7M times. Consistent ⇒ admissible, and a state is never re-opened.'],
    ['WHY IS NEAREST + MST ADMISSIBLE?', 'Any route eats the dots in some order. Those hops connect every dot, so they cost at least the MST. Before the first hop you must reach some dot: at least the nearest. Walls only add distance.'],
    ['WHY ANNEALING, NOT A GENETIC ALGORITHM?', 'Both are local search over orders. SA needs one move (reverse a segment) and one knob (temperature), and reached 256 in 0.1 s. A GA needs crossover that keeps a valid order. More code, no gain at this size.'],
    ['HOW DID A* PROVE 226?', 'With an admissible h, some state on the optimal route is always in the open list with f ≤ optimal. A* pops the lowest f first, so when it gave up, the f it had reached (226) is a lower bound.'],
    ['WHY USE IDA* IF IT REPEATS WORK?', 'Memory. It keeps only the current path (25 states vs 149 for A*). When memory, not time, is the limit (huge puzzles, small devices), repeating work is the cheaper price.'],
  ];
  lazy('s-qa', () => {
    const g = $('#qaGrid');
    g.innerHTML = QA.map(([q, a], k) => `<div class="panel qa" style="left:${k % 2 ? 852 : 48}px;top:${170 + (k >> 1) * 236}px"><h3>${q}</h3><p>${a}</p><span class="tap">TAP</span></div>`).join('');
    $$('.qa', g).forEach(c => (c.onclick = () => { const o = c.classList.contains('open'); $$('.qa', g).forEach(x => x.classList.remove('open')); c.classList.toggle('open', !o); }));
    return { boards: [], enter() {}, leave() {}, build() {} };
  });

  // ---------- speaker cues (match script.md) ----------
  const NOTES = {
    's-title': ['Title (PDF look, glitching). Tap.', 'Bricks flip to Pac-Man. Arrow cycles our names. Introduce the team. Tap = pick Chuong.', 'Do Thanh Chuong: player 1. It starts by itself. "Pac-Man has one job: eat every dot."'],
    's-hook': ['Pac-Man has one job: eat every dot. Just the path.', 'One dot is easy. Every dot, shortest route, is a different problem.', 'Same maze, two heuristics: 48 vs 32. By the end you\'ll know why, and how far it scales.', 'Pipeline: maze → state → A* + h → path. Too many dots → annealing. Ghosts → minimax.'],
    's-state': ['Input: maze, start, dots. Output: shortest move list eating every dot. One dot: state = position, 25 states.', 'Same tile, different futures: 12 steps vs 4.', 'State = (x, y, mask). Eating = one AND. mask == 0 is the goal.', 'Every dot doubles it: 25·2^k. Drag to 10 → 25,600, 16 → 1.6M.'],
    's-trace': ['18 lines. STEP: h = 13 → pop lowest f → expand → push. Then AUTO. Cost 10 vs h 13.', '① bitmask state: hashable, O(1) eat.', '② tie-break on h: 20–40% fewer expansions.', '③ no closed set: skip stale copies, re-open is safe.'],
    's-heur': ['f = g + h. Admissible = never overestimates ⇒ optimal.', 'Three dots in a row: Σ = 6, truth = 3. Overestimates 2×.', 'Trap: Σ chases the far pair first: 15 steps vs 9.'],
    's-mst': ['Red spokes = Σ = 18. Blue tree 10 + yellow nearest 1 = 11 = exact.', 'Why safe: any route links all dots → tree ≥ MST, + must reach first dot.', 'Code: 4 lines, Prim\'s on ≤ 10 dots = microseconds.'],
    's-relax': ['Relaxed problem = fewer rules → its answer is admissible for free. True cost here: 29.', 'Ladder: UCS 0, farthest 13, MST 14. MST = walk through walls + jump back. Loose.', 'Walls back: MAZE-MST 28 vs 29. Expansions 146 → 31. One BFS per dot.'],
    's-trials': ['Seeded, 500 mazes, live: red = Σ path, yellow = optimal. Tap any square to replay it. 5×5·5: 77% longer with Σ. MST 500/500. MAZE bar = fewest. Tap 7×7·6 → 89%.'],
    's-trade': ['Blind: BFS/UCS optimal but 6,263 states. DFS small but 0/300.', 'A*: Σ = same cost as MST, wrong 98%. MAZE: 130× fewer than BFS.', 'Greedy 198/300. WA* ≤ 2× optimal, 239/300. IDA*: memory 25, 11× the work.'],
    's-tsp': ['Eating every dot = choosing an order = travelling salesman. NP-hard. Same problem: delivery routes, warehouse robots, robot vacuums, game NPCs.', 'Held-Karp DP: bitmask again. 300/300 same answer as A*.', 'Wall table: BFS dies at 18 dots, Held-Karp at 24, A* MAZE at 60. h pushes the wall back, doesn\'t remove it.'],
    's-tour': ['220 dots: 282 × 2^220 ≈ 10^69 states. A* solved 40, gave up at 60.', 'Search routes, not states. Random order: 4,186.', 'Greedy nearest dot: 309.', 'Hill climb with 2-opt: 293. Stuck: local optimum.', 'Annealing: accept worse moves while hot. 256. Watch Pac-Man eat all 220.', 'A* gave up but proved ≥ 226. So 256 is within 13% of optimal, in 0.1 s.'],
    's-ghost': ['Standing ghost = tiles cost 10. One-line change: cost(nxt).', 'BFS: 19 steps cost 73. A*: 21 steps cost 21. But real ghosts MOVE →'],
    's-minimax': ['Ghost moves too: Pac = MAX, ghost = MIN, take turns. Leaf = score − steps to nearest dot.', 'Each move = its worst case. UP −3 · RIGHT 7 · LEFT −491 → RIGHT. Greedy goes LEFT and can die.', 'Alpha-beta: LEFT already ≤ −491 < 7, skip the rest. Depth 6: 363,790 → 16,348 nodes, same move.', 'Live vs a chasing ghost. 1,000 games: greedy 4%, minimax 100%.'],
    's-expecti': ['Cornered. Perfect ghost ⇒ every route dies. Minimax: UP −501 vs DOWN −502 → walks into the ghost.', 'Real ghost is random: chance node = average. DOWN −130.5 → waits, escapes.', '1,000 games: random ghost 0% vs 69%. Chasing ghost: both lose. Model your enemy.'],
    's-end': ['Five things to remember.', '1: state = (position, dots left).', '2: good h = exact answer to a relaxed problem. Σ isn\'t.', '3: tighter h = less work, same answer.', '4: it\'s a TSP: annealing + A*\'s bound, within 13%.', '5: ghosts play back: minimax vs perfect, expectimax vs random.', 'Limits: exact search stops near 60 dots; minimax needs a right ghost model. Lesson: relax the rules for h, then local search. Thank you!'],
    's-arena': ['Your turn: the whole deck is online. Scan, draw a maze, race nine searches. Questions?'],
    's-qa': ['Backup answers: tap a card.'],
  };

  // ---------- navigation ----------
  const slides = $$('.slide');
  let cur = -1, build = 0;
  const maxB = s => parseInt(s.dataset.builds || '0', 10);
  const dotsEl = $('#dots');
  dotsEl.innerHTML = slides.map((_, k) => `<button aria-label="Slide ${k + 1}" data-k="${k}"></button>`).join('');
  $$('button', dotsEl).forEach(bt => { bt.onclick = () => go(+bt.dataset.k, 0); bt.classList.toggle('bk', slides[+bt.dataset.k].hasAttribute('data-skip')); });

  function applyBuild(s, b) {
    $$('[data-build]', s).forEach(el => {
      const n = +el.dataset.build, until = el.dataset.until != null ? +el.dataset.until : Infinity;
      el.classList.toggle('on', b >= n && b <= until);
    });
  }
  let leaving = null;
  function go(i, b = 0) {
    i = Math.max(0, Math.min(slides.length - 1, i));
    if (i > 0 && cur <= 0 && typeof wake === 'function') setTimeout(wake, 0);
    b = Math.max(0, Math.min(maxB(slides[i]), b));
    if (i !== cur) {
      const back = i < cur;
      if (cur >= 0) {
        S[slides[cur].id].leave();
        const old = slides[cur]; old.classList.remove('active', 'from-left'); old.classList.add('leaving');
        leaving = old; setTimeout(() => { old.classList.remove('leaving'); if (leaving === old) leaving = null; }, 450);
      }
      const s = slides[i]; s.classList.remove('leaving'); s.classList.toggle('from-left', back);
      s.classList.remove('active'); void s.offsetWidth; s.classList.add('active');
      cur = i; applyBuild(s, b); pace.enter(s.id);
      $('#hudStage').textContent = `${String(i + 1).padStart(2, '0')}/${slides.length}`;
      $('#hudK').textContent = s.dataset.k; $('#hudV').textContent = s.dataset.v;
      stage.classList.toggle('nohud2', s.id === 's-hook' || s.id === 's-title');
      S[s.id].enter();
      for (let k = 0; k <= b; k++) S[s.id].build(k);
    } else if (b !== build) {
      applyBuild(slides[i], b);
      S[slides[i].id].build(b);
    }
    build = b;
    try { history.replaceState(null, '', `#${i + 1}.${b}`); } catch (_) {}
    $$('button', dotsEl).forEach((d, k) => { d.classList.toggle('on', k === i); d.classList.toggle('done', k < i); });
    $('#counter').textContent = `${i + 1}/${slides.length}`;
    const w = s => (s.hasAttribute('data-skip') ? 0 : maxB(s) + 1), total = slides.reduce((a, s) => a + w(s), 0);
    const done = slides.slice(0, i).reduce((a, s) => a + w(s), 0) + b + 1;
    $('#progress').style.width = (100 * done / total) + '%';
    renderNotes();
    warm(i);
  }
  // build the next slide while the presenter is still talking on this one
  let warmT;
  function warm(i) {
    clearTimeout(warmT);
    warmT = setTimeout(() => { const n = slides[i + 1]; if (n && cur === i) void S[n.id]; }, 1500);
  }
  // data-skip slides are backup: next/prev jump over them, the dock dots still reach them for Q&A
  const skip = k => k >= 0 && k < slides.length && slides[k].hasAttribute('data-skip');
  const step = (k, d) => { do k += d; while (skip(k)); return k; };
  const next = () => { pace.start(); if (build < maxB(slides[cur])) return go(cur, build + 1); const j = step(cur, 1); if (j < slides.length) go(j, 0); };
  const prev = () => { if (build > 0) return go(cur, build - 1); const j = step(cur, -1); if (j >= 0) go(j, maxB(slides[j])); };

  // ---------- render loop: only the boards on screen ----------
  let last = performance.now(), avg = 16, fskip = false, acc = 0;
  function frame(t) {
    const raw = t - last, dt = Math.min(50, raw); last = t;
    // adaptive: if the device can't hold ~40fps, draw boards every other frame (motion uses dt, so speed is unchanged)
    avg += (raw - avg) * 0.08; fskip = (LITE || avg > 26) ? !fskip : false;
    const on = [slides[cur], leaving].filter(Boolean);
    on.forEach(s => { const o = S[s.id]; o.tick && o.tick(t); if (fskip) { acc += dt; return; } o.boards.forEach(b => b.render(t, dt + acc)); acc = 0; });
    requestAnimationFrame(frame);
  }

  // ---------- notes ----------
  const notesEl = $('#notes');
  function renderNotes() {
    if (!notesEl.classList.contains('open')) return;
    const id = slides[cur].id, arr = NOTES[id] || [];
    const nxt = build < arr.length - 1 ? arr[build + 1] : (NOTES[slides[cur + 1]?.id] || [])[0];
    notesEl.innerHTML = `<b>${cur + 1}.${build}</b> — ${arr[build] || ''}${nxt ? `<div class="next">next: ${nxt}</div>` : ''}`;
  }
  function toggleNotes() { notesEl.classList.toggle('open'); renderNotes(); }
  $('#notesBtn').onclick = toggleNotes;
  notesEl.onclick = toggleNotes;
  let lp;
  $('#notesHot').addEventListener('pointerdown', () => { lp = setTimeout(toggleNotes, 550); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => $('#notesHot').addEventListener(ev, () => clearTimeout(lp)));

  // ---------- input: tap zones, swipe, keys ----------
  const isUI = t => t.closest('button, input, #dock, #notes, #notesHot, .qa, a, .edit, .lb, .tmc, .mosaic, .tboard');
  let p0 = null;
  window.addEventListener('pointerdown', e => { if (!e.isPrimary) return; p0 = { x: e.clientX, y: e.clientY, t: Date.now(), ui: !!isUI(e.target) }; wake(); });
  window.addEventListener('pointerup', e => {
    if (!p0 || !e.isPrimary) return;
    const dx = e.clientX - p0.x, dy = e.clientY - p0.y, dt = Date.now() - p0.t, start = p0;
    p0 = null;
    if (start.ui || cur === 0 || document.documentElement.classList.contains('rec')) return; // slide 1: anti-misclick, only button / dock / keys advance
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.4) return dx < 0 ? next() : prev();
    if (Math.hypot(dx, dy) < 14 && dt < 600) (e.clientX < innerWidth / 3 ? prev : next)();
  });
  window.addEventListener('pointercancel', () => { p0 = null; });
  document.addEventListener('gesturestart', e => e.preventDefault());
  document.addEventListener('dblclick', e => e.preventDefault());
  window.addEventListener('keydown', e => {
    if (['ArrowRight', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); next(); }
    else if (['ArrowLeft', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); prev(); }
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(slides.length - 1);
    else if (e.key === 'f') fullscreen();
    else if (e.key === 'n') toggleNotes();
    else if (e.key === 'r') pace.reset();
    else if (e.key === 'd') { G.depth.on = !G.depth.on; document.body.classList.toggle('flat', !G.depth.on); } // depth sample: compare on/off
    wake();
  });
  $('#nextBtn').onclick = next;
  $('#titleNext').onclick = next;
  $('#prevBtn').onclick = prev;

  // ---------- fullscreen + keep screen awake ----------
  function fullscreen() {
    const d = document, el = d.documentElement;
    if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen || d.webkitExitFullscreen).call(d);
    else (el.requestFullscreen || el.webkitRequestFullscreen || (() => {})).call(el);
  }
  $('#fsBtn').onclick = fullscreen;
  let lock = null;
  async function keepAwake() {
    try { if ('wakeLock' in navigator && !lock) { lock = await navigator.wakeLock.request('screen'); lock.addEventListener('release', () => { lock = null; }); } } catch (_) {}
  }
  window.addEventListener('pointerdown', keepAwake);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && keepAwake());

  // ---------- dock fades when idle ----------
  const dock = $('#dock');
  let idle;
  function wake() { dock.classList.remove('sleep'); clearTimeout(idle); idle = setTimeout(() => { if (cur > 0) dock.classList.add('sleep'); }, 3500); }

  // ---------- scale stage to the screen ----------
  function fit() { document.documentElement.style.setProperty('--s', Math.min(innerWidth / 1600, innerHeight / 1000)); }
  window.addEventListener('resize', fit);
  fit();
  stage.addEventListener('scroll', () => { stage.scrollLeft = 0; stage.scrollTop = 0; });

  // ---------- pace dot: warns when a stage runs long (budgets sum to ~9.7 min) ----------
  // bar drains over the stage's time: green, yellow (last 25%), red + empty (over budget), blinking red (25%+ over)
  const pace = (() => {
    const BUDGET = { 's-title': 30, 's-hook': 60, 's-state': 60, 's-trace': 92, 's-heur': 53, 's-mst': 42, 's-relax': 36, 's-trials': 25, 's-tsp': 44, 's-tour': 60, 's-minimax': 35, 's-expecti': 22, 's-end': 25 };
    const el = $('#pace');
    const spent = {}; let id = null, t0 = 0, started = false;
    // time saved (or overrun) on earlier stages carries into the current stage
    const ORDER = Object.keys(BUDGET);
    function bank() {
      const k = ORDER.indexOf(id); let sum = 0;
      for (let j = 0; j < k; j++) { const u = spent[ORDER[j]]; if (u != null) sum += BUDGET[ORDER[j]] - u; }
      return sum;
    }
    function now() { return id ? (spent[id] || 0) + (performance.now() - t0) / 1000 : 0; }
    const fill = $('i', el);
    function paint() {
      const b = BUDGET[id] && Math.max(5, BUDGET[id] + bank());
      if (!started || !b) { el.className = started ? 'ok' : 'wait'; fill.style.width = '100%'; return; }
      const t = now();
      el.className = t > b * 1.25 ? 'over' : t > b ? 'late' : t > b * 0.75 ? 'warn' : 'ok';
      fill.style.width = Math.max(0, 100 * (1 - t / b)) + '%';
    }
    setInterval(paint, 250);
    return {
      start() { if (!started) { started = true; t0 = performance.now(); } },
      enter(nid) { if (id) spent[id] = (spent[id] || 0) + (performance.now() - t0) / 1000; id = nid; t0 = performance.now(); paint(); },
      reset() { for (const k in spent) delete spent[k]; started = false; t0 = performance.now(); paint(); },
    };
  })();

  // ---------- start ----------
  const fromHash = () => {
    if (/^#play$/i.test(location.hash)) return go(slides.indexOf($('#s-arena')), 0);
    const m0 = /^#(\d+)(?:\.(\d+))?/.exec(location.hash); go(m0 ? +m0[1] - 1 : 0, m0 && m0[2] ? +m0[2] : 0); };
  addEventListener('hashchange', fromHash);
  fromHash();
  requestAnimationFrame(frame);
  wake();
  let seen = false;
  try { seen = localStorage.getItem('pac-hint') === '1'; localStorage.setItem('pac-hint', '1'); } catch (_) {}
  if (!seen) { const hint = $('#hint'); hint.classList.add('show'); setTimeout(() => hint.classList.remove('show'), 2600); }

  
})();
