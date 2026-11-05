# Publishing the browser extension

The release workflow publishes every new version of the extension to **Firefox Add-ons (AMO)** and the **Chrome Web Store** by itself. Each store needs two things from you, once:

1. **The first version, submitted by hand.** Neither store's API can create a new listing, and this is where the listing text, images and privacy answers go in. Everything to paste is below.
2. **API keys, saved as GitHub secrets**, so later releases can publish. Until they exist, the workflow skips publishing with a notice, and nothing fails.

For the first submission, use **`feedster-firefox.zip`** for Firefox and **`feedster-chrome.zip`** for Chrome. Releases from v1.4.1 attach both; `node scripts/package-extension.mjs` builds them into `dist/` from any checkout. (`feedster-extension.zip` loads in both browsers for developer-mode installs; give each store its own zip instead.) The images are in [`store/images`](images); `node store/render/render.mjs` regenerates them.

---

## Firefox Add-ons

### First submission

1. Go to <https://addons.mozilla.org/developers/addon/submit/distribution>, choose **On this site**, and continue.
2. Upload `feedster-firefox.zip`. Under compatibility, keep **Firefox** and untick **Firefox for Android** (toolbar extensions are a desktop feature).
3. **Source code:** answer **No**. The extension isn't minified or bundled, so the uploaded files are the source.
4. Fill in the listing:

