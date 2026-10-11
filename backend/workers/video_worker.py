"""RQ video worker — executes Manim rendering jobs with auto-retry.

Called by the RQ worker process. Writes the Manim script to a temp file,
runs `manim -ql` as a subprocess with a 180-second timeout. On failure,
calls Claude to fix the script and retries once. Updates the VideoJob row
in the database with the mp4_path or error.
"""

import json
import logging
import os
import subprocess
import tempfile
import uuid
from pathlib import Path

import boto3
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

logger = logging.getLogger(__name__)

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://cognexus:secret@localhost:5432/cognexus",
)
SYNC_DATABASE_URL = DATABASE_URL.replace("postgresql+asyncpg://", "postgresql+psycopg2://")

RENDER_TIMEOUT = 300
MEDIA_DIR = Path(__file__).parent.parent / "static" / "videos"

FIX_SYSTEM = """\
You are an expert Manim Community v0.18 debugger. The user will give you a \
Manim script and the error it produced. Fix the script so it renders without errors.

Common fixes:
- axes.c2p() returns a numpy array, NOT a Mobject — never pass it to VGroup(), \
SurroundingRectangle(), or any Mobject constructor
- Use Dot(axes.c2p(x, y)) to create a point Mobject at coordinates
- Angle() requires Line objects, not Arrow — use Line(start, end) instead
- MathTex substrings are indexed by TeX groups, not characters
- Always check .get_end() / .get_start() return arrays, not Mobjects

Frame & layout fixes:
- All content must stay within the safe zone: x in [-6.6, 6.6], y in [-3.5, 3.5]
- If elements overlap or go off-screen, use .scale_to_fit_width(13.2) or \
.scale_to_fit_height(7.0) on the offending VGroup
- Titles: .to_edge(UP, buff=0.5); bottom content: .to_edge(DOWN, buff=0.5)
- Axes must have explicit x_length and y_length that fit within the safe zone. \
Y-axis labels must go INSIDE the plot area — never extend past x=-6.6.
- Font sizes: title max 40, body max 32, labels max 28, annotations max 24
- Use .arrange(DOWN, buff=0.3) for vertical stacking, not manual .shift() chains
- Before placing new text near existing text, FadeOut the old content first or use \
.next_to(old_element, DOWN, buff=0.3) — NEVER place two text elements at overlapping \
positions
- Center all content: build VGroup of everything in each step, then .move_to(ORIGIN)
- The script MUST include config.frame_width = 14.2 and config.frame_height = 8
- Keep total animation count under 40 self.play() calls
- NEVER animate grid/matrix cells individually — FadeIn entire VGroup at once
- Avoid nested loops creating 30+ mobjects. Limit grids to 5x5 max
- Fix lambda closures: use `lambda x, i=i: f(x, i)` not `lambda x: f(x, i)`
- Prefer bulk animations: FadeIn(group) instead of LaggedStart on many items
- Total script under 200 lines. Simplify if longer

Return ONLY the fixed Python script. No markdown fences. No explanation."""


def _get_sync_session() -> Session:
    engine = create_engine(SYNC_DATABASE_URL, echo=False)
    return sessionmaker(bind=engine)()


def _invoke_claude_sync(system: str, user: str) -> str:
    """Synchronous Claude call for script repair."""
    client = boto3.client(
        "bedrock-runtime",
        region_name=os.getenv("AWS_REGION", "us-east-1"),
    )
    body = json.dumps({
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": 8192,
        "system": system,
        "messages": [{"role": "user", "content": user}],
    })
    response = client.invoke_model(
        modelId=os.getenv("CLAUDE_MODEL", "us.anthropic.claude-sonnet-4-5-20250929-v1:0"),
        contentType="application/json",
        accept="application/json",
        body=body,
    )
    response_body = json.loads(response["body"].read())
    return response_body["content"][0]["text"]


def _clean_script(raw: str) -> str:
    text = raw.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        lines = lines[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        text = "\n".join(lines)
    return text.strip()


def _try_render(script: str, job_id: str) -> tuple[bool, str, str | None]:
    """Attempt to render a manim script. Returns (success, error_msg, mp4_path)."""
    MEDIA_DIR.mkdir(parents=True, exist_ok=True)

    with tempfile.NamedTemporaryFile(
        suffix=".py", mode="w", delete=False, dir=str(MEDIA_DIR)
    ) as f:
        f.write(script)
        script_path = f.name

    try:
        result = subprocess.run(
            ["manim", "-ql", "--media_dir", str(MEDIA_DIR), script_path, "ConceptScene"],
            capture_output=True,
            text=True,
            timeout=RENDER_TIMEOUT,
            cwd=str(MEDIA_DIR),
        )

        if result.returncode != 0:
            return False, (result.stderr or result.stdout)[:2000], None

        mp4_files = list(MEDIA_DIR.rglob("ConceptScene.mp4"))
        if mp4_files:
            final_path = MEDIA_DIR / f"{job_id}.mp4"
            mp4_files[-1].rename(final_path)
            return True, "", f"/static/videos/{job_id}.mp4"

        return False, "No MP4 output found after rendering", None

    except subprocess.TimeoutExpired:
        return False, f"Manim rendering timed out after {RENDER_TIMEOUT}s", None
    finally:
        try:
            os.unlink(script_path)
        except OSError:
            pass


def render_manim(job_id: str, script: str) -> None:
    """Render a Manim script with one auto-fix retry on failure."""
    from db.models import VideoJob

    session = _get_sync_session()
    try:
        video_job = session.get(VideoJob, uuid.UUID(job_id))
        if video_job is None:
            return

        video_job.status = "rendering"
        session.commit()

        success, error, mp4_path = _try_render(script, job_id)

        if success:
            video_job.mp4_path = mp4_path
            video_job.status = "done"
            session.commit()
            return

        logger.warning("Manim render failed for %s, attempting auto-fix: %s", job_id, error[:200])

        try:
            fix_prompt = (
                f"Script:\n```python\n{script}\n```\n\n"
                f"Error:\n```\n{error[:1500]}\n```\n\n"
                "Fix the script."
            )
            fixed_raw = _invoke_claude_sync(FIX_SYSTEM, fix_prompt)
            fixed_script = _clean_script(fixed_raw)

            if not fixed_script or "class ConceptScene" not in fixed_script:
                raise ValueError("Claude returned invalid fix")

            success2, error2, mp4_path2 = _try_render(fixed_script, job_id)

            if success2:
                video_job.manim_script = fixed_script
                video_job.mp4_path = mp4_path2
                video_job.status = "done"
                session.commit()
                logger.info("Auto-fix succeeded for %s", job_id)
                return

            video_job.status = "failed"
            video_job.error = f"Retry also failed: {error2[:1000]}"
            session.commit()

        except Exception as fix_err:
            video_job.status = "failed"
            video_job.error = f"Original: {error[:800]} | Fix attempt: {str(fix_err)[:200]}"
            session.commit()

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
