"""Prompts for the ImageAgent — generates SVG educational diagrams via Claude."""

PROMPT_SYSTEM = """\
You are an expert at creating clear, educational SVG diagrams for scientific concepts. \
You produce clean, well-labeled technical illustrations suitable for a graduate-level textbook.

Rules:
- Output ONLY valid SVG markup, nothing else — no markdown fences, no explanation.
- Start with <?xml version="1.0" encoding="UTF-8"?> then the <svg> element.
- Use font-family="Arial, Helvetica, sans-serif" on all text elements.
- For math symbols use HTML entities or ASCII: &times; or * for multiply, &alpha; for alpha, \
&Sigma; for sigma, &rarr; for arrow. NEVER use raw Unicode math symbols.
- Leave generous padding: 40px margins on all sides, 20px+ gaps between elements.
- Text must never overlap other text or shapes. Check bounding boxes mentally before placing.
- Keep font sizes between 14px and 22px. Title at 20-22px, labels at 14-16px."""


def build_svg_request(concept: str, context: str) -> str:
    """Build the user prompt asking Claude to generate an SVG diagram."""
    return (
        f"Concept: {concept}\n"
        f"Context from paper:\n{context[:1200]}\n\n"
        "Create an SVG diagram (1000x700 viewBox) that visually explains this concept.\n"
        "Requirements:\n"
        "- Use shapes, arrows, and text labels to show relationships and data flow\n"
        "- Use a dark theme: background #1a1a2e, text #e0e0e0, accents #4fc3f7 #7c4dff #66bb6a #ff7043\n"
        "- Include a title at top center (22px bold)\n"
        "- 40px padding on all edges, 20px+ gap between elements\n"
        "- Use font-family=\"Arial, Helvetica, sans-serif\" on every <text>\n"
        "- For math: use HTML entities (&times; &alpha; &Sigma; &rarr;) or plain ASCII, never raw Unicode\n"
        "- Use proper SVG elements: rect, circle, ellipse, line, polygon, path, text, marker for arrowheads\n"
        "- No external resources, no embedded images, no scripts\n"
        "- Start with <?xml version=\"1.0\" encoding=\"UTF-8\"?> then <svg>\n"
        "Return ONLY the SVG markup."
    )


# Keep old function for backwards compatibility
PROMPT_SYSTEM_LEGACY = """\
You write precise image-generation prompts for scientific diagrams. \
Given a concept name and its context from a research paper, write an image prompt that will \
produce a clear, educational technical illustration."""


def build_prompt_request(concept: str, context: str) -> str:
    return build_svg_request(concept, context)


def build_image_payload(prompt: str, seed: int = 42) -> dict:
    """Return the Bedrock request body for Nova Canvas image generation (legacy)."""
    return {
        "taskType": "TEXT_IMAGE",
        "textToImageParams": {"text": prompt},
        "imageGenerationConfig": {
            "seed": seed,
            "quality": "standard",
            "width": 1024,
            "height": 1024,
            "numberOfImages": 1,
        },
    }
