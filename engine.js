// Search engine for the Pac-Man multi-dot problem.
// State = (cell index, bitmask of dots still uneaten). Works in the browser (window.PacEngine) and in Node.
//
// REPRODUCIBILITY
//   * There is no use of Math.random() anywhere. Every random choice goes through rng(seed), a small
//     seeded generator (mulberry32), so the same seed always gives the same mazes, tours and games.
//   * Neighbours are always expanded in the fixed order up, right, down, left, and heap ties are broken
//     by (f, h, insertion order), so A* is deterministic too.
//   * Seeds used in the report: 2026 (random mazes, game batches), 7 (random tour), 4 (annealing).
//   * Counts of expanded states are exact and repeat on every machine. Wall-clock times do not.
(function (root) {
  'use strict';

  const INF = 1e9;

  // ---------- maze helpers ----------
  function makeMaze(rows, opts = {}) {
    // rows: array of strings. '#' wall, '.' dot, 'P' start, ' ' or '-' empty, 'x' danger tile (cost 10)
    const h = rows.length, w = rows[0].length;
    const walls = new Uint8Array(w * h), cost = new Uint8Array(w * h).fill(1);
    const dots = [];
    let start = 0;
    rows.forEach((r, y) => [...r].forEach((c, x) => {
      const i = y * w + x;
      if (c === '#') walls[i] = 1;
      else if (c === '.') dots.push(i);
      else if (c === 'P') start = i;
      else if (c === 'x') cost[i] = opts.danger || 10;
    }));
    return { w, h, walls, cost, dots, start };
  }

  function neighbors(m, i) {
    const x = i % m.w, y = (i / m.w) | 0, out = [];
    // order: up, right, down, left (fixed so every run is deterministic)
    if (y > 0 && !m.walls[i - m.w]) out.push(i - m.w);
    if (x < m.w - 1 && !m.walls[i + 1]) out.push(i + 1);
    if (y < m.h - 1 && !m.walls[i + m.w]) out.push(i + m.w);
    if (x > 0 && !m.walls[i - 1]) out.push(i - 1);
    return out;
  }

  const xy = (m, i) => [i % m.w, (i / m.w) | 0];
  function manhattan(m, a, b) {
    return Math.abs(a % m.w - b % m.w) + Math.abs(((a / m.w) | 0) - ((b / m.w) | 0));
  }

  function bitOf(m) {
    const bit = new Int32Array(m.w * m.h).fill(0);
    m.dots.forEach((d, k) => { bit[d] = 1 << k; });
    return bit;
  }

  // ---------- heuristics ----------
  function remaining(m, mask) {
    const r = [];
    for (let k = 0; k < m.dots.length; k++) if (mask >> k & 1) r.push(m.dots[k]);
    return r;
  }

  const H = {
    zero: () => 0,
    // sum of Manhattan distances to every uneaten dot (the "obvious" one — can overestimate)
    sum(m, pos, mask) {
      let s = 0;
      for (let k = 0; k < m.dots.length; k++) if (mask >> k & 1) s += manhattan(m, pos, m.dots[k]);
      return s;
    },
    // distance to the nearest dot + weight of a minimum spanning tree over the uneaten dots (never overestimates)
    mst(m, pos, mask) {
      const r = remaining(m, mask);
      if (!r.length) return 0;
      let near = INF;
      for (const d of r) near = Math.min(near, manhattan(m, pos, d));
      return near + mstWeight(m, r);
    },
  };

  function mstWeight(m, pts) {
    // Prim's algorithm on the complete Manhattan graph
    const n = pts.length;
    if (n < 2) return 0;
    const best = new Array(n).fill(INF), used = new Array(n).fill(false);
    best[0] = 0;
    let total = 0;
    for (let it = 0; it < n; it++) {
      let j = -1;
      for (let k = 0; k < n; k++) if (!used[k] && (j < 0 || best[k] < best[j])) j = k;
      used[j] = true; total += best[j];
      for (let k = 0; k < n; k++) if (!used[k]) best[k] = Math.min(best[k], manhattan(m, pts[j], pts[k]));
    }
    return total;
  }

  function mstEdges(m, pts) {
    const n = pts.length, edges = [];
    if (n < 2) return edges;
    const best = new Array(n).fill(INF), from = new Array(n).fill(-1), used = new Array(n).fill(false);
    best[0] = 0;
    for (let it = 0; it < n; it++) {
      let j = -1;
      for (let k = 0; k < n; k++) if (!used[k] && (j < 0 || best[k] < best[j])) j = k;
      used[j] = true;
      if (from[j] >= 0) edges.push([pts[from[j]], pts[j], best[j]]);
      for (let k = 0; k < n; k++) {
        const d = manhattan(m, pts[j], pts[k]);
        if (!used[k] && d < best[k]) { best[k] = d; from[k] = j; }
      }
    }
    return edges;
  }

  // ---------- binary heap ----------
  class Heap {
    constructor(less) { this.a = []; this.less = less; }
    get size() { return this.a.length; }
    push(v) {
      const a = this.a; a.push(v);
      let i = a.length - 1;
      while (i > 0) { const p = (i - 1) >> 1; if (!this.less(a[i], a[p])) break; [a[i], a[p]] = [a[p], a[i]]; i = p; }
    }
    pop() {
      const a = this.a, top = a[0], last = a.pop();
      if (a.length) {
        a[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1; let s = i;
          if (l < a.length && this.less(a[l], a[s])) s = l;
          if (r < a.length && this.less(a[r], a[s])) s = r;
          if (s === i) break;
          [a[i], a[s]] = [a[s], a[i]]; i = s;
        }
      }
      return top;
    }
    sorted(n) { return [...this.a].sort((x, y) => (this.less(x, y) ? -1 : 1)).slice(0, n); }
  }

  // ---------- A* (mirrors the 18-line Python on the slide) ----------
  // opts: { tie: true -> order by (f, h); false -> (f, FIFO) ; trace: record events for the code tracer }
  function astar(m, hName = 'mst', opts = {}) {
    const h = H[hName], tie = opts.tie !== false, trace = opts.trace ? [] : null;
    const K = m.dots.length, bit = bitOf(m), ALL = (1 << K) - 1;
    const key = (pos, mask) => pos * (1 << K) + mask;
    const g = new Map(), parent = new Map();
    let seq = 0, expanded = 0;
    const order = []; // cells in expansion order (for heat maps)
    const less = tie
      ? (a, b) => a.f !== b.f ? a.f < b.f : a.h !== b.h ? a.h < b.h : a.seq < b.seq
      : (a, b) => a.f !== b.f ? a.f < b.f : a.seq < b.seq;
    const open = new Heap(less);
    const h0 = h(m, m.start, ALL);
    g.set(key(m.start, ALL), 0);
    open.push({ f: h0, h: h0, g: 0, pos: m.start, mask: ALL, seq: seq++ });
    const snap = () => open.sorted(6).map(e => ({ f: e.f, h: e.h, g: e.g, pos: e.pos, mask: e.mask }));
    if (trace) trace.push({ t: 'init', line: 4, open: snap(), pos: m.start, mask: ALL, h: h0 });

    while (open.size) {
      const cur = open.pop();
      const ck = key(cur.pos, cur.mask);
      if (cur.g > g.get(ck)) { if (trace) trace.push({ t: 'stale', line: 7, cur, open: snap() }); continue; }
      expanded++; order.push(cur.pos);
      if (trace) trace.push({ t: 'pop', line: 6, cur, open: snap(), expanded });
      if (cur.mask === 0) {
        const path = rebuild(parent, cur.pos, cur.mask, key, K);
        if (trace) trace.push({ t: 'goal', line: 10, cur, path, open: snap(), expanded });
        return { cost: cur.g, path, steps: path.length - 1, expanded, order, trace };
      }
      for (const nxt of neighbors(m, cur.pos)) {
        const nm = cur.mask & ~bit[nxt];
        const ng = cur.g + m.cost[nxt];
        const nk = key(nxt, nm);
        const old = g.has(nk) ? g.get(nk) : INF;
        if (ng < old) {
          const hh = h(m, nxt, nm);
          g.set(nk, ng); parent.set(nk, ck);
          open.push({ f: ng + hh, h: hh, g: ng, pos: nxt, mask: nm, seq: seq++ });
          if (trace) trace.push({ t: 'push', line: 17, from: cur.pos, pos: nxt, mask: nm, ate: nm !== cur.mask, g: ng, h: hh, f: ng + hh, open: snap() });
        } else if (trace) {
          trace.push({ t: 'skip', line: 15, from: cur.pos, pos: nxt, mask: nm, g: ng, old, open: snap() });
        }
      }
    }
    if (trace) trace.push({ t: 'fail', line: 18 });
    return { cost: INF, path: null, steps: INF, expanded, order, trace };
  }

  function rebuild(parent, pos, mask, key, K) {
    const path = [];
    let k = key(pos, mask);
    const span = 1 << K;
    while (k !== undefined) { path.push(Math.floor(k / span)); k = parent.get(k); }
    return path.reverse();
  }

  // ---------- BFS over (pos, mask): fewest steps, ignores tile costs ----------
  function bfs(m) {
    const K = m.dots.length, bit = bitOf(m), ALL = (1 << K) - 1, span = 1 << K;
    const key = (pos, mask) => pos * span + mask;
    const parent = new Map(), order = [];
    const s = key(m.start, ALL);
    parent.set(s, undefined);
    let q = [s], head = 0, expanded = 0;
    while (head < q.length) {
      const k = q[head++], pos = Math.floor(k / span), mask = k % span;
      expanded++; order.push(pos);
      if (mask === 0) {
        const path = rebuild(parent, pos, mask, key, K);
        let cost = 0; for (let i = 1; i < path.length; i++) cost += m.cost[path[i]];
        return { cost, path, steps: path.length - 1, expanded, order, mem: parent.size };
      }
      for (const nxt of neighbors(m, pos)) {
        const nk = key(nxt, mask & ~bit[nxt]);
        if (!parent.has(nk)) { parent.set(nk, k); q.push(nk); }
      }
    }
    return { cost: INF, path: null, steps: INF, expanded, order };
  }

  // ---------- random mazes ----------
  function rng(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function randomMaze(rand, w, h, k, wallP = 0.2) {
    const cells = [...Array(w * h).keys()];
    for (let i = cells.length - 1; i > 0; i--) { const j = (rand() * (i + 1)) | 0; [cells[i], cells[j]] = [cells[j], cells[i]]; }
    const walls = new Uint8Array(w * h);
    for (const c of cells.slice(1 + k)) if (rand() < wallP) walls[c] = 1;
    return { w, h, walls, cost: new Uint8Array(w * h).fill(1), start: cells[0], dots: cells.slice(1, 1 + k) };
  }

  // stateful trial runner so the browser can run a few trials per frame; same seed -> same numbers
  function trialRunner(seed, w, h, k, wallP = 0.2) {
    const rand = rng(seed);
    const s = { n: 0, subopt: 0, extra: 0, worst: 0, mstSubopt: 0, exp: { bfs: 0, sum: 0, mst: 0, maze: 0 }, log: [] };
    s.run = function (count) {
      for (let done = 0; done < count;) {
        const m = randomMaze(rand, w, h, k, wallP);
        const b = bfs(m);
        if (!b.path) continue;
        const a = astar(m, 'sum'), c = astar(m, 'mst');
        s.n++; done++;
        if (a.cost > b.cost) { s.subopt++; s.extra += a.cost - b.cost; s.worst = Math.max(s.worst, a.cost - b.cost); }
        if (c.cost !== b.cost) s.mstSubopt++;
        s.log.push({ extra: a.cost - b.cost, mstOk: c.cost === b.cost, m, aPath: a.path, bPath: b.path, aCost: a.cost, bCost: b.cost });
        s.exp.bfs += b.expanded; s.exp.sum += a.expanded; s.exp.mst += c.expanded;
        s.exp.maze += astar(m, 'maze').expanded;
      }
      return s;
    };
    return s;
  }

  function trials(seed, n, w, h, k, wallP = 0.2) { return trialRunner(seed, w, h, k, wallP).run(n); }

  // =====================================================================
  // ACT II additions: the whole search family, maze-distance heuristic,
  // effective branching factor, Held-Karp ground truth, tours for big mazes.
  // =====================================================================

  // ---------- true maze distances ----------
  // toDot[k][c] = cheapest cost to walk from cell c to dot k (Dijkstra run backwards from the dot, cost of entering a tile)
  function distTo(m, target) {
    const d = new Float64Array(m.w * m.h).fill(INF), open = new Heap((a, b) => a[0] < b[0]);
    d[target] = 0; open.push([0, target]);
    while (open.size) {
      const [dv, v] = open.pop();
      if (dv > d[v]) continue;
      for (const u of neighbors(m, v)) { const nd = dv + m.cost[v]; if (nd < d[u]) { d[u] = nd; open.push([nd, u]); } }
    }
    return d;
  }
  function toDots(m) {
    if (!m._toDot) m._toDot = m.dots.map(d => distTo(m, d));
    return m._toDot;
  }
  // symmetric dot-to-dot lower bound (min of both directions keeps it admissible when tiles have costs)
  function dotDist(m) {
    if (m._dd) return m._dd;
    const T = toDots(m), K = m.dots.length, dd = [];
    for (let a = 0; a < K; a++) { dd.push(new Float64Array(K)); for (let b = 0; b < K; b++) dd[a][b] = Math.min(T[b][m.dots[a]], T[a][m.dots[b]]); }
    return (m._dd = dd);
  }

  // nearest dot + MST, both measured along real corridors instead of straight through walls
  H.maze = function (m, pos, mask) {
    if (!mask) return 0;
    const T = toDots(m), dd = dotDist(m), K = m.dots.length, ids = [];
    let near = INF;
    for (let k = 0; k < K; k++) if (mask >> k & 1) { ids.push(k); if (T[k][pos] < near) near = T[k][pos]; }
    if (near >= INF) return INF;
    const n = ids.length, best = new Float64Array(n).fill(INF), used = new Uint8Array(n);
    best[0] = 0; let total = 0;
    for (let it = 0; it < n; it++) {
      let j = -1;
      for (let k = 0; k < n; k++) if (!used[k] && (j < 0 || best[k] < best[j])) j = k;
      used[j] = 1; total += best[j];
      for (let k = 0; k < n; k++) if (!used[k]) best[k] = Math.min(best[k], dd[ids[j]][ids[k]]);
    }
    return near + total;
  };
  // max distance to any single dot: admissible, but much weaker (shows "dominance")
  H.far = function (m, pos, mask) {
    const T = toDots(m); let f = 0;
    for (let k = 0; k < m.dots.length; k++) if (mask >> k & 1) f = Math.max(f, T[k][pos]);
    return f;
  };

  // ---------- one best-first engine for the whole family ----------
  // kind: 'ucs' f=g · 'astar' f=g+h · 'wastar' f=g+w·h · 'gbfs' f=h
  // mem = states held in memory at the end (the g-table + frontier is what A* has to keep)
  function bestFirst(m, kind, hName = 'maze', opts = {}) {
    const h = kind === 'ucs' ? H.zero : H[hName], w = kind === 'wastar' ? (opts.w || 2) : 1;
    const K = m.dots.length, bit = bitOf(m), ALL = (1 << K) - 1, span = 1 << K, cap = opts.cap || 3e6;
    const key = (pos, mask) => pos * span + mask;
    const g = new Map(), parent = new Map(), closed = kind === 'gbfs' ? new Set() : null;
    const less = (a, b) => a.f !== b.f ? a.f < b.f : a.h !== b.h ? a.h < b.h : a.seq < b.seq;
    const open = new Heap(less), order = [];
    let seq = 0, expanded = 0, peak = 0;
    const pri = (gg, hh) => kind === 'gbfs' ? hh : gg + w * hh;
    const h0 = h(m, m.start, ALL);
    g.set(key(m.start, ALL), 0);
    open.push({ f: pri(0, h0), h: h0, g: 0, pos: m.start, mask: ALL, seq: seq++ });
    while (open.size) {
      peak = Math.max(peak, open.size + g.size);
      const cur = open.pop(), ck = key(cur.pos, cur.mask);
      if (closed) { if (closed.has(ck)) continue; closed.add(ck); }
      else if (cur.g > g.get(ck)) continue;
      expanded++; order.push(cur.pos);
      if (expanded > cap) return { cost: INF, path: null, steps: INF, expanded, order, mem: peak, timeout: true };
      if (cur.mask === 0) {
        const path = rebuild(parent, cur.pos, cur.mask, key, K);
        return { cost: cur.g, path, steps: path.length - 1, expanded, order, mem: peak };
      }
      for (const nxt of neighbors(m, cur.pos)) {
        const nm = cur.mask & ~bit[nxt], ng = cur.g + m.cost[nxt], nk = key(nxt, nm);
        if (closed ? closed.has(nk) || g.has(nk) : ng >= (g.has(nk) ? g.get(nk) : INF)) continue;
        const hh = h(m, nxt, nm);
        g.set(nk, ng); parent.set(nk, ck);
        open.push({ f: pri(ng, hh), h: hh, g: ng, pos: nxt, mask: nm, seq: seq++ });
      }
    }
    return { cost: INF, path: null, steps: INF, expanded, order, mem: peak };
  }

  // ---------- A* with arbitrary-size masks (BigInt) ----------
  // The 32-bit masks above stop at 30 dots. This version has the same logic with BigInt masks so that
  // it can start on 40, 60 or all 220 dots. It stops after `cap` expansions and returns `bound`, the
  // largest f it popped: with an admissible h that is a proven lower bound on the optimal cost.
  function astarWide(m, { cap = 300000 } = {}) {
    const K = m.dots.length, T = toDots(m), dd = dotDist(m);
    const bitAt = new Map(m.dots.map((d, k) => [d, 1n << BigInt(k)]));
    const ALL = (1n << BigInt(K)) - 1n;
    const idsOf = mask => { const r = []; for (let k = 0; k < K; k++) if ((mask >> BigInt(k)) & 1n) r.push(k); return r; };
    const hOf = (pos, ids) => { // nearest dot + MST over corridor distances (same as H.maze)
      if (!ids.length) return 0;
      let near = INF; for (const k of ids) if (T[k][pos] < near) near = T[k][pos];
      const n = ids.length, best = new Float64Array(n).fill(INF), used = new Uint8Array(n);
      best[0] = 0; let total = 0;
      for (let it = 0; it < n; it++) {
        let j = -1; for (let k = 0; k < n; k++) if (!used[k] && (j < 0 || best[k] < best[j])) j = k;
        used[j] = 1; total += best[j];
        for (let k = 0; k < n; k++) if (!used[k]) { const d = dd[ids[j]][ids[k]]; if (d < best[k]) best[k] = d; }
      }
      return near + total;
    };
    const less = (a, b) => a.f !== b.f ? a.f < b.f : a.h !== b.h ? a.h < b.h : a.seq < b.seq;
    const open = new Heap(less), g = new Map(), key = (p, mk) => p + ':' + mk.toString(36);
    let seq = 0, expanded = 0, bound = 0;
    const h0 = hOf(m.start, idsOf(ALL));
    g.set(key(m.start, ALL), 0);
    open.push({ f: h0, h: h0, g: 0, pos: m.start, mask: ALL, seq: seq++ });
    while (open.size) {
      const cur = open.pop(), ck = key(cur.pos, cur.mask);
      if (cur.g > g.get(ck)) continue;
      expanded++; if (cur.f > bound) bound = cur.f;
      if (cur.mask === 0n) return { solved: true, cost: cur.g, expanded, bound: cur.f };
      if (expanded >= cap) return { solved: false, cost: INF, expanded, bound };
      for (const nxt of neighbors(m, cur.pos)) {
        const nm = cur.mask & ~(bitAt.get(nxt) || 0n), ng = cur.g + m.cost[nxt], nk = key(nxt, nm);
        if (ng < (g.has(nk) ? g.get(nk) : INF)) {
          const hh = hOf(nxt, idsOf(nm));
          g.set(nk, ng); open.push({ f: ng + hh, h: hh, g: ng, pos: nxt, mask: nm, seq: seq++ });
        }
      }
    }
    return { solved: false, cost: INF, expanded, bound };
  }

  // ---------- DFS (graph search): finds *a* path, no promise it is short ----------
  function dfs(m) {
    const K = m.dots.length, bit = bitOf(m), ALL = (1 << K) - 1, span = 1 << K;
    const key = (pos, mask) => pos * span + mask;
    const parent = new Map(), done = new Set(), order = [], stack = [key(m.start, ALL)];
    parent.set(stack[0], undefined);
    let expanded = 0, peak = 0;
    while (stack.length) {
      peak = Math.max(peak, stack.length + done.size);
      const k = stack.pop();
      if (done.has(k)) continue;
      done.add(k);
      const pos = Math.floor(k / span), mask = k % span;
      expanded++; order.push(pos);
      if (mask === 0) {
        const path = rebuild(parent, pos, mask, key, K);
        let cost = 0; for (let i = 1; i < path.length; i++) cost += m.cost[path[i]];
        return { cost, path, steps: path.length - 1, expanded, order, mem: peak };
      }
      const nb = neighbors(m, pos);
      for (let j = nb.length - 1; j >= 0; j--) {
        const nk = key(nb[j], mask & ~bit[nb[j]]);
        if (!done.has(nk)) { parent.set(nk, k); stack.push(nk); }
      }
    }
    return { cost: INF, path: null, steps: INF, expanded, order, mem: peak };
  }

  // ---------- IDA*: A*'s answer with almost no memory, paid for in re-expansions ----------
  function idastar(m, hName = 'maze', opts = {}) {
    const h = H[hName], bit = bitOf(m), K = m.dots.length, ALL = (1 << K) - 1, cap = opts.cap || 3e6;
    const path = [m.start], onPath = new Set([m.start * (1 << K) + ALL]), order = [];
    let expanded = 0, bound = h(m, m.start, ALL), maxDepth = 1, iters = 0;
    function dive(pos, mask, g) {
      const f = g + h(m, pos, mask);
      if (f > bound) return f;
      expanded++; order.push(pos);
      if (expanded > cap) return -2;
      if (mask === 0) return -1;
      let min = INF;
      for (const nxt of neighbors(m, pos)) {
        const nm = mask & ~bit[nxt], nk = nxt * (1 << K) + nm;
        if (onPath.has(nk)) continue;
        onPath.add(nk); path.push(nxt); maxDepth = Math.max(maxDepth, path.length);
        const t = dive(nxt, nm, g + m.cost[nxt]);
        if (t < 0) return t;
        if (t < min) min = t;
        onPath.delete(nk); path.pop();
      }
      return min;
    }
    for (;;) {
      iters++;
      const t = dive(m.start, ALL, 0);
      if (t === -1) {
        let cost = 0; for (let i = 1; i < path.length; i++) cost += m.cost[path[i]];
        return { cost, path: path.slice(), steps: path.length - 1, expanded, order, mem: maxDepth, iters };
      }
      if (t === -2) return { cost: INF, path: null, steps: INF, expanded, order, mem: maxDepth, iters, timeout: true };
      if (t >= INF) return { cost: INF, path: null, steps: INF, expanded, order, mem: maxDepth, iters };
      bound = t;
    }
  }

  // the line-up used by the arena / editor slide
  const FAMILY = [
    { id: 'bfs', name: 'BFS', run: m => bfs(m) },
    { id: 'dfs', name: 'DFS', run: m => dfs(m) },
    { id: 'ucs', name: 'UCS', run: m => bestFirst(m, 'ucs') },
    { id: 'gbfs', name: 'GREEDY', run: m => bestFirst(m, 'gbfs', 'maze') },
    { id: 'sum', name: 'A* Σ', run: m => bestFirst(m, 'astar', 'sum') },
    { id: 'mst', name: 'A* MST', run: m => bestFirst(m, 'astar', 'mst') },
    { id: 'maze', name: 'A* MAZE', run: m => bestFirst(m, 'astar', 'maze') },
    { id: 'wa', name: 'WA* ×2', run: m => bestFirst(m, 'wastar', 'maze', { w: 2 }) },
    { id: 'ida', name: 'IDA*', run: m => idastar(m, 'maze') },
  ];

  // ---------- effective branching factor: N + 1 = 1 + b + b² + … + b^d ----------
  function branching(N, d) {
    if (d <= 0) return 0;
    const tot = b => { let s = 1, p = 1; for (let i = 0; i < d; i++) { p *= b; s += p; } return s; };
    let lo = 1, hi = Math.max(2, N);
    if (tot(lo) >= N + 1) return 1;
    for (let it = 0; it < 80; it++) { const mid = (lo + hi) / 2; if (tot(mid) < N + 1) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  }

  // ---------- Held-Karp DP: exact answer by brute force over dot orders, O(2^K · K²) ----------
  // Eating every dot = shortest open tour through the dots on the maze-distance graph.
  function heldKarp(m) {
    const K = m.dots.length, T = toDots(m), span = 1 << K;
    const dp = new Float64Array(span * K).fill(INF);
    for (let k = 0; k < K; k++) dp[(1 << k) * K + k] = T[k][m.start];
    for (let S = 1; S < span; S++) for (let j = 0; j < K; j++) {
      const v = dp[S * K + j]; if (!(S >> j & 1) || v >= INF) continue;
      for (let k = 0; k < K; k++) {
        if (S >> k & 1) continue;
        const nv = v + T[k][m.dots[j]], idx = (S | 1 << k) * K + k;
        if (nv < dp[idx]) dp[idx] = nv;
      }
    }
    let best = INF; for (let j = 0; j < K; j++) best = Math.min(best, dp[(span - 1) * K + j]);
    return best;
  }

  // ---------- big mazes: tours over a distance matrix (node 0 = Pac-Man, 1..n = dots) ----------
  function tourMatrix(m) {
    const pts = [m.start, ...m.dots], n = pts.length, D = new Int32Array(n * n);
    pts.forEach((p, a) => {
      const d = new Int32Array(m.w * m.h).fill(-1), q = [p]; d[p] = 0;
      for (let h = 0; h < q.length; h++) for (const u of neighbors(m, q[h])) if (d[u] < 0) { d[u] = d[q[h]] + 1; q.push(u); }
      pts.forEach((r, b) => { D[a * n + b] = d[r]; });
    });
    return { pts, n, D, d: (a, b) => D[a * n + b] };
  }
  const tourLen = (TM, ord) => { let s = 0; for (let i = 1; i < ord.length; i++) s += TM.d(ord[i - 1], ord[i]); return s; };
  function greedyTour(TM) {
    const ord = [0], used = new Uint8Array(TM.n); used[0] = 1;
    for (let it = 1; it < TM.n; it++) {
      const a = ord[ord.length - 1]; let b = -1;
      for (let k = 1; k < TM.n; k++) if (!used[k] && (b < 0 || TM.d(a, k) < TM.d(a, b))) b = k;
      used[b] = 1; ord.push(b);
    }
    return ord;
  }
  function randomTour(TM, rand) {
    const ord = [...Array(TM.n).keys()];
    for (let i = ord.length - 1; i > 1; i--) { const j = 1 + ((rand() * i) | 0); [ord[i], ord[j]] = [ord[j], ord[i]]; }
    return ord;
  }
  // lower bound: any route through every dot is a spanning tree, so it can't beat the MST
  function tourLowerBound(TM) {
    const n = TM.n, best = new Float64Array(n).fill(INF), used = new Uint8Array(n); best[0] = 0; let total = 0;
    for (let it = 0; it < n; it++) {
      let j = -1; for (let k = 0; k < n; k++) if (!used[k] && (j < 0 || best[k] < best[j])) j = k;
      used[j] = 1; total += best[j];
      for (let k = 0; k < n; k++) if (!used[k]) best[k] = Math.min(best[k], TM.d(j, k));
    }
    return total;
  }
  // delta of reversing ord[i..j] in an open path that starts at ord[0]
  function revDelta(TM, o, i, j) {
    const a = o[i - 1], b = o[i], c = o[j], e = j + 1 < o.length ? o[j + 1] : -1;
    return TM.d(a, c) - TM.d(a, b) + (e < 0 ? 0 : TM.d(b, e) - TM.d(c, e));
  }
  function reverse(o, i, j) { while (i < j) { const t = o[i]; o[i] = o[j]; o[j] = t; i++; j--; } }
  // hill climbing: take any improving 2-opt move until none is left (a local optimum)
  function twoOpt(TM, ord) {
    const o = ord.slice(); let improved = true;
    while (improved) {
      improved = false;
      for (let i = 1; i < o.length - 1; i++) for (let j = i + 1; j < o.length; j++)
        if (revDelta(TM, o, i, j) < 0) { reverse(o, i, j); improved = true; }
    }
    return o;
  }
  // simulated annealing over 2-opt moves; step(n) lets the browser animate it frame by frame
  function annealer(TM, ord, rand, { T0 = 8, T1 = 0.05, steps = 4e5 } = {}) {
    const o = ord.slice(), s = { ord: o, len: tourLen(TM, o), best: null, bestLen: INF, done: 0, steps, T: T0, accWorse: 0, tried: 0 };
    s.best = o.slice(); s.bestLen = s.len;
    s.step = function (n) {
      for (let k = 0; k < n && s.done < steps; k++, s.done++) {
        s.T = T0 * Math.pow(T1 / T0, s.done / steps);
        let i = 1 + ((rand() * (o.length - 1)) | 0), j = 1 + ((rand() * (o.length - 1)) | 0);
        if (i === j) continue; if (i > j) [i, j] = [j, i];
        const dl = revDelta(TM, o, i, j); s.tried++;
        if (dl <= 0 || rand() < Math.exp(-dl / s.T)) {
          if (dl > 0) s.accWorse++;
          reverse(o, i, j); s.len += dl;
          if (s.len < s.bestLen) { s.bestLen = s.len; s.best = o.slice(); }
        }
      }
      return s;
    };
    return s;
  }
  // walk a tour along real corridors (for Pac-Man to follow)
  function tourPath(m, TM, ord) {
    const out = [TM.pts[ord[0]]];
    for (let i = 1; i < ord.length; i++) {
      const a = TM.pts[ord[i - 1]], b = TM.pts[ord[i]];
      if (a === b) continue;
      const prev = new Int32Array(m.w * m.h).fill(-1), q = [a]; prev[a] = a;
      for (let h = 0; h < q.length && prev[b] < 0; h++) for (const u of neighbors(m, q[h])) if (prev[u] < 0) { prev[u] = q[h]; q.push(u); }
      const seg = []; for (let c = b; c !== a; c = prev[c]) seg.push(c);
      out.push(...seg.reverse());
    }
    return out;
  }

  // =====================================================================
  // ACT III: adversarial search. Pac-Man (MAX) vs ghosts (MIN or CHANCE).
  // One ply per agent; Pac-Man has no "stop" move. Score: +10 dot, −1 move, ±500 win/lose.
  // =====================================================================
  const WIN = 500, LOSE = -500;
  // rows as makeMaze, plus 'G' for ghost starts; D = all-pairs corridor distance (small boards only)
  function makeGame(rows) {
    const m = makeMaze(rows.map(r => r.replace(/G/g, '-')));
    m.ghosts = [];
    rows.forEach((r, y) => [...r].forEach((c, x) => c === 'G' && m.ghosts.push(y * m.w + x)));
    m.D = [];
    for (let i = 0; i < m.w * m.h; i++) m.D.push(m.walls[i] ? null : distTo(m, i));
    return m;
  }
  const gameStart = m => ({ p: m.start, g: m.ghosts.slice(), mask: (1 << m.dots.length) - 1, score: 0, over: 0, t: 0 });
  // agent 0 = Pac-Man, 1.. = ghosts
  const gameMoves = (m, s, a) => neighbors(m, a ? s.g[a - 1] : s.p);
  function gameApply(m, s, a, to) {
    const n = { p: s.p, g: s.g.slice(), mask: s.mask, score: s.score, over: 0, t: s.t };
    if (a === 0) {
      n.p = to; n.score -= 1; n.t++;
      const k = m.dots.indexOf(to);
      if (k >= 0 && n.mask >> k & 1) { n.mask &= ~(1 << k); n.score += 10; }
    } else n.g[a - 1] = to;
    if (n.g.includes(n.p)) { n.over = -1; n.score += LOSE; }
    else if (!n.mask) { n.over = 1; n.score += WIN; }
    return n;
  }
  // leaf value when the search runs out of depth: points so far, minus the walk to the nearest dot
  function gameEval(m, s) {
    if (s.over) return s.score;
    let near = INF;
    for (let k = 0; k < m.dots.length; k++) if (s.mask >> k & 1) near = Math.min(near, m.D[m.dots[k]][s.p]);
    return s.score - near;
  }
  // kind: 'minimax' | 'alphabeta' | 'expectimax'; depth = full rounds (Pac-Man + every ghost)
  function gameSearch(m, depth, kind) {
    const st = { nodes: 0 };
    function V(s, a, d, al = -INF, be = INF) {
      st.nodes++;
      if (s.over || d === depth) return gameEval(m, s);
      const A = 1 + s.g.length, nx = (a + 1) % A, nd = nx === 0 ? d + 1 : d, mv = gameMoves(m, s, a);
      if (a === 0) {          // MAX: Pac-Man takes the best move
        let v = -INF;
        for (const to of mv) {
          v = Math.max(v, V(gameApply(m, s, 0, to), nx, nd, al, be));
          if (kind === 'alphabeta') { if (v > be) return v; al = Math.max(al, v); }
        }
        return v;
      }
      if (kind === 'expectimax') { // CHANCE: a random ghost, so average
        let t = 0;
        for (const to of mv) t += V(gameApply(m, s, a, to), nx, nd);
        return t / mv.length;
      }
      let v = INF;            // MIN: the ghost takes the worst move for Pac-Man
      for (const to of mv) {
        v = Math.min(v, V(gameApply(m, s, a, to), nx, nd, al, be));
        if (kind === 'alphabeta') { if (v < al) return v; be = Math.min(be, v); }
      }
      return v;
    }
    return { V, st };
  }
  function gameDecide(m, s, depth, kind) {
    const { V, st } = gameSearch(m, depth, kind), A = 1 + s.g.length;
    let best = -INF, move = -1, al = -INF;
    for (const to of gameMoves(m, s, 0)) {
      const v = V(gameApply(m, s, 0, to), 1 % A, A === 1 ? 1 : 0, al, INF);
      if (v > best) { best = v; move = to; }
      if (kind === 'alphabeta') al = Math.max(al, best);
    }
    return { move, value: best, nodes: st.nodes };
  }
  // ghost behaviour in simulations: 'random', or 'chase' = 80% step toward Pac-Man
  function ghostMove(m, s, a, kind, rand) {
    const mv = gameMoves(m, s, a);
    if (kind === 'chase' && rand() < 0.8) { let b = mv[0]; for (const c of mv) if (m.D[s.p][c] < m.D[s.p][b]) b = c; return b; }
    return mv[(rand() * mv.length) | 0];
  }
  // 'greedy' = walk toward the nearest dot and ignore ghosts
  function pacMove(m, s, kind, depth) {
    if (kind !== 'greedy') return gameDecide(m, s, depth, kind).move;
    let b = -1, bv = -INF;
    for (const to of gameMoves(m, s, 0)) { const v = gameEval(m, gameApply(m, s, 0, to)); if (v > bv) { bv = v; b = to; } }
    return b;
  }
  function playGame(m, pacKind, depth, ghostKind, rand, maxT = 200) {
    let s = gameStart(m); const trace = [s];
    while (!s.over && s.t < maxT) {
      s = gameApply(m, s, 0, pacMove(m, s, pacKind, depth)); trace.push(s);
      for (let a = 1; a <= s.g.length && !s.over; a++) { s = gameApply(m, s, a, ghostMove(m, s, a, ghostKind, rand)); trace.push(s); }
    }
    return { over: s.over, score: s.score, t: s.t, trace };
  }
  function games(m, pacKind, depth, ghostKind, seed, n) {
    const rand = rng(seed); let win = 0, lose = 0, score = 0, t = 0;
    for (let i = 0; i < n; i++) { const r = playGame(m, pacKind, depth, ghostKind, rand); if (r.over > 0) win++; if (r.over < 0) lose++; score += r.score; t += r.t; }
    return { n, win, lose, rate: win / n, score: score / n, t: t / n };
  }

  const ARCADE = ['............##............', '.####.#####.##.#####.####.', '.####.#####.##.#####.####.', '..........................',
    '.####.#.##########.#.####.', '......#............#......', '#####.###.######.###.#####', '#####.#------------#.#####',
    '#####.#-##########-#.#####', '#####.#-#--------#-#.#####', '-----.--#--------#--.-----', '#####.#-##########-#.#####',
    '#####.#------------#.#####', '#####.#.##########.#.#####', '............##............', '.####.#####.##.#####.####.',
    '...##.......P-.......##...', '##.##.#.##########.#.##.##', '......#.....##.....#......', '.##########.##.##########.',
    '..........................'];

  const api = { makeMaze, neighbors, manhattan, xy, H, mstWeight, mstEdges, remaining, astar, bfs, rng, randomMaze, trialRunner, trials, INF,
    distTo, toDots, dotDist, bestFirst, astarWide, dfs, idastar, FAMILY, branching, heldKarp,
    tourMatrix, tourLen, greedyTour, randomTour, tourLowerBound, twoOpt, annealer, tourPath, ARCADE,
    WIN, LOSE, makeGame, gameStart, gameMoves, gameApply, gameEval, gameSearch, gameDecide, ghostMove, pacMove, playGame, games };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PacEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
