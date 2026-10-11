/**
 * Reader utilities for the paper output page.
 *
 * Pure functions: section-title cleanup, media → section matching,
 * paragraph-level placement of figures, and concept-based matching for
 * labs and web sources. No React here so it is easy to unit test.
 */

import type {
  SimplifiedSection,
  GeneratedImage,
  GeneratedCanvas,
  VideoJob,
  GeneratedLab,
  WebSearchResult,
} from "./types";

/* ── Normalisation helpers ─────────────────────────────────────── */

const STOP = new Set([
  "the", "a", "an", "of", "and", "or", "in", "on", "for", "to", "with",
  "how", "why", "what", "vs", "versus", "via", "by", "at", "is", "are",
]);

/** Lower-case, replace `_`/`-` with spaces, drop punctuation. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[_\-]+/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokens(s: string): string[] {
  return normalize(s)
    .split(" ")
    .filter((t) => t.length > 2 && !STOP.has(t));
}

/** Fraction of `a`'s tokens that appear in `b` (0..1). */
export function overlap(a: string, b: string): number {
  const ta = tokens(a);
  if (ta.length === 0) return 0;
  const tb = new Set(tokens(b));
  let hit = 0;
  for (const t of ta) if (tb.has(t) || [...tb].some((x) => x.startsWith(t) || t.startsWith(x))) hit++;
  return hit / ta.length;
}

/* ── Section titles ────────────────────────────────────────────── */

const FIRST_HEADING = /^#{1,3}\s+(.+?)\s*$/m;

/** The first markdown heading of the simplified text, if any. */
export function firstHeading(text: string): string | null {
  const m = FIRST_HEADING.exec(text);
  return m ? m[1].trim() : null;
}

