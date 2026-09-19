import { AnthropicProvider } from "./anthropic";
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
