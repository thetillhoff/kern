from ai_router.metadata import extract_metadata


def test_extract_metadata_simple_message():
    messages = [
        {"role": "user", "content": "Hello, how are you?"}
    ]
    meta = extract_metadata(messages)
    assert meta["token_count"] > 0
    assert meta["has_code"] is False
    assert meta["conversation_turns"] == 1
    assert meta["last_message_length"] == len("Hello, how are you?")


def test_extract_metadata_with_code():
    messages = [
        {"role": "user", "content": "Fix this:\n```python\nprint('hi')\n```"}
    ]
    meta = extract_metadata(messages)
    assert meta["has_code"] is True


def test_extract_metadata_multi_turn():
    messages = [
        {"role": "user", "content": "Hi"},
        {"role": "assistant", "content": "Hello!"},
        {"role": "user", "content": "What is Python?"},
    ]
    meta = extract_metadata(messages)
    assert meta["conversation_turns"] == 3
    assert meta["last_message_length"] == len("What is Python?")


def test_extract_metadata_token_count_approximation():
    text = "one two three four five six seven eight"
    messages = [{"role": "user", "content": text}]
    meta = extract_metadata(messages)
    # 8 words / 0.75 ≈ 10.67 → rounded to int
    assert 10 <= meta["token_count"] <= 12
