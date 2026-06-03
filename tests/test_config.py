import pytest
from ai_router.config import load_config


def test_load_config_parses_yaml(sample_config_path):
    config = load_config(sample_config_path)
    assert config.server.port == 9090
    assert config.server.host == "127.0.0.1"
    assert config.classifier.model == "qwen3:4b"
    assert config.classifier.timeout_ms == 3000
    assert len(config.tiers) == 2
    assert config.tiers[0].name == "local"
    assert config.tiers[1].models[0].type == "anthropic"
    assert config.routing.default_tier == "local"
    assert config.routing.passthrough_model is True


def test_load_config_missing_file():
    with pytest.raises(FileNotFoundError):
        load_config("/nonexistent/path.yaml")
