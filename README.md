# Mail Counter

A Chrome extension that shows the unread count of several Gmail accounts in one toolbar badge.

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
   - **Optional, to avoid that:** publish to **In production**. That needs a homepage and a
     privacy-policy page on a domain you've verified. A free `<you>.github.io` GitHub Pages site,
     verified in Google Search Console, usually works. You still don't need Google's app
     verification for personal use; you'll see an "unverified app" screen once per account.

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

## Tweaks

- **Count only the Primary tab:** set `COUNT_LABEL = "CATEGORY_PERSONAL"` in `src/lib/config.ts`.
- **Change the icon color:** edit the `fill` in `assets/icon.svg`, then run `bun run icons`.
- **"Label INBOX has no unread count" error:** `gmail.labels` turned out to be too narrow. Switch
  the scope in `src/lib/config.ts` to `https://www.googleapis.com/auth/gmail.metadata`, add that
  scope in Data Access, rebuild, and reconnect.
