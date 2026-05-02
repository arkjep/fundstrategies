const { sma } = require('../indicators');

function signalDMR(ctx) {
  const perfW = 21;
  const smaL = 200;
  const risk = ['spy', 'qqq', 'iwm'];
  const def = ['tlt', 'gld', 'shy'];
  const priceKey = ctx.executionMode === 'close' ? 'close' : 'open';

  if (ctx.signalIndex < Math.max(perfW, smaL) || (ctx.i - ctx.userStartIndex) < Math.max(perfW, smaL)) {
    return { ready: false, allocation: {}, extras: {} };
  }

  const ranks = risk.slice().sort((a, b) => (
    ctx.series[b][ctx.signalIndex].close / ctx.series[b][ctx.signalIndex - perfW].close
    - ctx.series[a][ctx.signalIndex].close / ctx.series[a][ctx.signalIndex - perfW].close
  ));

  const active = ranks.filter((tk) => (
    ctx.series[tk][ctx.signalIndex][priceKey] > sma(ctx.series[tk], ctx.signalIndex, smaL)
  ));

  const longs = (active.length ? active : def).slice(0, 2);
  const w = 1 / longs.length;
  const allocation = {};
  for (const tk of longs) allocation[tk] = w;

  return { ready: true, allocation, extras: { riskOn: active.length > 0 } };
}

module.exports = {
  signalDMR,
};