| Field | Value |
| --- | --- |
| Name | `Feedster` |
| Add-on URL | `feedster` (if it's taken, `feedster-reader`) |
| Summary | See your Feedster unread count in the toolbar, glance at the latest headlines, and open your self-hosted feed reader in one click. |
| Description | The [description](#description) below |
| Categories | **Feeds, News & Blogging** |
| Support email / website | `https://github.com/tet0r/feedster/issues` |
| License | **MIT License** |
| Privacy policy | Tick "This add-on has a privacy policy" and paste the contents of [`PRIVACY.md`](../PRIVACY.md) |
| Notes to reviewer | The [notes for reviewers](#notes-for-reviewers) below |

5. Optional but recommended: on the add-on's edit page, add `store/images/screenshot-popup.png` and `store/images/screenshot-setup.png` as screenshots.
6. Submit. Mozilla reviews it, usually within a day or two for a small add-on.

### API keys for automatic releases

1. Open <https://addons.mozilla.org/developers/addon/api/key/> and click **Generate new credentials**.
2. Save them as GitHub secrets (see [Adding the secrets](#adding-the-secrets)):
   - **JWT issuer** → `AMO_JWT_ISSUER`
   - **JWT secret** → `AMO_JWT_SECRET`

---

## Chrome Web Store

Publishing needs 2-Step Verification on the Google account that owns the developer account.

### First submission

1. Open the [Developer Dashboard](https://chrome.google.com/webstore/devconsole), click **New item** and upload `feedster-chrome.zip`.
2. **Store listing** tab:

| Field | Value |
| --- | --- |
| Description | The [description](#description) below (the short description comes from the extension itself) |
| Category | **News & Weather** (or **Productivity** if you prefer) |
| Language | English |
| Store icon | `extension/icons/icon-128.png` |
| Screenshots | `store/images/screenshot-popup.png`, `store/images/screenshot-setup.png` |
| Small promo tile | `store/images/promo-small.png` |
| Homepage URL | `https://github.com/tet0r/feedster` |
| Support URL | `https://github.com/tet0r/feedster/issues` |

3. **Privacy** tab:

| Field | Value |
| --- | --- |
| Single purpose | Shows the unread article count from the user's own self-hosted Feedster feed reader on the toolbar, with the newest unread headlines and a shortcut to open Feedster. |
| `alarms` justification | Checks the user's Feedster server for new unread articles on the interval they choose (every 1 to 60 minutes). |
| `storage` justification | Keeps the user's Feedster address, username, sign-in token and check interval, and the last unread count and headlines, on their device. |
| `scripting` justification | Adds a small script to the user's own Feedster pages (only the address they connected, which they granted access to). It listens for Feedster's "something changed" event, for example when articles are marked as read, and asks the extension to update the unread count. It reads nothing from the page. |
| Host permission justification | Feedster is self-hosted, so its address is different for every user. The extension asks for access to the single address the user enters, at the moment they connect, and uses it only to read their unread count and headlines. It never accesses any other site. |
| Remote code | **No, I am not using remote code** |
| Data usage | Tick **Authentication information** only (the sign-in token for the user's own Feedster). Tick all three certifications: not sold to third parties, not used for unrelated purposes, not used for creditworthiness or lending. |
| Privacy policy URL | `https://github.com/tet0r/feedster/blob/main/PRIVACY.md` |

4. **Distribution** tab: **Public**, all regions, free.
5. If any form asks for test instructions or a test account, use the [notes for reviewers](#notes-for-reviewers).
6. Click **Submit for review**. Chrome reviews usually take a few days.

### Keys for automatic releases

Google's recommended way to publish from CI is a service account:

1. In the [Google Cloud console](https://console.cloud.google.com/), create a project (for example `feedster-publishing`).
2. **APIs & Services → Library**: search for **Chrome Web Store API** and click **Enable**.
3. **IAM & Admin → Service accounts → Create service account**: name it `feedster-ci`. It needs no roles; click **Done**.
4. Open the new service account → **Keys → Add key → Create new key → JSON**. A `.json` file downloads.
5. Back in the Chrome [Developer Dashboard](https://chrome.google.com/webstore/devconsole) → **Account**: add the service account's email (it ends in `.iam.gserviceaccount.com`).
6. Save these as GitHub secrets:
   - the whole contents of the downloaded `.json` file → `CWS_SERVICE_ACCOUNT`
   - **Publisher ID** (Dashboard → Publisher → Settings) → `CWS_PUBLISHER_ID`
   - the extension's **Item ID** (shown on the item in the dashboard; 32 letters) → `CWS_EXTENSION_ID`
7. Delete the downloaded `.json` file. GitHub keeps the only copy needed, and you can make a new key at any time.

---

## Adding the secrets

In GitHub: **tet0r/feedster → Settings → Secrets and variables → Actions → New repository secret**, once for each:

| Secret | From |
| --- | --- |
| `AMO_JWT_ISSUER` | Firefox Add-ons API key: JWT issuer |
| `AMO_JWT_SECRET` | Firefox Add-ons API key: JWT secret |
| `CWS_SERVICE_ACCOUNT` | Google service account JSON key (whole file) |
| `CWS_PUBLISHER_ID` | Chrome Developer Dashboard → Publisher → Settings |
| `CWS_EXTENSION_ID` | Chrome Developer Dashboard → the item's ID |

From then on, each new `VERSION` on `main` submits the extension to both stores for review. The version number is stamped from `VERSION`, so it always goes up.

---

## Text to paste

### Description

```
Feedster is a free, open-source feed reader (RSS, Atom and JSON Feed) that you run on your own server. This extension connects your browser to your Feedster.

• Your unread count on the toolbar icon, checked every 1 to 60 minutes
• Click the icon to see your newest unread headlines
• "Open Feedster" switches to your Feedster tab, or opens one
• A grey "!" tells you when Feedster can't be reached or wants you to sign in again

Private by design: the extension talks only to the Feedster address you enter. It signs in with an app password you create in Feedster (Settings → Reading apps), keeps only the sign-in token, and asks for access to that one address. No analytics, no tracking, no ads.

You need your own Feedster server: https://github.com/tet0r/feedster
```

### Notes for reviewers

```
This extension connects to Feedster, a self-hosted feed reader (https://github.com/tet0r/feedster). To test it you need a Feedster server; one runs locally with Docker:

1. docker run -p 8080:8080 ghcr.io/tet0r/feedster:latest
2. Open http://localhost:8080, click "+ Add subscription" and add https://xkcd.com/atom.xml
3. In Feedster's Settings → Reading apps, set username "reviewer" and an app password of at least 8 characters, then Save.
4. In the extension's settings, enter http://localhost:8080, that username and password, and click Connect. Allow access when asked.

The toolbar badge then shows the unread count; the popup lists the newest unread articles and opens Feedster.

The extension is not minified or bundled: the files in the package are the source.
```

If you run a Feedster that reviewers can reach over the internet, you can instead give them its address and a reviewer app password. Change the app password after the review.
