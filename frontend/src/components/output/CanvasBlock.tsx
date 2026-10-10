"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Shapes, ChevronDown, ChevronRight } from "lucide-react";
import type { GeneratedCanvas } from "@/lib/types";
import Button from "@/components/ui/Button";

interface Props {
  canvas: GeneratedCanvas;
}

export default function CanvasBlock({ canvas }: Props) {
  const conceptLabel = canvas.mode ?? `Section ${canvas.section_index + 1}`;
  const [showData, setShowData] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden"
    >
      {/* Styled placeholder card */}
      <div className="relative bg-zinc-950 p-8 min-h-[220px] flex flex-col items-center justify-center gap-4 overflow-hidden">
        {/* Subtle gradient background pattern */}
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-950/30 via-transparent to-violet-950/20" />
        <div className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)",
            backgroundSize: "24px 24px",
          }}
        />

        <div className="relative z-10 flex flex-col items-center gap-3">
          <div className="rounded-2xl bg-indigo-500/10 border border-indigo-500/20 p-4">
            <Shapes className="w-10 h-10 text-indigo-400" />
          </div>

          <h3 className="text-lg font-semibold text-zinc-100 text-center">
            {conceptLabel}
          </h3>

          <p className="text-sm text-zinc-400 text-center max-w-xs">
            Interactive diagram generated
          </p>
        </div>
      </div>

      {/* Collapsible JSON data */}
      <div className="px-5 py-4 border-t border-zinc-800/60">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowData((v) => !v)}
          iconLeft={
            showData ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )
          }
        >
          View Canvas Data
        </Button>

        {showData && (
          <div className="mt-3 rounded-lg bg-zinc-950 border border-zinc-800 p-4 max-h-[300px] overflow-auto">
            <pre className="text-xs font-mono text-zinc-400 whitespace-pre-wrap break-all">
              {canvas.elements_json
                ? JSON.stringify(canvas.elements_json, null, 2)
                : "No elements data yet"}
            </pre>
          </div>
        )}
      </div>
    </motion.div>
  );
}
