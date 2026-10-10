"""Prompts for the ImageAgent — writes image generation prompts and payloads."""

PROMPT_SYSTEM = """\
You write precise image-generation prompts for scientific diagrams. \
Given a concept name and its context from a research paper, write an image prompt that will \
produce a clear, educational technical illustration."""


def build_prompt_request(concept: str, context: str) -> str:
    """Build the user prompt asking Claude to generate an image description."""
    return (
        f"Concept: {concept}\n"
        f"Context from paper: {context[:600]}\n\n"
        "Write a single image generation prompt (2–4 sentences) for an educational "
        "scientific diagram.\n"
        "Requirements:\n"
        "- Describe the visual elements, layout, and relationships explicitly\n"
        "- Specify style: clean technical illustration, minimal text labels, arrows for flow\n"
        "- No people, no logos, no abstract art\n"
        "- Suitable for a graduate-level textbook\n"
        "Return ONLY the prompt text, nothing else."
    )


def build_image_payload(prompt: str, seed: int = 42) -> dict:
    """Return the Bedrock request body for Nova Canvas image generation."""
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
