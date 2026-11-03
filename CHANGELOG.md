# Changelog

All notable changes to Feedster are listed here, newest first. Version numbers follow [semantic versioning](https://semver.org/). The section for a version becomes its GitHub release notes.

## [Unreleased]

## [1.4.1] - 2026-11-03

### Changed

- Releases attach a separate extension package for each store: `feedster-chrome.zip` (Chrome Web Store, Edge and other Chromium browsers) and `feedster-firefox.zip` (Firefox Add-ons), each with only its own browser's settings, so neither browser warns about the other's. `feedster-extension.zip` still loads in both for developer-mode installs. `node scripts/package-extension.mjs` builds all three.

## [1.4.0] - 2026-11-03

### Added

- A Feedster browser extension for Chrome, Edge and Firefox. The toolbar icon shows your unread count, checked every 1 to 60 minutes. Clicking it shows your latest unread articles and an Open Feedster button that switches to an open Feedster tab or opens one. It signs in with the Reading apps username and app password, keeps only the sign-in token, and asks for access to your Feedster address only. A grey "!" on the icon explains when Feedster can't be reached or the sign-in needs renewing. Each release includes it as `feedster-extension.zip`; Settings → Browser extension links to the latest one.
- Releases also submit the extension to Firefox Add-ons and the Chrome Web Store once their API keys are set up ([store/SUBMITTING.md](store/SUBMITTING.md)), and a [privacy policy](PRIVACY.md) covers the extension and Feedster.

## [1.3.0] - 2026-11-03

### Added

- Full articles in the reading pane. When a feed only gives a summary, Feedster fetches the article's page and shows the main text, extracted with Readability (the engine behind Firefox's Reader View). A "Full article" button (or `f`) switches between the full article and the feed's text, and the choice is remembered per feed. Fetched articles are kept, so each page is only downloaded once.
- Subscribe from your browser: Feedster accepts the "subscribe in reader" links that extensions such as RSSHub Radar make (in the FreshRSS, Miniflux and Inoreader formats), and Settings has a bookmarklet for any browser. Both open the Add subscription dialog to confirm; nothing is subscribed without you. A subscribe link opened while signed out picks up again after you sign in.
- The README recommends free apps and extensions to use with Feedster: Capy Reader, Read You and FeedMe on Android; NetNewsWire and Fiery Feeds on iPhone and iPad; RSSHub Radar for Chrome and Firefox.
- Drag the dividers between the sidebar, the article list and the reading pane to resize them. Widths are remembered; double-click a divider to reset it, or use the arrow keys on a focused divider.

### Fixed

- Titles that feeds escape twice now read normally ("Jar Opener & Twist", "Women's") instead of showing `&amp;` and `&#039;`. Titles already stored are cleaned up once on upgrade.
- Feeds behind bot protection such as Cloudflare (for example Techbargains) are handled gently. A bot check is reported in plain words instead of "HTTP 403", and a failing feed is retried less and less often (doubling from one refresh interval, or from an hour after a bot check or rate limit, up to a day, honoring Retry-After) instead of every 15 minutes, which kept such sites refusing. Settings → Feed health shows when it will be tried next.
- Subscribing by website address checks candidate feed addresses three at a time and stops as soon as the site shows a bot check, rather than sending a burst of requests.
- Icon lookups stop at the first bot check and wait a day before asking that site again.

## [1.2.0] - 2026-11-03

### Added

- Feed icons are looked up on the server: the feed's own image first (when it is roughly square, not a wide banner), then the icons the website declares in its HTML, then `/favicon.ico`. Each candidate must really be an image, so HTML error pages and 1x1 tracking pixels are skipped. Only when nothing usable is found does the sidebar show the feed's first letter.
- Icons are stored in the database and served by Feedster, so they load instantly and your browser no longer contacts every site. Fever apps receive them too.
- Icons are checked again every 30 days; a site with no icon is checked again after 3 days, and one that didn't respond within the hour.

## [1.1.1] - 2026-11-03

### Fixed

- Subscribing by website address finds many more feeds. Feedster now tries addresses relative to the page you entered (such as reddit's `/r/name/.rss` and Medium's `/@name/feed`), keeps looking when a site refuses its homepage to feed readers, and knows where MLB, ESPN, BBC, CNN and The New York Times keep feeds they don't link to. Candidate addresses are checked in parallel, so discovery is faster too.
- Clearer messages when a site blocks feed readers or has no feed, suggesting to paste the feed's address directly.
- Article pictures from feeds that use a plain `<image>` or `<itunes:image>` tag, such as MLB's, now show.
- Articles from headline-only feeds show a link to the full article instead of an empty page.
- The database waits briefly for a lock instead of failing with "database is locked".

## [1.1.0] - 2026-11-03

### Added

- Sync with reading apps and browser extensions. Feedster now speaks the Google Reader API (the one FreshRSS and Miniflux offer) at `/api/greader.php` and the Fever API at `/api/fever.php`, so apps such as Reeder, NetNewsWire, ReadKit, FeedMe, Fluent Reader and Unread can sign in. Folders, read and starred state sync both ways; Google Reader apps can also add, rename, move and remove subscriptions.
- A "Reading apps" section in Settings to choose the username and app password apps sign in with. It is separate from the web password, stored hashed, and saving a new one signs every app out.

## [1.0.0] - 2026-11-03

First versioned release.

### Reading

- Three-pane layout (folders and feeds, article list, reading pane), or a card view that shows whole articles in the list.
- Unread / All views, a Starred view, and search across titles, article text and authors.
- Mark all as read, or mark articles older than a day or a week as read.
- Keyboard shortcuts: `j`/`k` next and previous, `s` star, `m` read/unread, `v` open original, `r` refresh, `Shift`+`A` mark all read, `a` add, `/` search.
- Article HTML is sanitized before display, and images load without sending a referrer.
- Light, dark and automatic themes, and a layout for phones.

### Subscriptions

- Subscribe with a feed URL or just a website address; the feed is found automatically.
- RSS 2.0, RSS 1.0 (RDF), Atom and JSON Feed.
- Folders with drag and drop, rename, move and unsubscribe; feeds that fail to load are flagged.
- OPML import and export.
- Feeds refresh in the background every 15 minutes, using ETag / Last-Modified so unchanged feeds cost almost nothing.
- Read, unstarred articles older than 90 days are cleaned up automatically.

### Running it

- One Node.js process and one SQLite file; optional password sign-in.
- Docker image `ghcr.io/tet0r/feedster` for amd64 and arm64, with a compose file that can be pasted into Portainer.
- The running version is shown in the sidebar. Every 5 minutes Feedster checks GitHub for a newer release and shows a banner when there is one.

### Fixed

- Feeds with a lot of escaped HTML no longer fail with "Entity expansion limit exceeded".
- The Docker container can write to its data volume.
