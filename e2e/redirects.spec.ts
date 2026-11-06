import { expect, test } from "@playwright/test";
import type { CheckoutData } from "../src/shared/contracts";

test("login replaces a cached unauthorized session and restores the requested page", async ({ page }) => {
  let authenticated = false;
  await page.route("**/admin-api/setup/status", (route) => route.fulfill({ json: { setup_completed: true } }));
  await page.route("**/admin-api/me", (route) => route.fulfill(authenticated
    ? { json: { user: { id: "admin-id", username: "admin" } } }
    : { status: 401, json: { message: "请先登录" } }));
  await page.route("**/admin-api/login", async (route) => {
    authenticated = true;
    await route.fulfill({ json: { ok: true } });
  });
  await page.route("**/admin-api/orders?**", (route) => route.fulfill({ json: { data: [], total: 0, page: 1, limit: 20 } }));
  await page.goto("/orders");
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("密码").fill("Test-password-2026");
  await page.getByRole("button", { name: /^登录/ }).click();
  await expect(page).toHaveURL(/\/orders$/);
  await expect(page.getByRole("heading", { name: "订单", exact: true })).toBeVisible();
});

for (const status of ["paid", "late_paid"] as const) {
  test(`${status} checkout recovers from an API error, shows success and returns to the merchant`, async ({ page }) => {
    let requests = 0;
    const checkout: CheckoutData = {
      trade_no: "REDIRECT-1", out_trade_no: "MERCHANT-1", name: "Redirect test",
      requested_money: "1.00", payable_money: "1.01", collection_mode: "business_qr", status: "pending",
      created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 300_000).toISOString(),
      monitor_until: new Date(Date.now() + 600_000).toISOString(), payment_poll_interval_seconds: 1,
      payment_uri: "", business_qr_url: "", return_url: "https://merchant.example/success", return_target: null,
    };
    await page.route("**/public-api/checkout/redirect-test", async (route) => {
      requests += 1;
      if (requests === 1) return route.fulfill({ status: 503, json: { message: "Temporary failure" } });
      await route.fulfill({ json: requests === 2 ? checkout : {
        ...checkout, status, return_target: "https://merchant.example/success?trade_status=TRADE_SUCCESS&sign=test-signature",
      } });
    });
    await page.route("https://merchant.example/**", (route) => route.fulfill({ body: "Merchant success", contentType: "text/html" }));
    await page.goto("/checkout/redirect-test");
    await expect(page.getByRole("heading", { name: "暂时无法读取订单" })).toBeVisible();
    await expect(page).toHaveURL(/\/checkout\/redirect-test\/success$/, { timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "已收到 ¥1.01" })).toBeVisible();
    await expect(page).toHaveURL(/^https:\/\/merchant\.example\/success\?trade_status=TRADE_SUCCESS&sign=test-signature$/);
  });
}
