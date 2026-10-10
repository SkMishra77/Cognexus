"use client";

type SizePreset = "xs" | "sm" | "md" | "lg" | "xl";
type ColorVariant = "default" | "primary";

const sizeMap: Record<SizePreset, number> = {
  xs: 14,
  sm: 20,
  md: 24,
  lg: 36,
  xl: 48,
};

const colorMap: Record<ColorVariant, string> = {
  default: "text-zinc-400",
  primary: "text-indigo-500",
};

interface SpinnerProps {
  size?: SizePreset | number;
  color?: ColorVariant;
  label?: string;
}

export default function Spinner({
  size = "md",
  color = "default",
  label,
}: SpinnerProps) {
  const resolvedSize = typeof size === "number" ? size : sizeMap[size];
  const colorClass = colorMap[color];

  const spinner = (
    <svg
      className={`animate-spin ${colorClass}`}
      width={resolvedSize}
      height={resolvedSize}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
      />
    </svg>
  );

  if (label) {
    return (
      <span className="inline-flex items-center gap-2">
        {spinner}
        <span className={`text-sm ${colorClass}`}>{label}</span>
      </span>
    );
  }

  return spinner;
}
