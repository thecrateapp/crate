"""Bandcamp integration package.

Bandcamp is handled as a user-owned purchase/source integration. Public API
routes queue worker tasks; filesystem writes and remote credential flows stay
outside the API process.
"""

__all__ = []
