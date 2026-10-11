"""Prompts for the CanvasAgent — Excalidraw JSON generation."""

SYSTEM = """\
You are an expert at creating Excalidraw diagrams for technical content. \
Given research paper section text, generate a valid Excalidraw elements JSON array that \
visually represents the workflow, architecture, or data flow described.

Rules:
- Use ONLY these element types: rectangle, ellipse, arrow, text, diamond.
- Each element MUST have these fields:
  id (uuid string), type, x (number), y (number), width (number), height (number), \
strokeColor ("#f4f4f5"), backgroundColor ("transparent" or a hex), strokeWidth (2), \
roughness (0), opacity (100).
- Text elements additionally need: text (string), fontSize (20), fontFamily (1).
- Use dark strokeColor ("#18181b") for text placed inside shapes with light backgrounds. \
Use light strokeColor ("#f4f4f5") for standalone text, shape outlines, and arrows. \
Use saturated (not pastel) background colors for shapes so they contrast with the dark canvas.
- Arrow elements need: points [[x1,y1],[x2,y2]], startBinding/endBinding with elementId.
- Use arrows to show direction of flow. Label arrows with short action verbs.
- Layout: left-to-right for sequential processes, top-to-bottom for hierarchies.
- Spacing: minimum 150px between node centers.
- Return ONLY the raw JSON array — no markdown fences, no explanation."""

OVERVIEW_SUFFIX = """

This is an OVERVIEW canvas for the entire paper. Show all major sections as nodes, \
connected in reading order, with the paper's key contribution highlighted with a diamond shape."""


def build_user(section_text: str, mode: str = "section", concept: str | None = None) -> str:
    """Build the user prompt for canvas generation.

    Args:
        section_text: Context text (either from RAG retrieval or raw section).
        mode: 'section' for section-level canvas, 'overview' for whole-paper overview.
        concept: Optional concept name to focus the canvas on.
    """
    suffix = OVERVIEW_SUFFIX if mode == "overview" else ""
    concept_hint = f"\nFocus on concept: {concept}" if concept else ""
    return f"Section text:\n\n{section_text}{concept_hint}{suffix}"
