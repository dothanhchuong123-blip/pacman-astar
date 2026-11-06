/* Boot + old-browser (LITE) mode. ES5 on purpose; loads engine/gfx/app itself once the mode is known.
   LITE (window.PAC_LITE): flat maze, no glow/particles, cheaper title glitch, throttled 500-maze replay, flex-gap polyfill.
   - First visit (no saved choice): a ~1 s benchmark decides. Slow or no flex-gap -> LITE + a notice.
   - The bolt icon on the title slide is the manual override (remembered; page reloads). */
(function () {
  var root = document.documentElement, KEY = 'pac-legacy', TOAST = 'pac-toast', styleEl = null, built = false;

  function flexGapOK() {
    try {
      var d = document.createElement('div'), a = document.createElement('i'), b = document.createElement('i');
      d.style.cssText = 'display:flex;flex-direction:column;gap:10px;position:absolute;left:-99px;top:0';
      a.style.height = '1px'; b.style.height = '1px'; d.appendChild(a); d.appendChild(b);
      document.body.appendChild(d); var ok = d.offsetHeight === 12; document.body.removeChild(d); return ok;
    } catch (e) { return false; }
  }

  // "gap:14px 30px" -> {row, col};  also row-gap / column-gap
  function parseGap(txt) {
    var r = 0, c = 0, m;
    if ((m = /(?:^|[;\s])gap:\s*(\d+)px(?:\s+(\d+)px)?/.exec(txt))) { r = +m[1]; c = m[2] != null ? +m[2] : +m[1]; }
    if ((m = /row-gap:\s*(\d+)px/.exec(txt))) r = +m[1];
    if ((m = /column-gap:\s*(\d+)px/.exec(txt))) c = +m[1];
    return (r || c) ? { r: r, c: c } : null;
  }
  function rule(sel, txt) {
    var g = parseGap(txt); if (!g || !/display:\s*(inline-)?flex/.test(txt)) return '';
    var col = /flex-direction:\s*column/.test(txt), wrap = /flex-wrap:\s*wrap/.test(txt);
    if (wrap) return sel + ' > *{margin:0 ' + g.c + 'px ' + g.r + 'px 0}';
    return col ? sel + ' > * + *{margin-top:' + g.r + 'px}' : sel + ' > * + *{margin-left:' + g.c + 'px}';
  }
  function build(done) {
    if (built) return done();
    var x = new XMLHttpRequest(); x.open('GET', 'style.css'); x.onload = function () {
      var out = '', re = /([^{}]+)\{([^{}]*)\}/g, m;
      while ((m = re.exec(x.responseText))) if (/gap/.test(m[2])) out += rule(m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim(), m[2]) + '\n';
      var all = document.querySelectorAll('[style*="gap"]');
      for (var i = 0; i < all.length; i++) {
        all[i].setAttribute('data-lg', i);
        out += rule('[data-lg="' + i + '"]', all[i].getAttribute('style')) + '\n';
      }
      styleEl = document.createElement('style'); styleEl.id = 'legacyGap'; styleEl.textContent = out;
      built = true; done();
    }; x.onerror = done; x.send();
  }


  var CPU_LIMIT = 90, FRAME_LIMIT = 24;
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
  function ss(k, v) { try { if (v === undefined) { var r = sessionStorage.getItem(k); sessionStorage.removeItem(k); return r; } sessionStorage.setItem(k, v); } catch (e) { return null; } }

  function applyClass(on) {
    var btn = document.getElementById('legacyBtn');
    if (btn) { btn.className = on ? 'on' : ''; btn.setAttribute('aria-pressed', on ? 'true' : 'false'); btn.title = 'Old browser mode: ' + (on ? 'ON' : 'OFF'); }
    if (!on) return;
    root.className += ' legacy';
    build(function () { if (styleEl && !styleEl.parentNode) document.head.appendChild(styleEl); });
  }

  // ---- toast (inside the scaled stage so it matches the deck) ----
  function toast(lines, kind) {
    var st = document.getElementById('stage'); if (!st) return;
    var t = document.createElement('div'); t.id = 'toast'; t.className = kind || '';
    t.innerHTML = lines.join('<br>'); st.appendChild(t);
    setTimeout(function () { t.className += ' show'; }, 30);
    setTimeout(function () { t.className = t.className.replace(' show', ''); setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 500); }, 5200);
  }

  // ---- benchmark: sync CPU work (the same per-pixel maths the maze bitmaps do) + real frame pacing on a canvas ----
  function cpuMs() {
    var t0 = (window.performance || Date).now(), w = 220, h = 220, c = document.createElement('canvas'); c.width = w; c.height = h;
    var x = c.getContext('2d'), im = x.createImageData(w, h), s = 0, px, py, ox, oy;
    for (py = 0; py < h; py++) for (px = 0; px < w; px++) {
      var d = 99; for (oy = -1; oy <= 1; oy++) for (ox = -1; ox <= 1; ox++) d = Math.min(d, Math.sqrt((px - 110 + ox * 9) * (px - 110 + ox * 9) + (py - 110 + oy * 9) * (py - 110 + oy * 9)));
      im.data[(py * w + px) * 4 + 3] = d > 40 ? 255 : 0; s += d;
    }
    x.putImageData(im, 0, 0);
    return (window.performance || Date).now() - t0;
  }
  function frameMs(done) {
    var c = document.createElement('canvas'), n = 0, last = 0, ts = [], dead = false;
    c.width = 800; c.height = 500; var x = c.getContext('2d');
    var spr = document.createElement('canvas'); spr.width = spr.height = 96; var sx = spr.getContext('2d');
    sx.fillStyle = '#ff0'; sx.beginPath(); sx.arc(48, 48, 44, 0, 7); sx.fill();
    function fin() { if (dead) return; dead = true; ts.sort(function (a, b) { return a - b; }); done(ts.length ? ts[ts.length >> 1] : null); }
    setTimeout(fin, 1800);                                   // hidden tab / no rAF: give up
    function f(t) {
      if (dead) return;
      if (last) ts.push(t - last); last = t;
      x.clearRect(0, 0, 800, 500);
      for (var i = 0; i < 90; i++) { x.globalAlpha = .6; x.drawImage(spr, (i * 53) % 700, (i * 37) % 400, 96, 96); }
      x.globalAlpha = 1; x.shadowColor = '#08f'; x.shadowBlur = 14; x.fillStyle = '#25f'; x.fillRect(60, 60, 600, 300); x.shadowBlur = 0;
      if (++n < 22) requestAnimationFrame(f); else { ts = ts.slice(4); fin(); }
    }
    requestAnimationFrame(f);
  }

  function boot(on, why) {
    window.PAC_LITE = on; applyClass(on);
    var b = document.getElementById('boot'); if (b) b.parentNode.removeChild(b);
    var btn = document.getElementById('legacyBtn');
    if (btn) btn.onclick = function (e) {
      e.stopPropagation(); on = !on; ls(KEY, on ? '1' : '0'); ss(TOAST, on ? 'on' : 'off'); location.reload(); /* lite mode changes how boards are built */
    };
    var pending = ss(TOAST);
    if (pending === 'on') toast(['OLD BROWSER MODE: ON', 'LITE GRAPHICS · FLAT MAZE · LESS GLOW'], 'on');
    else if (pending === 'off') toast(['OLD BROWSER MODE: OFF', 'FULL GRAPHICS'], 'off');
    else if (why) toast(['SLOW BROWSER DETECTED', 'SWITCHED TO LITE MODE · TAP THE ⚡ ICON TO CHANGE'], 'on');
    var files = ['../engine.js', 'gfx.js', 'app.js'], i = 0;
    (function next() { if (i >= files.length) return; var s = document.createElement('script'); s.src = files[i++]; s.onload = next; document.body.appendChild(s); })();
  }

  var saved = ls(KEY);
  if (saved !== null) return boot(saved === '1', false);        // the presenter chose: no benchmark

  window.PAC_LITE = false;
  var bootEl = document.getElementById('boot'), t0 = new Date().getTime(), first = ls('pac-checked') === null;
  var MIN = first ? 1900 : 300;                                  // first visit: slow on purpose so the check is visible
  var txt = document.getElementById('bootStep'), bar = document.getElementById('bootBar');
  function step(msg, pct) { if (txt) txt.innerHTML = msg; if (bar) bar.style.width = pct + '%'; }
  if (bootEl) bootEl.className = 'on';
  if (first) {
    step('TESTING PROCESSOR', 6);
    setTimeout(function () { step('TESTING GRAPHICS', 38); }, MIN * 0.28);
    setTimeout(function () { step('CHECKING LAYOUT SUPPORT', 70); }, MIN * 0.58);
  } else step('CHECKING BROWSER', 60);
  setTimeout(function () {                                      // let the overlay paint before the sync CPU test
    var cpu = cpuMs(), gapOk = flexGapOK();
    frameMs(function (fm) {
      var slow = !gapOk || cpu > CPU_LIMIT || (fm !== null && fm > FRAME_LIMIT);
      window.PAC_BENCH = { cpu: Math.round(cpu), frame: fm && Math.round(fm * 10) / 10, gap: gapOk, lite: slow };
      // never add delay on top of a check that was already slow by itself
      var wait = Math.max(0, MIN - (new Date().getTime() - t0)), hold = first ? 800 : 150;
      setTimeout(function () {
        step(slow ? '<span class="bs">SLOW BROWSER</span><br>LITE MODE ON' : '<span class="bf">FAST BROWSER</span><br>FULL GRAPHICS', 100);
        setTimeout(function () { ls('pac-checked', '1'); boot(slow, slow); }, hold);
      }, wait);
    });
  }, 80);
})();
