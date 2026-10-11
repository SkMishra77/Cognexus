"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { MessageCircle, Send, X, Trash2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

import type {
  ResponseType,
  GeneratedImage,
  GeneratedCanvas,
  VideoJob,
} from "@/lib/types";
import { subscribeToChat } from "@/lib/sse";
import ImageBlock from "@/components/output/ImageBlock";
import CanvasBlock from "@/components/output/CanvasBlock";
import VideoBlock from "@/components/output/VideoBlock";
import Spinner from "@/components/ui/Spinner";
import Button from "@/components/ui/Button";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ChatAsset {
  type: "image" | "canvas" | "video";
  data: GeneratedImage | GeneratedCanvas | VideoJob;
}

interface ChatEntry {
  id: string;
  role: "user" | "assistant";
  text: string;
  assets: ChatAsset[];
  streaming: boolean;
  createdAt: number;
  /** Section the question was scoped to, if any. */
  context?: string;
}

/** A question pushed in from outside the panel (e.g. the section rail). */
export interface ChatRequest {
  id: number;
  text: string;
  sectionTitle?: string;
}

interface Props {
  paperId: string;
  sessionId: string;
  /** Controlled open state. When omitted the panel manages itself. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Hide the floating launcher (the page supplies its own trigger). */
  hideTrigger?: boolean;
  /** Send this question as soon as it changes identity. */
  request?: ChatRequest | null;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const RESPONSE_TYPES: ResponseType[] = ["text", "image", "canvas", "video"];

const LABELS: Record<ResponseType, string> = {
  text: "Text",
  image: "Image",
  canvas: "Canvas",
  video: "Video",
};

const SUGGESTED_QUESTIONS = [
  "Summarize the key findings",
  "Explain the methodology",
  "What are the limitations?",
  "How does this relate to prior work?",
];

const LS_KEY = "cognexus_chat_response_types";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function loadSavedTypes(): ResponseType[] {
  if (typeof window === "undefined") return ["text"];
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ResponseType[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {
    /* ignore */
  }
  return ["text"];
}

function relativeTime(ts: number): string {
  const diff = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diff < 10) return "just now";
  if (diff < 60) return `${diff}s ago`;
  const mins = Math.floor(diff / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/* ------------------------------------------------------------------ */
/*  Drawer animation variants                                          */
/* ------------------------------------------------------------------ */

const backdropVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
};

const drawerVariants = {
  hidden: { x: "100%" },
  visible: { x: 0 },
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function ChatPanel({
  paperId,
  sessionId,
  open: openProp,
  onOpenChange,
  hideTrigger = false,
  request = null,
}: Props) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = useCallback(
    (v: boolean) => {
      setOpenState(v);
      onOpenChange?.(v);
    },
    [onOpenChange],
  );
  const [selectedTypes, setSelectedTypes] = useState<ResponseType[]>(loadSavedTypes);
  const [messages, setMessages] = useState<ChatEntry[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const cleanupRef = useRef<(() => void) | null>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);

  /* persist response-type selection */
  useEffect(() => {
    localStorage.setItem(LS_KEY, JSON.stringify(selectedTypes));
  }, [selectedTypes]);

  /* auto-scroll on new messages */
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  /* cleanup SSE on unmount */
  useEffect(() => {
    return () => {
      cleanupRef.current?.();
    };
  }, []);

  /* re-render relative timestamps every 30s */
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const toggleType = useCallback((type: ResponseType) => {
    setSelectedTypes((prev) => {
      if (prev.includes(type)) {
        const next = prev.filter((t) => t !== type);
        return next.length === 0 ? prev : next;
      }
      return [...prev, type];
    });
  }, []);

  const clearChat = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    setMessages([]);
    setSending(false);
  }, []);

