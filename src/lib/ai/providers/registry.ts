import { AnthropicProvider } from "./anthropic";
import { createE2EMockProvider } from "./e2eMockProvider";
import type { ModelProvider } from "./types";

/**
 * Known provider keys. Adding a real provider (OpenAI, a local/open-weight
 * model server, etc.) is: add its key here, add one `case` in
 * `createProvider` below, done — no other file needs to change. This is
 * the whole point of the abstraction (see DECISIONS.md, "Model provider
 * abstraction").
 */
export const PROVIDER_KEYS = ["anthropic", "mock"] as const;
export type ProviderKey = (typeof PROVIDER_KEYS)[number];

const instances = new Map<ProviderKey, ModelProvider>();

/** Register a provider instance for a key — how tests inject a
 * MockProvider, and how a real deployment could swap in a differently
 * configured provider without touching this file. */
export function registerProvider(key: ProviderKey, provider: ModelProvider): void {
  instances.set(key, provider);
}

export function getProvider(key: ProviderKey): ModelProvider {
  const existing = instances.get(key);
  if (existing) return existing;

  const created = createProvider(key);
  instances.set(key, created);
  return created;
}

function createProvider(key: ProviderKey): ModelProvider {
  switch (key) {
    case "anthropic":
      // Test-fixture override for the Playwright e2e suite ONLY — see
      // DECISIONS.md ("E2E coverage for the AI analysis flow uses a
      // fixture model provider"). Only playwright.config.ts's webServer
      // sets this env var; `npm run dev` / a real `npm run start` never
      // do, so this branch is inert in every real usage of the app.
      //
      // This check lives here (inside createProvider) rather than in an
      // external Next.js instrumentation hook because Next's per-route
      // bundling gives the instrumentation hook and a Server Action
      // separate module instances of this file — a module-level
      // `registerProvider()` call made from instrumentation.ts does not
      // reliably reach the instance a Server Action resolves providers
      // from. Reading `process.env` here works regardless of bundling,
      // since env vars are process-wide, not bundle-scoped.
      if (process.env.USE_MOCK_MODEL_PROVIDER === "true") {
        return createE2EMockProvider();
      }
      return new AnthropicProvider();
    case "mock":
      throw new Error(
        'No "mock" provider registered. Call registerProvider("mock", new MockProvider(...)) first — see tests/unit/modelClient.test.ts.',
      );
  }
}

/** Test-only: clear cached instances between test files so one test's
 * registerProvider() call can't leak into another. */
export function _resetProvidersForTests(): void {
  instances.clear();
}
