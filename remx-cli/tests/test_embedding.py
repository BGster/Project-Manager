"""Tests for remx.core.embedding module."""
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from remx.core.embedding import (
    OllamaEmbedder,
    OpenAIEmbedder,
    create_embedder,
    get_embedding,
    Embedder,
    _MAX_CONCURRENT,
)


class TestOllamaEmbedder:
    def test_init_defaults(self):
        e = OllamaEmbedder()
        assert e.base_url == "http://localhost:11434"
        assert e.model == "bge-m3"
        assert e.timeout == 60
        assert e.max_concurrency == _MAX_CONCURRENT

    def test_init_custom(self):
        e = OllamaEmbedder(base_url="http://custom:9999", model="mxbai", timeout=30, max_concurrency=16)
        assert e.base_url == "http://custom:9999"
        assert e.model == "mxbai"
        assert e.timeout == 30
        assert e.max_concurrency == 16

    def test_client_property_lazy(self):
        e = OllamaEmbedder()
        assert e._client is None
        client1 = e.client
        assert e._client is not None
        client2 = e.client
        assert client1 is client2

    def test_async_client_property_lazy(self):
        e = OllamaEmbedder()
        assert e._async_client is None
        client1 = e.async_client
        assert e._async_client is not None
        assert client1 is e._async_client

    @pytest.mark.asyncio
    async def test_aembed_concurrent_requests(self):
        e = OllamaEmbedder()
        e._async_client = AsyncMock()
        mock_resp = MagicMock()
        mock_resp.raise_for_status = MagicMock()
        mock_resp.json.return_value = {"embedding": [0.1, 0.2, 0.3]}
        e._async_client.post = AsyncMock(return_value=mock_resp)

        result = await e.aembed(["text a", "text b", "text c"])

        assert len(result) == 3
        assert result[0] == [0.1, 0.2, 0.3]
        assert e._async_client.post.call_count == 3

    def test_embed_uses_asyncio_run(self):
        e = OllamaEmbedder()
        with patch.object(e, "aembed", new_callable=AsyncMock) as mock_aembed:
            mock_aembed.return_value = [[0.1], [0.2]]
            result = e.embed(["a", "b"])
            assert result == [[0.1], [0.2]]
            mock_aembed.assert_called_once_with(["a", "b"])

    def test_embed_fallback_on_nested_event_loop(self):
        """When asyncio.run fails (nested loop), falls back to serial httpx."""
        e = OllamaEmbedder()
        e._client = MagicMock()
        mock_resp = MagicMock()
        mock_resp.raise_for_status = MagicMock()
        mock_resp.json.side_effect = [
            {"embedding": [0.1]},
            {"embedding": [0.2]},
        ]
        e._client.post.return_value = mock_resp

        # Simulate "attached to a different event loop" error from asyncio.run
        with patch.object(e, "aembed", side_effect=RuntimeError("attached to a different event loop")):
            result = e.embed(["a", "b"])
            assert result == [[0.1], [0.2]]
            assert e._client.post.call_count == 2

    def test_embed_raises_on_http_error(self):
        import httpx
        e = OllamaEmbedder()
        e._client = MagicMock()
        e._client.post.side_effect = httpx.HTTPError("connection refused")
        with pytest.raises(RuntimeError, match="Ollama embed failed"):
            e.embed(["text"])


class TestOpenAIEmbedder:
    def test_init(self):
        e = OpenAIEmbedder(api_key="sk-test", model="text-embedding-3-small", dimension=256)
        assert e.api_key == "sk-test"
        assert e.model == "text-embedding-3-small"
        assert e.dimension == 256

    def test_embed_without_api_key_raises(self):
        e = OpenAIEmbedder(api_key="", model="text-embedding-3-small")
        with pytest.raises(Exception):
            e.embed(["test"])


class TestCreateEmbedder:
    def test_create_ollama_embedder(self):
        e = create_embedder(provider="ollama", model="bge-m3")
        assert isinstance(e, OllamaEmbedder)
        assert e.model == "bge-m3"

    def test_create_openai_embedder(self):
        e = create_embedder(provider="openai", api_key="sk-test", model="text-embedding-3-small")
        assert isinstance(e, OpenAIEmbedder)

    def test_create_returns_none_for_unknown_provider(self):
        e = create_embedder(provider="unknown")
        assert e is None

    def test_create_openai_without_api_key_returns_none(self):
        e = create_embedder(provider="openai", api_key="")
        assert e is None


class TestGetEmbedding:
    def test_get_embedding_returns_none_when_no_embedder(self):
        result = get_embedding(None, "test text")
        assert result is None

    def test_get_embedding_single_text(self):
        e = OllamaEmbedder()
        with patch.object(e, "embed", return_value=[[0.1, 0.2, 0.3]]):
            result = get_embedding(e, "single text")
            assert result == [0.1, 0.2, 0.3]
            e.embed.assert_called_once_with(["single text"])

    def test_get_embedding_returns_none_on_error(self):
        e = OllamaEmbedder()
        with patch.object(e, "embed", side_effect=RuntimeError("fail")):
            result = get_embedding(e, "text")
            assert result is None
