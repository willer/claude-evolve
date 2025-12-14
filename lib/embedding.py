#!/usr/bin/env python3
"""
Embedding helper using Ollama's nomic-embed-text model.
AIDEV-NOTE: Requires ollama with nomic-embed-text model pulled.
"""

import json
import math
import os
import urllib.request
from typing import List, Optional, Tuple

EMBEDDING_MODEL = os.environ.get("EMBEDDING_MODEL", "nomic-embed-text")
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")


def get_embedding(text: str) -> Optional[List[float]]:
    """Get embedding vector for text using Ollama."""
    try:
        req_data = json.dumps({"model": EMBEDDING_MODEL, "input": text}).encode('utf-8')
        req = urllib.request.Request(
            f"{OLLAMA_URL}/api/embed",
            data=req_data,
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=30) as response:
            data = json.loads(response.read().decode('utf-8'))
            return data.get("embeddings", [[]])[0]
    except Exception as e:
        print(f"Embedding error: {e}")
        return None


def get_file_embedding(file_path: str) -> Optional[List[float]]:
    """Get embedding for a file's contents."""
    try:
        with open(file_path, 'r') as f:
            return get_embedding(f.read())
    except Exception as e:
        print(f"File read error: {e}")
        return None


def cosine_similarity(a: List[float], b: List[float]) -> float:
    """Compute cosine similarity between two embedding vectors."""
    if not a or not b or len(a) != len(b):
        return 0.0

    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))

    if norm_a == 0 or norm_b == 0:
        return 0.0

    return dot / (norm_a * norm_b)


def is_similar(text1: str, text2: str, threshold: float = 0.9) -> bool:
    """Check if two texts are semantically similar."""
    emb1 = get_embedding(text1)
    emb2 = get_embedding(text2)

    if not emb1 or not emb2:
        return False

    return cosine_similarity(emb1, emb2) >= threshold


def find_most_similar(
    query: str,
    candidates: List[str],
    top_k: int = 5
) -> List[Tuple[int, float, str]]:
    """
    Find most similar texts from candidates.
    Returns list of (index, similarity, text) tuples.
    """
    query_emb = get_embedding(query)
    if not query_emb:
        return []

    results = []
    for i, candidate in enumerate(candidates):
        cand_emb = get_embedding(candidate)
        if cand_emb:
            sim = cosine_similarity(query_emb, cand_emb)
            results.append((i, sim, candidate))

    results.sort(key=lambda x: x[1], reverse=True)
    return results[:top_k]


def check_novelty(
    new_code: str,
    existing_codes: List[str],
    threshold: float = 0.95
) -> Tuple[bool, float]:
    """
    Check if new code is novel enough compared to existing code.
    Returns (is_novel, max_similarity).
    """
    new_emb = get_embedding(new_code)
    if not new_emb:
        return True, 0.0  # Can't check, assume novel

    max_sim = 0.0
    for existing in existing_codes:
        existing_emb = get_embedding(existing)
        if existing_emb:
            sim = cosine_similarity(new_emb, existing_emb)
            max_sim = max(max_sim, sim)

    return max_sim < threshold, max_sim


if __name__ == "__main__":
    # Test
    print("Testing embedding...")
    emb = get_embedding("def hello(): print('hello world')")
    if emb:
        print(f"Embedding (first 5 dims): {emb[:5]}")
        print(f"Full dimensions: {len(emb)}")

        # Test similarity
        code1 = "def add(a, b): return a + b"
        code2 = "def sum(x, y): return x + y"
        code3 = "def multiply(a, b): return a * b"

        sim12 = cosine_similarity(get_embedding(code1), get_embedding(code2))
        sim13 = cosine_similarity(get_embedding(code1), get_embedding(code3))

        print(f"\nSimilarity (add vs sum): {sim12:.4f}")
        print(f"Similarity (add vs multiply): {sim13:.4f}")
