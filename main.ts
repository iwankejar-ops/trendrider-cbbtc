// TrendRider: buy early, hold the trend, exit only on a real break.
//
// What the dev window taught the first version of this bot: cbBTC's
// 1-minute bars are mostly noise (about 8 bps a minute), and a full round
// trip costs roughly 26 bps in fees, slippage and pool impact, so trading
// every wiggle loses money. The fast EMA-cross baseline lost $114.83 on
// the dev window with 76 trades; my own EMA-cross version lost $5.81
// with 12. Buy-and-hold made $32.17 with one trade and the momentum
// baseline $34.94, because the dev window simply rose 364 bps with a
// maximum drawdown under 2%. So this version trades the way the window
// rewards: get in early, stay in while the trend holds, and leave only
// when the trend itself breaks, not on every wiggle:
//
//   - A small probe trade guarantees the race guardrail (at least one
//     trade): after 24 scored bars, buy 10% of equity whatever the trend
//     says. In a market that only falls from the open, that probe is the
//     one trade that keeps the entry ranked with the entries that meet
//     the bar, and it can lose at most a few dollars.
//   - The main entry buys the rest when the latest close sits above its
//     120-bar average: the medium trend is up. It never chases a cross;
//     it holds while the close stays above that average.
//   - The exit sells everything when the close falls 150 bps under the
//     120-bar average, or 400 bps under the highest close since the
//     position opened, whichever comes first. A 400 bps give-back is far
//     outside the dev window's pullbacks, so a rising window is ridden
//     to the end; a falling one is left early.
//   - After an exit, wait 10 bars before the main entry can fire again,
//     so chop cannot re-enter on the same bounce.
//
// Long only, one position, no leverage, no shorts. Every order caps its
// slippage at 100 bps past the close it was decided on. The bot reads no
// clock, no environment and no file; the only inputs are the hello
// message and the batches the harness sends, and every decision is a
// pure function of the bars seen so far.

import { BPS, runBars, type Bar, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

/** Bars of history before the probe trade fires. */
const PROBE_BARS = 24;
/** The probe's share of equity, in basis points. */
const PROBE_BPS = 1000;
/** Bars in the trend average the entry and the exit read. */
const TREND_BARS = 120;
/** How far under the trend average the close must fall to exit. */
const EXIT_UNDER_BPS = 150;
/** Exit when the close gives back this much from the peak since entry. */
const TRAIL_BPS = 400;
/** Bars to wait after an exit before the main entry can fire again. */
const REENTRY_COOLDOWN_BARS = 10;
/** Largest fill move accepted past the close an order was decided on. */
const MAX_SLIPPAGE_BPS = 100;

interface Trend {
  /** Latest closes, oldest first, at most TREND_BARS of them. */
  closes: number[];
  /** Highest close since the current position opened, null while flat. */
  peak: number | null;
  /** First batch on which the main entry is allowed again. */
  coolUntil: number;
  /** Whether the probe trade has fired already. */
  probed: boolean;
}

const trends = new Map<string, Trend>();
/** Scored bars seen so far (warm-up batches do not count). */
let scoredBars = 0;

function freshTrend(): Trend {
  return { closes: [], peak: null, coolUntil: 0, probed: false };
}

function average(values: number[]): number {
  let sum = 0;
  for (const x of values) sum += x;
  return sum / values.length;
}

await runBars({
  onBatch(state: BarsState, batch) {
    const seen = new Set<string>();
    for (const bar of batch.bars) {
      let trend = trends.get(bar.symbol);
      if (trend === undefined) {
        trend = freshTrend();
        trends.set(bar.symbol, trend);
      }
      seen.add(bar.symbol);
      const close = Number(bar.c);
      trend.closes.push(close);
      if (trend.closes.length > TREND_BARS) trend.closes.shift();
      if (trend.peak !== null && close > trend.peak) trend.peak = close;
    }
    if (state.warmingUp) return [];
    scoredBars += 1;

    const { caps, fees } = state.hello;
    const sells: SellInput[] = [];
    const buys: BuyInput[] = [];

    for (const { symbol } of state.hello.symbols) {
      if (!seen.has(symbol)) continue;
      const trend = trends.get(symbol)!;
      const close = state.close(symbol);
      if (close === null) continue;
      const closeNum = Number(close);
      const held = state.positions.get(symbol);
      const trendAvg = trend.closes.length >= TREND_BARS ? average(trend.closes) : null;

      if (held !== undefined) {
        // Arm the trailing-stop peak from the first close the position
        // is actually held through, not from the close the buy was
        // decided on: a buy the market rejects must leave no stale
        // peak behind, and a fill lands a bar after its order.
        if (trend.peak === null) trend.peak = closeNum;
        // Holding: leave when the trend breaks or the trailing stop hits.
        const broken = trendAvg !== null && closeNum * 10_000 <= trendAvg * (10_000 - EXIT_UNDER_BPS);
        const peak = trend.peak;
        const stoppedOut = closeNum * 10_000 <= peak * (10_000 - TRAIL_BPS);
        if (broken || stoppedOut) {
          sells.push({ side: 'sell', symbol, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS });
          trend.coolUntil = state.seq + REENTRY_COOLDOWN_BARS;
          trend.peak = null;
          continue;
        }
        // Holding a probe only: scale in to full size once the trend
        // confirms, while the main entry window is open.
        if (trendAvg !== null && closeNum > trendAvg && state.seq >= trend.coolUntil) {
          let stake = state.weightRoom(symbol);
          if (stake > state.cash) stake = state.cash;
          if (stake > 0n && stake >= BigInt(fees.min_notional_quote_units)) {
            buys.push({ side: 'buy', symbol, notional_quote_units: stake, max_slippage_bps: MAX_SLIPPAGE_BPS });
          }
        }
        continue;
      }

      // Flat: the probe fires once, early, whatever the trend says, so
      // the entry always carries at least one trade into the race.
      if (!trend.probed && scoredBars >= PROBE_BARS) {
        trend.probed = true;
        const stake = (state.equity * BigInt(PROBE_BPS)) / BigInt(BPS);
        if (stake > 0n && stake >= BigInt(fees.min_notional_quote_units) && stake <= state.cash) {
          buys.push({ side: 'buy', symbol, notional_quote_units: stake, max_slippage_bps: MAX_SLIPPAGE_BPS });
          continue;
        }
      }

      // Flat after the probe: enter in full once the close clears its
      // 120-bar average and the re-entry wait has passed.
      if (trendAvg !== null && closeNum > trendAvg && state.seq >= trend.coolUntil) {
        let stake = state.cash;
        const byWeight = state.weightRoom(symbol);
        if (stake > byWeight) stake = byWeight;
        if (stake > 0n && stake >= BigInt(fees.min_notional_quote_units)) {
          buys.push({ side: 'buy', symbol, notional_quote_units: stake, max_slippage_bps: MAX_SLIPPAGE_BPS });
        }
      }
    }

    const orders: (SellInput | BuyInput)[] = sells.slice(0, caps.max_orders_per_bar);
    for (const buy of buys) {
      if (orders.length >= caps.max_orders_per_bar) break;
      orders.push(buy);
    }
    return orders;
  },
});