/** Strip the "Teaching: …" scaffolding the LLM adds to its own headings. */
export function cleanHeading(h: string): string {
  let t = h.trim();
  t = t.replace(/^teaching\s+(guide|about)?\s*:?\s*(the\s+)?/i, "");
  t = t.replace(/^guide\s*:\s*/i, "");
  t = t.replace(/\s*:\s*a teacher'?s guide$/i, "");
  t = t.replace(/\s+section$/i, "");
  return t.trim();
}

/** Heuristic: does this raw title look like a parser artifact? */
export function isJunkTitle(title: string | null | undefined): boolean {
  if (!title) return true;
  const t = title.trim();
  if (t.length === 0 || t.length > 60) return true;
  if (/[=\[\]]/.test(t)) return true;
  if (/^\d{4}\b/.test(t)) return true;
  if (/layer\s*\d/i.test(t)) return true;
  if (/[.,;]$/.test(t)) return true;
  if (/^[a-z]/.test(t)) return true;
  return false;
}

export interface TitledSection {
  section: SimplifiedSection;
  /** 1-based reading order (not the raw section_index). */
  number: number;
  title: string;
  /** Body text with a redundant leading "Teaching…" heading removed. */
  body: string;
  /** Word count of body text. */
  words: number;
}

/**
 * Produce clean, unique titles and bodies for sections in reading order.
 */
export function prepareSections(sections: SimplifiedSection[]): TitledSection[] {
  const sorted = [...sections].sort((a, b) => a.section_index - b.section_index);
  const seen = new Map<string, number>();

  return sorted.map((section, i) => {
    const raw = (section.title ?? "").trim().replace(/:$/, "");
    const heading = firstHeading(section.simplified_text);
    let title = isJunkTitle(raw) && heading ? cleanHeading(heading) : raw;
    if (!title) title = heading ? cleanHeading(heading) : `Section ${i + 1}`;

    const key = normalize(title);
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    if (n > 1) title = `${title} (${n})`;

    // Drop the first heading if it is LLM scaffolding or repeats the title.
    let body = section.simplified_text;
    if (heading) {
      const h = normalize(cleanHeading(heading));
      if (/^teaching\b/i.test(heading) || h === key || overlap(h, key) >= 0.8) {
        body = body.replace(FIRST_HEADING, "").replace(/^\s+/, "");
      }
    }

    return {
      section,
      number: i + 1,
      title,
      body,
      words: body.split(/\s+/).filter(Boolean).length,
    };
  });
}

/* ── Paragraph blocks ──────────────────────────────────────────── */

export interface Block {
  text: string;
  /** Character offset of the block start in the body string. */
  start: number;
  end: number;
  isHeading: boolean;
  isCode: boolean;
}

/**
 * Split markdown into blocks on blank lines while keeping fenced code and
 * display-math blocks intact.
 */
export function splitBlocks(md: string): Block[] {
  const lines = md.split("\n");
  const blocks: Block[] = [];
  let buf: string[] = [];
  let bufStart = 0;
  let pos = 0;
  let inFence = false;
  let inMath = false;

  const flush = (end: number) => {
    const text = buf.join("\n");
    if (text.trim().length > 0) {
      blocks.push({
        text,
        start: bufStart,
        end,
        isHeading: /^#{1,6}\s/.test(text.trim()),
        isCode: /^```/.test(text.trim()),
      });
    }
    buf = [];
  };

  for (const line of lines) {
    const lineStart = pos;
    pos += line.length + 1;
    const trimmed = line.trim();

    if (buf.length === 0) bufStart = lineStart;

    if (/^```/.test(trimmed)) inFence = !inFence;
    if (/^\$\$/.test(trimmed) && !inFence) {
      // "$$ … $$" on one line toggles twice
      const count = (trimmed.match(/\$\$/g) ?? []).length;
      if (count % 2 === 1) inMath = !inMath;
    }

    if (trimmed === "" && !inFence && !inMath) {
      flush(lineStart);
      continue;
    }
    buf.push(line);
  }
  flush(md.length);
  return blocks;
}

/* ── Media matching ────────────────────────────────────────────── */

export type MediaKind = "image" | "canvas" | "video";

export interface MediaItem {
  kind: MediaKind;
  id: string;
  concept: string;
  caption: string | null;
  hint: string | null;
  image?: GeneratedImage;
  canvas?: GeneratedCanvas;
  video?: VideoJob;
}

export interface PlacedMedia extends MediaItem {
  /** Block index after which the figure is inserted; -1 = end of section. */
  afterBlock: number;
  /** "3.2" style figure label. */
  label: string;
}

interface PlanEntry {
  key: string;
  types: string[];
  caption: string | null;
  hint: string | null;
}

function planEntries(section: SimplifiedSection): PlanEntry[] {
  const plan = section.media_plan ?? {};
  return Object.entries(plan).map(([key, v]) => {
    if (Array.isArray(v)) return { key, types: v, caption: null, hint: null };
    const obj = (v ?? {}) as { types?: string[]; caption?: string; paragraph_hint?: string };
    return {
      key,
      types: obj.types ?? [],
      caption: obj.caption ?? null,
      hint: obj.paragraph_hint ?? null,
    };
  });
}

function findPlan(section: SimplifiedSection, concept: string): PlanEntry | null {
  const c = normalize(concept);
  for (const p of planEntries(section)) {
    if (normalize(p.key) === c) return p;
  }
  return null;
}

/** Score how well a free-text concept belongs to a section (0..1). */
export function sectionAffinity(section: SimplifiedSection, concept: string): number {
  const planKeys = Object.keys(section.media_plan ?? {}).join(" ");
  const concepts = (section.key_concepts ?? []).join(" ");
  const titleScore = overlap(concept, `${section.title ?? ""} ${planKeys} ${concepts}`);
  if (titleScore >= 0.99) return 1;
  const textScore = overlap(concept, section.simplified_text) * 0.6;
  return Math.max(titleScore * 0.9, textScore);
}

export interface Distribution {
  /** section.id → placed media in reading order */
  bySection: Map<string, PlacedMedia[]>;
  /** Media that could not be tied to any section. */
  orphans: MediaItem[];
  /** The paper-level overview canvas, if any. */
  overview: GeneratedCanvas | null;
}

/**
 * Assign every image / canvas / video to a section and a paragraph.
 */
export function distributeMedia(
  prepared: TitledSection[],
  images: GeneratedImage[],
  canvases: GeneratedCanvas[],
  videos: VideoJob[],
): Distribution {
  const bySection = new Map<string, { item: MediaItem; afterBlock: number }[]>();
  const blocksCache = new Map<string, Block[]>();
  const orphans: MediaItem[] = [];
  let overview: GeneratedCanvas | null = null;

  const blocksFor = (p: TitledSection) => {
    let b = blocksCache.get(p.section.id);
    if (!b) {
      b = splitBlocks(p.body);
      blocksCache.set(p.section.id, b);
    }
    return b;
  };

  const push = (p: TitledSection, item: MediaItem, afterBlock: number) => {
    const list = bySection.get(p.section.id) ?? [];
    list.push({ item, afterBlock });
    bySection.set(p.section.id, list);
  };

  /**
   * A paragraph that ends with a colon introduces what follows (an equation,
   * a list, a code block). Never split them: move the anchor to the end of
   * that run.
   */
  const settle = (blocks: Block[], i: number): number => {
    let j = i;
    while (j < blocks.length - 1) {
      const t = blocks[j].text.trimEnd();
      const next = blocks[j + 1];
      const introduces = /[:：]$/.test(t);
      const continues = next.isCode || /^\s*(\$\$|[-*]\s|\d+\.\s|>|\|)/.test(next.text) || /^\s*↳/.test(next.text);
      if (introduces || continues) j++;
      else break;
    }
    return j;
  };

  /** Locate the paragraph the hint or concept refers to. */
  const anchor = (p: TitledSection, item: MediaItem): number => {
    const blocks = blocksFor(p);
    const prose = blocks
      .map((b, i) => ({ b, i }))
      .filter(({ b }) => !b.isHeading && !b.isCode);

    if (item.hint) {
      const h = normalize(item.hint).slice(0, 40);
      const hit = prose.find(({ b }) => normalize(b.text).includes(h));
      if (hit) return settle(blocks, hit.i);
      const h2 = normalize(item.hint).split(" ").slice(0, 5).join(" ");
      const hit2 = prose.find(({ b }) => normalize(b.text).includes(h2));
      if (hit2) return settle(blocks, hit2.i);
    }
    const toks = tokens(item.concept);
    if (toks.length > 0) {
      const hit = prose.find(({ b }) => {
        const nb = normalize(b.text);
        const hits = toks.filter((t) => nb.includes(t)).length;
        return hits >= Math.max(1, Math.ceil(toks.length * 0.6));
      });
      if (hit) return settle(blocks, hit.i);
    }
    return -1;
  };

  const placeByConcept = (item: MediaItem) => {
    // 1. exact media_plan key
    let target = prepared.find((p) => findPlan(p.section, item.concept));
    if (target) {
      const plan = findPlan(target.section, item.concept)!;
      item.hint = plan.hint;
      item.caption = item.caption ?? plan.caption;
      push(target, item, anchor(target, item));
      return;
    }
    // 2. fuzzy affinity
    let best = 0;
    for (const p of prepared) {
      const s = sectionAffinity(p.section, item.concept);
      if (s > best) {
        best = s;
        target = p;
      }
    }
    if (target && best >= 0.5) {
      push(target, item, anchor(target, item));
      return;
    }
    orphans.push(item);
  };

  for (const img of images) {
    placeByConcept({
      kind: "image",
      id: img.id,
      concept: img.concept,
      caption: img.caption,
      hint: null,
      image: img,
    });
  }
  for (const v of videos) {
    placeByConcept({
      kind: "video",
      id: v.id,
      concept: v.concept,
      caption: v.caption,
      hint: null,
      video: v,
    });
  }
  for (const c of canvases) {
    if (c.mode === "overview") {
      overview = c;
      continue;
    }
    const target = prepared.find((p) => p.section.section_index === c.section_index);
    const item: MediaItem = {
      kind: "canvas",
      id: c.id,
      concept: c.caption ?? `Section ${c.section_index}`,
      caption: c.caption,
      hint: null,
      canvas: c,
    };
    if (!target) {
      orphans.push(item);
      continue;
    }
    // Diagram: after the first substantial paragraph, unless its caption
    // clearly points at a later paragraph.
    const blocks = blocksFor(target);
    let after = blocks.findIndex(
      (b) => !b.isHeading && !b.isCode && b.text.split(/\s+/).length >= 40,
    );
    if (c.caption) {
      const byCaption = anchor(target, { ...item, concept: c.caption });
      if (byCaption > after) after = byCaption;
    }
    push(target, item, after >= 0 ? settle(blocks, after) : after);
  }

  // Order within a section by paragraph, then label them.
  const out = new Map<string, PlacedMedia[]>();
  for (const p of prepared) {
    const list = bySection.get(p.section.id) ?? [];
    list.sort((a, b) => {
      const ax = a.afterBlock < 0 ? Number.MAX_SAFE_INTEGER : a.afterBlock;
      const bx = b.afterBlock < 0 ? Number.MAX_SAFE_INTEGER : b.afterBlock;
      return ax - bx;
    });
    out.set(
      p.section.id,
      list.map(({ item, afterBlock }, i) => ({
        ...item,
        afterBlock,
        label: `${p.number}.${i + 1}`,
      })),
    );
  }

  return { bySection: out, orphans, overview };
}

/* ── Labs & sources per section ───────────────────────────────── */

/**
 * Strict match against what the section explicitly teaches (title, key
 * concepts, planned media). Body text is deliberately ignored: an
 * introduction mentions everything and would otherwise claim every lab.
 */
function teachesConcept(section: SimplifiedSection, concept: string): boolean {
  const taught = [
    section.title ?? "",
    ...(section.key_concepts ?? []),
    ...Object.keys(section.media_plan ?? {}),
  ];
  const c = normalize(concept);
  return taught.some((t) => {
    const n = normalize(t);
    if (!n) return false;
    if (n === c || n.includes(c) || c.includes(n)) return true;
    return overlap(concept, t) >= 0.75 && overlap(t, concept) >= 0.5;
  });
}

export function labsForSection(section: SimplifiedSection, labs: GeneratedLab[]): GeneratedLab[] {
  return labs.filter((l) => teachesConcept(section, l.concept));
}

export function sourcesForSection(
  section: SimplifiedSection,
  results: WebSearchResult[],
): WebSearchResult[] {
  return results.filter((r) => !r.concept.startsWith("_") && teachesConcept(section, r.concept));
}

/** Group web results by concept, preserving first-seen order. */
export function groupSources(results: WebSearchResult[]): [string, WebSearchResult[]][] {
  const map = new Map<string, WebSearchResult[]>();
  for (const r of results) {
    const list = map.get(r.concept) ?? [];
    list.push(r);
    map.set(r.concept, list);
  }
  return [...map.entries()];
}

/** Estimated reading time in minutes at 220 wpm, minimum 1. */
export function readingMinutes(words: number): number {
  return Math.max(1, Math.round(words / 220));
}
