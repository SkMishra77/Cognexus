import type {
  Paper,
  Concept,
  SimplifiedSection,
  GeneratedImage,
  GeneratedCanvas,
  GeneratedLab,
  VideoJob,
  ChatMessage,
} from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function apiFetch<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(`${API_BASE}/api${path}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

/* ── Ingest ──────────────────────────────────────────────────────── */

export interface IngestResult {
  paper_id: string;
  title: string;
  authors: string[];
  section_count: number;
  cached: boolean;
}

export async function ingestPdf(file: File): Promise<IngestResult> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE}/api/ingest/pdf`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    throw new Error(`Ingest error ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

export async function ingestArxiv(url: string): Promise<IngestResult> {
  return apiFetch<IngestResult>("/ingest/arxiv", {
    method: "POST",
    body: JSON.stringify({ url }),
  });
}

/* ── Concepts & Knowledge ────────────────────────────────────────── */

export async function getConcepts(
  paperId: string
): Promise<{ concepts: Concept[] }> {
  return apiFetch<{ concepts: Concept[] }>(`/ingest/concepts/${paperId}`);
}

export async function submitKnowledgeProfile(
  paperId: string,
  sessionId: string,
  ratings: Record<string, boolean>
): Promise<void> {
  await apiFetch(`/orchestrate/${paperId}`, {
    method: "POST",
    body: JSON.stringify({ session_id: sessionId, ratings }),
  });
}

/* ── Papers ──────────────────────────────────────────────────────── */

export async function getPapers(): Promise<{ papers: Paper[] }> {
  return apiFetch<{ papers: Paper[] }>("/output/papers");
}

export async function getPaperDetail(paperId: string): Promise<Paper> {
  return apiFetch<Paper>(`/output/papers/${paperId}`);
}

/* ── Output Snapshot ─────────────────────────────────────────────── */

export interface OutputSnapshot {
  paper: Paper;
  sections: SimplifiedSection[];
  images: GeneratedImage[];
  canvases: GeneratedCanvas[];
  videos: VideoJob[];
  labs: GeneratedLab[];
  status: "pending" | "running" | "done" | "error";
}

export interface AgentJob {
  id: string;
  agent_type: string;
  status: string;
  created_at: string | null;
  completed_at: string | null;
  error: string | null;
  metadata: { phase?: number; label?: string; concept?: string } | null;
}

export async function getAgentJobs(
  paperId: string
): Promise<{ agents: AgentJob[] }> {
  return apiFetch<{ agents: AgentJob[] }>(`/output/${paperId}/agents`);
}

export async function getOutputSnapshot(
  paperId: string
): Promise<OutputSnapshot> {
  return apiFetch<OutputSnapshot>(`/output/${paperId}`);
}

/* ── Image Endpoints ─────────────────────────────────────────────── */

export async function regenerateImage(
  paperId: string,
  concept: string,
  seed?: number
): Promise<GeneratedImage> {
  return apiFetch<GeneratedImage>("/images/regenerate", {
    method: "POST",
    body: JSON.stringify({ paper_id: paperId, concept, seed }),
  });
}

export async function generateManualImage(
  paperId: string,
  concept: string,
  context: string
): Promise<GeneratedImage> {
  return apiFetch<GeneratedImage>("/images/generate-manual", {
    method: "POST",
    body: JSON.stringify({ paper_id: paperId, concept, context }),
  });
}

/* ── Canvas Endpoints ────────────────────────────────────────────── */

export async function generateManualCanvas(
  paperId: string,
  sectionIndex: number,
  concept: string
): Promise<GeneratedCanvas> {
  return apiFetch<GeneratedCanvas>("/canvas/generate-manual", {
    method: "POST",
    body: JSON.stringify({ paper_id: paperId, section_index: sectionIndex, concept }),
  });
}

/* ── Video Endpoints ─────────────────────────────────────────────── */

export async function generateManualVideo(
  paperId: string,
  concept: string,
  equation?: string
): Promise<VideoJob> {
  return apiFetch<VideoJob>("/video/generate-manual", {
    method: "POST",
    body: JSON.stringify({ paper_id: paperId, concept, equation }),
  });
}

export async function getVideoStatus(jobId: string): Promise<VideoJob> {
  return apiFetch<VideoJob>(`/video/status/${jobId}`);
}

/* ── Labs Endpoints ──────────────────────────────────────────────── */

export async function downloadLabsZip(paperId: string): Promise<Blob> {
  const res = await fetch(`${API_BASE}/api/labs/${paperId}/download`);
  if (!res.ok) {
    throw new Error(`Download error ${res.status}: ${await res.text()}`);
  }
  return res.blob();
}

export async function downloadLab(
  paperId: string,
  labId: string
): Promise<Blob> {
  const res = await fetch(
    `${API_BASE}/api/labs/${paperId}/${labId}/download`
  );
  if (!res.ok) {
    throw new Error(`Download error ${res.status}: ${await res.text()}`);
  }
  return res.blob();
}

/* ── Chat Endpoints ──────────────────────────────────────────────── */

export async function sendChatMessage(
  paperId: string,
  sessionId: string,
  message: string,
  responseTypes: string[]
): Promise<ChatMessage> {
  return apiFetch<ChatMessage>(`/chat/${paperId}`, {
    method: "POST",
    body: JSON.stringify({
      session_id: sessionId,
      message,
      response_types: responseTypes,
    }),
  });
}

export async function getChatHistory(
  paperId: string,
  sessionId: string
): Promise<{ messages: ChatMessage[] }> {
  return apiFetch<{ messages: ChatMessage[] }>(
    `/chat/${paperId}/history?session_id=${sessionId}`
  );
}

export { API_BASE };
