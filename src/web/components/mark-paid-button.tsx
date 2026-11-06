import { CheckCircle2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import { isPaidStatus, type OrderRecord } from "@/shared/contracts";
import { apiFetch } from "@/web/api";
import { Button } from "@/web/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/web/components/ui/dialog";
import { formatMoney } from "@/web/lib/utils";

export function MarkPaidButton({ order }: { order: OrderRecord }) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const { mutate } = useSWRConfig();
  if (isPaidStatus(order.status)) return null;

  async function confirm() {
    setSubmitting(true);
    try {
      const result = await apiFetch<{ changed: boolean }>(`/admin-api/orders/${encodeURIComponent(order.id)}/mark-paid`, { method: "POST" });
      setOpen(false);
      toast.success(result.changed ? "已补单，支付通知已加入队列" : "订单已支付，无需重复补单");
      await mutate((key) => typeof key === "string" && (key.startsWith("/admin-api/orders") || key === "/admin-api/dashboard"));
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "补单失败，请重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!submitting) setOpen(value); }}>
      <DialogTrigger asChild><Button variant="outline" size="sm"><CheckCircle2 />补单</Button></DialogTrigger>
      <DialogContent>
        <DialogTitle>确认补单</DialogTitle>
        <DialogDescription>确认已收到款项后，将订单标记为“补单”并通知商户。</DialogDescription>
        <dl className="my-5 space-y-3 text-sm"><div><dt className="text-muted">商户订单号</dt><dd className="mt-1 break-all font-mono">{order.out_trade_no}</dd></div><div><dt className="text-muted">应收金额</dt><dd className="mt-1 font-mono text-lg">{formatMoney(order.payable_amount_cents)}</dd></div></dl>
        <div className="flex justify-end gap-2"><Button variant="ghost" disabled={submitting} onClick={() => setOpen(false)}>取消</Button><Button disabled={submitting} onClick={() => void confirm()}>{submitting ? "正在补单…" : "确认已收款"}</Button></div>
      </DialogContent>
    </Dialog>
  );
}
