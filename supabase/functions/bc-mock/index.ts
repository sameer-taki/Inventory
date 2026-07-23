// ============================================================================
// bc-mock — a stand-in for the Business Central OData create endpoint.
// ----------------------------------------------------------------------------
// Lets the gateway-bridge deliver path be exercised end-to-end WITHOUT on-prem
// BC connectivity: point BC_ODATA_URL at this function's URL and run the bridge
// in deliver mode. It accepts the posting document, echoes it back, and returns
// a synthetic document number the bridge stamps via ops.outbox_mark_sent.
//
// It is NOT Business Central. It performs no accounting and must never be used
// as the real target — it exists only for wiring/integration tests before the
// real BC OData endpoint (and its true field names) are available (D-3).
//
// Behaviour:
//   • POST  -> 200 { Document_No: "MOCK-ASM-<uuid>", echo: <body> }
//   • ?fail=true (or header x-mock-fail: 1) -> 500, to exercise the retry path
//   • honours x-idempotency-key by echoing it back
// ============================================================================

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const forceFail = url.searchParams.get("fail") === "true" || req.headers.get("x-mock-fail") === "1";
  const idem = req.headers.get("x-idempotency-key") ?? null;

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    /* allow empty / non-JSON bodies */
  }

  if (forceFail) {
    return new Response(
      JSON.stringify({ error: "mock BC failure (forced)", idempotency_key: idem }, null, 2),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }

  const docNo = `MOCK-ASM-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  return new Response(
    JSON.stringify({ Document_No: docNo, idempotency_key: idem, echo: body }, null, 2),
    { status: 200, headers: { "content-type": "application/json" } },
  );
});
