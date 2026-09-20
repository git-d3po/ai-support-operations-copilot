import { getAiMode } from "../mode";
import { AnthropicProvider } from "./anthropic";
import { DemoProvider } from "./demoProvider";
import { isSimulatedProvider } from "./provenance";
import type { ModelProvider } from "./types";

/**
 * Known provider keys. Adding a real provider (OpenAI, a local/open-weight
 * model server, etc.) is: add its key here, add one `case` in
 * `createProvider` below, and list its `ModelProvider.key` in
 * `REAL_PROVIDER_KEYS` (provenance.ts) so its runs count as real rather than
 * simulated — no other file needs to change. This is the whole point of the
 * abstraction (see DECISIONS.md, "Model provider abstraction").
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
  // In Demo Mode a REAL provider instance must never be handed out, even if one
  // was cached earlier in this process (e.g. created before the mode was read).
  // "Real" is the shared provenance rule (provenance.ts), not a hardcoded key, so
  // a real provider added later is covered too. A simulated provider that was
  // registered explicitly (test injection) is kept. The mode is only read when a
  // real instance is cached, so live behavior and injected providers are unaffected.
  const staleRealProvider = existing !== undefined && !isSimulatedProvider(existing.key) && getAiMode() === "demo";
  if (existing && !staleRealProvider) return existing;

  const created = createProvider(key);
  instances.set(key, created);
  return created;
}

function createProvider(key: ProviderKey): ModelProvider {
  switch (key) {
    case "anthropic":
      // Public Demo Mode (AI_MODE=demo): the Anthropic slot is served by the
      // deterministic DemoProvider, so no model is called and no API key is
      // needed, even if one happens to be set in the environment. AnthropicProvider
      // is not constructed at all in this mode. Routing (modelRouting.ts) is
      // untouched: every step still targets "anthropic", and the run records the
      // provider that ACTUALLY answered ("demo"), which provenance.ts treats as
      // simulated. Unset AI_MODE means live, so existing behavior is unchanged.
      // See DECISIONS.md ("Public Demo Mode").
      if (getAiMode() === "demo") {
        return new DemoProvider();
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
