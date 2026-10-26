import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "jsonc-parser";
import { defaultConfiguration, zedSettings } from "../src/catalog.ts";
import { mergeSettings } from "../src/settings.ts";

const model = {
  id: "lmm:ZGVmYXVsdA:cmVhbC1tb2RlbA",
  name: "Current catalog model",
  group: "ZGVmYXVsdA",
  upstream: "real-model",
  apis: ["openai-responses"],
};

function merge(saved: Record<string, unknown>, preserve = true) {
  const source = JSON.stringify({
    language_models: {
      openai_compatible: { lmm: { available_models: [saved] } },
    },
  });
  const provider = zedSettings([model], defaultConfiguration([model]), 7391)
    .language_models.openai_compatible.lmm;
  return parse(mergeSettings(source, provider, preserve)).language_models
    .openai_compatible.lmm.available_models[0];
}

test("preserved limits and tool choices cannot override the current catalog protocol", () => {
  for (const capabilities of [
    { tools: true, images: true },
    { tools: true, images: true, chat_completions: true },
  ]) {
    const updated = merge({
      name: model.id,
      display_name: "Previous catalog label",
      max_tokens: 8192,
      max_output_tokens: 1024,
      capabilities,
    });
    assert.equal(updated.name, model.id);
    assert.equal(updated.display_name, model.name);
    assert.equal(updated.max_tokens, 8192);
    assert.equal(updated.max_output_tokens, 1024);
    assert.deepEqual(updated.capabilities, {
      tools: true,
      images: true,
      parallel_tool_calls: false,
      chat_completions: false,
    });
  }
});

test("new fallback output fits a previously configured smaller context", () => {
  const updated = merge({ name: model.id, max_tokens: 2048 });
  assert.equal(updated.max_tokens, 2048);
  assert.equal(updated.max_output_tokens, 2048);
});

test("invalid explicit limits refuse configuration instead of changing user intent", () => {
  for (const limits of [
    { max_tokens: 0 },
    { max_tokens: 1.5 },
    { max_tokens: 2048, max_output_tokens: 4096 },
    { max_tokens: 2048, max_output_tokens: -1 },
  ]) {
    assert.throws(() => merge({ name: model.id, ...limits }), /Existing LMM/);
  }
});

test("explicit replacement ignores previous metadata", () => {
  const updated = merge({ name: model.id, max_tokens: 1 }, false);
  assert.equal(updated.max_tokens, 32768);
  assert.equal(updated.max_output_tokens, 4096);
  assert.equal(updated.capabilities.chat_completions, false);
});
