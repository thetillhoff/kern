from pydantic import BaseModel


class ServerConfig(BaseModel):
    port: int = 8080
    host: str = "0.0.0.0"


class ClassifierConfig(BaseModel):
    endpoint: str
    model: str
    system_prompt: str
    metadata: list[str]
    timeout_ms: int = 5000


class ModelConfig(BaseModel):
    name: str
    endpoint: str
    type: str  # "ollama" or "anthropic"
    api_key_env: str | None = None


class TierConfig(BaseModel):
    name: str
    description: str
    models: list[ModelConfig]


class RoutingConfig(BaseModel):
    default_tier: str
    passthrough_model: bool = True


class AppConfig(BaseModel):
    server: ServerConfig = ServerConfig()
    classifier: ClassifierConfig
    tiers: list[TierConfig]
    routing: RoutingConfig
