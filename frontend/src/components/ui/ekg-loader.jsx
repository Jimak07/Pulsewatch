import * as React from "react";
import { Activity, ShieldCheck, Heart } from "lucide-react";
import { cn } from "../../lib/utils";

export function EkgLoadingScreen({
  title = "PULSEWATCH",
  subtitle = "SYNCHRONIZING INFRASTRUCTURE TELEMETRY",
  bpm = 72,
  className,
}) {
  const [pulseCount, setPulseCount] = React.useState(bpm);

  React.useEffect(() => {
    const interval = setInterval(() => {
      setPulseCount((prev) => {
        const jitter = Math.floor(Math.random() * 3) - 1;
        return Math.max(68, Math.min(78, prev + jitter));
      });
    }, 1800);
    return () => clearInterval(interval);
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading PulseWatch infrastructure telemetry"
      className={cn(
        "fixed inset-0 z-50 flex flex-col items-center justify-center bg-white text-neutral-900 transition-colors duration-300 dark:bg-black dark:text-neutral-50 font-sans select-none overflow-hidden",
        className
      )}
    >
      <div
        className="absolute inset-0 opacity-[0.03] dark:opacity-[0.05] pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />

      <div className="absolute top-8 left-8 flex items-center gap-3 text-xs font-mono uppercase tracking-widest text-neutral-400 dark:text-neutral-600">
        <Activity className="h-4 w-4 animate-pulse text-emerald-500" />
        <span>NODE: V-GATEWAY-01</span>
        <span>•</span>
        <span>SYS: ACTIVE</span>
      </div>

      <div className="absolute top-8 right-8 flex items-center gap-2 text-xs font-mono text-neutral-400 dark:text-neutral-600">
        <Heart className="h-4 w-4 fill-rose-500 text-rose-500 animate-heartbeat" />
        <span className="font-bold text-neutral-800 dark:text-neutral-200">{pulseCount}</span>
        <span>BPM</span>
      </div>

      <div className="relative w-full max-w-2xl px-6 flex flex-col items-center">
        <div className="relative w-full h-32 md:h-40 flex items-center justify-center mb-6 overflow-hidden">
          <svg
            className="w-full h-full drop-shadow-[0_0_12px_rgba(16,185,129,0.25)] dark:drop-shadow-[0_0_18px_rgba(16,185,129,0.35)]"
            viewBox="0 0 800 160"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M 0 80 L 120 80 L 140 80 L 155 68 L 170 80 L 210 80 L 225 94 L 245 15 L 265 145 L 285 80 L 320 80 L 345 60 L 370 80 L 480 80 L 500 80 L 515 68 L 530 80 L 570 80 L 585 94 L 605 15 L 625 145 L 645 80 L 680 80 L 705 60 L 730 80 L 800 80"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-neutral-200 dark:text-neutral-800"
            />

            <path
              d="M 0 80 L 120 80 L 140 80 L 155 68 L 170 80 L 210 80 L 225 94 L 245 15 L 265 145 L 285 80 L 320 80 L 345 60 L 370 80 L 480 80 L 500 80 L 515 68 L 530 80 L 570 80 L 585 94 L 605 15 L 625 145 L 645 80 L 680 80 L 705 60 L 730 80 L 800 80"
              stroke="#10b981"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="animate-ekg-draw"
            />
          </svg>

          <div
            className="absolute inset-y-0 w-24 bg-gradient-to-r from-transparent via-emerald-500/20 to-transparent pointer-events-none animate-ekg-scan"
          />
        </div>

        <div className="flex flex-col items-center text-center space-y-3">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-[0.25em] uppercase text-neutral-950 dark:text-neutral-50 font-mono">
              {title}
            </h1>
          </div>

          <p className="text-xs font-mono tracking-widest text-neutral-400 dark:text-neutral-500 uppercase">
            {subtitle}
          </p>

          <div className="w-48 h-1 bg-neutral-100 dark:bg-neutral-900 rounded-full overflow-hidden mt-4">
            <div className="h-full bg-neutral-900 dark:bg-neutral-100 w-1/3 rounded-full animate-pulseScan" />
          </div>
        </div>
      </div>

      <div className="absolute bottom-8 flex items-center gap-2 text-[11px] font-mono text-neutral-400 dark:text-neutral-600 tracking-wider">
        <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
        <span>HIGH-AVAILABILITY CLUSTER GUARANTEE</span>
      </div>
    </div>
  );
}
