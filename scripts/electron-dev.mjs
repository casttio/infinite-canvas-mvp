import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { request } from "node:http";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const electronBinary = require("electron");
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const watchedElectronFiles = [
  path.join(projectRoot, "electron", "main.cjs"),
  path.join(projectRoot, "electron", "preload.cjs"),
];

const devServerHost = process.env.VITE_DEV_SERVER_HOST ?? "127.0.0.1";
const devServerPort = process.env.VITE_DEV_SERVER_PORT ?? "5173";
const devServerUrl = process.env.VITE_DEV_SERVER_URL ?? `http://${devServerHost}:${devServerPort}`;
const npmCliPath = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
const electronEnv = {
  ...process.env,
  VITE_DEV_SERVER_URL: devServerUrl,
};

let isShuttingDown = false;
let electronProcess = null;
let restartTimer = null;
let viteProcess = null;

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

const shutdown = (code = 0) => {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  if (electronProcess && !electronProcess.killed) {
    electronProcess.kill("SIGTERM");
  }
  if (viteProcess && !viteProcess.killed) {
    viteProcess.kill("SIGTERM");
  }
  process.exit(code);
};

process.on("SIGINT", () => shutdown(130));
process.on("SIGTERM", () => shutdown(143));

let reuseExistingDevServer = false;
try {
  await waitForServer(devServerUrl, 1200);
  reuseExistingDevServer = true;
} catch {
  viteProcess = spawn(
    process.execPath,
    [npmCliPath, "run", "dev", "--", "--host", devServerHost, "--strictPort", "--port", devServerPort],
    {
      stdio: "inherit",
      env: process.env,
    },
  );

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
}

if (reuseExistingDevServer) {
  console.log(`Reusing Vite dev server at ${devServerUrl}`);
}

const electronArgs =
  process.platform === "linux"
    ? ["--no-sandbox", "--disable-gpu", "--in-process-gpu", "."]
    : ["."];

const startElectron = () => {
  electronProcess = spawn(electronBinary, electronArgs, {
    stdio: "inherit",
    env: electronEnv,
  });

  electronProcess.on("exit", (code, signal) => {
    const exitedDuringRestart = !isShuttingDown && signal === "SIGTERM";
    if (exitedDuringRestart) {
      return;
    }

    shutdown(code ?? 0);
  });
};

const scheduleElectronRestart = () => {
  if (isShuttingDown) {
    return;
  }

  if (restartTimer) {
    clearTimeout(restartTimer);
  }

  restartTimer = setTimeout(() => {
    restartTimer = null;
    if (electronProcess && !electronProcess.killed) {
      electronProcess.kill("SIGTERM");
    }
    startElectron();
  }, 120);
};

for (const watchedFile of watchedElectronFiles) {
  watch(watchedFile, () => {
    scheduleElectronRestart();
  });
}

startElectron();
