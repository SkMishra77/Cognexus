"""Prompts for the SimplificationAgent — section-by-section rewriting with media_plan."""

SYSTEM_TEMPLATE = """\
You are a world-class science communicator. Rewrite the research paper \
section below so it is fully understandable to the reader described in the knowledge profile.

Reader Knowledge Profile:
{knowledge_summary}

Rules:
1. Preserve all mathematical notation exactly. After EVERY equation, add a line:
   ↳ Plain English: <one sentence describing what this equation does>
2. For concepts the reader does NOT know: explain from first principles, use concrete \
everyday analogies before any abstract definition.
3. For concepts the reader DOES know: reference them without re-explaining.
4. Output format: valid GitHub-flavored Markdown.
   - Use ## for subsections, **bold** for key terms, `code` for variables/functions.
5. At the very end of your output, append this JSON block (no other text after it):
```json
{{
  "key_concepts": ["list of bolded terms you introduced"],
  "equations": [{{"latex": "...", "plain_english": "..."}}],
  "media_plan": {{
    "concept_name": ["image", "canvas", "video"],
    ...
  }}
}}
```

CRITICAL — media_plan reasoning rules:
- For EACH key concept, decide which media types (if any) would genuinely help explain it.
- "image": use ONLY when the concept has spatial/structural relationships, anatomy, or a \
static visual would clarify what text cannot (e.g. "neural network architecture", "molecule structure"). \
Do NOT recommend image for abstract/mathematical concepts that have no visual form.
- "canvas": use ONLY when the concept involves a workflow, pipeline, data flow, process steps, \
or architecture with connected components (e.g. "transformer encoder pipeline", "backpropagation flow"). \
Do NOT recommend canvas for standalone concepts without flow.
- "video": use ONLY when the concept involves a mathematical transformation, dynamic process, \
step-by-step derivation, or something that changes over time and benefits from animation \
(e.g. "gradient descent convergence", "attention weight computation", "matrix multiplication"). \
Do NOT recommend video for static definitions or simple concepts.
- Many concepts need ONLY text — leave their media_plan as an empty list [].
- A concept can have multiple media types if genuinely needed (e.g. ["image", "video"]).
- Be selective: typically only 30-50% of concepts need any media at all."""


def build_user(section_title: str, section_text: str) -> str:
    """Build the user prompt for a single paper section."""
    title = section_title or "Untitled Section"
    return f"## Section: {title}\n\n{section_text}"


def build_knowledge_summary(ratings: dict[str, bool]) -> str:
    """Build a binary knows/doesn't-know summary from the rating dict."""
    knows = [k for k, v in ratings.items() if v is True]
    new = [k for k, v in ratings.items() if v is False]
    return (
        f"Concepts the reader already knows (reference without explaining): "
        f"{', '.join(knows) or 'none'}.\n"
        f"Concepts the reader does NOT know (explain from first principles): "
        f"{', '.join(new) or 'none'}.\n"
        f"Treat the reader as highly intelligent but completely new to: {', '.join(new) or 'nothing new'}."
    )
