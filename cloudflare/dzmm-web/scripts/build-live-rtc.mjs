// Keep the large receiving-only RTC SDK out of the ordinary site bundle.
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const source = fileURLToPath(new URL("../../../vidu-live/", import.meta.url));
const require = createRequire(`${source}/package.json`);
const { build } = require("esbuild");
const target = fileURLToPath(new URL("../../../public/dzmm/live/rtc.js", import.meta.url));
await mkdir(fileURLToPath(new URL("../../../public/dzmm/live/", import.meta.url)), { recursive: true });
await build({ absWorkingDir: source, entryPoints: ["rtc-entry.js"], bundle: true, format: "iife", platform: "browser", outfile: target, minify: true, legalComments: "eof" });
console.log("Built pinned AliRTC 7.3.4 receiver SDK for lazy loading.");
