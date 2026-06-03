from __future__ import annotations

import os
from typing import Any

os.environ.setdefault('HF_HOME', os.path.abspath(os.path.join(os.getcwd(), '.runtime', 'huggingface')))
os.environ.setdefault('TRANSFORMERS_CACHE', os.path.abspath(os.path.join(os.getcwd(), '.runtime', 'huggingface', 'transformers')))

import torch
from fastapi import FastAPI
from pydantic import BaseModel, Field

try:
    from FlagEmbedding import BGEM3FlagModel
except ImportError as error:
    raise RuntimeError(
        'FlagEmbedding is not installed. Run the setup commands from tools/bge-m3-server/README.md.'
    ) from error


DEFAULT_MODEL = os.environ.get('RMEM_BGE_MODEL', 'BAAI/bge-m3')
DEFAULT_DEVICE = os.environ.get('RMEM_BGE_DEVICE', 'cuda' if torch.cuda.is_available() else 'cpu')
DEFAULT_USE_FP16 = os.environ.get('RMEM_BGE_FP16', 'true').lower() == 'true'

app = FastAPI(title='rmem BGE-M3 embedding server')
model: BGEM3FlagModel | None = None


class EmbedRequest(BaseModel):
    texts: list[str] = Field(min_length=1)
    model: str = DEFAULT_MODEL


class EmbedResponse(BaseModel):
    model: str
    device: str
    dimensions: int
    embeddings: list[list[float]]


@app.on_event('startup')
def load_model() -> None:
    global model
    model = BGEM3FlagModel(
        DEFAULT_MODEL,
        use_fp16=DEFAULT_USE_FP16,
        device=DEFAULT_DEVICE,
    )


@app.get('/health')
def health() -> dict[str, Any]:
    return {
        'ok': model is not None,
        'model': DEFAULT_MODEL,
        'device': DEFAULT_DEVICE,
        'cuda': torch.cuda.is_available(),
        'gpu': torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
    }


@app.post('/embed')
def embed(request: EmbedRequest) -> EmbedResponse:
    if model is None:
        raise RuntimeError('Model is not loaded.')

    output = model.encode(
        request.texts,
        batch_size=int(os.environ.get('RMEM_BGE_BATCH_SIZE', '8')),
        max_length=int(os.environ.get('RMEM_BGE_MAX_LENGTH', '8192')),
    )
    dense_vectors = output['dense_vecs']
    embeddings = dense_vectors.tolist()
    dimensions = len(embeddings[0]) if embeddings else 0

    return EmbedResponse(
        model=request.model,
        device=DEFAULT_DEVICE,
        dimensions=dimensions,
        embeddings=embeddings,
    )


@app.post('/v1/embeddings')
def openai_embeddings(request: EmbedRequest) -> dict[str, Any]:
    response = embed(request)
    return {
        'object': 'list',
        'model': response.model,
        'data': [
            {
                'object': 'embedding',
                'index': index,
                'embedding': embedding,
            }
            for index, embedding in enumerate(response.embeddings)
        ],
    }
