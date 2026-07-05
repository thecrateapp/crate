"""Listen i18n translation draft generation via LLM."""

from __future__ import annotations

import json
from pathlib import Path
from typing import TypedDict

from pydantic import BaseModel, Field


class I18nSourceMessage(TypedDict, total=False):
    key: str
    source: str
    description: str


class I18nTranslatedMessage(BaseModel):
    key: str
    translation: str
    confidence: float = Field(ge=0, le=1)
    notes: str | None = None


class I18nTranslationDraft(BaseModel):
    locale: str
    messages: list[I18nTranslatedMessage]


I18N_TRANSLATION_SYSTEM_PROMPT = """You are translating UI copy for Crate Listen, a music listening app.
Translate naturally for product UI, preserve tone, and keep ICU placeholders unchanged.
Return translations only for the requested keys."""


def build_i18n_translation_prompt(
    *,
    target_locale: str,
    messages: list[I18nSourceMessage],
) -> str:
    payload = [
        {
            "key": message["key"],
            "source": message["source"],
            **(
                {"description": message["description"]}
                if message.get("description")
                else {}
            ),
        }
        for message in messages
    ]
    return "\n".join(
        [
            f"Translate these Crate Listen UI strings to locale '{target_locale}'.",
            "Do not add keys. Do not remove keys. Do not rename keys.",
            "Preserve ICU placeholders exactly, including braces and variable names.",
            "If a brand, artist, album, or product name appears, keep it unchanged.",
            "Source messages:",
            json.dumps(payload, ensure_ascii=False, indent=2),
        ]
    )


def load_listen_source_messages() -> dict[str, str]:
    catalog_path = (
        Path(__file__).resolve().parents[3] / "listen/src/i18n/catalogs/en.json"
    )
    with catalog_path.open(encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        raise ValueError("Listen source catalog must be a JSON object")
    return {str(key): str(value) for key, value in data.items()}


def validate_i18n_translation_draft(
    draft: I18nTranslationDraft,
    *,
    expected_keys: set[str],
    target_locale: str,
) -> dict[str, str]:
    if draft.locale.lower() != target_locale.lower():
        raise ValueError(
            f"draft locale mismatch: expected {target_locale}, got {draft.locale}"
        )

    translations: dict[str, str] = {}
    duplicate_keys: set[str] = set()
    for message in draft.messages:
        if message.key in translations:
            duplicate_keys.add(message.key)
            continue
        translations[message.key] = message.translation

    if duplicate_keys:
        raise ValueError(f"draft contains duplicate keys: {sorted(duplicate_keys)}")

    actual_keys = set(translations)
    missing_keys = expected_keys - actual_keys
    extra_keys = actual_keys - expected_keys
    if missing_keys:
        raise ValueError(f"draft is missing keys: {sorted(missing_keys)}")
    if extra_keys:
        raise ValueError(f"draft contains extra keys: {sorted(extra_keys)}")

    return translations


def generate_i18n_translation_draft(
    *,
    target_locale: str,
    source_messages: dict[str, str],
) -> I18nTranslationDraft:
    from crate.llm import ask_structured

    prompt = build_i18n_translation_prompt(
        target_locale=target_locale,
        messages=[
            {"key": key, "source": source}
            for key, source in sorted(source_messages.items())
        ],
    )
    return ask_structured(
        I18nTranslationDraft,
        prompt,
        system=I18N_TRANSLATION_SYSTEM_PROMPT,
    )
