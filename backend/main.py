import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

load_dotenv()

app = FastAPI(title="Cognexus", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

static_dir = Path(__file__).parent / "static"
static_dir.mkdir(exist_ok=True)
app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

from routers import canvas, chat, images, ingest, labs, orchestrate, output, video

app.include_router(ingest.router, prefix="/api")
app.include_router(orchestrate.router, prefix="/api")
app.include_router(output.router, prefix="/api")
app.include_router(images.router, prefix="/api")
app.include_router(canvas.router, prefix="/api")
app.include_router(video.router, prefix="/api")
app.include_router(labs.router, prefix="/api")
app.include_router(chat.router, prefix="/api")


@app.get("/api/health")
async def health_check():
    return {"status": "ok"}
