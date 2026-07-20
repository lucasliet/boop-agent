import { describe, expect, it } from "vitest";
import { findModelCost, type ModelsDevDataset } from "../server/model-prices.js";

const dataset: ModelsDevDataset = {
  zai: {
    models: {
      "glm-5.2": { cost: { input: 1.4, output: 4.4, cache_read: 0.26 } },
    },
  },
  openai: {
    models: {
      "gpt-5": { cost: { input: 1.25, output: 10, cache_read: 0.125 } },
    },
  },
  openrouter: {
    models: {
      "gpt-5": { cost: { input: 2, output: 16 } },
    },
  },
  ollama: {
    models: {
      "llama3.1": {},
    },
  },
};

describe("findModelCost", () => {
  it("finds an exact model match with provider hint from the base URL", () => {
    // Given
    const baseUrl = "https://api.z.ai/api/coding/paas/v4";

    // When
    const cost = findModelCost(dataset, "glm-5.2", baseUrl);

    // Then
    expect(cost).toEqual({ input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 });
  });

  it("prefers the hinted provider when several providers serve the same model id", () => {
    // Given
    const baseUrl = "https://openrouter.ai/api/v1";

    // When
    const cost = findModelCost(dataset, "gpt-5", baseUrl);

    // Then
    expect(cost?.input).toBe(2);
  });

  it("falls back to any provider when the hint does not serve the model", () => {
    // Given
    const baseUrl = "https://api.z.ai/api/coding/paas/v4";

    // When
    const cost = findModelCost(dataset, "gpt-5", baseUrl);

    // Then
    expect(cost?.input).toBe(1.25);
  });

  it("matches without a base URL hint", () => {
    // Given / When
    const cost = findModelCost(dataset, "GLM-5.2");

    // Then
    expect(cost?.output).toBe(4.4);
  });

  it("returns null for models without pricing (e.g. local Ollama)", () => {
    // Given / When
    const cost = findModelCost(dataset, "llama3.1");

    // Then
    expect(cost).toBeNull();
  });

  it("returns null for unknown or empty model ids", () => {
    // Given / When / Then
    expect(findModelCost(dataset, "does-not-exist")).toBeNull();
    expect(findModelCost(dataset, "   ")).toBeNull();
  });
});
