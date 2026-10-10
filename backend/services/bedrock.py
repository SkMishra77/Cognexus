import asyncio
import json
import os
from typing import AsyncGenerator

import aioboto3


class BedrockClient:
    """Async wrapper around AWS Bedrock for Claude, Nova Canvas, and Titan Embeddings."""

    def __init__(self) -> None:
        self.claude_model = os.getenv("CLAUDE_MODEL", "us.anthropic.claude-3-5-sonnet-20241022-v2:0")
        self.image_model = os.getenv("IMAGE_MODEL", "amazon.nova-canvas-v1:0")
        self.embedding_model = os.getenv("EMBEDDING_MODEL", "amazon.titan-embed-text-v2:0")

        # Bedrock API key (bearer token) takes priority over IAM creds.
        # botocore reads AWS_BEARER_TOKEN_BEDROCK from os.environ automatically.
        bedrock_token = os.getenv("AWS_BEARER_TOKEN_BEDROCK")
        if bedrock_token:
            os.environ["AWS_BEARER_TOKEN_BEDROCK"] = bedrock_token

        self._session = aioboto3.Session()

    async def invoke_claude(self, system: str, user: str, max_tokens: int = 4096) -> str:
        """Send a single prompt to Claude and return the full response text."""
        async with self._session.client("bedrock-runtime") as client:
            body = json.dumps(
                {
                    "anthropic_version": "bedrock-2023-05-31",
                    "max_tokens": max_tokens,
                    "system": system,
                    "messages": [{"role": "user", "content": user}],
                }
            )
            response = await client.invoke_model(
                modelId=self.claude_model,
                contentType="application/json",
                accept="application/json",
                body=body,
            )
            response_body = json.loads(await response["body"].read())
            return response_body["content"][0]["text"]

    async def stream_claude(self, system: str, user: str, max_tokens: int = 4096) -> AsyncGenerator[str, None]:
        """Stream Claude's response, yielding text deltas as they arrive."""
        async with self._session.client("bedrock-runtime") as client:
            body = json.dumps(
                {
                    "anthropic_version": "bedrock-2023-05-31",
                    "max_tokens": max_tokens,
                    "system": system,
                    "messages": [{"role": "user", "content": user}],
                }
            )
            response = await client.invoke_model_with_response_stream(
                modelId=self.claude_model,
                contentType="application/json",
                accept="application/json",
                body=body,
            )
            async for event in response["body"]:
                chunk = json.loads(event["chunk"]["bytes"])
                if chunk.get("type") == "content_block_delta":
                    delta = chunk.get("delta", {})
                    if delta.get("type") == "text_delta":
                        yield delta["text"]

    async def generate_image(self, prompt: str, seed: int = 42) -> bytes:
        """Generate an image using Nova Canvas and return raw PNG bytes."""
        async with self._session.client("bedrock-runtime") as client:
            body = json.dumps(
                {
                    "taskType": "TEXT_IMAGE",
                    "textToImageParams": {"text": prompt},
                    "imageGenerationConfig": {
                        "numberOfImages": 1,
                        "height": 1024,
                        "width": 1024,
                        "cfgScale": 8.0,
                        "seed": seed,
                    },
                }
            )
            response = await client.invoke_model(
                modelId=self.image_model,
                contentType="application/json",
                accept="application/json",
                body=body,
            )
            response_body = json.loads(await response["body"].read())
            import base64

            return base64.b64decode(response_body["images"][0])

    async def embed_text(self, text: str) -> list[float]:
        """Embed a single text string and return a 1024-dim float vector."""
        async with self._session.client("bedrock-runtime") as client:
            body = json.dumps(
                {
                    "inputText": text,
                    "dimensions": 1024,
                    "normalize": True,
                }
            )
            response = await client.invoke_model(
                modelId=self.embedding_model,
                contentType="application/json",
                accept="application/json",
                body=body,
            )
            response_body = json.loads(await response["body"].read())
            return response_body["embedding"]

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        """Embed a batch of texts in parallel using asyncio.gather."""
        return list(await asyncio.gather(*(self.embed_text(t) for t in texts)))
