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
    ).toEqual({ sound: false, volume: 1, checkEvery: { "a@x.com": 30 } });
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
