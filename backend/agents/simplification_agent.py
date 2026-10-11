"""SimplificationAgent — rewrites paper sections for a given knowledge profile.

Iterates over paper sections, calls Claude for each with the reader's knowledge
profile, parses the JSON block from the response, creates AgentJob rows, and
persists SimplifiedSection rows with media_plan JSONB.
"""

import asyncio
import json
import re
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from db.models import AgentJob, PaperSection, SimplifiedSection
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


SKIP_SECTIONS = {
    "abstract", "references", "bibliography", "acknowledgments",
    "acknowledgements", "related work", "prior work", "background",
    "appendix", "supplementary", "supplementary material",
    "funding", "author contributions", "competing interests",
    "data availability", "ethics", "declaration", "disclosure",
    "conclusion", "conclusions", "summary", "future work",
    "introduction", "keywords", "key words", "index terms",
    "table of contents", "contents", "list of figures",
    "list of tables", "notation", "nomenclature", "glossary",
    "copyright", "permissions", "license", "preface", "foreword",
    "dedication", "abbreviations", "acronyms", "conflict of interest",
    "conflicts of interest", "ccs concepts", "general terms",
}

SKIP_PREFIXES = [
    "acm ", "ieee ", "doi:", "isbn ", "issn ",
    "copyright ", "permission ", "©",
]


def _should_skip(title: str | None) -> bool:
    if not title:
        return True
    normalized = title.strip().lower()
    normalized = re.sub(r"^\d+(\.\d+)*\s*", "", normalized)
    if normalized in SKIP_SECTIONS:
        return True
    if any(normalized.startswith(p) for p in SKIP_PREFIXES):
        return True
    stripped = title.strip()
    if re.match(r"^[\d.,\s·×\-]+$", stripped):
        return True
    if len(stripped) > 200:
        return True
    return False


CONSOLIDATE_SYSTEM = """\
You are an expert at organizing research paper structure. Given a list of section \
titles from a paper, group them into at most {max_sections} logical chapters. \
Merge closely related sections together. Keep the original ordering — do not reorder.

Output a JSON array of objects. Each object has:
- "title": a clear, concise chapter title for the merged group
- "indices": array of original 0-based indices that belong to this group

Rules:
- Every original index must appear exactly once.
- Indices within each group must be contiguous (consecutive).
- Produce at most {max_sections} groups.
- Prefer merging very short or closely related sections rather than important distinct topics.
- Output ONLY the JSON array, no other text."""


class SimplificationAgent:
    """Rewrites each paper section for a reader's knowledge profile."""

    def __init__(
        self,
        paper_id: uuid.UUID,
        concepts: list,
        profile_ratings: dict[str, bool],
        db_session: AsyncSession,
        bedrock: BedrockClient,
    ) -> None:
        self.paper_id = paper_id
        self.concepts = concepts
        self.profile_ratings = profile_ratings
        self.db = db_session
        self.bedrock = bedrock

    async def _consolidate_sections(
        self, sections: list[PaperSection], max_sections: int
    ) -> list[PaperSection]:
        """Ask LLM to group sections into ≤ max_sections chapters, then merge."""
        titles_list = "\n".join(
            f"{i}. {s.title or f'Section {s.index}'}" for i, s in enumerate(sections)
        )
        system = CONSOLIDATE_SYSTEM.format(max_sections=max_sections)
        user = f"Here are {len(sections)} section titles:\n\n{titles_list}"

        try:
            response = await asyncio.wait_for(
                self.bedrock.invoke_claude(system, user, max_tokens=4096),
                timeout=60,
            )
            groups = json.loads(response.strip().strip("`").removeprefix("json").strip())
        except Exception:
            return sections[:max_sections]

        if not isinstance(groups, list) or len(groups) == 0:
            return sections[:max_sections]

        merged: list[PaperSection] = []
        for group in groups[:max_sections]:
            indices = group.get("indices", [])
            if not indices:
                continue
            indices = [i for i in indices if 0 <= i < len(sections)]
            if not indices:
                continue
            base = sections[indices[0]]
            if len(indices) == 1:
                merged.append(base)
                continue
            combined_text = "\n\n".join(sections[i].raw_text for i in indices)
            merged_section = PaperSection(
                paper_id=base.paper_id,
                index=base.index,
                title=group.get("title", base.title),
                raw_text=combined_text,
            )
            merged_section.id = base.id
            merged.append(merged_section)

        return merged if merged else sections[:max_sections]

    async def run(self) -> list[SimplifiedSection]:
        """Run simplification for all paper sections, returning persisted rows."""
        job = AgentJob(
            paper_id=self.paper_id,
            agent_type="simplification",
            status="running",
            job_metadata={"phase": 1, "label": "Simplification"},
        )
        self.db.add(job)
        await self.db.flush()

        try:
            knowledge_summary = build_knowledge_summary(self.profile_ratings)
            system_prompt = SYSTEM_TEMPLATE.format(knowledge_summary=knowledge_summary)

            result = await self.db.execute(
                select(PaperSection)
                .where(PaperSection.paper_id == self.paper_id)
                .order_by(PaperSection.index)
            )
            all_sections = result.scalars().all()

            MIN_SECTION_CHARS = 100
            MAX_SECTIONS = 30
            sections = [
                s for s in all_sections
                if len(s.raw_text.strip()) >= MIN_SECTION_CHARS
                and not _should_skip(s.title)
            ]

            if len(sections) > MAX_SECTIONS:
                sections = await self._consolidate_sections(sections, MAX_SECTIONS)

            simplified_rows: list[SimplifiedSection] = []
            total_sections = len(sections)
            BATCH_SIZE = 3

            for batch_start in range(0, total_sections, BATCH_SIZE):
                batch = sections[batch_start:batch_start + BATCH_SIZE]
                job.job_metadata = {
                    **(job.job_metadata or {}),
                    "progress": f"{batch_start}/{total_sections}",
                    "current_section": batch[0].title or f"Section {batch[0].index}",
                }
                flag_modified(job, "job_metadata")
                await self.db.flush()
                await self.db.commit()

                async def _simplify_section(section):
                    user_prompt = build_user(section.title, section.raw_text)
                    response = await asyncio.wait_for(
                        self.bedrock.invoke_claude(
                            system_prompt, user_prompt, max_tokens=8192
                        ),
                        timeout=120,
                    )
                    return section, response

                batch_results = await asyncio.gather(
                    *[_simplify_section(s) for s in batch],
                    return_exceptions=True,
                )

                for res in batch_results:
                    if isinstance(res, Exception):
                        continue
                    section, response = res
                    json_block = _parse_json_block(response)
                    markdown_body = _extract_markdown(response)

                    row = SimplifiedSection(
                        paper_id=self.paper_id,
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
