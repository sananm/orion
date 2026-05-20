from __future__ import annotations

from dataclasses import dataclass


DEFAULT_EMBEDDING_MODEL = "BAAI/bge-base-en-v1.5"


@dataclass(frozen=True)
class EmbeddingModelSpec:
    name: str
    dimension: int
    corpus_prefix: str = ""
    query_prefix: str = ""

    def prepare_corpus_text(self, text: str) -> str:
        text = (text or "").strip()
        return f"{self.corpus_prefix}{text}" if self.corpus_prefix else text

    def prepare_query_text(self, text: str) -> str:
        text = (text or "").strip()
        return f"{self.query_prefix}{text}" if self.query_prefix else text


_MODEL_SPECS: dict[str, EmbeddingModelSpec] = {
    "BAAI/bge-small-en-v1.5": EmbeddingModelSpec(
        name="BAAI/bge-small-en-v1.5",
        dimension=384,
    ),
    "BAAI/bge-base-en-v1.5": EmbeddingModelSpec(
        name="BAAI/bge-base-en-v1.5",
        dimension=768,
    ),
    "BAAI/bge-large-en-v1.5": EmbeddingModelSpec(
        name="BAAI/bge-large-en-v1.5",
        dimension=1024,
    ),
    "sentence-transformers/all-MiniLM-L6-v2": EmbeddingModelSpec(
        name="sentence-transformers/all-MiniLM-L6-v2",
        dimension=384,
    ),
    "sentence-transformers/all-mpnet-base-v2": EmbeddingModelSpec(
        name="sentence-transformers/all-mpnet-base-v2",
        dimension=768,
    ),
    "intfloat/e5-small-v2": EmbeddingModelSpec(
        name="intfloat/e5-small-v2",
        dimension=384,
        corpus_prefix="passage: ",
        query_prefix="query: ",
    ),
    "intfloat/e5-base-v2": EmbeddingModelSpec(
        name="intfloat/e5-base-v2",
        dimension=768,
        corpus_prefix="passage: ",
        query_prefix="query: ",
    ),
    "intfloat/e5-large-v2": EmbeddingModelSpec(
        name="intfloat/e5-large-v2",
        dimension=1024,
        corpus_prefix="passage: ",
        query_prefix="query: ",
    ),
    "mixedbread-ai/mxbai-embed-large-v1": EmbeddingModelSpec(
        name="mixedbread-ai/mxbai-embed-large-v1",
        dimension=1024,
    ),
}


def get_embedding_spec(model_name: str) -> EmbeddingModelSpec:
    return _MODEL_SPECS.get(
        model_name,
        EmbeddingModelSpec(name=model_name, dimension=384),
    )
