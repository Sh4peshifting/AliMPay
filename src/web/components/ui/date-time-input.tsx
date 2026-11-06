import type { InputHTMLAttributes } from "react";
import { Input } from "@/web/components/ui/input";
import { cn } from "@/web/lib/utils";

export function DateTimeInput({ value, className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  const empty = value === "" || value == null;
  return (
    <div className="group relative">
      <Input
        {...props}
        type="datetime-local"
        step="1"
        value={value}
        className={cn(empty && "text-transparent focus:text-foreground [&:not(:focus)::-webkit-datetime-edit]:opacity-0", className)}
      />
      {empty ? <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted group-focus-within:invisible">yyyy/mm/dd --:--:--</span> : null}
    </div>
  );
}
