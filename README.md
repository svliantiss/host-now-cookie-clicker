# host-now-cookie-clicker

A deliberately tiny cookie clicker used to prove an end-to-end deployment on our own
Dokploy host: Express on Node 20, Postgres behind `DATABASE_URL`, one counter row.

## Endpoints

| Method | Path | Behaviour |
|---|---|---|
| `GET` | `/` | HTML page: a big clickable cookie, the current count, and the database host it talked to |
| `POST` | `/click` | `UPDATE clicks SET clicks = clicks + 1` and returns `{ok, clicks, db}` |
| `GET` | `/healthz` | `200 {"ok":true,"clicks":<n>,"db":"<host>"}`; `500` if the database query fails |

The table (`clicks`, single row `id=1`) is created on boot. If `DATABASE_URL` is missing or
unparseable, or Postgres cannot be reached after 15 attempts (~30s), the process logs the
failure and exits non-zero rather than serving a page that cannot count.

## Run locally

```bash
npm install
DATABASE_URL=postgres://user:pass@localhost:5432/clicks npm start
# -> http://localhost:3000
```

## Build

```bash
docker build -t host-now-cookie-clicker .
docker run --rm -p 3000:3000 -e DATABASE_URL=postgres://... host-now-cookie-clicker
```
