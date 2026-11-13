/**
 * Creates the RSA key that pins this extension's ID.
 *
 * Chrome derives an unpacked extension's ID from the folder path unless the
 * manifest has a "key". With a fixed key the ID (and so the OAuth redirect URL
 * https://<id>.chromiumapp.org/) is the same on every machine.
 *
 *   extension-key.json  public key + ID, commit it
 *   .keys/extension.pem private key, only needed to pack a .crx; keep it private
 *
 * Usage: bun run keygen [--force]
 */
import { generateKeyPairSync } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { extensionIdFromKey } from "../src/lib/extension-id.ts";

const root = new URL("..", import.meta.url).pathname;
const publicFile = Bun.file(`${root}extension-key.json`);

if ((await publicFile.exists()) && !process.argv.includes("--force")) {
  const { id } = (await publicFile.json()) as { id: string };
  console.log(`extension-key.json already exists (ID ${id}).`);
  console.log(
    "A new key changes the ID and breaks the OAuth redirect URL. Use --force if you mean it.",
  );
  process.exit(1);
}

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "der" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const key = publicKey.toString("base64");
const id = await extensionIdFromKey(key);

await mkdir(`${root}.keys`, { recursive: true });
await Bun.write(`${root}.keys/extension.pem`, privateKey);
await Bun.write(publicFile, `${JSON.stringify({ id, key }, null, 2)}\n`);

console.log(`Extension ID: ${id}`);
console.log(`Redirect URI: https://${id}.chromiumapp.org/`);
