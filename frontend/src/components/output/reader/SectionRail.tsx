"use client";

import { useState, useCallback, useMemo, type FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import {
  Image as ImageIcon,
  Shapes,
  Film,
  FlaskConical,
  ExternalLink,
  ChevronDown,
  Download,
  Send,
  Loader2,
} from "lucide-react";
import type { TitledSection, PlacedMedia } from "@/lib/reader";
import { groupSources } from "@/lib/reader";
import { scrollToId } from "./ContentsNav";
import type { GeneratedLab, WebSearchResult } from "@/lib/types";

export type MediaRequestType = "image" | "canvas" | "video";

interface Props {
  prepared: TitledSection;
  media: PlacedMedia[];
  labs: GeneratedLab[];
  sources: WebSearchResult[];
  /** Concepts with a generation currently in flight (concept → type). */
  pending: Record<string, MediaRequestType>;
  onRequestMedia: (concept: string, type: MediaRequestType, sectionIndex: number) => void;
  onDownloadLab: (lab: GeneratedLab) => void;
  downloadingLabId: string | null;
  onAsk: (question: string, sectionTitle: string) => void;
  /** Compact = rendered inline under a section on narrow screens. */
  compact?: boolean;
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/* ── Collapsible group ─────────────────────────────────────────── */

function Group({
  title,
  count,
  defaultOpen = true,
  children,
}: {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-t border-rule pt-3">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between text-left text-ink font-medium text-[13px] py-0.5"
      >
        <span>
          {title}
          {typeof count === "number" && (
            <span className="ml-1.5 text-ink-faint tabular-nums font-normal">{count}</span>
          )}
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-ink-faint transition-transform ${open ? "" : "-rotate-90"}`}
          aria-hidden
        />
      </button>
      {open && <div className="mt-2.5">{children}</div>}
    </section>
  );
}

/* ── Rail ──────────────────────────────────────────────────────── */

/**
 * Margin notes for the active section: what it teaches, its equations,
 * figures, labs and sources, plus a way to ask about it.
 */
export default function SectionRail({
  prepared,
  media,
  labs,
  sources,
  pending,
  onRequestMedia,
  onDownloadLab,
  downloadingLabId,
  onAsk,
  compact = false,
}: Props) {
  const { section, title, number } = prepared;
  const [openConcept, setOpenConcept] = useState<string | null>(null);
  const [question, setQuestion] = useState("");

  const concepts = section.key_concepts ?? [];
  const equations = useMemo(
    () => Object.entries(section.equations ?? {}),
    [section.equations],
  );
  const sourceGroups = useMemo(() => groupSources(sources), [sources]);

  const submitQuestion = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const q = question.trim();
      if (!q) return;
      onAsk(q, title);
      setQuestion("");
    },
    [question, title, onAsk],
  );

  return (
    <aside
      aria-label={`Resources for section ${number}`}
      className={`font-sans text-[13px] text-ink-muted ${compact ? "rounded-lg border border-rule p-4" : ""}`}
    >
      {compact ? (
        <p className="text-ink font-medium mb-3">In this section</p>
      ) : (
        <p className="text-xs mb-3 truncate">
          <span className="text-ink-faint tabular-nums">Section {number}</span>{" "}
          <span className="text-ink-muted">{title}</span>
        </p>
      )}

      <div className="space-y-3">
        {/* Ask */}
        <form onSubmit={submitQuestion} className="relative">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask about this section…"
            aria-label={`Ask a question about section ${number}`}
            className="w-full rounded-md bg-zinc-900 border border-rule-strong pl-3 pr-9 py-2 text-[13px] text-ink
                       placeholder:text-ink-faint focus:outline-none focus:border-accent"
          />
          <button
            type="submit"
            disabled={!question.trim()}
            aria-label="Send question"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded text-ink-faint hover:text-ink disabled:opacity-40 transition-colors"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </form>

        {/* Key concepts */}
        {concepts.length > 0 && (
          <Group title="Key concepts" count={concepts.length}>
            <ul className="flex flex-wrap gap-1.5">
              {concepts.map((c) => {
                const open = openConcept === c;
                const busy = pending[c];
                return (
                  <li key={c} className="relative">
                    <button
                      onClick={() => setOpenConcept(open ? null : c)}
                      aria-expanded={open}
                      className={`rounded-md border px-2 py-1 text-[12.5px] leading-tight transition-colors
                        ${open ? "border-accent/60 bg-accent/10 text-ink" : "border-rule-strong text-ink-muted hover:text-ink hover:border-zinc-500"}`}
                    >
                      {busy ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Loader2 className="w-3 h-3 animate-spin" aria-hidden />
                          {c}
                        </span>
                      ) : (
                        c
                      )}
                    </button>
                    {open && (
                      <div
                        role="menu"
                        className="absolute left-0 top-full mt-1 z-20 flex rounded-md border border-rule-strong bg-zinc-900 shadow-xl p-1 gap-0.5"
                      >
                        {(
                          [
                            ["image", ImageIcon, "Illustrate"],
                            ["canvas", Shapes, "Diagram"],
                            ["video", Film, "Animate"],
                          ] as const
                        ).map(([type, Icon, label]) => (
                          <button
                            key={type}
                            role="menuitem"
                            disabled={!!busy}
                            onClick={() => {
                              onRequestMedia(c, type, section.section_index);
                              setOpenConcept(null);
                            }}
                            className="inline-flex items-center gap-1.5 rounded px-2 py-1.5 text-[12px] text-ink-muted hover:bg-zinc-800 hover:text-ink disabled:opacity-40 whitespace-nowrap"
                          >
                            <Icon className="w-3.5 h-3.5" aria-hidden />
                            {label}
                          </button>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </Group>
        )}

        {/* Equations */}
        {equations.length > 0 && (
          <Group title="Equations" count={equations.length} defaultOpen={!compact}>
            <ul className="space-y-3">
              {equations.map(([name, eq]) => {
                const latex = typeof eq === "string" ? eq : eq?.latex ?? null;
                const plain = typeof eq === "object" && eq ? eq.plain_english : null;
                const named = !/^\d+$/.test(name);
                return (
                  <li key={name}>
                    {named && <p className="text-[11.5px] text-ink-faint mb-1 truncate">{name}</p>}
                    {latex ? (
                      <div className="overflow-x-auto rounded bg-zinc-900/70 px-2 py-1.5 [&_.katex]:text-[0.95rem] [&_.katex]:text-indigo-200 [&_.katex-display]:my-0">
                        <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                          {`$$${latex}$$`}
                        </ReactMarkdown>
                      </div>
                    ) : null}
                    {plain && <p className="mt-1 text-[12px] leading-snug text-ink-muted">{plain}</p>}
                  </li>
                );
              })}
            </ul>
          </Group>
        )}

        {/* Figures in this section */}
        {media.length > 0 && (
          <Group title="Figures" count={media.length} defaultOpen={!compact}>
            <ul className="space-y-1">
              {media.map((m) => {
                const Icon = m.kind === "image" ? ImageIcon : m.kind === "canvas" ? Shapes : Film;
                return (
                  <li key={m.id}>
                    <button
                      onClick={() => scrollToId(`figure-${m.id}`)}
                      className="w-full text-left flex items-start gap-2 rounded px-1.5 py-1 hover:bg-zinc-900 transition-colors"
                    >
                      <Icon className="w-3.5 h-3.5 mt-[2px] text-ink-faint shrink-0" aria-hidden />
                      <span className="min-w-0">
                        <span className="text-ink tabular-nums">Fig. {m.label}</span>{" "}
                        <span className="text-ink-muted line-clamp-2">
                          {m.caption || m.concept.replace(/[_\-]+/g, " ")}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Group>
        )}

        {/* Labs */}
        {labs.length > 0 && (
          <Group title="Lab notebooks" count={labs.length}>
            <ul className="space-y-1.5">
              {labs.map((lab) => (
                <li key={lab.id}>
                  <button
                    onClick={() => onDownloadLab(lab)}
                    disabled={downloadingLabId === lab.id}
                    className="w-full text-left flex items-start gap-2 rounded-md border border-rule px-2.5 py-2 hover:border-zinc-500 hover:bg-zinc-900 transition-colors disabled:opacity-60"
                  >
                    <FlaskConical className="w-3.5 h-3.5 mt-[2px] text-emerald-400 shrink-0" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block text-ink leading-snug">{lab.title}</span>
                      <span className="block text-[11.5px] text-ink-faint mt-0.5">
                        Jupyter notebook
                      </span>
                    </span>
                    {downloadingLabId === lab.id ? (
                      <Loader2 className="w-3.5 h-3.5 mt-[2px] animate-spin text-ink-faint" />
                    ) : (
                      <Download className="w-3.5 h-3.5 mt-[2px] text-ink-faint" aria-hidden />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </Group>
        )}

        {/* Sources */}
        {sourceGroups.length > 0 && (
          <Group title="Further reading" count={sources.length} defaultOpen={!compact}>
            <ul className="space-y-3">
              {sourceGroups.map(([concept, items]) => (
                <li key={concept}>
                  <p className="text-[11.5px] text-ink-faint mb-1">{concept}</p>
                  <ul className="space-y-1">
                    {items.map((s) => (
                      <li key={s.id}>
                        <a
                          href={s.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="group flex items-start gap-1.5 rounded px-1.5 py-1 hover:bg-zinc-900 transition-colors"
                        >
                          <ExternalLink className="w-3 h-3 mt-[3px] text-ink-faint shrink-0" aria-hidden />
                          <span className="min-w-0">
                            <span className="block text-ink group-hover:text-accent leading-snug line-clamp-2">
                              {s.title}
                            </span>
                            <span className="block text-[11.5px] text-ink-faint truncate">
                              {hostname(s.url)}
                            </span>
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </Group>
        )}
      </div>
    </aside>
  );
}
