# Mail Counter

A Chrome extension that shows unread Gmail for several accounts in one toolbar badge, and lets you
preview and handle new mail without opening Gmail.

**Homepage:** <https://irondsd.github.io/mail-counter/> ·
**Privacy policy:** <https://irondsd.github.io/mail-counter/privacy.html>

It uses the official Gmail API (`gmail.modify`). It never touches cookies and never signs you in
or out of Google. If it can't get a token silently, it marks the account and waits for you to
click **Reconnect**.

- **Badge:** total unread conversations in Inbox across accounts. Amber means an account needs
  attention; hover for details.
- **Click with nothing unread:** opens Gmail (the first account), or the popup if you choose that in Options.
- **Click with unread mail:** opens the popup with a card for each unread conversation (sender,
  subject and the first lines of the email). Hover one for **Open**, **Mark as read**,
  **Archive** (also marks it read) and **Report spam**. Click a card to expand it and read the
  whole email in place; click again or press Esc to fold it. With exactly one unread email, it
  opens already expanded.
- **Right-click the icon:** **Open** any account's inbox, **Refresh** to check every account now,
  **Open popup**, or **Options**.
- **Options page:** add, reconnect and remove accounts; how often to check each account (10 seconds
  to 10 minutes); what clicking the icon does when nothing is unread; light, dark or system theme;
  the new-mail chime and its volume.
- **New-mail chime:** a short sound when a check finds a new unread conversation or a new
  message in one. Connecting an account doesn't chime for mail already there.
- **Email preview:** scripts, forms and remote images are blocked, so tracking pixels don't
  report that you opened it. **Show images** loads them, or turn on
  **Always show remote images** in the options. Clicking a link, including a calendar RSVP
  button, opens it in a new tab and marks the conversation as read.
- **Polling:** each account on its own interval (default every minute), plus all of them whenever
  the popup opens. Chrome alarms can't fire more often than every 30 seconds, so shorter
  intervals run on a timer and a 30-second alarm restarts it if Chrome puts the extension to
  sleep. A check costs about 11 of Gmail's quota units, so even every 10 seconds uses well under 1%
  of Google's per-user limit.

## Development

```bash
bun install
bun run build      # → dist/
bun run dev        # rebuild on change
bun run ci         # typecheck + lint + format check + tests + build
bun test
bun lint
bun fmt
bun run icons      # assets/icon.svg → public/icons/*.png
```

