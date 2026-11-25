import { describe, expect, test } from "bun:test";
import {
  DEFAULT_SETTINGS,
  formatInterval,
  intervalFor,
  normalizeSettings,
} from "../src/lib/settings.ts";

describe("normalizeSettings", () => {
  test("nothing stored → defaults", () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  test("keeps valid values and drops junk", () => {
    expect(
      normalizeSettings({
        sound: false,
        volume: 3,
        checkEvery: { "a@x.com": 30, "b@x.com": 0, "c@x.com": "10", "d@x.com": Number.NaN },
      }),
    ).toEqual({
      sound: false,
      volume: 1,
      checkEvery: { "a@x.com": 30 },
      emptyClick: "gmail",
      theme: "system",
      showImages: false,
    });
  });

  test("empty-inbox click opens Gmail unless set to the popup", () => {
    expect(normalizeSettings({ emptyClick: "popup" }).emptyClick).toBe("popup");
    expect(normalizeSettings({ emptyClick: "gmail" }).emptyClick).toBe("gmail");
    expect(normalizeSettings({ emptyClick: "tab" }).emptyClick).toBe("gmail");
  });

  test("theme follows the system unless set to light or dark", () => {
    expect(normalizeSettings({ theme: "dark" }).theme).toBe("dark");
    expect(normalizeSettings({ theme: "light" }).theme).toBe("light");
    expect(normalizeSettings({ theme: "sepia" }).theme).toBe("system");
    expect(normalizeSettings({}).theme).toBe("system");
  });

  test("remote images stay blocked unless turned on", () => {
    expect(normalizeSettings({ showImages: true }).showImages).toBe(true);
    expect(normalizeSettings({ showImages: "yes" }).showImages).toBe(false);
    expect(normalizeSettings({}).showImages).toBe(false);
  });

  test("intervals are kept between 10 seconds and 10 minutes", () => {
    const { checkEvery } = normalizeSettings({ checkEvery: { "a@x.com": 2, "b@x.com": 3600 } });
    expect(checkEvery).toEqual({ "a@x.com": 10, "b@x.com": 600 });
  });

  test("minutes saved by the previous version carry over", () => {
    const { checkEvery } = normalizeSettings({ intervals: { "a@x.com": 5, "b@x.com": 60 } });
    expect(checkEvery).toEqual({ "a@x.com": 300, "b@x.com": 600 });
  });
});

test("accounts without an interval are checked every minute", () => {
  const settings = normalizeSettings({ checkEvery: { "a@x.com": 15 } });
  expect(intervalFor(settings, "a@x.com")).toBe(15);
  expect(intervalFor(settings, "b@x.com")).toBe(60);
});

test("formatInterval", () => {
  expect(formatInterval(10)).toBe("10 seconds");
  expect(formatInterval(60)).toBe("1 minute");
  expect(formatInterval(600)).toBe("10 minutes");
});
