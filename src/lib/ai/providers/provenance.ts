/**
 * The one definition of "was this served by a real model?". Everything that
 * records or displays simulated-versus-real provenance (persisted runs, the
 * ticket page) must use this, never an ad-hoc string comparison, because two
 * such comparisons once disagreed: persistence treated only "mock" as
 * simulated while the UI treated anything but "anthropic" as simulated, which
 * would have let a new provider's runs count as real in the metrics.
 *
 * The rule is an allowlist of REAL providers, so it fails closed: a provider
 * is simulated unless it is explicitly listed as real. `demo` (public Demo
 * Mode's scripted replay) and `mock` (test and dry-run fixtures) are therefore
 * simulated, and so is any provider added in the future until someone
 * deliberately adds it to `REAL_PROVIDER_KEYS`. Adding a real provider is the
 * only change that makes its runs count in the real metrics.
 *
 * See DECISIONS.md ("Honestly recording which provider actually served a
 * call" and "Public Demo Mode").
 */

/** `ModelProvider.key` of the scripted Demo Mode provider. */
export const DEMO_PROVIDER_KEY = "demo";

/** Provider keys whose answers come from a real model. */
export const REAL_PROVIDER_KEYS: readonly string[] = ["anthropic"];

export function isSimulatedProvider(providerKey: string): boolean {
  return !REAL_PROVIDER_KEYS.includes(providerKey);
}

/** True when ANY of the given provider keys is simulated (a run is real only if every call was). */
export function anyProviderSimulated(providerKeys: Iterable<string>): boolean {
  for (const key of providerKeys) {
    if (isSimulatedProvider(key)) return true;
  }
  return false;
}
