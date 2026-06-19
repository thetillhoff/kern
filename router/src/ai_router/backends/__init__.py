from ai_router.backends.ollama import OllamaBackend
from ai_router.backends.anthropic import AnthropicBackend
from ai_router.backends.base import Backend
from ai_router.models import ModelConfig


def get_backend(model_config: ModelConfig) -> Backend:
    match model_config.type:
        case "ollama":
            return OllamaBackend(model_config)
        case "anthropic":
            return AnthropicBackend(model_config)
        case _:
            raise ValueError(f"Unknown backend type: {model_config.type}")
