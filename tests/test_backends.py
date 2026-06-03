import pytest
from ai_router.backends import get_backend
from ai_router.backends.base import Backend
from ai_router.models import ModelConfig


def test_get_backend_ollama():
    model = ModelConfig(name="qwen3:4b", endpoint="http://localhost:11434", type="ollama")
    backend = get_backend(model)
    assert isinstance(backend, Backend)


def test_get_backend_anthropic():
    model = ModelConfig(name="claude-opus", endpoint="https://api.anthropic.com", type="anthropic", api_key_env="ANTHROPIC_API_KEY")
    backend = get_backend(model)
    assert isinstance(backend, Backend)


def test_get_backend_unknown_raises():
    model = ModelConfig(name="foo", endpoint="http://x", type="unknown")
    with pytest.raises(ValueError, match="Unknown backend type"):
        get_backend(model)
