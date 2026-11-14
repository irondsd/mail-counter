import { expect, test } from "bun:test";
import { menuItems } from "../src/lib/menu.ts";

const titles = (emails: string[]) =>
  menuItems(emails).map((i) => (i.parentId ? `  ${i.title}` : i.title));

test("no accounts: only Open popup", () => {
  expect(titles([])).toEqual(["Open popup"]);
});

test("accounts first, then Refresh, then Open popup", () => {
  expect(titles(["a@x.com", "b@x.com"])).toEqual([
    "Open a@x.com",
    "Open b@x.com",
    "Refresh",
    "Open popup",
  ]);
});

test("four accounts still fit Chrome's six top-level items", () => {
  const items = menuItems(["a", "b", "c", "d"]);
  expect(items.filter((i) => !i.parentId)).toHaveLength(6);
  expect(items.some((i) => i.parentId)).toBe(false);
});

test("more accounts move into a submenu so Refresh and Open popup stay visible", () => {
  expect(titles(["a", "b", "c", "d", "e", "f"])).toEqual([
    "Open a",
    "Open b",
    "Open c",
    "Open another inbox",
    "  Open d",
    "  Open e",
    "  Open f",
    "Refresh",
    "Open popup",
  ]);
  expect(menuItems(["a", "b", "c", "d", "e", "f"]).filter((i) => !i.parentId)).toHaveLength(6);
});
