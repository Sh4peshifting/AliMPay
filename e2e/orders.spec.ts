import { expect, test } from "@playwright/test";

test("order time filters use UTC+8, reject reversed ranges and reset all filters", async ({ page }) => {
  await page.route("**/admin-api/me", (route) => route.fulfill({ json: { user: { username: "admin" } } }));
  await page.route("**/admin-api/orders?**", (route) => {
    const filtered = new URL(route.request().url()).searchParams.has("start_time");
    return route.fulfill({ json: { data: [], total: 0, page: 1, limit: 20, paid_summary: {
      paid_count: filtered ? 3 : 5, paid_amount_cents: filtered ? 502 : 1005, requested_amount_cents: filtered ? 500 : 1000,
    } } });
  });
  await page.goto("/orders");
  const summary = page.getByLabel("时段支付汇总");
  await expect(summary.getByText("5 笔", { exact: true })).toBeVisible();
  await page.getByLabel("起始时间（UTC+8）").fill("2026-11-06T00:00");
  await page.getByLabel("结束时间（UTC+8）").fill("2026-11-06T23:59:59");
  const applied = page.waitForRequest((request) => request.url().includes("/admin-api/orders?") && new URL(request.url()).searchParams.has("start_time"));
  await page.getByRole("button", { name: "筛选", exact: true }).click();
  const params = new URL((await applied).url()).searchParams;
  expect(params.get("start_time")).toBe("2026-11-05T16:00:00.000Z");
  expect(params.get("end_time")).toBe("2026-11-06T15:59:59.000Z");
  await expect(summary.getByText("3 笔", { exact: true })).toBeVisible();
  await expect(summary.getByText(/[¥￥]5\.02/)).toBeVisible();
  await page.getByLabel("起始时间（UTC+8）").fill("2026-11-07T00:00");
  await page.getByRole("button", { name: "筛选", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("起始时间不能晚于结束时间");
  await page.getByRole("button", { name: "重置", exact: true }).click();
  await expect(page.getByLabel("起始时间（UTC+8）")).toHaveValue("");
  await expect(page.getByLabel("结束时间（UTC+8）")).toHaveValue("");
  await expect(summary.getByText("5 笔", { exact: true })).toBeVisible();
});
