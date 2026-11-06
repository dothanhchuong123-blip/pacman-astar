#!/usr/bin/env python3
"""A* for "eat every dot" in a maze: the 18-line algorithm from the slides, runnable.

State = (position, bitmask of dots still uneaten). Eating a dot clears its bit.
Goal  = mask == 0.

Two heuristics are compared:
  h_sum  sum of Manhattan distances to every uneaten dot   (can overestimate -> not optimal)
  h_mst  nearest dot + minimum spanning tree over the dots (never overestimates -> optimal)

Nothing here is random. Neighbours are always tried in the order up, right, down, left,
so every run prints the same numbers.

Run:  python3 python/astar.py        (prints a table and checks it against the report)
"""
import sys
from heapq import heappop, heappush

INF = float("inf")


class Maze:
    """Rows of text. '#' wall, '.' dot, 'P' Pac-Man, '-' empty, 'x' costly tile (cost 10)."""

    def __init__(self, rows):
        self.h, self.w = len(rows), len(rows[0])
        self.wall, self.cost, self.dots, self.start = set(), {}, [], 0
        for y, row in enumerate(rows):
            for x, ch in enumerate(row):
                i = y * self.w + x
                self.cost[i] = 10 if ch == "x" else 1
                if ch == "#":
                    self.wall.add(i)
                elif ch == ".":
                    self.dots.append(i)
                elif ch == "P":
                    self.start = i
        self.bit = {d: 1 << k for k, d in enumerate(self.dots)}
        self.all = (1 << len(self.dots)) - 1

    def neighbors(self, i):
        x, y = i % self.w, i // self.w
        out = []
        if y > 0 and i - self.w not in self.wall:
            out.append(i - self.w)  # up
        if x < self.w - 1 and i + 1 not in self.wall:
            out.append(i + 1)  # right
        if y < self.h - 1 and i + self.w not in self.wall:
            out.append(i + self.w)  # down
        if x > 0 and i - 1 not in self.wall:
            out.append(i - 1)  # left
        return out

    def manhattan(self, a, b):
        return abs(a % self.w - b % self.w) + abs(a // self.w - b // self.w)

    def left(self, mask):
        return [d for k, d in enumerate(self.dots) if mask >> k & 1]


def h_sum(m, pos, mask):
    return sum(m.manhattan(pos, d) for d in m.left(mask))


def prim_mst(m, pts):
    if len(pts) < 2:
        return 0
    best = {p: INF for p in pts}
    best[pts[0]] = 0
    todo, total = set(pts), 0
    while todo:
        j = min(todo, key=lambda p: best[p])
        todo.remove(j)
        total += best[j]
        for p in todo:
            best[p] = min(best[p], m.manhattan(j, p))
    return total


def h_mst(m, pos, mask):
    left = m.left(mask)
    if not left:
        return 0
    near = min(m.manhattan(pos, d) for d in left)
    return near + prim_mst(m, left)


def astar(m, h):
    """The algorithm from the slide. Returns (cost, number of expanded states)."""
    s = (m.start, m.all)
    g = {s: 0}
    open_ = [(h(m, *s), h(m, *s), 0, s)]  # f, h, g, state
    expanded = 0
    while open_:
        f, _, gc, cur = heappop(open_)
        if gc > g[cur]:
            continue  # stale copy
        pos, mask = cur
        expanded += 1
        if mask == 0:
            return gc, expanded
        for nxt in m.neighbors(pos):
            nm = mask & ~m.bit.get(nxt, 0)  # eat
            ns = (nxt, nm)
            ng = gc + m.cost[nxt]
            if ng < g.get(ns, INF):
                g[ns] = ng
                heappush(open_, (ng + h(m, *ns), h(m, *ns), ng, ns))
    return INF, expanded


# The demo mazes used in the report (same strings as in engine.js / the slides).
MAZES = {
    "hook":  ["P---#---.--", "-##-#-##-#-", "-.-------#.", "-#-##.##-#-", "-------.---", "-##-#-##-#-", ".---#---.--"],
    "trap":  ["----.", "#---.", "-----", "-----", ".P---"],
    "trace": [".---#", "##---", "----.", "#-.--", "--#-P"],
    "race":  ["--#----", "-----.-", "---.--.", "-#-----", "---..--", "----P.-", "-------"],
    "row":   ["P..."],
    "relax": ["P------", "-#--##.", "#-#---#", "-#---#.", ".----#.", ".--#---", "#---##-"],
    "arena": ["-.#------", "#.----###", "-##-#----", ".-#-P-#--", ".-------.", "-##.-#--#", "#-------."],
}

# What the report states: (cost with h_sum, cost with h_mst, initial h_sum, initial h_mst)
EXPECTED = {
    "hook":  (48, 32, 62, 28),
    "trap":  (15, 9, 14, 9),
    "trace": (10, 10, 13, 10),
    "race":  (13, 11, 18, 11),
    "row":   (3, 3, 6, 3),
    "relax": (35, 29, 35, 14),
    "arena": (41, 30, 35, 20),
}


def main():
    print(f"{'maze':<7} {'A*+sum':>7} {'A*+mst':>7} {'h_sum(0)':>9} {'h_mst(0)':>9}  report")
    ok = True
    for name, rows in MAZES.items():
        m = Maze(rows)
        c_sum, _ = astar(m, h_sum)
        c_mst, _ = astar(m, h_mst)
        got = (c_sum, c_mst, h_sum(m, m.start, m.all), h_mst(m, m.start, m.all))
        same = got == EXPECTED[name]
        ok &= same
        print(f"{name:<7} {got[0]:>7} {got[1]:>7} {got[2]:>9} {got[3]:>9}  {'OK' if same else 'MISMATCH ' + str(EXPECTED[name])}")
    print("ALL MATCH THE REPORT" if ok else "MISMATCH")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
