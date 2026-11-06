import { afterEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase, getSetting, type AppDatabase } from "../src/server/db";
import { createOrder, getActiveOrders, getOrderById, markOrderPaid, recordAndMatchPayment } from "../src/server/orders";
import { configuredDatabase, orderInput } from "./helpers";

let directory = "";
const opened: AppDatabase[] = [];

afterEach(() => {
  for (const database of opened.splice(0)) database.close();
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = "";
});

function seedLegacyLayer(path: string, layer: number) {
  const database = new Database(path);
  database.exec(`
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, is_secret INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);
  `);
  database.query("INSERT INTO schema_migrations(version, applied_at) VALUES (1, ?)").run(new Date().toISOString());
  database.query("INSERT INTO settings(key, value_json, is_secret, updated_at) VALUES ('transfer_link_layer', ?, 0, ?)")
    .run(JSON.stringify(layer), new Date().toISOString());
  database.close();
}

describe("database settings migrations", () => {
  it("maps the old five-layer numbering to the retained three layers once", () => {
    directory = mkdtempSync(join(tmpdir(), "alimpay-db-test-"));
    const cases: Array<readonly [number, number]> = [[5, 1], [4, 2], [3, 3], [2, 3], [1, 3]];
    for (const [legacy, expected] of cases) {
      const path = join(directory, `legacy-${legacy}.sqlite`);
      seedLegacyLayer(path, legacy);
      const database = createDatabase(path);
      expect(getSetting(database, "transfer_link_layer", 0)).toBe(expected);
      expect(database.query("SELECT 1 FROM schema_migrations WHERE version = 2").get()).not.toBeNull();
      database.close();

      const reopened = createDatabase(path);
      opened.push(reopened);
      expect(getSetting(reopened, "transfer_link_layer", 0)).toBe(expected);
    }
  });

  it("uses the verified HTTPS layer for new databases", () => {
    directory = mkdtempSync(join(tmpdir(), "alimpay-db-test-"));
    const database = createDatabase(join(directory, "fresh.sqlite"));
    opened.push(database);
    expect(getSetting(database, "transfer_link_layer", 0)).toBe(2);
  });

  it("migrates the old order CHECK constraint without losing orders or child records", () => {
    directory = mkdtempSync(join(tmpdir(), "alimpay-db-test-"));
    const path = join(directory, "orders-v2.sqlite");
    const { database: source } = configuredDatabase();
    const paid = createOrder(source, orderInput(1)).order;
    const pending = createOrder(source, orderInput(2)).order;
    recordAndMatchPayment(source, {
      accountLogId: "MIGRATION-LOG", occurredAt: new Date().toISOString(), direction: "收入", amountCents: paid.payable_amount_cents,
      alipayOrderNo: "MIGRATION-ALI", transMemo: "", otherAccount: "buyer", raw: {},
    }, getActiveOrders(source));
    writeFileSync(path, source.serialize());
    source.close();
    const legacy = new Database(path);
    const { sql } = legacy.query("SELECT sql FROM sqlite_master WHERE name = 'orders'").get() as { sql: string };
    legacy.exec(sql.replace("CREATE TABLE orders", "CREATE TABLE orders_legacy").replace(", 'manual_paid'", ""));
    legacy.exec("INSERT INTO orders_legacy SELECT * FROM orders; DROP TABLE orders; ALTER TABLE orders_legacy RENAME TO orders; DELETE FROM schema_migrations WHERE version = 3");
    legacy.close();

    const migrated = createDatabase(path);
    expect(getOrderById(migrated, paid.id)?.status).toBe("paid");
    expect(migrated.query("SELECT matched_order_id FROM payment_events").get()).toEqual({ matched_order_id: paid.id });
    expect(migrated.query("SELECT order_id FROM notification_jobs").get()).toEqual({ order_id: paid.id });
    expect(migrated.query("SELECT COUNT(*) AS n FROM amount_reservations").get()).toEqual({ n: 2 });
    expect(migrated.query("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(migrated.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    expect(markOrderPaid(migrated, pending.id, "admin").order.status).toBe("manual_paid");
    migrated.close();

    const reopened = createDatabase(path);
    opened.push(reopened);
    expect(getOrderById(reopened, pending.id)?.status).toBe("manual_paid");
    expect(reopened.query("SELECT COUNT(*) AS n FROM notification_jobs").get()).toEqual({ n: 2 });
  });
});
