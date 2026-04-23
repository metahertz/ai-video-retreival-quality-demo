"""Emotion scoring for videos using anchor text embeddings."""
import asyncio
import math
from .voyage import embed_query

EMOTION_ANCHORS: dict[str, str] = {
    "positive": "happy, upbeat, celebratory, joyful, optimistic, cheerful content",
    "neutral":  "calm, informational, documentary, neutral, balanced, factual content",
    "intense":  "action, dramatic, suspenseful, high-energy, tense, thrilling content",
    "negative": "sad, somber, melancholic, tragedy, grief, dark, difficult content",
}


async def embed_anchors() -> dict[str, list[float]]:
    """Embed all four anchor phrases concurrently and return {label: vector}."""
    labels = list(EMOTION_ANCHORS.keys())
    phrases = list(EMOTION_ANCHORS.values())
    vectors = await asyncio.gather(*[embed_query(p) for p in phrases])
    return dict(zip(labels, vectors))


def average_embedding(embeddings: list[list[float]]) -> list[float]:
    """Component-wise average of N embeddings — no numpy required."""
    if not embeddings:
        return []
    n = len(embeddings)
    dims = len(embeddings[0])
    return [sum(embs[d] for embs in embeddings) / n for d in range(dims)]


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    mag_a = math.sqrt(sum(x * x for x in a))
    mag_b = math.sqrt(sum(x * x for x in b))
    if mag_a == 0 or mag_b == 0:
        return 0.0
    return dot / (mag_a * mag_b)


def score_against_anchors(
    avg_emb: list[float],
    anchor_embs: dict[str, list[float]],
) -> tuple[dict[str, float], str]:
    """
    Compute cosine similarity of avg_emb against each anchor vector.
    Returns (scores_dict with values rounded to 4dp, dominant_label).
    """
    scores = {
        label: round(_cosine(avg_emb, anchor), 4)
        for label, anchor in anchor_embs.items()
    }
    dominant = max(scores, key=lambda k: scores[k])
    return scores, dominant
