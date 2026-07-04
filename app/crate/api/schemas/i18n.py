from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class I18nManifestBundle(BaseModel):
    id: str
    locale: str
    bundleVersion: str
    publishedAt: datetime | str


class I18nManifestResponse(BaseModel):
    app: str
    fallbackLocale: str
    sourceVersion: str
    bundles: list[I18nManifestBundle]


class I18nBundleResponse(BaseModel):
    id: str
    app: str
    locale: str
    sourceLocale: str
    sourceVersion: str
    bundleVersion: str
    messages: dict[str, str]


class I18nAdminBundleResponse(I18nBundleResponse):
    status: str
    createdAt: datetime | str
    publishedAt: datetime | str | None = None


class I18nTranslationRequestPayload(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    detectedLocale: str = Field(min_length=2, max_length=48)
    normalizedLocale: str = Field(min_length=2, max_length=16)
    sourceVersion: str = Field(min_length=1, max_length=128)
    client: str | None = Field(default=None, max_length=48)
    reason: str = Field(min_length=1, max_length=96)


class I18nTranslationRequestResponse(BaseModel):
    requestId: str
    status: str


class I18nAdminTranslationRequest(BaseModel):
    id: str
    app: str
    locale: str
    sourceVersion: str
    client: str | None = None
    reason: str
    status: str
    taskId: str | None = None
    createdAt: datetime | str
    updatedAt: datetime | str


class I18nAdminRequestsResponse(BaseModel):
    requests: list[I18nAdminTranslationRequest]
