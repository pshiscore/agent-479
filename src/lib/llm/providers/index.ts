import { LlmError } from "../errors";
import type { LlmProvider } from "../types";
import { OpenAIProvider } from "./openai";

export type ProviderFactory = () => LlmProvider;

/**
 * Adapters by the name stored in llm_models.provider. Switching between
 * providers listed here is a row change; a new provider needs one adapter.
 */
export const PROVIDERS: Record<string, ProviderFactory> = {
  openai: () => OpenAIProvider.fromEnv(),
};

const instances = new Map<string, LlmProvider>();

export function getProvider(
  name: string,
  registry: Record<string, ProviderFactory> = PROVIDERS,
): LlmProvider {
  const factory = registry[name];
  if (!factory) {
    throw new LlmError("unknown_provider", `No adapter for provider "${name}"`);
  }
  if (registry !== PROVIDERS) return factory();
  let instance = instances.get(name);
  if (!instance) {
    instance = factory();
    instances.set(name, instance);
  }
  return instance;
}
