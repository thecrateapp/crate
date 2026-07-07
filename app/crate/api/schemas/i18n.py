from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


I18nQualityIssueCode = Literal[
    "missing_key",
    "extra_key",
    "empty_value",
    "stale_translation",
    "placeholder_mismatch",
    "icu_parse_error",
    "protected_term_changed",
    "english_fallback",
    "hardcoded_copy",
]


class I18nManifestBundle(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    locale: str
    source_version: str = Field(alias="sourceVersion")
    bundle_version: str = Field(alias="bundleVersion")
    published_at: str | None = Field(default=None, alias="publishedAt")


class I18nManifestResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    app: str
    fallback_locale: str = Field(alias="fallbackLocale")
    source_version: str = Field(alias="sourceVersion")
    bundles: list[I18nManifestBundle] = Field(default_factory=list)


class I18nBundleResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    schema_: str = Field(default="crate.i18n.bundle.v1", alias="schema")
    app: str
    locale: str
    source_locale: str = Field(alias="sourceLocale")
    source_version: str = Field(alias="sourceVersion")
    bundle_version: str = Field(alias="bundleVersion")
    messages: dict[str, str]


class I18nTranslationRequestCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    detected_locale: str | None = Field(default=None, alias="detectedLocale")
    normalized_locale: str = Field(
        alias="normalizedLocale", min_length=2, max_length=16
    )
    source_version: str = Field(alias="sourceVersion", min_length=1, max_length=128)
    client: str | None = Field(default=None, max_length=64)
    reason: str = Field(min_length=1, max_length=128)


class I18nTranslationRequestResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    request_id: str = Field(alias="requestId")
    status: str


class I18nQualityIssueResponse(BaseModel):
    severity: Literal["error", "warning"]
    code: I18nQualityIssueCode
    locale: str
    key: str | None = None
    message: str
    source: str | None = None
    value: str | None = None
    file: str | None = None


class I18nQualityReportResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    schema_: Literal["crate.listen.i18n.quality.v1"] = Field(
        default="crate.listen.i18n.quality.v1",
        alias="schema",
    )
    source_version: str = Field(alias="sourceVersion")
    generated_at: str = Field(alias="generatedAt")
    locales: list[str]
    issue_count: int = Field(alias="issueCount")
    error_count: int = Field(alias="errorCount")
    warning_count: int = Field(alias="warningCount")
    issues: list[I18nQualityIssueResponse] = Field(default_factory=list)
