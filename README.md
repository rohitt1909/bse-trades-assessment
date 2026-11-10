# BSE Trades: Long-Running Pull Dashboard

A mock BSE exchange API whose trade pull takes up to 15 minutes, plus a live dashboard.

The design works around a network that kills HTTP connections held open longer than 30 seconds.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the diagram and design reasoning.

## Structure

```

mock-bse/   Mock BSE API (GET /getTrades), port 5000

backend/    Webhook receiver + SQLite + SSE + dashboard, port 4000

  public/   Dashboard (index.html)

```

## Requirements

- Node.js 18 or newer (uses built-in `fetch`)

## Setup

```bash

cd mock-bse

npm install

cd ../backend

npm install

```

## Run

Open two terminals.

**Terminal 1: Mock BSE API**

```powershell

cd mock-bse

node server.js

```

**Terminal 2: Backend + Dashboard**

```powershell

cd backend

node server.js

```

Open **http://localhost:4000** and click **Start Pull**.

### Quick demo (20-second pull instead of 15 minutes)

```powershell

# Windows PowerShell

$env:PULL_DELAY_MS=20000; node server.js

```

```bash

# macOS / Linux

PULL_DELAY_MS=20000 node server.js

```

## Configuration

| Variable | Service | Default | Meaning |

|---|---|---|---|

| `PULL_DELAY_MS` | mock-bse | 900000 (15 min) | Total time a pull takes |

| `TOTAL_TRADES` | mock-bse | 3000 | Number of seeded trades |

| `BATCH_SIZE` | mock-bse | 500 | Trades per webhook batch |

| `PORT` | both | 5000 / 4000 | Listening port |

| `BSE_URL` | backend | http://localhost:5000 | Where the mock BSE runs |

| `PUBLIC_URL` | backend | http://localhost:4000 | Webhook base URL given to BSE |

## How to verify the requirements

1. **Opens instantly with saved trades:** run a pull, then open a new tab at http://localhost:4000 mid-pull. Already-pulled trades appear immediately.

2. **Live updates:** keep the dashboard open. New batches appear without refresh.

3. **No polling or scheduler:** the pull is started by a button click. Data arrives by webhook and is pushed to the browser by SSE.

4. **30-second limit:** `GET /getTrades` returns `202 Accepted` in milliseconds. No connection is held open during the pull.

## Reset data

Stop the backend, delete `backend/trades.db*`, and start it again.

