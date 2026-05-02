const { sma } = require('../indicators');

function signalTrend(ctx) {
  const smaL = 100;
  const priceKey = ctx.executionMode === 'close' ? 'close' : 'open';
  const spyRSI = ctx.state.spyRSI;

  if (ctx.signalIndex < smaL || spyRSI[ctx.signalIndex] === null) {
    return { ready: false, allocation: {}, extras: {} };
  }

  const spySMA = sma(ctx.series.spy, ctx.signalIndex, smaL);
  const spyPrice = ctx.series.spy[ctx.signalIndex][priceKey];

  if (spyPrice < spySMA || spyRSI[ctx.signalIndex] < 40) {
    return { ready: true, allocation: {}, extras: {} };
  }

  return { ready: true, allocation: { upro: 1 }, extras: {} };
}

module.exports = {
  signalTrend,
};
