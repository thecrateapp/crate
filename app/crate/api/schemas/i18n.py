from pydantic import BaseModel, ConfigDict, Field


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
