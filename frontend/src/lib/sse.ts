import { API_BASE } from "./api";
import type {
  SimplifiedSection,
  GeneratedImage,
  GeneratedCanvas,
  VideoJob,
  GeneratedLab,
  WebSearchResult,
} from "./types";

/* ── Generic SSE helper ─────────────────────────────────────────── */

export type SSEHandler = {
  onMessage: (event: string, data: unknown) => void;
  onError?: (error: Event) => void;
  onClose?: () => void;
};

export function subscribeToSSE(path: string, handlers: SSEHandler): () => void {
  const url = `${API_BASE}/api${path}`;
  const eventSource = new EventSource(url);

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handlers.onMessage(event.type, data);
    } catch {
      handlers.onMessage(event.type, event.data);
    }
  };

  eventSource.onerror = (event) => {
    handlers.onError?.(event);
    eventSource.close();
    handlers.onClose?.();
  };

  return () => {
    eventSource.close();
    handlers.onClose?.();
  };
}

/* ── Output stream types ────────────────────────────────────────── */

export interface MediaPlanEvent {
  section_index: number;
  media_plan: Record<string, string[]>;
}

export interface OutputHandlers {
  onSimplification?: (section: SimplifiedSection) => void;
  onImage?: (image: GeneratedImage) => void;
  onCanvas?: (canvas: GeneratedCanvas) => void;
  onVideoQueued?: (job: VideoJob) => void;
  onVideoDone?: (job: VideoJob) => void;
  onLab?: (lab: GeneratedLab) => void;
  onResearch?: (result: WebSearchResult) => void;
  onMediaPlan?: (plan: MediaPlanEvent) => void;
  onComplete?: () => void;
  onError?: (error: Event) => void;
}

/**
 * Subscribe to the output SSE stream for a paper.
 * Returns a cleanup function that closes the EventSource.
 */
export function subscribeToOutput(
  paperId: string,
  handlers: OutputHandlers
): () => void {
  const url = `${API_BASE}/api/output/${paperId}/stream`;
  const es = new EventSource(url);

  const listen = (type: string, cb: ((data: unknown) => void) | undefined) => {
    if (!cb) return;
    es.addEventListener(type, (e: MessageEvent) => {
      try {
        cb(JSON.parse(e.data));
      } catch {
        cb(e.data);
      }
    });
  };

  listen("simplification", handlers.onSimplification as (d: unknown) => void);
  listen("image", handlers.onImage as (d: unknown) => void);
  listen("canvas", handlers.onCanvas as (d: unknown) => void);
  listen("video_queued", handlers.onVideoQueued as (d: unknown) => void);
  listen("video_done", handlers.onVideoDone as (d: unknown) => void);
  listen("lab", handlers.onLab as (d: unknown) => void);
  listen("research", handlers.onResearch as (d: unknown) => void);
  listen("media_plan", handlers.onMediaPlan as (d: unknown) => void);
  listen("complete", handlers.onComplete as (d: unknown) => void);

  es.onerror = (event) => {
    handlers.onError?.(event);
    es.close();
  };

  return () => {
    es.close();
  };
}

/* ── Chat stream types ──────────────────────────────────────────── */

export interface ChatHandlers {
  onTextDelta?: (delta: string) => void;
  onImage?: (image: GeneratedImage) => void;
  onCanvas?: (canvas: GeneratedCanvas) => void;
  onVideoQueued?: (job: VideoJob) => void;
  onVideoDone?: (job: VideoJob) => void;
  onDone?: () => void;
  onError?: (error: Event) => void;
}

/**
 * Subscribe to the chat SSE stream.
 * Sends the user message as a POST and opens the response as a stream.
 * Returns a cleanup / abort function.
 */
export function subscribeToChat(
  paperId: string,
  sessionId: string,
  message: string,
  responseTypes: string[],
  handlers: ChatHandlers
): () => void {
  const controller = new AbortController();

  const run = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/chat/${paperId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          message,
          response_types: responseTypes,
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        handlers.onError?.(new Event("fetch_error"));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            const eventType = line.slice(7).trim();
            const nextIdx = lines.indexOf(line) + 1;
            if (nextIdx < lines.length && lines[nextIdx].startsWith("data: ")) {
              const raw = lines[nextIdx].slice(6);
              try {
                const data = JSON.parse(raw);
                switch (eventType) {
                  case "chat_text_delta":
                    handlers.onTextDelta?.(data.delta ?? data);
                    break;
                  case "chat_image":
                    handlers.onImage?.(data);
                    break;
                  case "chat_canvas":
                    handlers.onCanvas?.(data);
                    break;
                  case "chat_video_queued":
                    handlers.onVideoQueued?.(data);
                    break;
                  case "chat_video_done":
                    handlers.onVideoDone?.(data);
                    break;
                  case "chat_done":
                    handlers.onDone?.();
                    break;
                }
              } catch {
                if (eventType === "chat_text_delta") {
                  handlers.onTextDelta?.(raw);
                }
              }
            }
          } else if (line.startsWith("data: ")) {
            const raw = line.slice(6);
            try {
              const data = JSON.parse(raw);
              if (typeof data === "string") {
                handlers.onTextDelta?.(data);
              } else if (data.delta) {
                handlers.onTextDelta?.(data.delta);
              }
            } catch {
              handlers.onTextDelta?.(raw);
            }
          }
        }
      }
      handlers.onDone?.();
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        handlers.onError?.(new Event("stream_error"));
      }
    }
  };

  run();

  return () => {
    controller.abort();
  };
}
