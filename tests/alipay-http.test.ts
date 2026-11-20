import { createSign, createVerify } from "node:crypto";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "bun:test";
import { PaymentScanner } from "../src/server/alipay";
import { setSetting } from "../src/server/db";
import { createOrder, getOrderById } from "../src/server/orders";
import { generateRsaKeyPair } from "../src/server/security";
import { configuredDatabase, orderInput } from "./helpers";

const encodings = ["identity", "gzip", "br"] as const;

function createUpstream(encoding: typeof encodings[number], validSignature = true) {
  const { database, alipay: application } = configuredDatabase();
  const upstream = generateRsaKeyPair();
  setSetting(database, "alipay_public_key", upstream.publicKey);
  const order = createOrder(database, { ...orderInput(), money: "20.00" }).order;
  const body = JSON.stringify({
    page_no: 1, page_size: 2000, total_size: 1,
    detail_list: [{
      account_log_id: "gzip-regression-payment",
      trans_dt: new Date().toISOString(),
      direction: "收入",
      trans_amount: "20.01",
      alipay_order_no: "ALIPAY-GZIP-REGRESSION",
      trans_memo: "账务明细".repeat(300),
    }],
  });
  const timestamp = String(Date.now());
  const nonce = "upstream-response-nonce";
  const signature = createSign("RSA-SHA256")
    .update(`${timestamp}\n${nonce}\n${validSignature ? body : "tampered"}\n`)
    .sign(upstream.privateKey, "base64");
  const wireBody = encoding === "gzip" ? gzipSync(body) : encoding === "br" ? brotliCompressSync(body) : Buffer.from(body);
  const requests: Array<{ path: string; query: URLSearchParams; signatureVerified: boolean }> = [];
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    fetch(request) {
      const url = new URL(request.url);
      const authorization = request.headers.get("authorization") ?? "";
      const [auth, requestSignature = ""] = authorization.replace(/^ALIPAY-SHA256withRSA /, "").split(",sign=");
      requests.push({
        path: url.pathname,
        query: url.searchParams,
        signatureVerified: createVerify("RSA-SHA256")
          .update(`${auth}\nGET\n${url.pathname}${url.search}\n\n`)
          .verify(application.publicKey, requestSignature, "base64"),
      });
      return new Response(wireBody, {
        headers: {
          "content-type": "application/json; charset=utf-8",
          ...(encoding === "identity" ? {} : { "content-encoding": encoding }),
          "alipay-timestamp": timestamp,
          "alipay-nonce": nonce,
          "alipay-signature": signature,
          "alipay-trace-id": "upstream-compression-test",
        },
      });
    },
  });
  setSetting(database, "alipay_endpoint", `http://127.0.0.1:${server.port}`);
  return { database, order, requests, wireBody, close() { server.stop(true); database.close(); } };
}

describe("Alipay HTTP response compression", () => {
  it.each([...encodings])("scans and matches a signed %s response using the real SDK", async (encoding) => {
    const fixture = createUpstream(encoding);
    const { database, order, requests } = fixture;
    try {
      const result = await new PaymentScanner(database).scanNow();
      expect(result).toMatchObject({ status: "success", pages: 1, records: 1, matched: 1, traceId: "upstream-compression-test" });
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({ path: "/v3/alipay/data/bill/accountlog/query", signatureVerified: true });
      expect(requests[0]!.query.get("page_size")).toBe("2000");
      expect(requests[0]!.query.get("start_time")).toBeTruthy();
      expect(requests[0]!.query.get("end_time")).toBeTruthy();
      expect(getOrderById(database, order.id)).toMatchObject({
        status: "paid", alipay_account_log_id: "gzip-regression-payment", alipay_order_no: "ALIPAY-GZIP-REGRESSION",
      });
      expect(database.query("SELECT status, records, matched FROM scan_runs").get())
        .toEqual({ status: "success", records: 1, matched: 1 });
      expect(database.query("SELECT amount_cents, matched_order_id FROM payment_events").get())
        .toEqual({ amount_cents: 2001, matched_order_id: order.id });
      expect(database.query("SELECT status, attempts FROM notification_jobs WHERE order_id = ?").get(order.id))
        .toEqual({ status: "pending", attempts: 0 });
      if (encoding === "gzip") expect(fixture.wireBody.subarray(0, 2).toString("hex")).toBe("1f8b");
    } finally { fixture.close(); }
  });

  it.each([...encodings])("rejects an invalid signature on a %s response without confirming payment", async (encoding) => {
    const fixture = createUpstream(encoding, false);
    try {
      await expect(new PaymentScanner(fixture.database).scanNow())
        .rejects.toMatchObject({ code: "response-signature-verify-error" });
      expect(getOrderById(fixture.database, fixture.order.id)?.status).toBe("pending");
      expect(fixture.database.query("SELECT status, matched FROM scan_runs").get()).toEqual({ status: "error", matched: 0 });
      expect(fixture.database.query("SELECT count(*) AS n FROM payment_events").get()).toEqual({ n: 0 });
      expect(fixture.database.query("SELECT count(*) AS n FROM notification_jobs").get()).toEqual({ n: 0 });
    } finally { fixture.close(); }
  });
});
