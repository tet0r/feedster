# Changelog

All notable changes to Feedster are listed here, newest first. Version numbers follow [semantic versioning](https://semver.org/). The section for a version becomes its GitHub release notes.

## [Unreleased]

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