| Path                  | What                                                              |
| --------------------- | ----------------------------------------------------------------- |
| `src/background.ts`   | service worker: OAuth, polling, badge, actions, click behavior    |
| `src/popup/`          | popup UI                                                          |
| `src/options/`        | options page: accounts, check intervals, icon click, sound        |
| `src/offscreen/`      | hidden page that plays the chime (service workers can't)          |
| `src/ui/base.css`     | colors and buttons shared by the popup and options page           |
| `src/lib/`            | pure logic (OAuth URLs, Gmail API, badge), unit-tested in `test/` |
| `src/lib/config.ts`   | scopes, which label to count, poll interval                       |
| `src/manifest.ts`     | manifest, generated into `dist/` at build time                    |
| `extension-key.json`  | public key that pins the extension ID; commit it                  |
| `.keys/extension.pem` | matching private key (git-ignored); only needed to pack a `.crx`  |

### Extension ID

The manifest `key` pins the ID to **`nlmlamifemkcdemlkldjenngmcjbidek`** on every machine, so the
OAuth redirect URL never changes:

```
https://nlmlamifemkcdemlkldjenngmcjbidek.chromiumapp.org/
```

Don't rerun `bun run keygen --force`. A new key means a new ID, and you'd have to update the
redirect URI in Google Cloud.

## Google Cloud setup (one time, about 10 minutes)

1. **Create a project.** Go to <https://console.cloud.google.com/>, open the project picker, choose
   **New project**, name it `Mail Counter`, and create it. Make sure it's selected.

2. **Enable the Gmail API.** Go to **APIs & Services → Library**, search for **Gmail API**, and
   click **Enable**.

3. **Configure the consent screen.** Go to **Google Auth Platform**, which may also appear as
   **APIs & Services → OAuth consent screen**, and click **Get started**:
   - App name: `Mail Counter`. Avoid "Gmail" or "Google" in the name.
   - User support email: your address.
   - Audience: **External**.
   - Contact email: your address. Agree to the policy and click **Create**.

4. **Add scopes.** Go to **Data Access → Add or remove scopes** and tick:
   - `openid`
   - `.../auth/userinfo.email`
   - `.../auth/gmail.modify`. If it's not in the list, paste
     `https://www.googleapis.com/auth/gmail.modify` into **Manually add scopes**.

   Click **Update**, then **Save**. `gmail.modify` lets the extension read mail and change labels
   (read, archive, spam). It can't delete mail permanently. Google classes it as **restricted**;
   for personal use that only means the "unverified app" screen (see step 9).

5. **Add yourself as a test user.** Go to **Audience → Test users → Add users** and add both
   Gmail addresses. Leave the app in **Testing**; that needs no domain or homepage. (Test users can
   only be added while the app is in Testing.)
   - Google may expire a Testing grant after about 7 days. If that happens, the account shows
     **signed out** and you click **Reconnect** once. You don't get logged out of Google.
   - To avoid that, publish the app. See
     [Publishing the OAuth app](#publishing-the-oauth-app-optional) below.

6. **Create the OAuth client.** Go to **Clients → Create client**:
   - Application type: **Web application**. Not "Chrome Extension", which only supports the
     single Chrome-profile account.
   - Name: `Mail Counter extension`.
   - **Authorized redirect URIs → Add URI**:
     `https://nlmlamifemkcdemlkldjenngmcjbidek.chromiumapp.org/`. Keep the trailing slash.
   - Click **Create** and copy the **Client ID**. No client secret is needed.

7. **Build with the client ID.**

   ```bash
   cp .env.example .env    # paste your client ID into PUBLIC_GOOGLE_CLIENT_ID
   bun run build
   ```

8. **Load the extension.** Open `chrome://extensions`, turn on **Developer mode**, click **Load
   unpacked**, and pick the `dist/` folder. The ID shown should be
   `nlmlamifemkcdemlkldjenngmcjbidek`. Pin the envelope icon to the toolbar.

9. **Connect your accounts.** Click the icon, then **Add an account in Options** (later: right-click
   the icon → **Options**). Click **Add Gmail account** and pick an account. On
   "Google hasn't verified this app", click **Advanced → Go to Mail Counter (unsafe)**, then
   **Continue**. Repeat for the second account.

After a code change: `bun run build`, then click the reload arrow on the extension's card in
`chrome://extensions`.

### On another computer (laptop)

Clone the repo, add the same `.env`, run `bun run build`, and load `dist/`. The ID is the same, so
the same OAuth client works. If Chrome Sync is on, the list of accounts carries over and the
extension tries to connect them silently. Otherwise click **Add Gmail account** in Options once per account.
Google remembers your earlier approval, so it's only the account picker.

### How sign-in stays alive

Access tokens last about an hour. Before one expires, the extension silently asks Google for a new
one (`prompt=none` with your email as `login_hint`). That reuses your normal Google session in
Chrome, so nothing pops up. You'll only see **Reconnect** if you actually sign out of that Google
account in Chrome, or revoke the app at <https://myaccount.google.com/connections>.

## Publishing the OAuth app (optional)

Publishing moves the app from **Testing** to **In production**, so Google stops expiring the grant
after a week. Google then wants a homepage and a privacy policy on a domain you've proven you own.
The `docs/` folder holds both pages, served by GitHub Pages.

1. **Turn on GitHub Pages.** In the repo, go to **Settings → Pages**, set Source to **Deploy from
   a branch**, branch **main**, folder **/docs**, and save. After a minute the site is at
   <https://irondsd.github.io/mail-counter/>.

2. **Prove you own `irondsd.github.io`.** Google checks the domain root, and a project site lives
   under `/mail-counter/`, so this needs your user site:
   - In [Google Search Console](https://search.google.com/search-console), sign in with the same
     Google account that owns the Cloud project. Add a property, choose **URL prefix**, and enter
     `https://irondsd.github.io/`. Pick the **HTML file** method and download the
     `google….html` file.
   - Create a public repo named exactly `irondsd.github.io`. Commit that file to its root,
     optionally with an `index.html` that links to `/mail-counter/`. GitHub publishes user sites
     automatically.
   - Back in Search Console, click **Verify**.

3. **Fill in the branding.** In Google Auth Platform, go to **Branding**:
   - Application home page: `https://irondsd.github.io/mail-counter/`
   - Privacy policy link: `https://irondsd.github.io/mail-counter/privacy.html`
   - Authorized domains: `irondsd.github.io`

   Save.

4. **Publish.** Go to **Audience → Publish app** and confirm. The status should read **In
   production**. You don't need Google's verification review for personal use (under 100 users).
   You'll see "Google hasn't verified this app" once per account when you connect it.

## Tweaks

- **Count only the Primary tab:** set `COUNT_LABEL = "CATEGORY_PERSONAL"` in `src/lib/config.ts`.
- **Change the icon color:** edit the `fill` in `assets/icon.svg`, then run `bun run icons`.
- **Preview more conversations:** raise `MAX_PREVIEW_THREADS` (default 25 per account) in
  `src/lib/config.ts`.
