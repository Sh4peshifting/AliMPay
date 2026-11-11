import { expect, test } from "@playwright/test";

test.use({ locale: "zh-CN" });

test("order time filters use UTC+8, reject reversed ranges and reset all filters", async ({ page }) => {
  await page.route("**/admin-api/me", (route) => route.fulfill({ json: { user: { username: "admin" } } }));
  await page.route("**/admin-api/orders?**", (route) => {
    const filters = new URL(route.request().url()).searchParams;
    const filtered = filters.has("start_time");
    const searched = filters.get("q") === "会员订阅";
    return route.fulfill({ json: { data: [], total: 0, page: 1, limit: 20, paid_summary: {
      paid_count: searched ? 1 : filtered ? 3 : 5, paid_amount_cents: searched ? 201 : filtered ? 502 : 1005, requested_amount_cents: searched ? 200 : filtered ? 500 : 1000,
    } } });
  });
  await page.goto("/orders");
  const summary = page.getByLabel("时段支付汇总");
  await expect(summary.getByText("5 笔", { exact: true })).toBeVisible();
  const startInput = page.getByLabel("起始时间（UTC+8）");
  await startInput.focus();
  await expect(startInput).toHaveAttribute("type", "text");
  await expect(startInput).toHaveAttribute("placeholder", "yyyy/mm/dd --:--:--");
  // Stub the OS-owned popup while checking that opening it preserves the input.
  await page.evaluate(() => { HTMLInputElement.prototype.showPicker = function () {}; });
  await page.getByRole("button", { name: "选择起始时间" }).click();
  await expect(startInput).toHaveValue("");
  await expect(startInput).toHaveAttribute("placeholder", "yyyy/mm/dd --:--:--");
  await page.locator('input[type="datetime-local"]').first().fill("2026-11-06T08:09:10");
  await expect(startInput).toHaveValue("2026/11/06 08:09:10");
  await page.getByRole("button", { name: "选择起始时间" }).click();
  await expect(startInput).toHaveValue("2026/11/06 08:09:10");
  await page.getByLabel("起始时间（UTC+8）").fill("2026-11-06T00:00");
  await page.getByLabel("结束时间（UTC+8）").fill("2026-11-06T23:59:59");
  const applied = page.waitForRequest((request) => request.url().includes("/admin-api/orders?") && new URL(request.url()).searchParams.has("start_time"));
  await page.getByRole("button", { name: "筛选", exact: true }).click();
  const params = new URL((await applied).url()).searchParams;
  expect(params.get("start_time")).toBe("2026-11-05T16:00:00.000Z");
  expect(params.get("end_time")).toBe("2026-11-06T15:59:59.000Z");
  await expect(summary.getByText("3 笔", { exact: true })).toBeVisible();
  await expect(summary.getByText(/[¥￥]5\.02/)).toBeVisible();
  await page.getByLabel("搜索订单").fill("  会员订阅  ");
  const searched = page.waitForRequest((request) => request.url().includes("/admin-api/orders?") && new URL(request.url()).searchParams.get("q") === "会员订阅");
  await page.getByRole("button", { name: "筛选", exact: true }).click();
  const searchedParams = new URL((await searched).url()).searchParams;
  expect(searchedParams.get("start_time")).toBe(params.get("start_time"));
  expect(searchedParams.get("end_time")).toBe(params.get("end_time"));
  await expect(summary.getByText("1 笔", { exact: true })).toBeVisible();
  await expect(summary.getByText(/[¥￥]2\.01/)).toBeVisible();
  await page.getByLabel("搜索订单").fill("");
  await page.getByRole("button", { name: "筛选", exact: true }).click();
  await expect(summary.getByText("3 笔", { exact: true })).toBeVisible();
  await page.getByLabel("起始时间（UTC+8）").fill("2026-11-07T00:00");
  await page.getByRole("button", { name: "筛选", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("起始时间不能晚于结束时间");
  await page.getByRole("button", { name: "重置", exact: true }).click();
  await expect(page.getByLabel("起始时间（UTC+8）")).toHaveValue("");
  await expect(page.getByLabel("结束时间（UTC+8）")).toHaveValue("");
  await expect(summary.getByText("5 笔", { exact: true })).toBeVisible();
});
