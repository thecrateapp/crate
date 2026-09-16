"""OpenSubsonic protocol errors shared by transport adapters."""

from enum import IntEnum


class ErrorCode(IntEnum):
    GENERIC = 0
    MISSING_PARAMETER = 10
    INCOMPATIBLE_CLIENT = 20
    INCOMPATIBLE_SERVER = 30
    INVALID_CREDENTIALS = 40
    TOKEN_AUTH_UNSUPPORTED = 41
    AUTH_MECHANISM_UNSUPPORTED = 42
    CONFLICTING_AUTH_MECHANISMS = 43
    INVALID_API_KEY = 44
    NOT_AUTHORIZED = 50
    NOT_FOUND = 70


class OpenSubsonicError(Exception):
    def __init__(self, code: ErrorCode | int, message: str) -> None:
        super().__init__(message)
        self.code = int(code)
        self.message = message
