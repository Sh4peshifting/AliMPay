import { CalendarDays } from "lucide-react";
import { useEffect, useRef } from "react";
import { Input } from "@/web/components/ui/input";
import { Button } from "@/web/components/ui/button";
import { formatDateTime, parseDateTime } from "@/web/lib/date-time";
import { cn } from "@/web/lib/utils";

interface DateTimeInputProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  pickerLabel: string;
  className?: string;
}

export function DateTimeInput({ id, value, onChange, pickerLabel, className }: DateTimeInputProps) {
  const input = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.setCustomValidity(value.trim() && !parseDateTime(value) ? "请输入有效时间，格式为 yyyy/mm/dd hh:mm:ss" : "");
  }, [value]);

  return (
    <div className="relative">
      <Input
        ref={input}
        id={id}
        type="text"
        value={value}
        placeholder="yyyy/mm/dd --:--:--"
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
        onBlur={() => { if (parseDateTime(value)) onChange(formatDateTime(value)); }}
        className={cn("pr-10", className)}
      />
      <input
        ref={picker}
        type="datetime-local"
        step="1"
        value={parseDateTime(value) ?? ""}
        onChange={(event) => onChange(formatDateTime(event.target.value))}
        aria-hidden="true"
        tabIndex={-1}
        className="pointer-events-none absolute right-0 top-0 size-9 opacity-0"
      />
      <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0" aria-label={pickerLabel} onClick={() => {
        if (picker.current?.showPicker) picker.current.showPicker();
        else { picker.current?.focus(); picker.current?.click(); }
      }}><CalendarDays /></Button>
    </div>
  );
}
