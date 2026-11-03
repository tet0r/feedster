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
docker compose up -d
```

The compose file pulls the prebuilt image `ghcr.io/tet0r/feedster:latest` (amd64 and arm64),
so it can be pasted on its own into Portainer or any other stack manager; set the variables
from `.env.example` in the stack's environment settings. To build from source instead, swap
the `image:` line for `build: .` and run `docker compose up -d --build`.

The database lives in the `feedster-data` volume. To use a host folder instead, replace
`feedster-data:/data` with e.g. `./data:/data` and make it writable by the container user
(`sudo chown 1000:1000 ./data`).

## Reading apps and browser extensions

Feedster can be used from apps that support a **FreshRSS / Google Reader** or **Fever** account. Open **Settings → Reading apps**, choose a username and an app password (separate from the web sign-in password), then add an account in your app:

| App type | Account to choose | Server address |
| --- | --- | --- |
| Reeder, NetNewsWire, ReadKit, FeedMe, Fluent Reader, Read You, browser extensions with FreshRSS support | FreshRSS (or "Google Reader API") | `https://your-server/api/greader.php` |
| Unread, Reeder (classic), other Fever clients | Fever | `https://your-server/api/fever.php` |

Folders, read and starred articles sync both ways. Google Reader apps can also add, rename, move and remove subscriptions. Mobile apps usually need the server to be reachable over HTTPS, so put Feedster behind a reverse proxy (see below) when using them away from home.

## Versions and updates

The running version is shown at the bottom of the sidebar. Every 5 minutes Feedster asks GitHub whether a newer release exists; when one does, a banner appears within a minute, without reloading the page, and a line is written to the container log. Set `UPDATE_CHECK=false` to turn this off. To stay on a specific release, use an image tag such as `ghcr.io/tet0r/feedster:1.0.0` (or `:1.0` for patch updates only) instead of `:latest`.

Releases are cut by changing the number in the `VERSION` file: the first push to `main` with a new number publishes that image tag and a GitHub release. Changes are listed in [CHANGELOG.md](CHANGELOG.md); a version's section there becomes its release notes.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8080` | HTTP port |
| `FEEDSTER_PASSWORD` | *(empty)* | When set, a sign-in page protects the app |
| `FEEDSTER_DATA` | `./data` | Folder for the SQLite database |
| `FEEDSTER_REFRESH_MINUTES` | `15` | How often all feeds are re-fetched (`0` disables) |
| `FEEDSTER_RETENTION_DAYS` | `90` | Read, unstarred articles older than this are deleted (`0` keeps all) |
| `UPDATE_CHECK` | `true` | Check GitHub for a newer release every 5 minutes. `false` makes no outside calls for this |

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