  const send = useCallback((text: string, context?: string) => {
    if (!text || sending) return;

    const now = Date.now();

    const userEntry: ChatEntry = {
      id: `user-${now}`,
      role: "user",
      text,
      assets: [],
      streaming: false,
      createdAt: now,
      context,
    };

    // The API has no section parameter; scope the question in the prompt.
    const outbound = context ? `Regarding the section "${context}": ${text}` : text;

    const assistantId = `assistant-${now}`;
    const assistantEntry: ChatEntry = {
      id: assistantId,
      role: "assistant",
      text: "",
      assets: [],
      streaming: true,
      createdAt: now,
    };

    setMessages((prev) => [...prev, userEntry, assistantEntry]);
    setInput("");
    setSending(true);

    cleanupRef.current = subscribeToChat(
      paperId,
      sessionId,
      outbound,
      selectedTypes,
      {
        onTextDelta: (delta) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, text: m.text + delta } : m
            )
          );
        },
        onImage: (image) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, assets: [...m.assets, { type: "image", data: image }] }
                : m
            )
          );
        },
        onCanvas: (canvas) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, assets: [...m.assets, { type: "canvas", data: canvas }] }
                : m
            )
          );
        },
        onVideoQueued: (job) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, assets: [...m.assets, { type: "video", data: job }] }
                : m
            )
          );
        },
        onVideoDone: (job) => {
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== assistantId) return m;
              return {
                ...m,
                assets: m.assets.map((a) =>
                  a.type === "video" && (a.data as VideoJob).id === job.id
                    ? { ...a, data: job }
                    : a
                ),
              };
            })
          );
        },
        onDone: () => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, streaming: false } : m
            )
          );
          setSending(false);
        },
        onError: () => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, streaming: false, text: m.text || "An error occurred." }
                : m
            )
          );
          setSending(false);
        },
      }
    );
  }, [sending, paperId, sessionId, selectedTypes]);

  const handleSend = useCallback(() => {
    send(input.trim());
  }, [input, send]);

  /* External requests (from the section rail) */
  const lastRequestId = useRef<number | null>(null);
  useEffect(() => {
    if (!request || request.id === lastRequestId.current) return;
    lastRequestId.current = request.id;
    setOpen(true);
    send(request.text.trim(), request.sectionTitle);
  }, [request, send, setOpen]);

  const unreadCount = useMemo(
    () => messages.filter((m) => m.role === "assistant" && m.text).length,
    [messages]
  );

  return (
    <>
      {/* Floating trigger button */}
      {!hideTrigger && (
        <motion.button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-50 flex items-center justify-center w-14 h-14
                     rounded-full bg-indigo-600 text-white shadow-lg shadow-indigo-900/40
                     hover:bg-indigo-500 transition-colors"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          aria-label="Open chat"
          style={{ display: open ? "none" : "flex" }}
        >
          <MessageCircle size={24} />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 flex items-center justify-center w-5 h-5 rounded-full bg-red-500 text-[10px] font-bold">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </motion.button>
      )}

      {/* Drawer overlay */}
      <AnimatePresence>
        {open && (
          <>
            {/* Backdrop */}
            <motion.div
              key="chat-backdrop"
              className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
              variants={backdropVariants}
              initial="hidden"
              animate="visible"
              exit="hidden"
              transition={{ duration: 0.2 }}
              onClick={() => setOpen(false)}
            />

            {/* Drawer panel */}
            <motion.div
              key="chat-drawer"
              className="fixed inset-y-0 right-0 z-50 w-full max-w-md flex flex-col
                         bg-zinc-900 border-l border-zinc-800 shadow-2xl"
              variants={drawerVariants}
              initial="hidden"
              animate="visible"
              exit="hidden"
              transition={{ type: "spring", damping: 28, stiffness: 300 }}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
                <div>
                  <h2 className="text-lg font-bold text-zinc-100">Ask a Question</h2>
                  <div className="flex gap-1.5 mt-2">
                    {RESPONSE_TYPES.map((type) => (
                      <button
                        key={type}
                        onClick={() => toggleType(type)}
                        className={`rounded-full px-3 py-1 text-xs font-medium transition-colors
                          ${
                            selectedTypes.includes(type)
                              ? "bg-indigo-600 text-white"
                              : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300"
                          }`}
                      >
                        {LABELS[type]}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {messages.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={clearChat}
                      iconLeft={<Trash2 size={14} />}
                      aria-label="Clear chat"
                    >
                      Clear
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setOpen(false)}
                    iconLeft={<X size={16} />}
                    aria-label="Close chat"
                  />
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                {messages.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-full gap-6 py-12">
                    <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-zinc-800 text-zinc-500">
                      <MessageCircle size={28} />
                    </div>
                    <p className="text-sm text-zinc-500 text-center">
                      Ask anything about the paper…
                    </p>
                    <div className="flex flex-wrap justify-center gap-2 max-w-xs">
                      {SUGGESTED_QUESTIONS.map((q) => (
                        <button
                          key={q}
                          onClick={() => setInput(q)}
                          className="rounded-full border border-zinc-700 bg-zinc-800/60 px-3 py-1.5 text-xs text-zinc-300
                                     hover:bg-zinc-700 hover:text-zinc-100 transition-colors"
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {messages.map((msg) => (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2 }}
                    className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-xl px-4 py-3 space-y-3
                        ${
                          msg.role === "user"
                            ? "bg-indigo-600 text-white"
                            : "bg-zinc-800 text-zinc-200"
                        }`}
                    >
                      {/* Section scope */}
                      {msg.context && (
                        <p className="text-[11px] text-indigo-200/70 -mb-1 truncate">
                          About: {msg.context}
                        </p>
                      )}

                      {/* Text content */}
                      {msg.text && msg.role === "user" && (
                        <div className="text-sm leading-relaxed whitespace-pre-wrap">
                          {msg.text}
                        </div>
                      )}

                      {msg.text && msg.role === "assistant" && (
                        <div className="text-sm leading-relaxed prose prose-invert prose-sm max-w-none
                                        prose-p:my-1.5 prose-pre:bg-zinc-900 prose-pre:rounded-lg
                                        prose-code:text-indigo-300 prose-a:text-indigo-400">
                          <ReactMarkdown
                            remarkPlugins={[remarkMath]}
                            rehypePlugins={[rehypeKatex]}
                          >
                            {msg.text}
                          </ReactMarkdown>
                          {msg.streaming && (
                            <span className="inline-block w-1.5 h-4 bg-indigo-400 rounded-sm ml-0.5 animate-pulse" />
                          )}
                        </div>
                      )}

                      {!msg.text && msg.streaming && (
                        <div className="flex items-center gap-2">
                          <Spinner size={14} />
                          <span className="text-xs text-zinc-400">Thinking…</span>
                        </div>
                      )}

                      {/* Inline assets */}
                      {msg.assets.map((asset, idx) => (
                        <div key={idx} className="mt-2">
                          {asset.type === "image" && (
                            <ImageBlock image={asset.data as GeneratedImage} />
                          )}
                          {asset.type === "canvas" && (
                            <CanvasBlock canvas={asset.data as GeneratedCanvas} />
                          )}
                          {asset.type === "video" && (
                            <VideoBlock video={asset.data as VideoJob} />
                          )}
                        </div>
                      ))}

                      {/* Timestamp */}
                      <p className={`text-[10px] mt-1 ${
                        msg.role === "user" ? "text-indigo-300/60" : "text-zinc-500"
                      }`}>
                        {relativeTime(msg.createdAt)}
                      </p>
                    </div>
                  </motion.div>
                ))}
                <div ref={threadEndRef} />
              </div>

              {/* Input */}
              <div className="px-5 py-4 border-t border-zinc-800 flex gap-3">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
                  placeholder="Ask a question about this paper…"
                  disabled={sending}
                  className="flex-1 rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-sm text-zinc-100
                             placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500
                             disabled:opacity-50"
                />
                <Button
                  onClick={handleSend}
                  disabled={sending || !input.trim()}
                  loading={sending}
                  iconLeft={!sending ? <Send size={16} /> : undefined}
                  aria-label="Send message"
                >
                  Send
                </Button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
