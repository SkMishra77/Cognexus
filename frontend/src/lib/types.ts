export interface Paper {
  id: string;
  title: string;
  authors: string[];
  abstract: string | null;
  year: number | null;
  source: string | null;
  fingerprint: string;
  doi: string | null;
  created_at: string;
  cached: boolean;
}

export interface PaperSection {
  id: string;
  paper_id: string;
  index: number;
  title: string | null;
  raw_text: string;
}

export interface Concept {
  id: string;
  paper_id: string;
  name: string;
  description: string;
  difficulty: string | null;
  related_concepts: string[] | null;
}

export interface KnowledgeProfile {
  id: string;
  paper_id: string;
  session_id: string;
  ratings_json: Record<string, string>;
}

export interface AgentJob {
  id: string;
  paper_id: string;
  agent_type: string;
  status: "pending" | "running" | "done" | "error";
  error: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface SimplifiedSection {
  id: string;
  paper_id: string;
  section_index: number;
  title: string | null;
  simplified_text: string;
  key_concepts: string[] | null;
  equations: Record<string, string> | null;
  media_plan: Record<string, string[]> | null;
}

export interface GeneratedImage {
  id: string;
  paper_id: string;
  concept: string;
  image_base64: string;
  caption: string | null;
  seed: number | null;
}

export interface GeneratedCanvas {
  id: string;
  paper_id: string;
  section_index: number;
  mode: string | null;
  elements_json: Record<string, unknown> | null;
}

export interface VideoJob {
  id: string;
  paper_id: string;
  concept: string;
  status: "pending" | "running" | "done" | "error";
  mp4_path: string | null;
  manim_script: string | null;
  error: string | null;
  created_at: string;
}

export interface GeneratedLab {
  id: string;
  paper_id: string;
  concept: string;
  title: string;
  notebook_json: Record<string, unknown> | null;
}

export interface ChatMessage {
  id: string;
  paper_id: string;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  response_types: string[] | null;
  chat_assets: Record<string, unknown> | null;
  created_at: string;
}

export interface IngestResponse {
  paper_id: string;
  cached: boolean;
}

export interface WebSearchResult {
  id: string;
  paper_id: string;
  concept: string;
  title: string;
  url: string;
  snippet: string;
  created_at: string;
}

export type ResponseType = "text" | "image" | "canvas" | "video";
