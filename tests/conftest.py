import pytest
from pathlib import Path


@pytest.fixture
def sample_config_path(tmp_path):
    config = tmp_path / "config.yaml"
    config.write_text("""
server:
  port: 9090
  host: 127.0.0.1

classifier:
  endpoint: http://localhost:11434
  model: qwen3:4b
  system_prompt: "Classify this."
  metadata:
    - token_count
    - has_code
  timeout_ms: 3000

tiers:
  - name: local
    description: Simple stuff
    models:
      - name: qwen3:4b
        endpoint: http://localhost:11434
        type: ollama
  - name: heavy
    description: Hard stuff
    models:
      - name: claude-opus
        endpoint: https://api.anthropic.com
        type: anthropic
        api_key_env: ANTHROPIC_API_KEY

routing:
  default_tier: local
  passthrough_model: true
""")
    return config
