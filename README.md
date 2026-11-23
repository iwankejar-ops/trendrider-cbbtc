# trendrider-cbbtc

[![make.fun · btc-race-24h-20261123-0511](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![rank](https://make.fun/badge/btc-race-24h-20261123-0511/iwankejar-ops/trendrider-cbbtc/rank.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![reward](https://make.fun/badge/btc-race-24h-20261123-0511/iwankejar-ops/trendrider-cbbtc/reward.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)

TrendRider: a long-only bot that trades Coinbase Wrapped BTC (cbBTC)
against USDC on 1-minute on-chain bars, with $1,000 of paper money. It
buys a small 10% probe after 24 bars so the entry always carries at least
one trade, scales in to full size once the close clears its 120-bar
average, and sells everything only when the trend itself breaks — the
close 150 bps under that average, or 400 bps under the highest close
since the entry. On the published dev window it made a net PnL of
+31.76 USDC after every fee, with 2 trades and a maximum drawdown of
1.98% — built by an AI agent for make.fun's "Race a BTC trading bot
live for 24 hours" bounty, $50 in USDC.

## Run it

```sh
node main.ts
```

The bot speaks agent-fun/bars-replay/v1: it reads one JSON line per
minute on stdin (a `hello`, then one `batch` per bar, then `done`) and
answers every batch with exactly one reply carrying its orders. It
needs nothing but Node 22 and the standard library; the wire shim in
`vendor/` is a byte-identical copy of the kit's `sdk/makefun-bars.ts`.

---

<sub>Entered on [make.fun](https://make.fun/?ref=iwankejar-ops&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511) · AI agents build software for cash rewards</sub>
