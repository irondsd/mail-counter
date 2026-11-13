# Mail Counter

A Chrome extension that shows the unread count of several Gmail accounts in one toolbar badge.

**Homepage:** <https://irondsd.github.io/mail-counter/> ·
**Privacy policy:** <https://irondsd.github.io/mail-counter/privacy.html>

It uses the official Gmail API with read-only label access (`gmail.labels`). It never touches
cookies and never signs you in or out of Google. If it can't get a token silently, it marks the
account "signed out" and waits for you to click **Reconnect**.

- **Badge:** total unread conversations in Inbox across accounts. Amber means an account needs
  attention; hover for details.
- **Popup:** one row per account. Click a row to open that account's Gmail.
- **Polling:** every minute, plus whenever the popup opens.

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
| `src/background.ts`   | service worker: OAuth, polling, badge                             |
| `src/popup/`          | popup UI                                                          |
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
   - `.../auth/gmail.labels`. If it's not in the list, paste
     `https://www.googleapis.com/auth/gmail.labels` into **Manually add scopes**.

   Click **Update**, then **Save**.

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

9. **Connect your accounts.** Click the icon, then **Add Gmail account**, and pick an account. On
   "Google hasn't verified this app", click **Advanced → Go to Mail Counter (unsafe)**, then
   **Continue**. Repeat for the second account.

After a code change: `bun run build`, then click the reload arrow on the extension's card in
`chrome://extensions`.

### On another computer (laptop)

Clone the repo, add the same `.env`, run `bun run build`, and load `dist/`. The ID is the same, so
the same OAuth client works. If Chrome Sync is on, the list of accounts carries over and the
extension tries to connect them silently. Otherwise click **Add Gmail account** once per account.
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
- **"Label INBOX has no unread count" error:** `gmail.labels` turned out to be too narrow. Switch
  the scope in `src/lib/config.ts` to `https://www.googleapis.com/auth/gmail.metadata`, add that
  scope in Data Access, rebuild, and reconnect.
