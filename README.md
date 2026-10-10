# Cognexus

**AI-powered research paper learning platform** — upload any academic paper and get an interactive, personalized learning experience with simplified explanations, auto-generated diagrams, animations, lab notebooks, and a multi-modal chat assistant.

## Architecture

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16 (App Router) + TypeScript + Tailwind CSS v4 |
| Backend | FastAPI + SQLAlchemy 2 (async) + Pydantic |
| Database | PostgreSQL 16 with pgvector for vector similarity search |
| Queue | Redis + RQ (for Manim video rendering) |
| AI | AWS Bedrock — Claude (text), Nova Canvas (images), Titan Embeddings (RAG) |

```
┌─────────────────────────────────────────────────────────────┐
│  Frontend (Next.js 16 — port 3000)                          │
│  ┌──────────┐  ┌──────────────────┐  ┌──────────────────┐   │
│  │ Upload / │  │ Knowledge Check  │  │ Output Timeline  │   │
│  │ History  │  │ (sequential Y/N) │  │ + Multi-Modal    │   │
│  │ Page     │  │                  │  │   Chat Panel     │   │
│  └──────────┘  └──────────────────┘  └──────────────────┘   │
└───────────────────────────┬─────────────────────────────────┘
                            │ REST + SSE
┌───────────────────────────▼─────────────────────────────────┐
│  Backend (FastAPI — port 8000)                               │
│  Ingest → Chunk → Embed → Orchestrate → Stream Output        │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Agents: Simplification, Image, Canvas, Video, Lab,   │  │
│  │          Chat (all RAG-powered via pgvector)           │  │
│  └────────────────────────────────────────────────────────┘  │
└───────────┬──────────────┬──────────────┬───────────────────┘
            │              │              │
   ┌────────▼───────┐  ┌──▼──┐   ┌───────▼────────┐
   │ PostgreSQL 16  │  │Redis│   │  RQ Worker      │
   │ + pgvector     │  │     │   │  (Manim videos) │
   └────────────────┘  └─────┘   └────────────────┘
```

## Prerequisites

- **Docker** & **Docker Compose** (v2+)
- **AWS Bedrock** credentials with access to:
  - Claude (e.g. `us.anthropic.claude-3-5-sonnet-20241022-v2:0`)
  - Amazon Nova Canvas (`amazon.nova-canvas-v1:0`)
  - Amazon Titan Embeddings (`amazon.titan-embed-text-v2:0`)

## Quick Start

```bash
# 1. Clone the repository
git clone <repo-url> && cd Cognexus

# 2. Copy environment template and fill in your AWS credentials
cp .env.example .env
# Edit .env with your AWS_BEARER_TOKEN_BEDROCK (Bedrock API key) and AWS_REGION
# IAM credentials (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY) are also supported as a fallback

# 3. Start all services
docker-compose up --build
```

- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:8000
- **Health check**: http://localhost:8000/api/health

## Project Structure

