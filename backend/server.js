const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');

const PORT = process.env.PORT || 4000;
const BSE_URL = process.env.BSE_URL || 'http://localhost:5000';
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;

// ---------- Database ----------
const db = new Database(path.join(__dirname, 'trades.db'));
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS trades (
    seq       INTEGER PRIMARY KEY AUTOINCREMENT,
    trade_id  TEXT UNIQUE NOT NULL,
    client    TEXT,
    symbol    TEXT,
    quantity  INTEGER,
    price     REAL,
    timestamp TEXT
  )
`);

const insertTrade = db.prepare(`
  INSERT OR IGNORE INTO trades (trade_id, client, symbol, quantity, price, timestamp)
  VALUES (@tradeId, @client, @symbol, @quantity, @price, @timestamp)
`);
const insertMany = db.transaction((trades) => {
  for (const t of trades) insertTrade.run(t);
});
const maxSeq = () => db.prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM trades').get().m;
const tradesAfter = db.prepare('SELECT * FROM trades WHERE seq > ? ORDER BY seq');

// ---------- Pull status (in memory) ----------
let pullStatus = { state: 'idle', jobId: null, batch: 0, totalBatches: 0, startedAt: null };

// ---------- SSE clients ----------
const clients = new Set();
function broadcast(event, data, id) {
  const msg = (id ? `id: ${id}\n` : '') + `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public'))); // dashboard (Step 3)

// 1) Dashboard loads saved trades instantly (optionally only newer ones)
app.get('/api/trades', (req, res) => {
  const after = Number(req.query.after || 0);
  res.json({ trades: tradesAfter.all(after), lastSeq: maxSeq(), status: pullStatus });
});

app.get('/api/status', (req, res) => res.json(pullStatus));

// 2) Live stream to the dashboard
app.get('/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();
  res.write('retry: 2000\n\n'); // browser reconnects after 2s if the connection drops
  clients.add(res);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 15000);
  req.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(res);
  });
});

// 3) Webhook: the mock BSE pushes batches here
app.post('/webhook', (req, res) => {
  const { jobId, batch, totalBatches, done, trades } = req.body;
  const before = maxSeq();
  insertMany(trades || []);
  const added = tradesAfter.all(before);

  pullStatus = {
    ...pullStatus,
    state: done ? 'complete' : 'running',
    jobId, batch, totalBatches,
  };

  if (added.length) broadcast('trades', added, maxSeq());
  broadcast('status', pullStatus);
  console.log(`[webhook] batch ${batch}/${totalBatches}: +${added.length} new trades`);
  res.sendStatus(200);
});

// 4) Start a pull (event-driven: triggered by a button, not a scheduler)
app.post('/api/pull', async (req, res) => {
  if (pullStatus.state === 'running') {
    return res.status(409).json({ error: 'A pull is already in progress' });
  }
  try {
    const callbackUrl = encodeURIComponent(`${PUBLIC_URL}/webhook`);
    const r = await fetch(`${BSE_URL}/getTrades?callbackUrl=${callbackUrl}`);
    const job = await r.json();
    pullStatus = { state: 'running', jobId: job.jobId, batch: 0, totalBatches: 0, startedAt: new Date().toISOString() };
    broadcast('status', pullStatus);
    res.status(202).json(pullStatus);
  } catch (err) {
    res.status(502).json({ error: `Could not reach BSE API: ${err.message}` });
  }
});

app.listen(PORT, () => console.log(`Backend on http://localhost:${PORT}`));