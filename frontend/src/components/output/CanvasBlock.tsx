"use client";

import { useState, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Shapes, ChevronDown, ChevronRight, X } from "lucide-react";
import type { GeneratedCanvas } from "@/lib/types";
import Button from "@/components/ui/Button";

interface ExcalidrawElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  text?: string;
  fontSize?: number;
  strokeColor?: string;
  backgroundColor?: string;
  strokeWidth?: number;
  opacity?: number;
  points?: [number, number][];
  startBinding?: { elementId: string };
  endBinding?: { elementId: string };
}

interface Props {
  canvas: GeneratedCanvas;
  /** Render the diagram only; the parent supplies frame and caption. */
  frameless?: boolean;
}

function computeViewBox(elements: ExcalidrawElement[]): string {
  if (elements.length === 0) return "0 0 800 600";
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const el of elements) {
    const x = el.x ?? 0;
    const y = el.y ?? 0;
    const w = el.width ?? 100;
    const h = el.height ?? 40;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
    if (el.points) {
      for (const [px, py] of el.points) {
        minX = Math.min(minX, x + px);
        minY = Math.min(minY, y + py);
        maxX = Math.max(maxX, x + px);
        maxY = Math.max(maxY, y + py);
      }
    }
  }
  const pad = 40;
  return `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`;
}

function isColorDark(hex: string): boolean {
  const c = hex.replace("#", "");
  if (c.length < 6) return false;
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance < 0.4;
}

function findContainingShapeBg(
  el: ExcalidrawElement,
  allElements: ExcalidrawElement[],
): string | null {
  const tx = el.x;
  const ty = el.y;
  for (const shape of allElements) {
    if (shape.type !== "rectangle" && shape.type !== "ellipse" && shape.type !== "diamond") continue;
    const bg = shape.backgroundColor;
    if (!bg || bg === "transparent" || bg === "none") continue;
    const sx = shape.x;
    const sy = shape.y;
    const sw = shape.width ?? 100;
    const sh = shape.height ?? 60;
    if (tx >= sx && tx <= sx + sw && ty >= sy && ty <= sy + sh) {
      return bg;
    }
  }
  return null;
}

function renderElement(el: ExcalidrawElement, allElements: ExcalidrawElement[], markerId: string): React.ReactNode {
  const rawStroke = el.strokeColor || "#f4f4f5";
  const stroke = isColorDark(rawStroke) ? "#f4f4f5" : rawStroke;
  const fill = el.backgroundColor && el.backgroundColor !== "transparent" ? el.backgroundColor : "none";
  const sw = el.strokeWidth ?? 1;
  const op = (el.opacity ?? 100) / 100;

  switch (el.type) {
    case "rectangle":
      return (
        <rect
          key={el.id}
          x={el.x}
          y={el.y}
          width={el.width ?? 100}
          height={el.height ?? 60}
          rx={6}
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
          opacity={op}
        />
      );
    case "ellipse":
      return (
        <ellipse
          key={el.id}
          cx={el.x + (el.width ?? 100) / 2}
          cy={el.y + (el.height ?? 60) / 2}
          rx={(el.width ?? 100) / 2}
          ry={(el.height ?? 60) / 2}
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
          opacity={op}
        />
      );
    case "diamond": {
      const w = el.width ?? 100;
      const h = el.height ?? 60;
      const cx = el.x + w / 2;
      const cy = el.y + h / 2;
      const pts = `${cx},${el.y} ${el.x + w},${cy} ${cx},${el.y + h} ${el.x},${cy}`;
      return (
        <polygon
          key={el.id}
          points={pts}
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
          opacity={op}
        />
      );
    }
    case "text": {
      const lines = (el.text ?? "").split("\n");
      const fs = el.fontSize ?? 14;
      const containingBg = findContainingShapeBg(el, allElements);
      const textFill = containingBg && !isColorDark(containingBg) ? "#18181b" : stroke;
      return (
        <text
          key={el.id}
          x={el.x}
          y={el.y + fs}
          fontSize={fs}
          fill={textFill}
          opacity={op}
          fontFamily="system-ui, sans-serif"
        >
          {lines.map((line, i) => (
            <tspan key={i} x={el.x} dy={i === 0 ? 0 : fs * 1.2}>
              {line}
            </tspan>
          ))}
        </text>
      );
    }
    case "arrow":
    case "line": {
      if (el.points && el.points.length >= 2) {
        const pts = el.points.map(([px, py]) => `${el.x + px},${el.y + py}`).join(" ");
        return (
          <polyline
            key={el.id}
            points={pts}
            fill="none"
            stroke={stroke}
            strokeWidth={Math.max(sw, 1.5)}
            opacity={op}
            markerEnd={el.type === "arrow" ? `url(#${markerId})` : undefined}
          />
        );
      }
      return null;
    }
    default:
      return null;
  }
}

