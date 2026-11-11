import { afterEach, describe, expect, it } from "bun:test";
import QRCode from "qrcode";
import { createBusinessQrUri, normalizeBusinessQrContent } from "../src/shared/business-qr";
import { createSession } from "../src/server/auth";
import { getSetting, type AppDatabase } from "../src/server/db";
import { createApp } from "../src/server/index";
import { configuredDatabase } from "./helpers";

let database: AppDatabase | undefined;
afterEach(() => database?.close());

describe("merchant QR payment links", () => {
  it("preserves the scan result and encodes nested parameters exactly once", () => {
    const content = "HTTPS://QR.ALIPAY.COM/FKX-TEST?note=hello%20world&saId=other";
    const normalized = normalizeBusinessQrContent(content);
    expect(normalized).toBe("https://qr.alipay.com/FKX-TEST?note=hello%20world&saId=other");
    const uri = new URL(createBusinessQrUri(content));
    expect(uri.searchParams.get("qrcode")).toBe(normalized);
    expect(uri.searchParams.get("saId")).toBe("10000007");
  });

  it("does not open an empty scanner or an unrelated URL", () => {
    for (const content of ["", "not a URL", "https://qr.alipay.com/", "https://qr.alipay.com.evil.example/FKX", "https://evil.example/qr.alipay.com/FKX", "https://user:password@qr.alipay.com/FKX", "https://qr.alipay.com:8080/FKX", "javascript:alert(1)", "alipays://platformapi/startapp?saId=10000007"]) {
      expect(createBusinessQrUri(content)).toBe("");
    }
  });

  it("saves upload scan results, clears stale results when replacing an image, and validates manual edits", async () => {
    ({ database } = configuredDatabase());
    const now = new Date().toISOString();
    const userId = crypto.randomUUID();
    database.query("INSERT INTO admin_users(id, username, password_hash, created_at, updated_at) VALUES (?, 'admin', 'unused', ?, ?)").run(userId, now, now);
    const session = createSession(database, userId, new Headers());
    const headers = { cookie: `alimpay_session=${session.token}; alimpay_csrf=${session.csrf}`, "x-csrf-token": session.csrf, origin: "http://localhost" };
    const { app } = createApp({ database });
    const content = "https://qr.alipay.com/FKX-UPLOADED";
    const png = new Uint8Array(await QRCode.toBuffer(content));
    const upload = new FormData();
    upload.set("file", new File([png], "qr.png", { type: "image/png" }));
    upload.set("qr_content", content);
    const response = await app.request("http://localhost/admin-api/settings/qr", { method: "POST", headers, body: upload });
    expect(response.status).toBe(200);
    expect(getSetting(database, "business_qr_content", "")).toBe(content);
    upload.delete("qr_content");
    expect((await app.request("http://localhost/admin-api/settings/qr", { method: "POST", headers, body: upload })).status).toBe(200);
    expect(getSetting(database, "business_qr_content", "")).toBe("");
    const update = (business_qr_content: string) => app.request("http://localhost/admin-api/settings", {
      method: "PUT", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ business_qr_content }),
    });
    expect((await update("https://evil.example/merchant")).status).toBe(400);
    expect(getSetting(database, "business_qr_content", "")).toBe("");
    expect((await update(content)).status).toBe(200);
    expect(getSetting(database, "business_qr_content", "")).toBe(content);
  });
});
