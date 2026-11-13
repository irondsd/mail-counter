const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";

export interface AuthUrlOptions {
  clientId: string;
  redirectUri: string;
  scopes: string[];
  state: string;
  /** Email of the account to authorize. Omit to let the user pick one. */
  loginHint?: string;
  /** false = silent refresh: Google must answer without showing any UI. */
  interactive: boolean;
}

export function buildAuthUrl(options: AuthUrlOptions): string {
  const url = new URL(AUTH_ENDPOINT);
  const params = url.searchParams;
  params.set("client_id", options.clientId);
  params.set("redirect_uri", options.redirectUri);
  params.set("response_type", "token");
  params.set("scope", options.scopes.join(" "));
  params.set("include_granted_scopes", "true");
  params.set("state", options.state);
  if (options.loginHint) params.set("login_hint", options.loginHint);

  if (!options.interactive) {
    params.set("prompt", "none");
  } else if (!options.loginHint) {
    params.set("prompt", "select_account");
  }
  return url.toString();
}

export type AuthResult =
  { ok: true; accessToken: string; expiresAt: number } | { ok: false; error: string };

/**
 * Parses the URL Google redirects back to. Implicit-flow results live in the
 * fragment (`#access_token=…`); some errors come back in the query string.
 */
export function parseAuthRedirect(
  redirectUrl: string,
  expectedState: string,
  now: number = Date.now(),
): AuthResult {
  const url = new URL(redirectUrl);
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
  const get = (key: string) => fragment.get(key) ?? url.searchParams.get(key) ?? undefined;

  const error = get("error");
  if (error) return { ok: false, error };

  if (get("state") !== expectedState) {
    return { ok: false, error: "state_mismatch" };
  }

  const accessToken = get("access_token");
  if (!accessToken) return { ok: false, error: "missing_access_token" };

  const expiresIn = Number(get("expires_in") ?? "3600");
  const seconds = Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600;
  return { ok: true, accessToken, expiresAt: now + seconds * 1000 };
}

/** Errors that mean "the user has to click something", not "it's broken". */
export function needsInteraction(error: string): boolean {
  return [
    "interaction_required",
    "login_required",
    "consent_required",
    "account_selection_required",
    "user_interaction_required",
  ].includes(error);
}
