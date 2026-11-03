# Privacy policy

_Last updated: 3 November 2026_

This policy covers the **Feedster browser extension** (for Chrome, Edge and Firefox) and the **Feedster** self-hosted feed reader it connects to.

## The short version

The extension talks only to the Feedster server whose address you enter. It does not send anything to the developer or to anyone else, has no analytics or tracking, and shows no ads.

## What the extension stores

On your own device, in the browser's extension storage:

- the address of your Feedster server,
- your Feedster app username,
- the sign-in token Feedster returns when you connect (your app password is used once to sign in and is **not** stored),
- how often to check for new articles,
- the latest unread count and the titles, feed names, links and times of your newest unread articles, so the toolbar popup can show them instantly.

Disconnecting in the extension's settings deletes the token and the saved articles. Removing the extension deletes all of it.

## What the extension sends, and where

Every few minutes (you choose how often), the extension asks your Feedster server for your unread count and newest unread articles, using the sign-in token. When you first connect, it sends your username and app password to that server to sign in. Nothing is sent anywhere else.

The browser asks for your permission to access your Feedster address when you connect; the extension cannot read or change any other website.

## Feedster itself

Feedster is software you run on your own server. Your subscriptions, articles, read and starred state, and passwords stay on that server, under your control. To do its job it downloads the feeds you subscribe to, their icons, and (when you open an article from a summary-only feed) the article's web page, from the sites that publish them. It checks GitHub every few minutes for a newer Feedster release unless you turn that off with `UPDATE_CHECK=false`. The developer receives no data from your Feedster.

## Contact

Questions about this policy: open an issue at <https://github.com/tet0r/feedster/issues>.
