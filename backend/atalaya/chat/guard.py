"""Content and query guard for ATALAYA conversational assistant.

Compatibility wrapper backed by the unified guardrails engine.
"""

from __future__ import annotations

from atalaya.chat.guardrails import (
    REJECTION_PERSONAL_DATA,
    REJECTION_POLITICAL,
    screen_input,
)


def check(message: str) -> str | None:
    """Evaluate user message against privacy and content safeguards.

    Returns a courteous rejection message if the query requests personal voter data,
    electoral preferences, parties, candidates, or out-of-scope content.
    Returns None if the message passes.
    """
    if not message:
        return None

    verdict = screen_input(message)
    if not verdict.allowed:
        return verdict.refusal

    return None
