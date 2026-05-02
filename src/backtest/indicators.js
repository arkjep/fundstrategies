function sma(arr, i, len) {
  if (i < len - 1) return null;
  let s = 0;
  for (let k = i - len + 1; k <= i; k += 1) s += arr[k].close;
  return s / len;
}

function computeRSI(arr, len = 14) {
  const res = new Array(arr.length).fill(null);
  let gains = 0;
  let losses = 0;

  for (let i = 1; i < len; i += 1) {
    const diff = arr[i].close - arr[i - 1].close;
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }

  for (let i = len; i < arr.length; i += 1) {
    const diff = arr[i].close - arr[i - 1].close;

    if (diff >= 0) {
      gains = ((gains * (len - 1)) + diff) / len;
      losses = (losses * (len - 1)) / len;
    } else {
      gains = (gains * (len - 1)) / len;
      losses = ((losses * (len - 1)) - diff) / len;
    }

    const rs = losses === 0 ? 100 : gains / losses;
    res[i] = 100 - 100 / (1 + rs);
  }

  return res;
}

function avgDollarVol(arr, i, len = 20) {
  if (i < len - 1) return 0;

  let sum = 0;
  let count = 0;
  for (let k = i - len + 1; k <= i; k += 1) {
    const p = arr[k];
    if (!p) continue;
    if (Number.isFinite(p.close) && Number.isFinite(p.vol)) {
      sum += p.close * p.vol;
      count += 1;
    }
  }

  return count ? (sum / len) : 0;
}

module.exports = {
  sma,
  computeRSI,
  avgDollarVol,
};
