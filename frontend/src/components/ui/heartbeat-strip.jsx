import * as React from "react";
import { cn } from "../../lib/utils";

export function HeartbeatStrip({
  history = [],
  totalBars = 40,
  showLabels = true,
  className,
}) {
  const [hoveredIndex, setHoveredIndex] = React.useState(null);

  const points = React.useMemo(() => {
    const raw = Array.isArray(history) ? history : [];
    const recent = raw.slice(-totalBars);
    const missing = Math.max(0, totalBars - recent.length);
    const pad = Array.from({ length: missing }, () => ({
      status: null,
      timestamp: null,
      statusText: "No data",
    }));
    return [...pad, ...recent];
  }, [history, totalBars]);

  const uptimeRate = React.useMemo(() => {
    const valid = points.filter((p) => p.status !== null);
    if (!valid.length) return "100%";
    const upCount = valid.filter((p) => p.status === 1 || p.status === true).length;
    return `${((upCount / valid.length) * 100).toFixed(1)}%`;
  }, [points]);

  return (
    <div className={cn("w-full space-y-1.5", className)}>
      <div className="relative flex items-center gap-[2px] sm:gap-1 h-6">
        {points.map((point, index) => {
          const isUp = point.status === 1 || point.status === true;
          const isDown = point.status === 0 || point.status === false;
          const isHovered = hoveredIndex === index;

          let colorClass = "bg-neutral-200 dark:bg-neutral-800";
          if (isUp) {
            colorClass = "bg-emerald-500 hover:bg-emerald-400 dark:bg-emerald-500";
          } else if (isDown) {
            colorClass = "bg-rose-500 hover:bg-rose-400 dark:bg-rose-500 animate-pulse";
          }

          return (
            <div
              key={index}
              onMouseEnter={() => setHoveredIndex(index)}
              onMouseLeave={() => setHoveredIndex(null)}
              className={cn(
                "group relative flex-1 h-5 rounded-[2px] transition-all cursor-pointer",
                colorClass,
                isHovered && "scale-y-125 z-10 brightness-110"
              )}
            >
              {isHovered && point.timestamp && (
                <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-30 whitespace-nowrap rounded-md border border-neutral-200 bg-white/95 px-2.5 py-1 text-[11px] font-medium text-neutral-900 shadow-xl backdrop-blur-sm dark:border-neutral-800 dark:bg-neutral-950/95 dark:text-neutral-50">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        isUp ? "bg-emerald-500" : isDown ? "bg-rose-500" : "bg-neutral-400"
                      )}
                    />
                    <span>{isUp ? "Operational" : isDown ? "Outage Detected" : "Unmonitored"}</span>
                  </div>
                  <div className="text-[10px] text-neutral-500 dark:text-neutral-400">
                    {point.fullDate || new Date(point.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {showLabels && (
        <div className="flex items-center justify-between text-[10px] font-medium text-neutral-400 dark:text-neutral-500">
          <span>{totalBars} checks ago</span>
          <span className="font-mono text-neutral-600 dark:text-neutral-300">{uptimeRate} uptime</span>
          <span>Now</span>
        </div>
      )}
    </div>
  );
}
