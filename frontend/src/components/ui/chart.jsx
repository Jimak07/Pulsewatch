import * as React from "react";
import { ResponsiveContainer } from "recharts";
import { cn } from "../../lib/utils";

const ChartContainer = React.forwardRef(({ className, children, width = "100%", height = "100%", ...props }, ref) => {
  return (
    <div ref={ref} className={cn("w-full h-full", className)} {...props}>
      <ResponsiveContainer width={width} height={height}>
        {children}
      </ResponsiveContainer>
    </div>
  );
});
ChartContainer.displayName = "ChartContainer";

function ChartTooltipContent({
  active,
  payload,
  label,
  indicator = "dot",
  formatter,
  labelFormatter,
  className,
}) {
  if (!active || !payload || !payload.length) {
    return null;
  }

  const formattedLabel = labelFormatter ? labelFormatter(label, payload) : label;

  return (
    <div
      className={cn(
        "rounded-lg border border-neutral-200 bg-white/95 p-3 text-xs shadow-xl backdrop-blur-sm dark:border-neutral-800 dark:bg-neutral-950/95",
        className
      )}
    >
      {formattedLabel && (
        <div className="mb-2 font-medium text-neutral-500 dark:text-neutral-400">
          {formattedLabel}
        </div>
      )}
      <div className="space-y-1.5">
        {payload.map((item, index) => {
          const key = `${item.name || item.dataKey || "item"}-${index}`;
          const color = item.color || item.stroke || item.fill || "#22c55e";
          const formatted = formatter
            ? formatter(item.value, item.name, item, index, payload)
            : [item.value, item.name || "Value"];

          const valueDisplay = Array.isArray(formatted) ? formatted[0] : formatted;
          const nameDisplay = Array.isArray(formatted) ? formatted[1] : item.name;

          return (
            <div key={key} className="flex items-center justify-between gap-4 font-mono">
              <div className="flex items-center gap-1.5">
                {indicator === "dot" && (
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                )}
                {indicator === "line" && (
                  <span
                    className="h-0.5 w-3 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                )}
                <span className="font-sans text-neutral-600 dark:text-neutral-400">
                  {nameDisplay}
                </span>
              </div>
              <span className="font-semibold text-neutral-950 dark:text-neutral-50">
                {valueDisplay}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export { ChartContainer, ChartTooltipContent };