```
Cognexus/
├── frontend/                   # Next.js 16 + Tailwind v4
│   └── src/
│       ├── app/
│       │   ├── page.tsx                           # Upload & paper history
│       │   └── paper/[id]/
│       │       ├── knowledge-check/page.tsx       # Sequential concept quiz
│       │       └── output/page.tsx                # Output timeline + chat
│       ├── components/
│       │   ├── output/
│       │   │   ├── SimplifiedSection.tsx           # Markdown + KaTeX + tooltips
│       │   │   ├── ImageBlock.tsx                  # Generated image display
│       │   │   ├── CanvasBlock.tsx                 # Excalidraw embed
│       │   │   ├── VideoBlock.tsx                  # Manim video player
│       │   │   ├── LabsBlock.tsx                   # Jupyter notebooks + ZIP
│       │   │   ├── ChatPanel.tsx                   # Multi-modal chat
│       │   │   └── OutputTimeline.tsx              # Timeline orchestrator
│       │   └── ui/                                # Spinner, ProgressBar
│       └── lib/
│           ├── api.ts                             # REST client
│           ├── sse.ts                             # SSE subscription
│           └── types.ts                           # Shared TypeScript types
├── backend/
│   ├── main.py                                    # FastAPI app + CORS + routers
│   ├── routers/
│   │   ├── ingest.py                              # PDF upload + arXiv fetch + dedup
│   │   ├── orchestrate.py                         # Launch agent pipeline
│   │   ├── output.py                              # SSE stream + snapshot + papers list
│   │   ├── images.py                              # Image regeneration + manual gen
│   │   ├── canvas.py                              # Manual canvas generation
│   │   ├── video.py                               # Video generation + status polling
│   │   ├── labs.py                                # Lab notebook + ZIP download
│   │   └── chat.py                                # Multi-modal chat SSE
│   ├── agents/
│   │   ├── orchestrator.py                        # Two-phase pipeline controller
│   │   ├── simplification_agent.py                # Section simplification + media_plan
│   │   ├── concept_extractor.py                   # Map-reduce concept extraction
│   │   ├── image_agent.py                         # Nova Canvas image generation
│   │   ├── canvas_agent.py                        # Excalidraw JSON generation
│   │   ├── video_agent.py                         # Manim script generation + RQ
│   │   ├── lab_agent.py                           # Jupyter notebook generation
│   │   └── chat_agent.py                          # Multi-modal chat orchestrator
│   ├── services/
│   │   ├── bedrock.py                             # AWS Bedrock client (Claude/Nova/Titan)
│   │   ├── chunker.py                             # Text chunking (~1000 tokens)
│   │   ├── retrieval.py                           # RAG cosine similarity search
│   │   ├── pdf_parser.py                          # PyMuPDF PDF extraction
│   │   ├── arxiv.py                               # arXiv metadata + PDF fetch
│   │   └── zip_builder.py                         # Labs ZIP archive builder
│   ├── workers/
│   │   └── video_worker.py                        # RQ worker for Manim rendering
│   ├── db/
│   │   ├── base.py                                # SQLAlchemy async engine + session
│   │   └── models.py                              # ORM models (12 tables)
│   ├── prompts/                                   # LLM prompt templates
│   └── alembic/                                   # Database migrations
├── docker-compose.yml                             # 5-service orchestration
└── .env.example                                   # Environment variable template
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Health check |
| `POST` | `/api/ingest/pdf` | Upload a PDF file |
| `POST` | `/api/ingest/arxiv` | Fetch paper from arXiv URL |
| `GET` | `/api/ingest/concepts/{paper_id}` | Get/extract concepts for a paper |
| `POST` | `/api/orchestrate/{paper_id}` | Launch agent pipeline |
| `GET` | `/api/output/{paper_id}/stream` | SSE stream of agent outputs |
| `GET` | `/api/output/{paper_id}` | Full output snapshot |
| `GET` | `/api/output/papers` | List all papers |
| `GET` | `/api/output/papers/{paper_id}` | Paper detail |
| `POST` | `/api/images/regenerate` | Regenerate an image |
| `POST` | `/api/images/generate-manual` | Manually generate an image |
| `POST` | `/api/canvas/generate-manual` | Manually generate a canvas |
| `POST` | `/api/video/generate-manual` | Queue a video render |
| `GET` | `/api/video/status/{job_id}` | Poll video job status |
| `GET` | `/api/labs/{paper_id}/download` | Download all labs as ZIP |
| `GET` | `/api/labs/{paper_id}/{lab_id}/download` | Download single notebook |
| `POST` | `/api/chat/{paper_id}` | Multi-modal chat (SSE) |

## Features

- **Paper Ingestion** — upload PDF or paste arXiv URL; automatic text extraction, section splitting, and DOI detection
- **Smart Deduplication** — fingerprints papers by arXiv ID → DOI → SHA-256; reuses cached results for duplicates
- **RAG-Powered Agents** — all agents retrieve relevant context via pgvector cosine similarity instead of naive text truncation
- **Map-Reduce Concept Extraction** — splits paper into segments, extracts concepts in parallel, merges and ranks top 8-20
- **Knowledge Check** — sequential Yes/No quiz on extracted concepts to build a user knowledge profile
- **Two-Phase Orchestration** — Phase 1 runs Simplification + Labs + Overview Canvas in parallel; Phase 2 dispatches media agents based on LLM-generated media plans
- **Simplified Explanations** — section-by-section simplification with KaTeX math rendering and concept tooltips
- **Image Generation** — Amazon Nova Canvas generates educational diagrams per concept
- **Interactive Canvases** — Excalidraw-based diagrams generated by Claude
- **Manim Animations** — Claude writes Manim scripts, rendered as MP4 via background RQ workers
- **Lab Notebooks** — up to 7 Jupyter notebooks with executable Python code, downloadable individually or as ZIP
- **Multi-Modal Chat** — ask questions with selectable response types (Text / Image / Canvas / Video); agents dispatched in parallel
- **Dark Theme** — consistent dark UI across all pages
- **Real-Time Updates** — Server-Sent Events for progressive output reveal as agents complete
