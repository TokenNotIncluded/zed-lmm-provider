import { test } from "node:test";
import assert from "node:assert/strict";
import { LmmHttp } from "../src/vendor/http.ts";
import { LmmError } from "../src/vendor/protocol.ts";

test("oversized JSON error streams are bounded and cancelled without exposing their contents", async () => {
  let pulls = 0;
  let cancelled = false;
  const chunk = new TextEncoder().encode(" ".repeat(256));
  const http = new LmmHttp({
    fetch: async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            if (pulls++ < 100) controller.enqueue(chunk);
            else {
              controller.enqueue(
                new TextEncoder().encode(
                  '{"secret":"lmm_at_private","code":"IP_ACCESS_ROUTE_REJECTED"}',
                ),
              );
              controller.close();
            }
          },
          cancel() {
            cancelled = true;
          },
        }),
        { status: 403, headers: { "content-type": "application/json" } },
      ),
  });
  await assert.rejects(
    http.request("/api/oauth2/catalog", {}, 32),
    (error: unknown) => {
      assert.ok(error instanceof LmmError);
      assert.equal(error.code, "unauthorized");
      assert.doesNotMatch(
        error.message,
        /lmm_at_private|IP_ACCESS_ROUTE_REJECTED/,
      );
      return true;
    },
  );
  assert.ok(pulls < 4, `oversized error read ${pulls} chunks`);
  assert.equal(cancelled, true);
});

test("a bounded valid IP policy error keeps its specific safe message", async () => {
  const http = new LmmHttp({
    fetch: async () =>
      new Response('{"error":{"code":"IP_ACCESS_ROUTE_REJECTED"}}', {
        status: 403,
        headers: { "content-type": "application/json" },
      }),
  });
  await assert.rejects(
    http.bearer("/api/oauth2/catalog", "synthetic-access"),
    (error: unknown) => {
      assert.ok(error instanceof LmmError);
      assert.equal(error.code, "ip_policy");
      return true;
    },
  );
});

test("malformed UTF-8 cannot become replacement characters in a successful JSON response", async () => {
  const http = new LmmHttp({
    fetch: async () =>
      new Response(
        Buffer.concat([
          Buffer.from('{"value":"'),
          Buffer.from([0xff]),
          Buffer.from('"}'),
        ]),
        { headers: { "content-type": "application/json" } },
      ),
  });
  await assert.rejects(http.bearer("/api/oauth2/catalog", "synthetic-access"));
});

for (const status of [200, 403]) {
  test(`cancelling a stalled HTTP ${status} body settles and cancels its reader`, async () => {
    let started!: () => void;
    const reading = new Promise<void>((resolve) => {
      started = resolve;
    });
    let cancelled = false;
    const controller = new AbortController();
    const http = new LmmHttp({
      fetch: async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull() {
              started();
            },
            cancel() {
              cancelled = true;
            },
          }),
          { status, headers: { "content-type": "application/json" } },
        ),
    });
    const request = http.bearer(
      "/api/oauth2/catalog",
      "synthetic-access",
      controller.signal,
    );
    await reading;
    controller.abort();
    await assert.rejects(request, (error: unknown) => {
      assert.ok(error instanceof LmmError);
      assert.equal(error.code, "aborted");
      return true;
    });
    assert.equal(cancelled, true);
  });
}
