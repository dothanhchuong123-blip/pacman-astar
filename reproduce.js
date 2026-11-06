#!/usr/bin/env node
// Re-computes every number that appears in the report and checks it against the value printed there.
//
//   node reproduce.js            ~10 seconds   everything except the long 220-dot proof
//   node reproduce.js --full     ~2-3 minutes  also runs A* on all 220 dots (the "at least 226" bound)
//
// Randomness: none except seeded generators (see rng() in engine.js). Same seed -> same mazes, same
// tours, same games, on every machine. Only the wall-clock times that are printed in brackets vary.
// Exit code is 0 when every check passes and 1 otherwise.
'use strict';
const E = require('./engine.js');
const FULL = process.argv.includes('--full');
const t0 = Date.now();
let checks = 0, failed = 0;

const title = s => console.log('\n=== ' + s + ' ===');
function check(label, got, want) {
  checks++;
  const ok = got === want || (typeof got === 'number' && typeof want === 'number' && Math.abs(got - want) < 1e-9);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(58)} got ${got}${ok ? '' : '  (report says ' + want + ')'}`);
}
const ALLMASK = m => (1 << m.dots.length) - 1;
const pct = (a, b) => Math.round(100 * a / b);

// ---------------------------------------------------------------------------------------------
title('1. Demo mazes (slides 2-7, 9)');
const MZ = {
  hook:  ['P---#---.--', '-##-#-##-#-', '-.-------#.', '-#-##.##-#-', '-------.---', '-##-#-##-#-', '.---#---.--'],
  trap:  ['----.', '#---.', '-----', '-----', '.P---'],
  trace: ['.---#', '##---', '----.', '#-.--', '--#-P'],
  race:  ['--#----', '-----.-', '---.--.', '-#-----', '---..--', '----P.-', '-------'],
  row:   ['P...'],
  relax: ['P------', '-#--##.', '#-#---#', '-#---#.', '.----#.', '.--#---', '#---##-'],
  ghost: ['--.----', '-------', '--#----', '---#-#-', '-Px---.', '-#x####', '-.x-#--'],
  arena: ['-.#------', '#.----###', '-##-#----', '.-#-P-#--', '.-------.', '-##.-#--#', '#-------.'],
};
const mz = n => E.makeMaze(MZ[n]);
{
  const m = mz('hook');
  check('hook: A* with sum of distances (steps)', E.astar(m, 'sum').cost, 48);
  check('hook: A* with nearest + MST (steps)', E.astar(m, 'mst').cost, 32);
  check('hook: true optimum by BFS', E.bfs(m).cost, 32);
}
{
  const m = mz('row');
  check('row of 3 dots: sum of distances h(start)', E.H.sum(m, m.start, ALLMASK(m)), 6);
  check('row of 3 dots: true cost', E.bfs(m).cost, 3);
}
{
  const m = mz('trace');
  check('trace: h(start) with sum of distances', E.H.sum(m, m.start, ALLMASK(m)), 13);
  check('trace: real cost', E.astar(m, 'sum').cost, 10);
}
{
  const m = mz('trap');
  check('trap: A* with sum of distances', E.astar(m, 'sum').cost, 15);
  check('trap: A* with nearest + MST', E.astar(m, 'mst').cost, 9);
  // "same tile, different futures": Pac-Man on the centre tile with 3 dots left, then with 1 dot left
  const mini = dots => E.makeMaze(MZ.trap.map((r, y) => [...r].map((ch, x) => {
    const i = y * 5 + x; if (i === 12) return 'P';
    return (ch === '.' || ch === 'P') ? (dots.includes(i) ? '.' : '-') : ch;
  }).join('')));
  check('same tile, 3 dots left: more steps', E.bfs(mini([4, 9, 20])).cost, 12);
  check('same tile, 1 dot left: more steps', E.bfs(mini([20])).cost, 4);
}
{
  const m = mz('race'), A = ALLMASK(m), rem = E.remaining(m, A);
  const near = Math.min(...rem.map(d => E.manhattan(m, m.start, d))), tree = E.mstWeight(m, rem);
  check('race: sum of distances', E.H.sum(m, m.start, A), 18);
  check('race: nearest dot', near, 1);
  check('race: MST weight', tree, 10);
  check('race: true optimum', E.bfs(m).cost, 11);
}
{
  const m = mz('relax'), A = ALLMASK(m), hs = E.bfs(m).cost;
  check('relax: true cost h*', hs, 29);
  check('relax: h(start) MST on straight lines', E.H.mst(m, m.start, A), 14);
  check('relax: h(start) MST on real corridors', E.H.maze(m, m.start, A), 28);
  check('relax: h(start) sum of distances (overestimates)', E.H.sum(m, m.start, A), 35);
  check('relax: states expanded by UCS (h = 0)', E.bestFirst(m, 'ucs').expanded, 502);
  check('relax: states expanded, MST straight', E.bestFirst(m, 'astar', 'mst').expanded, 146);
  check('relax: states expanded, MST corridors', E.bestFirst(m, 'astar', 'maze').expanded, 31);
}
{
  const m = mz('ghost'), b = E.bfs(m), a = E.astar(m, 'mst');
  check('ghost tiles: BFS steps', b.steps, 19);
  check('ghost tiles: BFS real cost', b.cost, 73);
  check('ghost tiles: A* steps', a.steps, 21);
  check('ghost tiles: A* real cost', a.cost, 21);
}
{
  const m = mz('arena');
  check('arena: BFS expanded', E.bfs(m).expanded, 3175);
  check('arena: A* corridor-MST expanded', E.bestFirst(m, 'astar', 'maze').expanded, 101);
}

// ---------------------------------------------------------------------------------------------
title('2. Evidence: 500 random mazes per setting, seed 2026, 20% walls (slide 8)');
const WANT_SUBOPT = { '5x5/3': [153, 31, 5], '5x5/5': [385, 77, 9], '7x7/6': [446, 89, 16] };
for (const [w, h, k] of [[5, 5, 3], [5, 5, 5], [7, 7, 6]]) {
  const t = E.trials(2026, 500, w, h, k, 0.2), id = `${w}x${h}/${k}`;
  const [sub, p, worst] = WANT_SUBOPT[id];
  check(`${id}: mazes where the sum-of-distances path is longer`, t.subopt, sub);
  check(`${id}: ... as a percentage`, pct(t.subopt, t.n), p);
  check(`${id}: worst extra steps`, t.worst, worst);
  check(`${id}: mazes where nearest+MST is NOT optimal`, t.mstSubopt, 0);
  const avg = k => (t.exp[k] / t.n).toFixed(1);
  console.log(`      average states expanded  BFS ${avg('bfs')}  sum ${avg('sum')}  MST ${avg('mst')}  corridor-MST ${avg('maze')}`);
}

// ---------------------------------------------------------------------------------------------
title('3. Nine searches on 300 random 9x7 mazes with 8 dots, seed 2026 (slide 10, trade-offs)');
const acc = {}; let n = 0, hk = 0, tieOn = 0, tieOff = 0;
{
  const rand = E.rng(2026);
  while (n < 300) {
    const m = E.randomMaze(rand, 9, 7, 8, 0.2), b = E.bfs(m);
    if (!b.path) continue;
    n++;
    for (const f of E.FAMILY) {
      const r = f.run(m), a = acc[f.id] || (acc[f.id] = { e: 0, mem: 0, ok: 0 });
      a.e += r.expanded; a.mem += r.mem || 0; if (r.cost === b.cost) a.ok++;
    }
    if (E.heldKarp(m) === E.bestFirst(m, 'astar', 'maze').cost) hk++;
    tieOn += E.astar(m, 'mst', { tie: true }).expanded; tieOff += E.astar(m, 'mst', { tie: false }).expanded;
  }
}
const WANT_FAMILY = { bfs: [6263, 6941, 300], ucs: [6263, 7622, 300], dfs: [161, 257, 0], sum: [138, 313, 6], mst: [142, 314, 300],
  maze: [48, 149, 300], gbfs: [30, 105, 198], wa: [31, 108, 239], ida: [528, 25, 300] };
for (const f of E.FAMILY) {
  const a = acc[f.id], [e, mem, ok] = WANT_FAMILY[f.id];
  check(`${f.name.padEnd(8)} avg states expanded`, Math.round(a.e / n), e);
  check(`${f.name.padEnd(8)} avg peak memory (states)`, Math.round(a.mem / n), mem);
  check(`${f.name.padEnd(8)} mazes solved with the shortest path`, a.ok, ok);
}
check('Held-Karp equals A* corridor-MST in 300 mazes', hk, 300);
check('BFS needs this many times more states than A* MST', Math.round(acc.bfs.e / acc.mst.e), 44);
check('BFS needs this many times more states than A* corridor-MST', Math.round(acc.bfs.e / acc.maze.e), 130);
check('IDA* repeats this many times the work of A* corridor-MST', Math.round(acc.ida.e / acc.maze.e), 11);
check('tie-break on h saves (percent of states)', Math.round(100 * (1 - tieOn / tieOff)), 34);

// ---------------------------------------------------------------------------------------------
title('4. Where exact search hits a wall (slide 11): k random dots of the 220-dot arcade maze, dots chosen with seed 2026');
{
  const full = E.makeMaze(E.ARCADE);
  const subset = k => {
    const rand = E.rng(2026), d = full.dots.slice();
    for (let i = d.length - 1; i > 0; i--) { const j = (rand() * (i + 1)) | 0; [d[i], d[j]] = [d[j], d[i]]; }
    return Object.assign({}, full, { dots: d.slice(0, k), _toDot: null, _dd: null });
  };
  const WANT = { 10: [99, 185], 14: [99, 189], 18: [111, 310], 24: [118, 524], 40: [146, 18291] };
  console.log('      dots   states BFS      Held-Karp table   A* corridor-MST');
  for (const k of [10, 14, 18, 24, 40, 60]) {
    const m = subset(k), t = Date.now(), r = E.astarWide(m, { cap: 300000 });
    const states = BigInt(282) * 2n ** BigInt(k), table = BigInt(k) * 2n ** BigInt(k);
    console.log(`      ${String(k).padStart(4)}   ${states.toLocaleString('en-US').padStart(18)}   ${table.toLocaleString('en-US').padStart(15)}   ` +
      (r.solved ? `solved, cost ${r.cost}, ${r.expanded} expanded` : `stopped after ${r.expanded} expanded, proven >= ${r.bound}`) + `   [${((Date.now() - t) / 1000).toFixed(1)} s]`);
    if (WANT[k]) {
      check(`${k} dots: A* optimal cost`, r.cost, WANT[k][0]);
      check(`${k} dots: A* states expanded`, r.expanded, WANT[k][1]);
      if (k <= 18) check(`${k} dots: Held-Karp gives the same cost`, E.heldKarp(m), r.cost);
    } else {
      check(`${k} dots: A* gives up inside 300,000 expansions`, r.solved, false);
    }
  }
  check('BFS state count for 18 dots is about 74 million', Math.round(282 * 2 ** 18 / 1e6), 74);
  check('BFS state count for 220 dots is about 10^69', Math.round(Math.log10(282) + 220 * Math.log10(2)), 69);
  check('Held-Karp table for 24 dots is about 3 GB (8-byte cells)', Math.round(24 * 2 ** 24 * 8 / 1e9), 3);
}

// ---------------------------------------------------------------------------------------------
title('5. 220 dots: searching routes instead of states (slide 12)');
{
  const m = E.makeMaze(E.ARCADE), TM = E.tourMatrix(m);
  check('number of dots', m.dots.length, 220);
  check('random visiting order (seed 7)', E.tourLen(TM, E.randomTour(TM, E.rng(7))), 4186);
  const gr = E.greedyTour(TM);
  check('greedy: always the nearest dot', E.tourLen(TM, gr), 309);
  check('hill climbing with 2-opt, starts from greedy', E.tourLen(TM, E.twoOpt(TM, gr)), 293);
  const sa = E.annealer(TM, E.randomTour(TM, E.rng(7)), E.rng(4), { T0: 3, steps: 2e6 });
  sa.step(2e6);
  check('simulated annealing (seed 4, T0 3, 2,000,000 steps)', sa.bestLen, 256);
  console.log(`      MST lower bound on the dot graph: ${E.tourLowerBound(TM)} (one step per dot is the trivial bound)`);
  if (FULL) {
    const t = Date.now(), r = E.astarWide(m, { cap: 300000 });
    check('A* on all 220 dots, stopped after 300,000 expansions: solved?', r.solved, false);
    check('A* proved the optimum is at least', r.bound, 226);
    check('annealing is within this percentage of that bound', Math.round(100 * (sa.bestLen - r.bound) / r.bound), 13);
    console.log(`      [${((Date.now() - t) / 1000).toFixed(0)} s]`);
  } else {
    console.log('      (skipped: A* lower bound of 226 on 220 dots, run with --full, about 2 minutes)');
  }
}

// ---------------------------------------------------------------------------------------------
title('6. Ghosts that fight back (slides 13-14)');
{
  const duel = E.makeGame(['.-----.', '-#---#-', '.-.P.-.', '-#G#-#-', '.-----.']), s0 = E.gameStart(duel);
  // value of each first move when the ghost answers perfectly, one round deep
  const { V } = E.gameSearch(duel, 1, 'minimax');
  const val = {};
  for (const to of E.gameMoves(duel, s0, 0)) {
    const dx = (to % duel.w) - (s0.p % duel.w), dy = ((to / duel.w) | 0) - ((s0.p / duel.w) | 0);
    val[dy < 0 ? 'UP' : dy > 0 ? 'DOWN' : dx > 0 ? 'RIGHT' : 'LEFT'] = V(E.gameApply(duel, s0, 0, to), 1, 0);
  }
  check('minimax value of UP', val.UP, -3);
  check('minimax value of RIGHT', val.RIGHT, 7);
  check('minimax value of LEFT', val.LEFT, -491);
  const WANT_NODES = { 3: [651, 305], 4: [6105, 1794], 5: [40061, 6923], 6: [363790, 16348] };
  for (const d of [3, 4, 5, 6]) {
    const a = E.gameDecide(duel, s0, d, 'minimax'), b = E.gameDecide(duel, s0, d, 'alphabeta');
    check(`depth ${d}: nodes minimax`, a.nodes, WANT_NODES[d][0]);
    check(`depth ${d}: nodes alpha-beta`, b.nodes, WANT_NODES[d][1]);
    check(`depth ${d}: same move and same value`, a.move === b.move && a.value === b.value, true);
  }
  check('depth 6: alpha-beta saves this factor', Math.round(363790 / 16348), 22);
  const gG = E.games(duel, 'greedy', 3, 'chase', 2026, 1000), gA = E.games(duel, 'alphabeta', 3, 'chase', 2026, 1000);
  check('1,000 games vs chasing ghost: greedy wins (percent)', 100 * gG.rate, 4);
  check('1,000 games vs chasing ghost: alpha-beta depth 3 wins (percent)', 100 * gA.rate, 100);

  const pocket = E.makeGame(['--.-.--', '-#---#-', '---G---', '###P###', '###-###', '#######']);
  const R = (kind, ghost) => Math.round(100 * E.games(pocket, kind, 3, ghost, 2026, 1000).rate);
  {
    const ps = E.gameStart(pocket), step = (kind, to) => E.gameSearch(pocket, 3, kind).V(E.gameApply(pocket, ps, 0, to), 1, 0);
    const [m1, m2] = E.gameMoves(pocket, ps, 0);
    check('pocket: minimax value of the move that dies now', step('minimax', m1), -501);
    check('pocket: minimax value of the other move', step('minimax', m2), -502);
    check('pocket: expectimax value of waiting (rounded to 1 decimal)', Math.round(step('expectimax', m2) * 10) / 10, -130.5);
  }
  check('pocket, random ghost: minimax wins (percent)', R('minimax', 'random'), 0);
  check('pocket, random ghost: expectimax wins (percent)', R('expectimax', 'random'), 69);
  check('pocket, chasing ghost: minimax wins (percent)', R('minimax', 'chase'), 0);
  check('pocket, chasing ghost: expectimax wins (percent)', R('expectimax', 'chase'), 3);
}

// ---------------------------------------------------------------------------------------------
console.log(`\n${checks - failed} / ${checks} checks match the report.  ${failed ? 'MISMATCH' : 'ALL GOOD'}   [${((Date.now() - t0) / 1000).toFixed(0)} s]`);
process.exit(failed ? 1 : 0);
