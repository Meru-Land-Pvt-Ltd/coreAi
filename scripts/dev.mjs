import { spawn } from "node:child_process";

const tasks = ["dev:shared", "dev:backend", "dev:telegram-worker", "dev:frontend"];
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const children = new Set();
let shuttingDown = false;

function stop(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }

  // Give npm's child processes a moment to receive the forwarded signal.
  const timer = setTimeout(() => process.exit(exitCode), 1_000);
  timer.unref();
}

for (const task of tasks) {
  const child = spawn(npmCommand, ["run", task], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit"
  });
  children.add(child);

  child.on("error", (error) => {
    console.error(`[dev] ${task} could not start:`, error.message);
    stop(1);
  });

  child.on("exit", (code, signal) => {
    children.delete(child);
    if (shuttingDown) return;
    console.error(
      `[dev] ${task} stopped unexpectedly${signal ? ` (${signal})` : ` (exit ${code ?? 1})`}.`
    );
    stop(code ?? 1);
  });
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
