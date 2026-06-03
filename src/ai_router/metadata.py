import re


def extract_metadata(messages: list[dict]) -> dict:
    all_content = " ".join(m.get("content", "") or "" for m in messages)
    word_count = len(all_content.split())
    token_count = round(word_count / 0.75)

    last_user_content = ""
    for m in reversed(messages):
        if m.get("role") == "user" and m.get("content"):
            last_user_content = m["content"]
            break

    has_code = bool(
        re.search(r"```", all_content)
        or re.search(r"def |class |function |import |const |let |var ", all_content)
    )

    return {
        "token_count": token_count,
        "has_code": has_code,
        "conversation_turns": len(messages),
        "last_message_length": len(last_user_content),
    }
