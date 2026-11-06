import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createSession } from "../src/server/auth";
import type { AppDatabase } from "../src/server/db";
import { createApp } from "../src/server/index";
import { createOrder, listOrders } from "../src/server/orders";
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
afterEach(() => database.close());

describe("admin order time filters", () => {
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
    for (const query of [
      { start_time: "invalid" }, { start_time: "2026-02-30T00:00:00Z" }, { start_time: "2026-11-06T00:00:00" },
      { start_time: "2026-11-07T00:00:00Z", end_time: "2026-11-06T00:00:00Z" },
    ]) {
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
