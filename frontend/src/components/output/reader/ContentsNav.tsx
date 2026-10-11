"use client";

import { useEffect, useRef } from "react";
import { FlaskConical, Globe, Images } from "lucide-react";
import type { TitledSection } from "@/lib/reader";

interface Props {
  sections: TitledSection[];
  activeId: string | null;
  /** Section ids the reader has scrolled past. */
  readIds: Set<string>;
  figureCounts: Map<string, number>;
  hasLabs: boolean;
  hasSources: boolean;
  hasExtraFigures: boolean;
  /** Called with the section id (or null for appendix links) after a jump. */
  onNavigate?: (sectionId: string | null) => void;
}

/**
 * Jump to an element and keep correcting for a few frames. Sections use
 * `content-visibility: auto`, so their height is estimated until they are
 * laid out; a single scrollIntoView can land a screen or two off.
 */
export function scrollToId(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const offset = 72; // sticky top bar
  let frames = 0;
  const step = () => {
    const top = el.getBoundingClientRect().top - offset;
    if (Math.abs(top) > 2) window.scrollBy({ top, behavior: "auto" });
    if (++frames < 8) requestAnimationFrame(step);
  };
  step();
}

/**
 * Table of contents. Sticky on desktop, embedded in a sheet on mobile.
 * Keeps the active entry in view as the reader scrolls.
 */
export default function ContentsNav({
  sections,
  activeId,
  readIds,
  figureCounts,
  hasLabs,
  hasSources,
  hasExtraFigures,
  onNavigate,
}: Props) {
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    if (!activeId || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-nav-id="${activeId}"]`);
    if (!el) return;
    const list = listRef.current.parentElement;
    if (!list) return;
    const r = el.getBoundingClientRect();
    const lr = list.getBoundingClientRect();
    if (r.top < lr.top + 40 || r.bottom > lr.bottom - 40) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [activeId]);

  const go = (id: string, sectionId: string | null = null) => {
    scrollToId(id);
    onNavigate?.(sectionId);
  };

  const done = sections.filter((s) => readIds.has(s.section.id)).length;

  return (
    <nav aria-label="Contents" className="font-sans text-[13.5px]">
      <div className="flex items-baseline justify-between px-2 mb-3">
        <span className="text-ink font-medium">Contents</span>
        <span className="text-ink-faint tabular-nums text-xs">
          {done}/{sections.length} read
        </span>
      </div>

      <ol ref={listRef} className="space-y-px">
        {sections.map((s) => {
          const id = s.section.id;
          const active = activeId === id;
          const read = readIds.has(id) && !active;
          const figs = figureCounts.get(id) ?? 0;
          return (
            <li key={id} data-nav-id={id}>
              <button
                onClick={() => go(`section-${id}`, id)}
                aria-current={active ? "location" : undefined}
                className={`group w-full text-left flex items-start gap-2.5 rounded-md px-2 py-1.5 transition-colors
                  ${active ? "bg-zinc-800/70 text-ink" : read ? "text-ink-faint hover:text-ink-muted hover:bg-zinc-900" : "text-ink-muted hover:text-ink hover:bg-zinc-900"}`}
              >
                <span
                  className={`mt-[3px] w-5 shrink-0 text-right tabular-nums text-[11px] leading-4
                    ${active ? "text-accent" : "text-ink-faint"}`}
                >
                  {s.number}
                </span>
                <span className="min-w-0 flex-1 leading-[1.35]">
                  <span className="block truncate">{s.title}</span>
                  {figs > 0 && (
                    <span className="block text-[11px] text-ink-faint leading-4">
                      {figs} figure{figs === 1 ? "" : "s"}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {(hasLabs || hasSources || hasExtraFigures) && (
        <div className="mt-5 pt-4 border-t border-rule space-y-px">
          <span className="block px-2 mb-2 text-ink font-medium">Appendix</span>
          {hasExtraFigures && (
            <NavLink icon={Images} label="Additional figures" onClick={() => go("appendix-figures")} />
          )}
          {hasLabs && (
            <NavLink icon={FlaskConical} label="Lab notebooks" onClick={() => go("appendix-labs")} />
          )}
          {hasSources && (
            <NavLink icon={Globe} label="Sources" onClick={() => go("appendix-sources")} />
          )}
        </div>
      )}
    </nav>
  );
}

function NavLink({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Globe;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left flex items-center gap-2.5 rounded-md px-2 py-1.5 text-ink-muted hover:text-ink hover:bg-zinc-900 transition-colors"
    >
      <Icon className="w-3.5 h-3.5 text-ink-faint shrink-0" aria-hidden />
      <span className="truncate">{label}</span>
    </button>
  );
}
