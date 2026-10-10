"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import Spinner from "./Spinner";

type Variant = "primary" | "secondary" | "danger" | "ghost";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
}

const variantClasses: Record<Variant, string> = {
  primary:
    "bg-indigo-600 text-white hover:bg-indigo-500 focus-visible:ring-indigo-500",
  secondary:
    "bg-zinc-800 text-zinc-200 hover:bg-zinc-700 focus-visible:ring-zinc-500",
  danger:
    "bg-red-600 text-white hover:bg-red-500 focus-visible:ring-red-500",
  ghost:
    "bg-transparent text-zinc-300 hover:bg-zinc-800 focus-visible:ring-zinc-500",
};

const sizeClasses: Record<Size, string> = {
  sm: "px-2.5 py-1 text-xs gap-1.5",
  md: "px-4 py-2 text-sm gap-2",
  lg: "px-5 py-2.5 text-base gap-2.5",
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    loading = false,
    disabled,
    iconLeft,
    iconRight,
    children,
    className = "",
    ...rest
  },
  ref,
) {
  const isDisabled = disabled || loading;

  return (
    <button
      ref={ref}
      disabled={isDisabled}
      className={[
        "inline-flex items-center justify-center rounded-lg font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900",
        "disabled:opacity-50 disabled:pointer-events-none",
        variantClasses[variant],
        sizeClasses[size],
        className,
      ].join(" ")}
      {...rest}
    >
      {loading ? (
        <Spinner size={size === "sm" ? 12 : size === "lg" ? 20 : 16} />
      ) : (
        iconLeft
      )}
      {children}
      {!loading && iconRight}
    </button>
  );
});

export default Button;
