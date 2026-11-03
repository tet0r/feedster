# Feedster

A self-hosted RSS/Atom/JSON Feed reader in the spirit of Inoreader: folders, unread counts,
starring, search, list and card layouts, keyboard shortcuts, OPML import/export and
automatic background refresh. One Node process, one SQLite file, two small dependencies.

## Run it

Requires Node.js 22.13+ (uses the built-in `node:sqlite`).

```bash
npm install
npm start
```

Open http://localhost:8080. Data is stored in `./data/feedster.db`.

### Docker

```bash
cp .env.example .env   # optional: set FEEDSTER_PASSWORD, port, etc.
docker compose up -d --build
```

The database lives in the `feedster-data` volume. To use a host folder instead, replace
`feedster-data:/data` with e.g. `./data:/data` and make it writable by the container user
(`sudo chown 1000:1000 ./data`).

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8080` | HTTP port |
| `FEEDSTER_PASSWORD` | *(empty)* | When set, a sign-in page protects the app |
| `FEEDSTER_DATA` | `./data` | Folder for the SQLite database |
| `FEEDSTER_REFRESH_MINUTES` | `15` | How often all feeds are re-fetched (`0` disables) |
| `FEEDSTER_RETENTION_DAYS` | `90` | Read, unstarred articles older than this are deleted (`0` keeps all) |

## Features

- Subscribe by feed URL **or** website URL (feeds are auto-discovered from `<link rel="alternate">` and common paths)
- RSS 2.0, RSS 1.0 (RDF), Atom and JSON Feed
- Folders with drag-and-drop, rename, move, unsubscribe; per-feed error indicators
- Unread / All views, Starred, full-text search across titles, content and authors
- List + reading pane, or a card view that shows articles inline (optional mark-as-read on scroll)
- Mark all read, or mark older than a day / week as read
- Conditional GETs (ETag / Last-Modified) so refreshes are cheap
- Article HTML is sanitized with DOMPurify; images load with `no-referrer`
- OPML import (e.g. from Inoreader: *Preferences → Import/Export*) and export
- Light / dark / auto theme, responsive mobile layout

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| `j` / `k` | Next / previous article |
| `s` | Star / unstar |
| `m` | Toggle read |
| `v` | Open original |
| `r` | Refresh all feeds |
| `Shift`+`A` | Mark all in current view as read |
| `a` | Add subscription |
| `/` | Search |

## Running behind a reverse proxy

Feedster serves plain HTTP. Put it behind Caddy, nginx or Traefik for HTTPS, and set
`FEEDSTER_PASSWORD` if it is reachable from the internet.

## License

MIT, see [LICENSE](LICENSE).
