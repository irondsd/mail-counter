import { expect, test } from "bun:test";
import { extensionIdFromKey } from "../src/lib/extension-id.ts";
import { createManifest } from "../src/manifest.ts";

const keyFile = (await Bun.file(new URL("../extension-key.json", import.meta.url)).json()) as {
  id: string;
  key: string;
};

test("extension-key.json's ID matches its key", async () => {
  expect(await extensionIdFromKey(keyFile.key)).toBe(keyFile.id);
});

test("IDs are 32 letters a-p", async () => {
  expect(await extensionIdFromKey(btoa("any bytes"))).toMatch(/^[a-p]{32}$/);
});

test("manifest pins the key and asks only for what it needs", () => {
  const manifest = createManifest({ version: "1.2.3", key: keyFile.key });
  expect(manifest.manifest_version).toBe(3);
  expect(manifest.key).toBe(keyFile.key);
  expect(manifest.version).toBe("1.2.3");
  expect(manifest.permissions).toEqual(["identity", "alarms", "storage"]);
  expect("host_permissions" in manifest).toBe(false);
});
