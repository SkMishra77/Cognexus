/** Reusable skeleton shimmer placeholders. Uses the `.skeleton-shimmer` class from globals.css. */

interface SkeletonProps {
  className?: string;
  width?: string | number;
  height?: string | number;
}

export function Skeleton({ className = "", width, height }: SkeletonProps) {
  return (
    <div
      className={`skeleton-shimmer rounded-md ${className}`}
      style={{ width, height }}
      aria-hidden
    />
  );
}

interface SkeletonTextProps {
  lines?: number;
  className?: string;
}

export function SkeletonText({ lines = 3, className = "" }: SkeletonTextProps) {
  return (
    <div className={`flex flex-col gap-2 ${className}`} aria-hidden>
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="skeleton-shimmer rounded h-3.5"
          style={{ width: i === lines - 1 ? "60%" : "100%" }}
        />
      ))}
    </div>
  );
}

interface SkeletonCardProps {
  className?: string;
}

export function SkeletonCard({ className = "" }: SkeletonCardProps) {
  return (
    <div
      className={`rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 ${className}`}
      aria-hidden
    >
      <div className="skeleton-shimmer rounded h-4 w-2/5 mb-4" />
      <div className="flex flex-col gap-2">
        <div className="skeleton-shimmer rounded h-3.5 w-full" />
        <div className="skeleton-shimmer rounded h-3.5 w-full" />
        <div className="skeleton-shimmer rounded h-3.5 w-3/5" />
      </div>
    </div>
  );
}
