# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/cnmarky/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/cnmarky/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar ranks every pre-token protocol in a sealed DefiLlama snapshot by what its token launch would be worth, and gives each one a concrete farm plan. The board covers all 40 watchlist protocols plus every other protocol that passes the house's own exclusion rule (198 rows in this snapshot), and it keeps wrapped, staked and bridged products of tokens that already trade — WBTC, Binance staked ETH, USDT0, the exchange bridges — off the board entirely.

The model (radar-2) is one function of the snapshot's own figures, the same for every row and with no protocol name special-cased: implied value is TVL times a base multiple, times a growth multiplier from the 7-day TVL change, times a maturity multiplier from how long the protocol has run with no token on record, times a small chain-breadth multiplier. The base multiple is not asserted — it is the median market-cap-per-TVL of the live-token protocols in the same snapshot (0.2138x across 128 comparables here), read off the market instead of guessed. The dashboard recomputes every row from the same figures, so a reader can check the board's number by hand.

The dashboard is a static page with no network: a top-ten spotlight, a sortable and filterable board (search, category, chain, 7-day growth, watchlist-only), a detail view for every protocol with the model broken down line by line and a seven-step farm plan with costs and times, a live-token view set aside with market caps, and the methodology and category mix. Each farm plan is derived from the protocol's own record — category, chains, TVL and age — never from a hand-written list of names.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Requires Node.js 22.18 or later. The program reads the sealed snapshot, writes `board.json` (198 rows), `data.js`, and copies `dashboard/` and `screenshots/` to the output directory, then writes `dossier.json` with the vendored make.fun library.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
