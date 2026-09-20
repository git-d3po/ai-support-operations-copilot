/**
 * Start command for the public Demo Mode deployment:
 * `DATABASE_URL=file:./demo.db npm run start:demo` (after `npm run build`).
 *
 * Makes the deployment's mode explicit rather than relying on an operator
 * remembering a variable: the server is started with AI_MODE=demo and with
 * ANTHROPIC_API_KEY blanked in its environment, so it cannot answer in live
 * mode and cannot see a key even if one was configured on the host by mistake.
 * The application's own default (unset AI_MODE means live) is unchanged; this
 * script is only the public entry point. It then initializes the database
 * (scripts/initDemoDatabase.ts, with the same guards) and starts `next start`,
 * which honors PORT and binds 0.0.0.0 by default.
 *
 * Initializing on every start is deliberate: the deployment's filesystem may
 * not persist between restarts, so the container always begins from the same
 * deterministic dataset, and demo runs reset when the process restarts.
 *
 * SIGINT and SIGTERM are handled from the very start: they are forwarded to
 * whichever child is running (the initialization, then the server), and if one
 * arrives during initialization the server is never started.
 */
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { assertSafeDemoDatabaseUrl, buildDemoEnv } from "../src/lib/deploy/demoDeployment";

const cwd = process.cwd();
const bin = (name: string) => path.join(cwd, "node_modules/.bin", name);

const SIGNAL_EXIT_CODES = { SIGINT: 130, SIGTERM: 143 } as const;

/** Resolves when the child exits; rejects, with context, if it could not be started or errored. */
function waitForExit(child: ChildProcess, label: string): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    child.once("error", (error) => reject(new Error(`${label} could not be run: ${error.message}`)));
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

async function main() {
  // A plain object (not `let` variables assigned in a closure, which TypeScript would narrow to
  // `undefined` at the reads below): what is running now, and which signal asked us to stop.
  const state: { running?: ChildProcess; stoppedBy?: keyof typeof SIGNAL_EXIT_CODES } = {};
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      state.stoppedBy ??= signal;
      state.running?.kill(signal);
    });
  }

  const env = buildDemoEnv(process.env);
  assertSafeDemoDatabaseUrl(env, cwd);

  console.log("Public demo: AI_MODE=demo, the Anthropic key is blanked for the server, no model is called.");

  state.running = spawn(bin("tsx"), ["scripts/initDemoDatabase.ts"], { cwd, env, stdio: "inherit" });
  const init = await waitForExit(state.running, "Demo database initialization");
  if (state.stoppedBy) {
    process.exitCode = SIGNAL_EXIT_CODES[state.stoppedBy];
    return;
  }
  if (init.code !== 0) {
    throw new Error("Demo database initialization failed; the server was not started.");
  }

  state.running = spawn(bin("next"), ["start"], { cwd, env, stdio: "inherit" });
  const server = await waitForExit(state.running, "The demo server (next start)");
  process.exitCode = server.code ?? (server.signal ? 1 : 0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