export default function CanvasBlock({ canvas, frameless = false }: Props) {
  const conceptLabel = canvas.caption || (canvas.mode === "overview" ? "Paper Overview" : `Section ${canvas.section_index + 1}`);
  const [showData, setShowData] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  useEffect(() => {
    if (!lightboxOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightboxOpen(false);
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [lightboxOpen]);

  const elements = useMemo(() => {
    if (!canvas.elements_json) return [];
    const raw = canvas.elements_json;
    if (Array.isArray(raw)) return raw as ExcalidrawElement[];
    return [];
  }, [canvas.elements_json]);

  const viewBox = useMemo(() => computeViewBox(elements), [elements]);
  // Unique marker id so several diagrams on one page don't share arrowheads.
  const markerId = `arrowhead-${canvas.id.slice(0, 8)}`;

  if (elements.length === 0) {
    return (
      <div
        className={
          frameless
            ? "rounded-lg bg-zinc-900/40 p-8 min-h-[120px] flex flex-col items-center justify-center gap-3"
            : "rounded-xl border border-zinc-800 bg-zinc-900/60 p-8 min-h-[120px] flex flex-col items-center justify-center gap-3"
        }
      >
        <Shapes className="w-8 h-8 text-zinc-600" />
        <p className="text-sm text-zinc-500">No diagram data</p>
      </div>
    );
  }

  const svg = (
    <svg
      viewBox={viewBox}
      className="w-full h-auto min-h-[200px] max-h-[520px]"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={conceptLabel}
    >
      <defs>
        <marker
          id={markerId}
          markerWidth="10"
          markerHeight="7"
          refX="10"
          refY="3.5"
          orient="auto"
        >
          <polygon points="0 0, 10 3.5, 0 7" fill="#d4d4d8" />
        </marker>
      </defs>
      {elements.map((el) => renderElement(el, elements, markerId))}
    </svg>
  );

  const lightbox = (
    <AnimatePresence>
      {lightboxOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          onClick={() => setLightboxOpen(false)}
        >
          <button
            className="absolute top-4 right-4 rounded-full bg-zinc-800/80 p-2 text-zinc-300 hover:bg-zinc-700 transition-colors"
            onClick={() => setLightboxOpen(false)}
            aria-label="Close lightbox"
          >
            <X className="w-5 h-5" />
          </button>
          <motion.div
            className="max-w-[90vw] max-h-[90vh] rounded-xl overflow-auto bg-zinc-900 p-6 [&>svg]:w-full [&>svg]:h-auto [&>svg]:max-h-[85vh]"
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={(e) => e.stopPropagation()}
          >
            <svg
              viewBox={viewBox}
              className="w-full h-auto min-h-[400px] max-h-[85vh]"
              xmlns="http://www.w3.org/2000/svg"
              role="img"
              aria-label={conceptLabel}
            >
              <defs>
                <marker
                  id={`${markerId}-lb`}
                  markerWidth="10"
                  markerHeight="7"
                  refX="10"
                  refY="3.5"
                  orient="auto"
                >
                  <polygon points="0 0, 10 3.5, 0 7" fill="#d4d4d8" />
                </marker>
              </defs>
              {elements.map((el) => renderElement(el, elements, `${markerId}-lb`))}
            </svg>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  if (frameless) {
    return (
      <>
        <div
          className="rounded-lg bg-zinc-900/40 p-3 overflow-x-auto cursor-zoom-in"
          onClick={() => setLightboxOpen(true)}
        >
          {svg}
        </div>
        {lightbox}
      </>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden"
    >
      <div
        className="relative bg-zinc-900 p-4 overflow-x-auto cursor-zoom-in"
        onClick={() => setLightboxOpen(true)}
      >
        {svg}
      </div>

      <div className="px-5 py-3 border-t border-zinc-800/60 flex items-center justify-between">
        <span className="text-sm text-zinc-400">{conceptLabel}</span>
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
          Raw Data
        </Button>
      </div>

      {showData && (
        <div className="px-5 pb-4">
          <div className="rounded-lg bg-zinc-950 border border-zinc-800 p-4 max-h-[300px] overflow-auto">
            <pre className="text-xs font-mono text-zinc-400 whitespace-pre-wrap break-all">
              {JSON.stringify(canvas.elements_json, null, 2)}
            </pre>
          </div>
        </div>
      )}
      {lightbox}
    </motion.div>
  );
}
