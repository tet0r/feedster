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

## Apps and browser extensions

Feedster works in any browser on desktop or phone. To read in a native app instead, or to subscribe to sites from your browser's toolbar, these are good free options. None of them were made for Feedster: they connect through the same **Google Reader (FreshRSS)** and **Fever** APIs that FreshRSS offers, so choose the FreshRSS (or Google Reader) account type wherever an app has one. Fever works too, but it can't add, move or rename subscriptions.

### Connecting an app

1. In Feedster, open **Settings → Reading apps** and choose a username and app password. These are only for apps; your web password is never needed.
2. In the app, add a **FreshRSS** (or **Google Reader API**) account with the server address `https://your-server/api/greader.php`, or a **Fever** account with `https://your-server/api/fever.php`.
3. Sign in with that username and app password.

Phone apps need Feedster to be reachable over HTTPS (see [Running behind a reverse proxy](#running-behind-a-reverse-proxy)).

### Android

| App | Cost | Account type | Get it |
| --- | --- | --- | --- |
| [Capy Reader](https://github.com/jocmp/capyreader) | Free, open source | FreshRSS (Google Reader API) | Google Play, F-Droid. Needs Android 11+ |
| [Read You](https://github.com/Ashinch/ReadYou) | Free, open source | FreshRSS / Google Reader, or Fever | F-Droid, GitHub releases |
| [FeedMe](https://github.com/seazon/FeedMe) | Free with ads | FreshRSS or Fever | Google Play |

### iPhone and iPad

| App | Cost | Account type | Get it |
| --- | --- | --- | --- |
| [NetNewsWire](https://netnewswire.com/) | Free, open source | FreshRSS | App Store. The current version needs iOS 26 |
| [Fiery Feeds](https://apps.apple.com/app/id1158763303) | Free, optional Pro upgrade | FreshRSS or Fever | App Store |

NetNewsWire also runs on the Mac with the same FreshRSS account.

### Browser (Chrome, Firefox, Edge and others)

There is no maintained extension that reads a Google Reader account inside the browser; Feedster's web page fills that role. What extensions do well is find a site's feeds and send them to your reader:

| Extension | Cost | What it does | Get it |
| --- | --- | --- | --- |
| [RSSHub Radar](https://github.com/DIYgod/RSSHub-Radar) | Free, open source | Shows the feeds on the page you're on, with one-click subscribe | [Chrome](https://chromewebstore.google.com/detail/kefjpfngnndepjbopdmoebkipbgkggaa), [Firefox](https://addons.mozilla.org/firefox/addon/rsshub-radar/) (Edge and other Chromium browsers can use the Chrome version) |
| Feedster bookmarklet | Free, built in | Subscribe to the site you're on from your bookmarks bar, in any browser | Settings → Subscribe from your browser: drag **+ Feedster** to the bookmarks bar |

To set up RSSHub Radar: open its settings, turn on quick subscription for **FreshRSS**, and enter your Feedster address (`https://your-server`). Feedster understands the subscribe links RSSHub Radar makes for FreshRSS, Miniflux and Inoreader, and opens them in its **Add subscription** dialog for you to confirm.

These apps and extensions speak the same APIs as FreshRSS, and Feedster's end-to-end tests send the requests they use, but they haven't all been tried against Feedster by hand. If one misbehaves, please open an issue.

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
- Full articles for summary-only feeds, extracted from the article page (toggle per feed)
- Resizable sidebar, article list and reading pane
- Failing feeds back off (up to a day) instead of hammering a site that is refusing them
- Feed icons from the feed itself or the website's favicon, stored locally (a letter only when a site has none)
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
| `f` | Full article / feed text |
| `r` | Refresh all feeds |
| `Shift`+`A` | Mark all in current view as read |
| `a` | Add subscription |
| `/` | Search |

## Running behind a reverse proxy

Feedster serves plain HTTP. Put it behind Caddy, nginx or Traefik for HTTPS, and set
`FEEDSTER_PASSWORD` if it is reachable from the internet.

## License

MIT, see [LICENSE](LICENSE).
