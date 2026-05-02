const { sma, avgDollarVol } = require('../indicators');

function signalTurbo(ctx) {
  const smaL = 200;
  const perfW = 21;
  const liqThresh = 5e6;
  const priceKey = ctx.executionMode === 'close' ? 'close' : 'open';
  const spyRSI = ctx.state.spyRSI;

  if (ctx.signalIndex < Math.max(smaL, perfW)) {
    return { ready: false, allocation: {}, extras: {} };
  }

  const spySMA = sma(ctx.series.spy, ctx.signalIndex, smaL);
  const spyPrice = ctx.series.spy[ctx.signalIndex][priceKey];

  let riskOn = spyPrice > spySMA && spyRSI[ctx.signalIndex] >= 45;

  let tradables = ctx.state.turboUniverse.filter((tk) => ctx.series[tk] && ctx.series[tk][ctx.signalIndex]);
  tradables = tradables.filter((tk) => avgDollarVol(ctx.series[tk], ctx.signalIndex, 20) > liqThresh);

  tradables.sort((a, b) => (
    ctx.series[b][ctx.signalIndex].close / ctx.series[b][ctx.signalIndex - perfW].close
    - ctx.series[a][ctx.signalIndex].close / ctx.series[a][ctx.signalIndex - perfW].close
  ));

  if (riskOn && tradables.length < 2) riskOn = false;

  const longs = riskOn ? tradables.slice(0, 2) : ['tmf', 'shy'];
  const w = 1 / longs.length;
  const allocation = {};
  for (const tk of longs) allocation[tk] = w;

  return { ready: true, allocation, extras: { riskOn } };
}

module.exports = {
  signalTurbo,
};
