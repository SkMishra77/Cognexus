"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle, XCircle, Info, X } from "lucide-react";

/* ---------- types ---------- */

type ToastVariant = "success" | "error" | "info";

interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  toast: (message: string, variant?: ToastVariant) => void;
}

/* ---------- context ---------- */

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}

/* ---------- provider ---------- */

const AUTO_DISMISS_MS = 4_000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, variant: ToastVariant = "info") => {
      const id = crypto.randomUUID();
      setToasts((prev) => [...prev, { id, message, variant }]);
      setTimeout(() => removeToast(id), AUTO_DISMISS_MS);
    },
    [removeToast],
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </ToastContext.Provider>
  );
}

/* ---------- container ---------- */

const variantStyles: Record<
  ToastVariant,
  { bg: string; icon: typeof CheckCircle }
> = {
  success: { bg: "bg-emerald-900/80 border-emerald-700", icon: CheckCircle },
  error: { bg: "bg-red-900/80 border-red-700", icon: XCircle },
  info: { bg: "bg-zinc-800/90 border-zinc-600", icon: Info },
};

function ToastContainer({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}) {
  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
      <AnimatePresence mode="popLayout">
        {toasts.map((t) => {
          const { bg, icon: Icon } = variantStyles[t.variant];
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className={`pointer-events-auto flex items-center gap-2.5 rounded-lg border px-4 py-3 text-sm text-zinc-100 shadow-lg backdrop-blur-sm ${bg}`}
            >
              <Icon size={16} className="shrink-0" />
              <span className="flex-1">{t.message}</span>
              <button
                onClick={() => onDismiss(t.id)}
                className="shrink-0 text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                <X size={14} />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
