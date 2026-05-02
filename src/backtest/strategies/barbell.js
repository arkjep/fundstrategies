const { sma } = require('../indicators');

function signalBarbell(ctx) {
  const smaL = 100;
  const priceKey = ctx.executionMode === 'close' ? 'close' : 'open';
  const spyRSI = ctx.state.spyRSI;

  if (ctx.signalIndex < smaL || spyRSI[ctx.signalIndex] === null) {
    return { ready: false, allocation: {}, extras: {} };
  }

  const spySMA = sma(ctx.series.spy, ctx.signalIndex, smaL);
  const tltSMA = sma(ctx.series.tlt, ctx.signalIndex, smaL);
  const spyPrice = ctx.series.spy[ctx.signalIndex][priceKey];
  const tltPrice = ctx.series.tlt[ctx.signalIndex][priceKey];

  const allocation = {};
  if (spyPrice < spySMA || spyRSI[ctx.signalIndex] < 40) {
    allocation.upro = 0.30;
    allocation.splv = 0.30;
  } else {
    allocation.upro = 0.60;
  }

  allocation[tltPrice < tltSMA ? 'shy' : 'tmf'] = 0.40;
  return { ready: true, allocation, extras: {} };
}

module.exports = {
  signalBarbell,
};
