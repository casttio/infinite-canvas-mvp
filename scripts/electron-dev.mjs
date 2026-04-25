import { spawn } from "node:child_process";
import { request } from "node:http";
import process from "node:process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const electronBinary = require("electron");

const devServerUrl = process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:5173";
const viteCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const electronEnv = {
  ...process.env,
  VITE_DEV_SERVER_URL: devServerUrl,
};

let isShuttingDown = false;

const waitForServer = (url, timeoutMs = 20000) =>
  new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;

    const tryConnect = () => {
      const req = request(url, (res) => {
        res.resume();
        resolve();
      });

      req.on("error", () => {
        if (Date.now() >= deadline) {
          reject(new Error(`Timed out waiting for Vite dev server at ${url}`));
          return;
        }

        setTimeout(tryConnect, 250);
      });

      req.end();
    };

    tryConnect();
  });

const viteProcess = spawn(
  viteCommand,
  ["run", "dev", "--", "--host", "127.0.0.1", "--strictPort", "--port", "5173"],
  {
    stdio: "inherit",
    env: process.env,
  },
);

const shutdown = (code = 0) => {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  viteProcess.kill("SIGTERM");
  process.exit(code);
};

process.on("SIGINT", () => shutdown(130));
process.on("SIGTERM", () => shutdown(143));

viteProcess.on("exit", (code) => {
  if (!isShuttingDown) {
    process.exit(code ?? 1);
  }
});

try {
  await waitForServer(devServerUrl);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  shutdown(1);
}

const electronArgs =
  process.platform === "linux"
    ? ["--no-sandbox", "--disable-gpu", "--in-process-gpu", "."]
    : ["."];

const electronProcess = spawn(electronBinary, electronArgs, {
  stdio: "inherit",
  env: electronEnv,
});

electronProcess.on("exit", (code) => {
  shutdown(code ?? 0);
});
