const { sma, stdev } = require('../indicators');

// TEMPEST — Futures-overlay strategy.
//
// Concept: use VIX futures ETPs as the primary regime tool, since they
// directly express market stress without the contango-decay problems of
// inverse leveraged equity ETFs.
//
// Three regimes (computed from SPY only):
//
//   CALM   -> SPY > 200SMA, SPY > 50SMA, realized 20d vol below trailing
//             leveraged longs (TQQQ + UPRO) plus a small SVXY vol-carry
//             sleeve (harvests contango when vol is grinding lower)
//
//   STORM  -> SPY < 50SMA AND short-window realized vol expanding faster
//             than the medium window (vol5 > vol20 by a margin)
//             long UVXY hedge (long VIX futures) + cash; avoids fighting
//             a falling tape with leveraged longs OR inverse ETFs
//
//   DRIFT  -> anything in between
//             defensive shy + gld
//
// VIX-futures ETPs come with their own decay (UVXY contango bleed, SVXY
// crash risk). Sizing is intentionally small (UVXY <= 25%, SVXY <= 10%).

function signalTempest(ctx) {
  const sigI = ctx.signalIndex;
  const series = ctx.series;
  const priceKey = ctx.executionMode === 'close' ? 'close' : 'open';

  if (sigI < 252) return { ready: false, allocation: {}, extras: {} };
  if (!series.spy || !series.shy) {
    return { ready: false, allocation: {}, extras: {} };
  }

  const spy = series.spy;
  const spyPx = spy[sigI][priceKey];

  const vol5 = stdev(spy, sigI, 5);
  const vol20 = stdev(spy, sigI, 20);
  const vol252 = stdev(spy, sigI, 252);

  const above200 = spyPx > sma(spy, sigI, 200);
  const above50 = spyPx > sma(spy, sigI, 50);
  const sixMoUp = sigI >= 126 && spy[sigI].close / spy[sigI - 126].close > 1.0;
  const calmVol = vol252 > 0 && vol20 < vol252 * 0.85;
  const stormVol = vol20 > 0 && vol5 > vol20 * 1.5;

  // STORM: market broken AND short-vol expanding aggressively.
  if (!above50 && stormVol && series.uvxy) {
    const allocation = { uvxy: 0.25 };
    if (series.gld) {
      allocation.shy = 0.55;
      allocation.gld = 0.20;
    } else {
      allocation.shy = 0.75;
    }
    return { ready: true, allocation, extras: { regime: 'storm' } };
  }

  // CALM: trend solid AND vol compressed -> leveraged longs + small carry.
  if (above200 && above50 && sixMoUp && calmVol) {
    const allocation = {};
    if (series.tqqq && series.upro) {
      allocation.tqqq = 0.45;
      allocation.upro = 0.45;
    } else if (series.tqqq) {
      allocation.tqqq = 0.9;
    } else {
      allocation.spy = 0.9;
    }
    if (series.svxy) {
      allocation.svxy = 0.10;
    } else {
      allocation.shy = 0.10;
    }
    return { ready: true, allocation, extras: { regime: 'calm' } };
  }

  // RISK-ON but not pristine: lighter leveraged exposure, no vol carry.
  if (above200 && above50 && sixMoUp) {
    const allocation = {};
    if (series.tqqq && series.upro) {
      allocation.tqqq = 0.30;
      allocation.upro = 0.30;
      allocation.shy = 0.40;
    } else {
      allocation.spy = 0.6;
      allocation.shy = 0.4;
    }
    return { ready: true, allocation, extras: { regime: 'riskon' } };
  }

  // DRIFT: defensive parking.
  const allocation = series.gld ? { shy: 0.6, gld: 0.4 } : { shy: 1.0 };
  return { ready: true, allocation, extras: { regime: 'drift' } };
}

module.exports = {
  signalTempest,
};
