import path from "node:path";

/**
 * Deployment-boundary rules for the public Demo Mode deployment, shared by
 * `scripts/initDemoDatabase.ts` and `scripts/startDemo.ts` and unit-tested.
 * Pure functions, no I/O.
 *
 * Two things must never happen in a public deployment: the app answering in
 * live mode, and the initialization (which clears and reseeds the database)
 * running against an evaluation database. See DECISIONS.md ("Public
 * deployment: explicit Demo Mode and a guarded initialization").
 */

export class UnsafeDeploymentDatabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeDeploymentDatabaseError";
  }
}

/** The absolute path a SQLite `file:` URL refers to, resolved against `cwd` the way the app and the seed script do. */
export function sqliteFilePath(url: string, cwd: string): string | null {
  if (!url.startsWith("file:")) return null;
  const withoutQuery = url.slice("file:".length).split("?")[0];
  if (withoutQuery.length === 0) return null;
  return path.resolve(cwd, withoutQuery);
}

/**
 * The database the deployment initialization is allowed to clear and reseed.
 * It must be named explicitly (there is no default: an unset DATABASE_URL would
 * otherwise fall back to the local development database), must be SQLite, and
 * must not be an evaluation database: not any file whose name starts with
 * `eval` (the repository's `eval.db` and the conventional
 * `eval-<something>.db` runs), and not the file EVAL_DATABASE_URL names.
 * Returns the absolute path. Content is checked separately, by the script.
 */
export function assertSafeDemoDatabaseUrl(env: Record<string, string | undefined>, cwd: string): string {
  const url = env.DATABASE_URL?.trim();
  if (!url) {
    throw new UnsafeDeploymentDatabaseError(
      "DATABASE_URL is not set. The deployment initialization needs an explicit SQLite target " +
        "(for example DATABASE_URL=file:./demo.db); it never falls back to a default database.",
    );
  }

  const file = sqliteFilePath(url, cwd);
  if (!file) {
    throw new UnsafeDeploymentDatabaseError("DATABASE_URL must be a SQLite file: URL (for example file:./demo.db).");
  }

  if (path.basename(file).toLowerCase().startsWith("eval")) {
    throw new UnsafeDeploymentDatabaseError(
      `Refusing to initialize ${file}: it looks like an evaluation database. The deployment initialization ` +
        "clears and reseeds its target, and evaluation databases hold live results. Use a separate file such as demo.db.",
    );
  }

  const evalUrl = env.EVAL_DATABASE_URL?.trim();
  const evalFile = evalUrl ? sqliteFilePath(evalUrl, cwd) : null;
  if (evalFile && evalFile === file) {
    throw new UnsafeDeploymentDatabaseError(`Refusing to initialize ${file}: EVAL_DATABASE_URL points at the same file.`);
  }

  return file;
}

/**
 * The environment the public demo server runs with: Demo Mode forced on, and
 * the Anthropic key blanked, so even a key added to the host by mistake is
 * invisible to the process. The key is set to an empty string rather than
 * deleted on purpose: `next start` loads `.env` and fills in any variable that
 * is undefined, so a deleted key would be re-read from a local `.env`, while a
 * defined-but-empty one is left alone. The application default (unset means
 * live) is untouched; only this deployment path is explicit.
 */
export function buildDemoEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...env, AI_MODE: "demo", ANTHROPIC_API_KEY: "" };
}
