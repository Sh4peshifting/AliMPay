import { expect, test } from "@playwright/test";
import QRCode from "qrcode";
import type { CheckoutData } from "../src/shared/contracts";

test("old uploaded merchant images open their scan result without re-uploading", async ({ page }) => {
  const content = "https://qr.alipay.com/FKX-LEGACY-MERCHANT?x=1&note=legacy";
  const imagePath = "/uploads/business-qr-0123456789abcdef.png";
  const png = await QRCode.toBuffer(content, { width: 480, margin: 4 });
  const checkout: CheckoutData = {
    trade_no: "LEGACY-QR", out_trade_no: "MERCHANT-QR", name: "Legacy QR test", requested_money: "1.00", payable_money: "1.01",
    collection_mode: "business_qr", status: "pending", created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 300_000).toISOString(), monitor_until: new Date(Date.now() + 600_000).toISOString(),
    payment_poll_interval_seconds: 5, payment_uri: "", business_qr_url: `https://old-domain.example${imagePath}`, return_url: null, return_target: null,
  };
  await page.route("**/public-api/checkout/legacy-qr", (route) => route.fulfill({ json: checkout }));
  await page.route(`**${imagePath}`, (route) => route.fulfill({ body: png, contentType: "image/png" }));
  await page.goto("/checkout/legacy-qr");
  const button = page.getByRole("link", { name: "打开支付宝付款" });
  await expect(button).toBeVisible();
  const uri = new URL((await button.getAttribute("href"))!);
  expect(uri.protocol).toBe("alipays:");
  expect(uri.searchParams.get("saId")).toBe("10000007");
  expect(uri.searchParams.get("qrcode")).toBe(content);
  await expect(page.getByRole("link", { name: "打开支付宝扫一扫" })).toHaveCount(0);
});
