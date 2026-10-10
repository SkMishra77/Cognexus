"""RQ video worker — executes Manim rendering jobs.

Called by the RQ worker process. Writes the Manim script to a temp file,
runs `manim -ql` as a subprocess with a 180-second timeout, and updates
the VideoJob row in the database with the mp4_path or error.
"""

import os
import subprocess
import tempfile
import uuid
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://cognexus:secret@localhost:5432/cognexus",
)
# For the synchronous worker, we need a sync connection string
SYNC_DATABASE_URL = DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")

RENDER_TIMEOUT = 180  # seconds
MEDIA_DIR = Path(__file__).parent.parent / "static" / "videos"


def _get_sync_session() -> Session:
    """Create a synchronous DB session for the worker process."""
    engine = create_engine(SYNC_DATABASE_URL, echo=False)
    SessionLocal = sessionmaker(bind=engine)
    return SessionLocal()


def render_manim(job_id: str, script: str) -> None:
    """Render a Manim script and update the VideoJob in the database.

    Args:
        job_id: UUID string of the VideoJob row.
        script: The full Manim Python script to render.
    """
    from db.models import VideoJob

    session = _get_sync_session()
    try:
        video_job = session.get(VideoJob, uuid.UUID(job_id))
        if video_job is None:
            return

        video_job.status = "rendering"
        session.commit()

        MEDIA_DIR.mkdir(parents=True, exist_ok=True)

        # Write script to temp file
        with tempfile.NamedTemporaryFile(
            suffix=".py", mode="w", delete=False, dir=str(MEDIA_DIR)
        ) as f:
            f.write(script)
            script_path = f.name

        try:
            result = subprocess.run(
                [
                    "manim",
                    "-ql",  # low quality for speed
                    "--media_dir",
                    str(MEDIA_DIR),
                    script_path,
                    "ConceptScene",
                ],
                capture_output=True,
                text=True,
                timeout=RENDER_TIMEOUT,
                cwd=str(MEDIA_DIR),
            )

            if result.returncode != 0:
                video_job.status = "failed"
                video_job.error = (result.stderr or result.stdout)[:2000]
                session.commit()
                return

            # Find the rendered MP4
            mp4_files = list(MEDIA_DIR.rglob("ConceptScene.mp4"))
            if mp4_files:
                mp4_path = str(mp4_files[-1])
                # Move to a predictable location
                final_path = MEDIA_DIR / f"{job_id}.mp4"
                mp4_files[-1].rename(final_path)
                video_job.mp4_path = f"/static/videos/{job_id}.mp4"
                video_job.status = "done"
            else:
                video_job.status = "failed"
                video_job.error = "No MP4 output found after rendering"

            session.commit()

        except subprocess.TimeoutExpired:
            video_job.status = "failed"
            video_job.error = f"Manim rendering timed out after {RENDER_TIMEOUT}s"
            session.commit()

        finally:
            # Clean up temp script file
            try:
                os.unlink(script_path)
            except OSError:
                pass

    except Exception as e:
        try:
            if video_job:
                video_job.status = "failed"
                video_job.error = str(e)[:2000]
                session.commit()
        except Exception:
            pass
    finally:
        session.close()
