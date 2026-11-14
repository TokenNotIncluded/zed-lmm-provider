# Dynamic OAuth model catalog

The client reads `GET /api/oauth2/catalog` with its own OAuth grant. Schema version 1 now supports additive `models[].metadata`: `context_window`, `max_input_tokens`, `max_output_tokens`, `input_modalities`, `output_modalities`, `reasoning`, `tool_call`, and `source`. Unknown fields are ignored; unknown values remain null.

When metadata is present it takes precedence over bundled model catalogs. New IDs do not need a plugin release. A missing server capability or price never falls back to a bundled guess. Old servers that omit metadata entirely retain the previous compatibility path; upgrade the server to make metadata authoritative.

`upstream_model` is the original request ID. The canonical catalog `id` binds it to the authorized group; requests retain that binding. `pricing` specifies currency, unit, input/output/cache/request rates and group/trust multipliers. Effective rates already include the multipliers: clients do not multiply again. Unknown is not free; final settlement remains server-authoritative.

A host context budget uses the smaller of the declared total context and input maximum. If only the input maximum is known it is used as a conservative budget; output is never added to invent total context. Current dynamic adapters expose text transport and explicitly advertised tools where supported; a reasoning boolean alone does not establish vendor-specific thinking controls or image transport.

Refreshing the catalog performs no paid model invocation. Discovery failures remain errors, not successful empty directories. Empty successful catalogs remove models. These changes are source updates, not a package publication or production deployment.

Zed settings/configure/start fetch current metadata. The running bridge refreshes on model discovery and invocation, then synchronizes the managed `language_models.openai_compatible.lmm` block; unrelated settings remain unchanged. Use `--models` for explicit verified overrides. With server metadata the managed model limits are replaced at sync, not retained from old generated defaults. Zed may require a model picker reload to display changed settings. Unknown limits exclude automatic entries; prices remain in `lmm-zed catalog` and bridge discovery because the native picker has no price field.
