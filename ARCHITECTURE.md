\# Architecture Note



\## Problem



A full BSE pull takes up to 15 minutes, but the network kills any HTTP connection open longer than 30 seconds.

A single request that waits for the data can never work.



\## Design: async job + webhook + server push



```mermaid

sequenceDiagram

&#x20;   participant D as Dashboard (browser)

&#x20;   participant B as Backend (:4000)

&#x20;   participant S as SQLite

&#x20;   participant X as Mock BSE (:5000)



&#x20;   D->>B: GET /api/trades (instant, from DB)

&#x20;   B->>S: read saved trades

&#x20;   B-->>D: trades already pulled

&#x20;   D->>B: GET /events (SSE, stays open)

&#x20;   D->>B: POST /api/pull

&#x20;   B->>X: GET /getTrades?callbackUrl=...

&#x20;   X-->>B: 202 Accepted + jobId (milliseconds)

&#x20;   loop every batch, over up to 15 min

&#x20;       X->>B: POST /webhook (500 trades)

&#x20;       B->>S: INSERT OR IGNORE

&#x20;       B-->>D: SSE event "trades" (new rows)

&#x20;   end

&#x20;   B-->>D: SSE event "status" = complete

```



```

&#x20;Browser  <--- SSE push --- Backend ---> SQLite

&#x20;   |                          ^

&#x20;   | POST /api/pull           | POST /webhook (batches)

&#x20;   +------------------------> |

&#x20;                              +---- Mock BSE (202 immediately, works in background)

```



\## Why this design



| Requirement | How it is met |

|---|---|

| 15-min pull vs 30-s connection limit | `/getTrades` returns `202` immediately. Data comes back later as short webhook calls (each under a second). |

| Dashboard opens instantly | It reads from our own SQLite database, never from BSE. |

| Shows trades even mid-pull | Batches are saved as they arrive, so the DB always holds partial results. |

| Live updates, no refresh | Server-Sent Events push new rows to open dashboards. |

| No polling, no cron | A pull starts from a user action. Data is pushed by webhook and SSE, with no timers that check for work. |



\## Key decisions



\- \*\*Webhook over long polling:\*\* keeps every connection short and removes the need for the client to ask repeatedly.

\- \*\*SSE over WebSocket:\*\* updates only flow server to browser, SSE is simpler, and `EventSource` reconnects automatically.

\- \*\*Batches:\*\* the mock sends 500 trades at a time, so data appears progressively instead of all at the end.

\- \*\*Idempotent inserts:\*\* `trade\_id` is `UNIQUE` with `INSERT OR IGNORE`, so retried webhooks cannot create duplicates.

\- \*\*Reconnect safety:\*\* every row has an increasing `seq`. After a dropped SSE connection the dashboard calls `/api/trades?after=<lastSeq>` to catch up on anything missed.

\- \*\*SSE and the 30-second rule:\*\* the SSE stream is long-lived, so the server sends a heartbeat every 15 s, and the browser reconnects within 2 s if a proxy cuts it.



\## Trade-offs and limitations



\- Pull status is held in memory, so it resets if the backend restarts (trade data itself is persisted).

\- The mock `/getTrades` takes a `callbackUrl` and replies `202` rather than returning data inline. This is deliberate and is the core of the design.

\- A production version would add webhook authentication, retries with backoff, and a job table in the database.

