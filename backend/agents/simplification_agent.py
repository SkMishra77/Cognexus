"""SimplificationAgent — rewrites paper sections for a given knowledge profile.

Iterates over paper sections, calls Claude for each with the reader's knowledge
profile, parses the JSON block from the response, creates AgentJob rows, and
persists SimplifiedSection rows with media_plan JSONB.
"""

import json
import re
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import AgentJob, Paper, PaperSection, SimplifiedSection
from prompts.simplification import SYSTEM_TEMPLATE, build_knowledge_summary, build_user
from services.bedrock import BedrockClient


def _parse_json_block(text: str) -> dict:
    """Extract the trailing JSON block from the Claude response.

    The JSON block is expected after a ```json fence at the end of the output.
    Falls back to searching for the last {...} block if fences aren't found.
    """
    # Try to find ```json ... ``` block
    pattern = r"```json\s*(\{[\s\S]*?\})\s*```"
    matches = list(re.finditer(pattern, text))
    if matches:
        try:
            return json.loads(matches[-1].group(1))
        except json.JSONDecodeError:
            pass

    # Fallback: find last top-level { ... }
    brace_depth = 0
    start = -1
    last_block = None
    for i, ch in enumerate(text):
        if ch == "{":
            if brace_depth == 0:
                start = i
            brace_depth += 1
        elif ch == "}":
            brace_depth -= 1
            if brace_depth == 0 and start >= 0:
                last_block = text[start : i + 1]
                start = -1
    if last_block:
        try:
            return json.loads(last_block)
        except json.JSONDecodeError:
            pass

    return {"key_concepts": [], "equations": [], "media_plan": {}}


def _extract_markdown(text: str) -> str:
    """Strip the trailing JSON block, returning only the Markdown body."""
    # Remove ```json ... ``` from the end
    pattern = r"```json\s*\{[\s\S]*?\}\s*```\s*$"
    cleaned = re.sub(pattern, "", text).strip()
    return cleaned


class SimplificationAgent:
    """Rewrites each paper section for a reader's knowledge profile."""

    def __init__(
        self,
        paper: Paper,
        concepts: list,
        profile_ratings: dict[str, bool],
        db_session: AsyncSession,
        bedrock: BedrockClient,
    ) -> None:
        self.paper = paper
        self.concepts = concepts
        self.profile_ratings = profile_ratings
        self.db = db_session
        self.bedrock = bedrock

    async def run(self) -> list[SimplifiedSection]:
        """Run simplification for all paper sections, returning persisted rows."""
        job = AgentJob(
            paper_id=self.paper.id,
            agent_type="simplification",
            status="running",
        )
        self.db.add(job)
        await self.db.flush()

        try:
            knowledge_summary = build_knowledge_summary(self.profile_ratings)
            system_prompt = SYSTEM_TEMPLATE.format(knowledge_summary=knowledge_summary)

            result = await self.db.execute(
                select(PaperSection)
                .where(PaperSection.paper_id == self.paper.id)
                .order_by(PaperSection.index)
            )
            sections = result.scalars().all()

            simplified_rows: list[SimplifiedSection] = []
            for section in sections:
                user_prompt = build_user(section.title, section.raw_text)
                response = await self.bedrock.invoke_claude(
                    system_prompt, user_prompt, max_tokens=8192
                )

                json_block = _parse_json_block(response)
                markdown_body = _extract_markdown(response)

                row = SimplifiedSection(
                    paper_id=self.paper.id,
                    section_index=section.index,
                    title=section.title,
                    simplified_text=markdown_body,
                    key_concepts=json_block.get("key_concepts", []),
                    equations=json_block.get("equations", []),
                    media_plan=json_block.get("media_plan", {}),
                )
                self.db.add(row)
                simplified_rows.append(row)

            job.status = "done"
            job.completed_at = datetime.now(timezone.utc)
            await self.db.flush()
            return simplified_rows

        except Exception as e:
            job.status = "failed"
            job.error = str(e)[:2000]
            job.completed_at = datetime.now(timezone.utc)
            await self.db.flush()
            raise
