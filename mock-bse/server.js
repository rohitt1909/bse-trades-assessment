const express = require('express');
const crypto = require('crypto');

const app = express();

// ---- Config (override with environment variables) ----
const PORT = process.env.PORT || 5000;
const PULL_DELAY_MS = Number(process.env.PULL_DELAY_MS || 15 * 60 * 1000); // default 15 min
const TOTAL_TRADES = Number(process.env.TOTAL_TRADES || 3000);
const BATCH_SIZE = Number(process.env.BATCH_SIZE || 500);

// ---- Seeded random generator (same data on every start) ----
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(42);
const CLIENTS = ['Reliance Securities', 'HDFC Securities', 'Zerodha Broking', 'ICICI Direct', 'Kotak Securities', 'Angel One'];
const SYMBOLS = {
  RELIANCE: 2900, TCS: 4100, INFY: 1750, HDFCBANK: 1650,
  ICICIBANK: 1200, SBIN: 820, ITC: 470, LT: 3600,
};

function generateTrades(count) {
  const symbols = Object.keys(SYMBOLS);
  const start = Date.now() - 6 * 60 * 60 * 1000;
  return Array.from({ length: count }, (_, i) => {
    const symbol = symbols[Math.floor(rand() * symbols.length)];
    const price = +(SYMBOLS[symbol] * (0.97 + rand() * 0.06)).toFixed(2);
    return {
      tradeId: `BSE${String(i + 1).padStart(6, '0')}`,
      client: CLIENTS[Math.floor(rand() * CLIENTS.length)],
      symbol,
      quantity: Math.floor(rand() * 500) + 1,
      price,
      timestamp: new Date(start + i * 7000).toISOString(),
    };
  });
}

const ALL_TRADES = generateTrades(TOTAL_TRADES);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Background job: sends trades in batches spread over PULL_DELAY_MS ----
async function runPullJob(jobId, callbackUrl) {
  const batches = [];
  for (let i = 0; i < ALL_TRADES.length; i += BATCH_SIZE) {
    batches.push(ALL_TRADES.slice(i, i + BATCH_SIZE));
  }
  const gap = PULL_DELAY_MS / batches.length;

  for (let i = 0; i < batches.length; i++) {
    await sleep(gap);
    try {
      await fetch(callbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId,
          batch: i + 1,
          totalBatches: batches.length,
          done: i === batches.length - 1,
          trades: batches[i],
        }),
      });
      console.log(`[${jobId}] sent batch ${i + 1}/${batches.length}`);
    } catch (err) {
      console.error(`[${jobId}] callback failed: ${err.message}`);
    }
  }
  console.log(`[${jobId}] pull complete`);
}

// ---- GET /getTrades: returns immediately, work continues in background ----
app.get('/getTrades', (req, res) => {
  const { callbackUrl } = req.query;
  if (!callbackUrl) {
    return res.status(400).json({ error: 'callbackUrl query param is required' });
  }
  const jobId = crypto.randomUUID();
  res.status(202).json({
    jobId,
    status: 'accepted',
    estimatedSeconds: Math.round(PULL_DELAY_MS / 1000),
  });
  runPullJob(jobId, callbackUrl); // not awaited, so the HTTP connection closes right away
});

app.listen(PORT, () => {
  console.log(`Mock BSE API on http://localhost:${PORT}`);
  console.log(`Pull delay: ${PULL_DELAY_MS / 1000}s, trades: ${TOTAL_TRADES}, batch size: ${BATCH_SIZE}`);
});