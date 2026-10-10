"use client";

import { motion } from "framer-motion";

type ColorVariant = "primary" | "success" | "warning" | "danger";

const colorMap: Record<ColorVariant, string> = {
  primary: "bg-indigo-500",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-red-500",
};

interface ProgressBarProps {
  /** Current value (used with `total` for determinate mode) */
  current?: number;
  /** Total value (used with `current` for determinate mode) */
  total?: number;
  /** When true, shows a sliding indeterminate animation */
  indeterminate?: boolean;
  /** Color variant */
  variant?: ColorVariant;
  /** Optional label showing percentage text */
  showLabel?: boolean;
}

export default function ProgressBar({
  current = 0,
  total = 0,
  indeterminate = false,
  variant = "primary",
  showLabel = false,
}: ProgressBarProps) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  const barColor = colorMap[variant];

  return (
    <div className="w-full">
      <div className="w-full rounded-full bg-zinc-800 h-2 overflow-hidden relative">
        {indeterminate ? (
          <motion.div
            className={`absolute h-full rounded-full ${barColor}`}
            initial={{ left: "-30%", width: "30%" }}
            animate={{ left: "100%" }}
            transition={{
              duration: 1.5,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          />
        ) : (
          <div
            className={`h-full rounded-full ${barColor} transition-all duration-300 ease-out`}
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
      {showLabel && !indeterminate && (
        <p className="text-xs text-zinc-400 mt-1 text-right">{pct}%</p>
      )}
    </div>
  );
}
