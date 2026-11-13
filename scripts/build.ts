/**
 * Builds the unpacked extension into dist/.
 * Usage: bun run build        one-off build
 *        bun run dev          rebuild on every change in src/, public/
 */
import { watch } from "node:fs";
import { cp, rm } from "node:fs/promises";
import { createManifest } from "../src/manifest.ts";

const root = new URL("..", import.meta.url).pathname;
const out = `${root}dist`;

/** HTML and CSS copied as-is next to the bundled scripts. */
const PAGES = [
  "ui/base.css",
  "popup/popup.html",
  "popup/popup.css",
  "options/options.html",
  "options/options.css",
  "offscreen/offscreen.html",
];

async function build(): Promise<boolean> {
  const started = performance.now();

  const keyFile = Bun.file(`${root}extension-key.json`);
  if (!(await keyFile.exists())) {
    console.error("extension-key.json is missing. Run `bun run keygen` first.");
    return false;
  }
  const { key, id } = (await keyFile.json()) as { key: string; id: string };
  const { version } = (await Bun.file(`${root}package.json`).json()) as { version: string };

  if (!process.env.PUBLIC_GOOGLE_CLIENT_ID) {
    console.warn("! PUBLIC_GOOGLE_CLIENT_ID is not set in .env; sign-in will be disabled.");
  }

  await rm(out, { recursive: true, force: true });

  const result = await Bun.build({
    entrypoints: [
      `${root}src/background.ts`,
      `${root}src/popup/popup.ts`,
      `${root}src/options/options.ts`,
      `${root}src/offscreen/offscreen.ts`,
    ],
    outdir: out,
    target: "browser",
    format: "esm",
    naming: "[name].[ext]",
    // Always inline, even when unset: `process` doesn't exist in the browser.
    define: {
      "process.env.PUBLIC_GOOGLE_CLIENT_ID": JSON.stringify(
        process.env.PUBLIC_GOOGLE_CLIENT_ID ?? "",
      ),
    },
    sourcemap: "linked",
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    return false;
  }

  await Promise.all([
    cp(`${root}public`, out, { recursive: true }),
    ...PAGES.map((file) => cp(`${root}src/${file}`, `${out}/${file.split("/").pop()}`)),
    Bun.write(
      `${out}/manifest.json`,
      `${JSON.stringify(createManifest({ version, key }), null, 2)}\n`,
    ),
  ]);

  console.log(`Built dist/ for extension ${id} in ${Math.round(performance.now() - started)}ms`);
  return true;
}

const ok = await build();

if (process.argv.includes("--watch")) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const rebuild = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void build(), 100);
  };
  for (const dir of ["src", "public"]) watch(`${root}${dir}`, { recursive: true }, rebuild);
  console.log(
    "Watching src/ and public/ … (reload the extension in chrome://extensions after changes)",
  );
} else if (!ok) {
  process.exit(1);
}
