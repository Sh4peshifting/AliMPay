import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createSession } from "../src/server/auth";
import type { AppDatabase } from "../src/server/db";
import { createApp } from "../src/server/index";
import { createOrder, getOrderById, listOrders, markOrderPaid, paidOrderSummary, recordAndMatchPayment } from "../src/server/orders";
import { buildSignedReturnUrl, NotificationWorker, queueManualNotification } from "../src/server/notifications";
import { verifyMd5 } from "../src/server/security";
import { configuredDatabase, orderInput } from "./helpers";

let database: AppDatabase;
let app: ReturnType<typeof createApp>["app"];
let headers: Record<string, string>;

beforeEach(() => {
  ({ database } = configuredDatabase());
  const now = new Date().toISOString();
  const userId = crypto.randomUUID();
  database.query("INSERT INTO admin_users(id, username, password_hash, created_at, updated_at) VALUES (?, 'admin', 'unused', ?, ?)").run(userId, now, now);
  const session = createSession(database, userId, new Headers());
  headers = { cookie: `alimpay_session=${session.token}; alimpay_csrf=${session.csrf}`, "x-csrf-token": session.csrf, origin: "http://localhost" };
  ({ app } = createApp({ database }));
});

describe("manual payment confirmation", () => {
  it("requires authentication and CSRF", async () => {
    const order = createOrder(database, orderInput(1)).order;
    const url = `http://localhost/admin-api/orders/${order.id}/mark-paid`;
    expect((await app.request(url, { method: "POST" })).status).toBe(401);
    expect((await app.request(url, { method: "POST", headers: { cookie: headers.cookie! } })).status).toBe(403);
    expect(getOrderById(database, order.id)?.status).toBe("pending");
  });

  it("confirms expired orders once and records an audit trail without fabricating bank records", async () => {
    const order = createOrder(database, orderInput(1)).order;
    database.query("UPDATE orders SET status = 'expired', monitor_until = ? WHERE id = ?").run(new Date(Date.now() - 1_000).toISOString(), order.id);
    const url = `http://localhost/admin-api/orders/${order.id}/mark-paid`;
    for (const changed of [true, false]) {
      const response = await app.request(url, { method: "POST", headers });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ changed, order: { status: "manual_paid", id: order.id } });
    }
    expect(getOrderById(database, order.id)?.paid_at).toBeTruthy();
    expect(database.query("SELECT COUNT(*) AS n FROM notification_jobs").get()).toEqual({ n: 1 });
    expect(database.query("SELECT COUNT(*) AS n FROM payment_events").get()).toEqual({ n: 0 });
    expect(database.query("SELECT actor, action FROM audit_logs WHERE target_id = ?").all(order.id)).toEqual([{ actor: "admin", action: "order.manual_paid" }]);
    expect(listOrders(database, { externalPaid: true }).total).toBe(1);
    expect(listOrders(database, { externalPaid: false }).total).toBe(0);
    expect((await app.request("http://localhost/admin-api/orders?status=manual_paid", { headers })).status).toBe(200);
  });

  it("preserves already confirmed payments and does not allocate their reserved amount", () => {
    const order = createOrder(database, orderInput(1)).order;
    markOrderPaid(database, order.id, "admin");
    expect(createOrder(database, orderInput(2)).order.payable_amount_cents).toBe(102);
    recordAndMatchPayment(database, {
      accountLogId: "STALE-SCAN", occurredAt: new Date().toISOString(), direction: "收入", amountCents: order.payable_amount_cents,
      alipayOrderNo: "ALI-1", transMemo: "", otherAccount: "", raw: {},
    }, [order]);
    expect(getOrderById(database, order.id)?.status).toBe("manual_paid");
    expect(database.query("SELECT COUNT(*) AS n FROM notification_jobs").get()).toEqual({ n: 1 });
    const existing = createOrder(database, orderInput(3)).order;
    database.query("UPDATE orders SET status = 'late_paid' WHERE id = ?").run(existing.id);
    expect(markOrderPaid(database, existing.id, "admin").order.status).toBe("late_paid");
  });

  it("signs manual payment returns and notifications and allows resends", async () => {
    const { order } = markOrderPaid(database, createOrder(database, orderInput(1)).order.id, "admin");
    const target = new URL(buildSignedReturnUrl(database, order)!);
    expect(target.searchParams.get("trade_status")).toBe("TRADE_SUCCESS");
    expect(verifyMd5(Object.fromEntries(target.searchParams), "1234567890abcdef1234567890abcdef")).toBe(true);
    let callback = "";
    const worker = new NotificationWorker(database, (async (url: string | URL | Request) => {
      callback = String(url);
      return new Response("success");
    }) as typeof fetch);
    await worker.tick();
    expect(new URL(callback).searchParams.get("trade_status")).toBe("TRADE_SUCCESS");
    expect(database.query("SELECT status FROM notification_jobs").get()).toEqual({ status: "succeeded" });
    expect(queueManualNotification(database, order.id)).toBeTruthy();
  });
});
afterEach(() => database.close());

