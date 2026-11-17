import { parseMetadata, type ServerMetadata } from "./server-metadata.ts";
import { peekModelsDev, type ModelsDevCatalog, type ModelsDevMetadata } from "./models-dev-cache.ts";
import {
  base64url,
  canonicalId,
  object,
  requireValue,
  text,
} from "./vendor/protocol.ts";

export interface Model {
  id: string;
  name: string;
  group: string;
  groupName: string;
  upstream: string;
  apis: string[];
  metadata?: ServerMetadata;
  reference?: ModelsDevMetadata;
  pricing?: Record<string, unknown>;
  groupMultiplier: number | null;
}
export function parseCatalog(
  value: unknown,
  resource: string,
  scope: string,
  references: ModelsDevCatalog = peekModelsDev(),
): Model[] {
  const data = object(value);
  requireValue(data.schema_version === 1 && data.resource === resource);
  requireValue(
    Array.isArray(data.groups) &&
      Array.isArray(data.models) &&
      data.models.length <= 20000,
  );
  const allowed = new Set(scope.split(" "));
  const groups = new Map<string, string>();
  for (const value of data.groups) {
    const row = object(value);
    const id = canonicalId(row.id);
    const name = text(row.name);
    requireValue(
      id === base64url(name) &&
        row.scope === `group:${id}` &&
        allowed.has(`group:${id}`) &&
        !groups.has(id),
    );
    groups.set(id, name);
  }
  const ids = new Set<string>();
  return data.models.map((value) => {
    const row = object(value);
    const group = canonicalId(row.group_id);
    const groupName = groups.get(group);
    const upstream = text(row.upstream_model, 512);
    const id = text(row.id, 4096);
    requireValue(
      groups.get(group) === row.group &&
        id === `lmm:${group}:${base64url(upstream)}` &&
        !ids.has(id),
    );
    requireValue(
      Array.isArray(row.apis) &&
        row.apis.every((api) => typeof api === "string"),
    );
    const pricing = object(row.pricing);
    const multiplier = pricing.group_multiplier;
    requireValue(
      multiplier === null ||
        (typeof multiplier === "number" && Number.isFinite(multiplier) && multiplier >= 0),
    );
    ids.add(id);
    return {
      id,
      group,
      groupName: groupName!,
      upstream,
      name: text(row.name),
      groupMultiplier: multiplier as number | null,
      apis: row.apis as string[],
      metadata: parseMetadata(row.metadata), reference: references.resolve(upstream), pricing,
    };
  });
}

// User overrides remain bound to authorized route IDs; fuzzy matching only supplies metadata.
export interface ModelConfiguration {
  id: string;
  max_tokens: number;
  max_output_tokens?: number;
  capabilities?: {
    tools?: boolean;
    images?: boolean;
    parallel_tool_calls?: boolean;
  };
}
export function zedSettings(
  models: Model[],
  configuration: ModelConfiguration[],
  port: number,
) {
  requireValue(Number.isInteger(port) && port > 0 && port <= 65535);
  const byId = new Map(models.map((model) => [model.id, model]));
  const seen = new Set<string>();
  const available_models = configuration.map((raw) => {
    const entry = object(raw);
    const id = text(entry.id, 4096);
    const model = byId.get(id);
    requireValue(
      model && !seen.has(id),
      "Configured model is missing from the current account catalog or duplicated.",
    );
    seen.add(id);
    requireValue(
      Number.isSafeInteger(entry.max_tokens) &&
        (entry.max_tokens as number) > 0,
    );
    if (entry.max_output_tokens !== undefined)
      requireValue(
        Number.isSafeInteger(entry.max_output_tokens) &&
          (entry.max_output_tokens as number) > 0 &&
          (entry.max_output_tokens as number) <= (entry.max_tokens as number),
      );
    const chat = model.apis.includes("openai-completions");
    requireValue(
      chat || model.apis.includes("openai-responses"),
      "This model has no Zed-compatible OpenAI protocol.",
    );
    const capabilities = object(entry.capabilities ?? {});
    requireValue(
      Object.keys(capabilities).every((key) =>
        ["tools", "images", "parallel_tool_calls"].includes(key),
      ) &&
        Object.values(capabilities).every(
          (value) => typeof value === "boolean",
        ),
    );
    return {
      name: id,
      display_name: `${model.groupName} / ${model.upstream} · ${model.groupMultiplier === null ? "倍率未知" : `${model.groupMultiplier}×`} · ${model.metadata ? "server metadata" : model.reference ? "models.dev reference" : "context估算"}`,
      max_tokens: entry.max_tokens,
      ...(entry.max_output_tokens === undefined
        ? {}
        : { max_output_tokens: entry.max_output_tokens }),
      capabilities: {
        tools: false,
        images: false,
        parallel_tool_calls: false,
        ...capabilities,
        chat_completions: chat,
      },
    };
  });
  return {
    language_models: {
      openai_compatible: {
        lmm: { api_url: `http://127.0.0.1:${port}/v1`, available_models },
      },
    },
  };
}

/** Metadata enriches every compatible authorized route; a miss never removes it. */
export function defaultConfiguration(models: Model[]): ModelConfiguration[] {
  return models
    .filter((model) => model.apis.includes("openai-completions") || model.apis.includes("openai-responses"))
    .filter((model) => {
      const input = model.metadata?.input_modalities ?? model.reference?.modalities.input;
      const output = model.metadata?.output_modalities ?? model.reference?.modalities.output;
      return (!input || input.includes("text")) && (!output || output.includes("text"));
    })
    .map((model) => {
      const context = model.metadata?.context_window ?? model.reference?.limit.context;
      const input = model.metadata?.max_input_tokens ?? model.reference?.limit.input;
      const budget = Math.min(context && context > 0 ? context : input && input > 0 ? input : 32768, input && input > 0 ? input : Infinity);
      const output = model.metadata?.max_output_tokens ?? model.reference?.limit.output;
      const modalities = model.metadata?.input_modalities ?? model.reference?.modalities.input;
      return {
        id: model.id,
        max_tokens: budget,
        max_output_tokens: Math.min(output && output > 0 ? output : 4096, budget),
        capabilities: {
          tools: (model.metadata?.tool_call ?? model.reference?.tool_call) === true,
          images: modalities?.includes("image") === true,
          parallel_tool_calls: false,
        },
      };
    });
}
