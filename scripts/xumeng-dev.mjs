import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultBackend = "https://dzmm-backend.850587960.workers.dev";
const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== "--dry-run")) {
  console.error("使用 node scripts/xumeng-dev.mjs；仅支持 --dry-run 检查启动配置。");
  process.exit(1);
}
let backend;
try {
  backend = new URL(process.env.DZMM_BACKEND_URL?.trim() || defaultBackend);
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(backend.hostname);
  if (backend.username || backend.password || backend.pathname !== "/" || backend.search || backend.hash
    || !(backend.origin === defaultBackend || (loopback && ["http:", "https:"].includes(backend.protocol)))) {
    throw new Error("untrusted backend");
  }
} catch {
  console.error("本地叙梦后端地址无效；只能使用指定 HTTPS Worker 或 loopback 开发后端。");
  process.exit(1);
}

const nextArgs = [resolve(repository, "node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", "3010"];
const devEnv = { ...process.env, NODE_ENV: "development", DZMM_LOCAL_SUPER_AUTO_LOGIN: "1", DZMM_BACKEND_URL: backend.origin };
if (args[0] === "--dry-run") {
  console.log(JSON.stringify({ command: process.execPath, args: nextArgs, cwd: repository,
    environment: { NODE_ENV: devEnv.NODE_ENV, DZMM_LOCAL_SUPER_AUTO_LOGIN: devEnv.DZMM_LOCAL_SUPER_AUTO_LOGIN, DZMM_BACKEND_URL: devEnv.DZMM_BACKEND_URL } }));
} else {
  const child = spawn(process.execPath, nextArgs, { cwd: repository, env: devEnv, stdio: "inherit" });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
  child.on("error", () => {
    console.error("本地叙梦开发服务未启动，请确认已安装项目依赖。");
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
}
