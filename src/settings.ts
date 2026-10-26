import { applyEdits, modify, parse, type ParseError } from "jsonc-parser";
import {
  readFile,
  mkdir,
  copyFile,
  writeFile,
  rename,
  lstat,
  unlink,
} from "node:fs/promises";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { object, requireValue } from "./vendor/protocol.ts";

export function mergeSettings(
  source: string,
  provider: unknown,
  preserveModelSettings = false,
): string {
  const errors: ParseError[] = [];
  const root = parse(source, errors, { allowTrailingComma: true });
  requireValue(
    errors.length === 0,
    "Zed settings contain invalid JSONC. Fix the file before configuring LMM.",
  );
  object(root);
  if (root.language_models !== undefined) object(root.language_models);
  if (root.language_models?.openai_compatible !== undefined)
    object(root.language_models.openai_compatible);
  if (preserveModelSettings) {
    const next = object(provider);
    const existing =
      root.language_models?.openai_compatible?.lmm?.available_models;
    if (Array.isArray(existing) && Array.isArray(next.available_models)) {
      const byId = new Map<string, Record<string, unknown>>();
      for (const model of existing) {
        if (
          model &&
          typeof model === "object" &&
          typeof model.name === "string"
        )
          byId.set(model.name, object(model));
      }
      provider = {
        ...next,
        available_models: next.available_models.map((model) => {
          const current = object(model);
          const saved =
            typeof current.name === "string"
              ? byId.get(current.name)
              : undefined;
          if (!saved) return current;
          const capabilities = object(current.capabilities ?? {});
          const maxTokens =
            saved.max_tokens === undefined
              ? current.max_tokens
              : saved.max_tokens;
          requireValue(
            typeof maxTokens === "number" &&
              Number.isSafeInteger(maxTokens) &&
              maxTokens > 0,
            "Existing LMM context limits must be positive safe integers.",
          );
          let maxOutput =
            saved.max_output_tokens === undefined
              ? current.max_output_tokens
              : saved.max_output_tokens;
          if (maxOutput !== undefined) {
            requireValue(
              typeof maxOutput === "number" &&
                Number.isSafeInteger(maxOutput) &&
                maxOutput > 0,
              "Existing LMM output limits must be positive safe integers.",
            );
            if (saved.max_output_tokens === undefined)
              maxOutput = Math.min(maxOutput, maxTokens);
            else
              requireValue(
                maxOutput <= maxTokens,
                "Existing LMM output limits exceed their context limits.",
              );
          }
          return {
            ...current,
            ...saved,
            name: current.name,
            display_name: current.display_name,
            max_tokens: maxTokens,
            ...(maxOutput === undefined
              ? {}
              : { max_output_tokens: maxOutput }),
            capabilities: {
              ...capabilities,
              ...object(saved.capabilities ?? {}),
              // The current catalog determines which inference endpoint is usable.
              chat_completions: capabilities.chat_completions,
            },
          };
        }),
      };
    }
  }
  return applyEdits(
    source,
    modify(source, ["language_models", "openai_compatible", "lmm"], provider, {
      formattingOptions: { insertSpaces: true, tabSize: 2 },
    }),
  );
}
export async function configureSettings(
  path: string,
  provider: unknown,
  preserveModelSettings = false,
): Promise<string | undefined> {
  await mkdir(dirname(path), { recursive: true });
  let source = "{}\n";
  let backup: string | undefined;
  try {
    const info = await lstat(path);
    requireValue(
      info.isFile() && !info.isSymbolicLink(),
      "Zed settings must be a regular file.",
    );
    source = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const updated = mergeSettings(source, provider, preserveModelSettings);
  if (updated === source) return undefined;
  try {
    await lstat(path);
    backup = `${path}.lmm-backup-${Date.now()}-${randomBytes(3).toString("hex")}`;
    await copyFile(path, backup);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const temporary = `${path}.lmm-${randomBytes(8).toString("hex")}`;
  try {
    await writeFile(temporary, updated, { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => {});
  }
  return backup;
}
