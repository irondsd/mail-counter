import { expect, test } from "bun:test";

const root = new URL("..", import.meta.url).pathname;

test("build output is browser-safe and complete", async () => {
  const proc = Bun.spawnSync(["bun", "scripts/build.ts"], { cwd: root, stderr: "pipe" });
  expect(proc.exitCode).toBe(0);

  for (const file of ["background.js", "popup.js", "options.js", "offscreen.js"]) {
    const js = await Bun.file(`${root}dist/${file}`).text();
    // `process` doesn't exist in extension pages or service workers.
    expect(js).not.toContain("process.env");
  }
  for (const file of [
    "manifest.json",
    "base.css",
    "popup.html",
    "popup.css",
    "options.html",
    "options.css",
    "offscreen.html",
    "icons/icon-16.png",
  ]) {
    expect(await Bun.file(`${root}dist/${file}`).exists()).toBe(true);
  }
});
