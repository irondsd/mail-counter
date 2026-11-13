/**
 * Renders assets/icon.svg to the PNG sizes Chrome wants.
 * Usage: bun run icons
 */
import { Resvg } from "@resvg/resvg-js";

const SIZES = [16, 32, 48, 128] as const;
const root = new URL("..", import.meta.url).pathname;
const svg = await Bun.file(`${root}assets/icon.svg`).text();

for (const size of SIZES) {
  const png = new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();
  const out = `${root}public/icons/icon-${size}.png`;
  await Bun.write(out, png);
  console.log(`wrote ${out.slice(root.length)} (${png.length} bytes)`);
}