describe("admin order time filters", () => {
  it("sums all three successful states across pages and ignores unpaid and out-of-range orders", async () => {
    const createdAt = "2026-11-06T08:00:00.000Z";
    for (let i = 1; i <= 25; i++) {
      const order = createOrder(database, orderInput(i)).order;
      database.query("UPDATE orders SET status = ?, created_at = ? WHERE id = ?").run(["paid", "late_paid", "manual_paid"][i % 3]!, createdAt, order.id);
    }
    const unpaid = createOrder(database, orderInput(26)).order;
    database.query("UPDATE orders SET status = 'expired', created_at = ? WHERE id = ?").run(createdAt, unpaid.id);
    const outside = createOrder(database, { ...orderInput(27), money: "99.99" }).order;
    database.query("UPDATE orders SET status = 'paid', created_at = '2026-11-07T00:00:00.000Z' WHERE id = ?").run(outside.id);
    const params = new URLSearchParams({ start_time: createdAt, end_time: createdAt, limit: "1", page: "2", status: "pending", q: "no-matching-order" });
    const response = await app.request(`http://localhost/admin-api/orders?${params}`, { headers });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ total: 0, data: [], paid_summary: { paid_count: 25, paid_amount_cents: 2825, requested_amount_cents: 2500 } });
    expect(paidOrderSummary(database, { startTime: "2027-01-01T00:00:00.000Z" })).toEqual({ paid_count: 0, paid_amount_cents: 0, requested_amount_cents: 0 });
  });

  it("includes both endpoints, combines filters and counts beyond the current page", async () => {
    const times = ["2026-11-05T15:59:59.999Z", "2026-11-05T16:00:00.000Z", "2026-11-06T15:59:59.000Z", "2026-11-06T16:00:00.000Z"];
    times.forEach((time, index) => {
      const order = createOrder(database, orderInput(index)).order;
      database.query("UPDATE orders SET created_at = ? WHERE id = ?").run(time, order.id);
    });
    const params = new URLSearchParams({ start_time: "2026-11-06T00:00:00+08:00", end_time: "2026-11-06T23:59:59+08:00", limit: "1", page: "2", q: "Test order", status: "pending" });
    const response = await app.request(`http://localhost/admin-api/orders?${params}`, { headers });
    expect(response.status).toBe(200);
    const body = await response.json() as { total: number; data: Array<{ out_trade_no: string }> };
    expect(body.total).toBe(2);
    expect(body.data.map((order) => order.out_trade_no)).toEqual(["ORDER-1"]);
    expect(listOrders(database, { startTime: times[3] }).total).toBe(1);
    expect(listOrders(database, { endTime: times[0] }).total).toBe(1);
  });

  it("rejects invalid dates, missing timezones and reversed ranges", async () => {
    const queries: Record<string, string>[] = [
      { start_time: "invalid" }, { start_time: "2026-02-30T00:00:00Z" }, { start_time: "2026-11-06T00:00:00" },
      { start_time: "2026-11-07T00:00:00Z", end_time: "2026-11-06T00:00:00Z" },
    ];
    for (const query of queries) {
      const response = await app.request(`http://localhost/admin-api/orders?${new URLSearchParams(query)}`, { headers });
      expect(response.status).toBe(400);
    }
  });

  it("searches literal wildcard characters", () => {
    createOrder(database, { ...orderInput(1), name: "100%_\\literal" });
    createOrder(database, orderInput(2));
    expect(listOrders(database, { query: "%_\\" }).total).toBe(1);
  });
});
