import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const script = resolve(dirname(fileURLToPath(import.meta.url)), "build-character-share.py");
const result = spawnSync("python3", [script], { stdio: "inherit" });
if (result.status !== 0) process.exit(result.status ?? 1);
