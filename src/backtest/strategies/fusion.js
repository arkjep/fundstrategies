const { signalApex } = require('./apex');
const { signalTempest } = require('./tempest');

// FUSION — 70% apex (offense) + 30% tempest (VIX-futures hedge).
//
// Both child strategies generate a daily target allocation. We weight
// them and merge into a single allocation. State for both children must
// be present (apexUniverse, apexBearUniverse) — set up by index.js.

const APEX_WEIGHT = 0.70;
const TEMPEST_WEIGHT = 0.30;

function signalFusion(ctx) {
  const apexParams = ctx.state.fusionParams && ctx.state.fusionParams.apex;
  const childCtx = apexParams
    ? { ...ctx, state: { ...ctx.state, apexParams } }
    : ctx;

  const a = signalApex(childCtx);
  const t = signalTempest(ctx);

  if (!a.ready && !t.ready) return { ready: false, allocation: {}, extras: {} };

  // If only one is ready, scale that one up to full so we are not under-invested.
  const aw = a.ready ? APEX_WEIGHT : 0;
  const tw = t.ready ? TEMPEST_WEIGHT : 0;
  const total = aw + tw;
  if (total <= 0) return { ready: false, allocation: {}, extras: {} };
  const aFinal = aw / total;
  const tFinal = tw / total;

  const allocation = {};
  if (a.ready) {
    for (const [tk, w] of Object.entries(a.allocation)) {
      allocation[tk] = (allocation[tk] || 0) + w * aFinal;
    }
  }
  if (t.ready) {
    for (const [tk, w] of Object.entries(t.allocation)) {
      allocation[tk] = (allocation[tk] || 0) + w * tFinal;
    }
  }

  return {
    ready: true,
    allocation,
    extras: {
      apexReady: a.ready,
      tempestReady: t.ready,
      apexExtras: a.extras,
      tempestExtras: t.extras,
    },
  };
}

module.exports = {
  signalFusion,
};
