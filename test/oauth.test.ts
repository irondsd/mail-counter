import { describe, expect, test } from "bun:test";
import { buildAuthUrl, needsInteraction, parseAuthRedirect } from "../src/lib/oauth.ts";

const base = {
  clientId: "client-123.apps.googleusercontent.com",
  redirectUri: "https://abc.chromiumapp.org/",
  scopes: ["openid", "email", "https://www.googleapis.com/auth/gmail.labels"],
  state: "state-1",
};

describe("buildAuthUrl", () => {
  test("interactive without hint shows the account chooser", () => {
    const url = new URL(buildAuthUrl({ ...base, interactive: true }));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    const p = url.searchParams;
    expect(p.get("client_id")).toBe(base.clientId);
    expect(p.get("redirect_uri")).toBe(base.redirectUri);
    expect(p.get("response_type")).toBe("token");
    expect(p.get("scope")).toBe("openid email https://www.googleapis.com/auth/gmail.labels");
    expect(p.get("state")).toBe("state-1");
    expect(p.get("prompt")).toBe("select_account");
    expect(p.has("login_hint")).toBe(false);
  });

  test("reconnect goes straight to that account and re-shows consent", () => {
    const p = new URL(buildAuthUrl({ ...base, interactive: true, loginHint: "a@gmail.com" }))
      .searchParams;
    expect(p.get("login_hint")).toBe("a@gmail.com");
    expect(p.get("prompt")).toBe("consent");
  });

  test("silent refresh uses prompt=none", () => {
    const p = new URL(buildAuthUrl({ ...base, interactive: false, loginHint: "a@gmail.com" }))
      .searchParams;
    expect(p.get("prompt")).toBe("none");
    expect(p.get("login_hint")).toBe("a@gmail.com");
  });
});

describe("parseAuthRedirect", () => {
  const now = 1_000_000;

  test("reads the token from the fragment", () => {
    const result = parseAuthRedirect(
      "https://abc.chromiumapp.org/#state=state-1&access_token=tok&token_type=Bearer&expires_in=3599",
      "state-1",
      now,
    );
    expect(result).toEqual({ ok: true, accessToken: "tok", expiresAt: now + 3_599_000 });
  });

  test("returns the scopes Google actually granted", () => {
    const result = parseAuthRedirect(
      "https://abc.chromiumapp.org/#state=s&access_token=tok&expires_in=3599&scope=email%20openid%20https://www.googleapis.com/auth/userinfo.email",
      "s",
      now,
    );
    expect(result).toEqual({
      ok: true,
      accessToken: "tok",
      expiresAt: now + 3_599_000,
      scopes: ["email", "openid", "https://www.googleapis.com/auth/userinfo.email"],
    });
  });

  test("defaults expiry to an hour", () => {
    const result = parseAuthRedirect(
      "https://abc.chromiumapp.org/#state=s&access_token=tok",
      "s",
      now,
    );
    expect(result).toEqual({ ok: true, accessToken: "tok", expiresAt: now + 3_600_000 });
  });

  test("rejects a state mismatch", () => {
    const result = parseAuthRedirect(
      "https://abc.chromiumapp.org/#state=evil&access_token=tok",
      "state-1",
    );
    expect(result).toEqual({ ok: false, error: "state_mismatch" });
  });

  test("returns errors from the fragment or the query", () => {
    expect(
      parseAuthRedirect("https://abc.chromiumapp.org/#error=interaction_required&state=s", "s"),
    ).toEqual({
      ok: false,
      error: "interaction_required",
    });
    expect(parseAuthRedirect("https://abc.chromiumapp.org/?error=access_denied", "s")).toEqual({
      ok: false,
      error: "access_denied",
    });
  });

  test("reports a missing token", () => {
    expect(parseAuthRedirect("https://abc.chromiumapp.org/#state=s", "s")).toEqual({
      ok: false,
      error: "missing_access_token",
    });
  });
});

test("needsInteraction separates 'click to reconnect' from real failures", () => {
  expect(needsInteraction("interaction_required")).toBe(true);
  expect(needsInteraction("login_required")).toBe(true);
  expect(needsInteraction("consent_required")).toBe(true);
  expect(needsInteraction("access_denied")).toBe(false);
  expect(needsInteraction("invalid_client")).toBe(false);
});
