from pathlib import Path

import yaml

from ai_router.models import AppConfig


def load_config(path: str | Path) -> AppConfig:
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"Config file not found: {path}")
    with open(path) as f:
        raw = yaml.safe_load(f)
    config = AppConfig(**raw)
    tier_names = {t.name for t in config.tiers}
    if config.routing.default_tier not in tier_names:
        raise ValueError(
            f"default_tier '{config.routing.default_tier}' not in tiers {sorted(tier_names)}"
        )
    for tier in config.tiers:
        if not tier.models:
            raise ValueError(f"Tier '{tier.name}' has no models defined")
    return config
