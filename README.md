# Pac-Man Pathfinding with A*

Pac-Man has one job: eat every dot in the fewest steps. This repository holds the code behind our
course project report: a search engine for the "eat every dot" problem, the heuristics we compare,
the experiments in the report, and an interactive demo.

* Live demo: https://pacmanchuong.vercel.app
* Everything in the report can be recomputed with one command (see below).

## What is inside

| Path | What it is |
|---|---|
| `engine.js` | The search engine (plain JavaScript, no dependencies): A\*, BFS, UCS, greedy, weighted A\*, IDA\*, DFS, Held-Karp, tour search (greedy, 2-opt, simulated annealing), minimax, alpha-beta and expectimax. |
| `reproduce.js` | Recomputes every number in the report and checks it against the value printed there. |
| `python/astar.py` | The 18-line A\* from the slides in Python, with both heuristics. Cross-checks the JavaScript results on the demo mazes. |
| `demo/` | The interactive slides (open in a browser). |
| `expected_output.txt` | What `node reproduce.js` prints. `expected_output_full.txt` is the same with `--full`. |

## Reproduce the results

Requirements: Node.js 18 or newer. Python 3 is only needed for `python/astar.py`.

```bash
node reproduce.js            # about 10 seconds
node reproduce.js --full     # about 2-3 minutes, adds the 220-dot lower bound of 226
python3 python/astar.py      # same demo mazes, Python implementation
```

Every line is `PASS` or `FAIL` for one number in the report, and the last line says how many match.
The exit code is `0` when everything matches. Compare with `expected_output.txt`.

### Where the randomness is (and why it does not change the results)

Nothing uses `Math.random()`. All random choices go through `rng(seed)` in `engine.js`, a small seeded
generator (mulberry32). The same seed gives the same sequence on every machine and every run.

| Seed | Used for |
|---|---|
| `2026` | 500 random mazes per setting; 300 random 9x7 mazes with 8 dots; choice of k dots in the arcade maze; batches of 1,000 games |
| `7` | the random visiting order of the 220 dots (4,186 steps) |
| `4` | simulated annealing on the 220-dot tour (T0 = 3, 2,000,000 steps, result 256) |

Other sources of determinism: neighbours are always expanded in the order up, right, down, left, and
heap ties are broken by `(f, h, insertion order)`. Counts of expanded states are therefore exact.
Only wall-clock times (printed in square brackets, or shown in the demo) differ between machines.
Where the report says "A\* gave up", it means "stopped after 300,000 expansions", not a time limit.

## What is measured

The state is `(position, bitmask of dots left)`; the goal is `mask == 0`. Two heuristics for A\*:

* `sum`: sum of Manhattan distances to every uneaten dot. It can overestimate, so A\* is not always optimal.
* `mst`: distance to the nearest dot plus the weight of a minimum spanning tree over the uneaten dots.
  It never overestimates, so A\* is optimal. `maze` is the same idea measured along real corridors.

Headline results (all checked by `reproduce.js`):

* 500 random mazes, seed 2026: the sum heuristic returns a longer path in 31% / 77% / 89% of mazes
  (5x5 with 3 dots, 5x5 with 5 dots, 7x7 with 6 dots). Nearest + MST is optimal in 500 / 500 of each.
* On 300 random 9x7 mazes with 8 dots, A\* with corridor-MST expands 48 states on average, BFS 6,263.
* Eating every dot is a travelling-salesman problem. Exact search stops near 60 dots; on the 220-dot
  arcade maze simulated annealing finds a 256-step route, and A\* proves that no route shorter than 226 exists.
* Against a ghost that fights back: alpha-beta (depth 3) wins 1,000 / 1,000 games, greedy wins 4%.
  In the cornered "pocket" maze minimax wins 0% against a random ghost and expectimax wins 69%.

## Run the demo locally

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000/demo/ . The demo loads `engine.js` from the repository root, so serve the
repository root, not the `demo/` folder.

## License

MIT, see `LICENSE`.
