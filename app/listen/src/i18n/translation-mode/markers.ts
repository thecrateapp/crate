const MARKER_START = "\u2063\u2060\u2063";
const MARKER_END = "\u2063\u2060\u2064";
const BIT_ZERO = "\u200B";
const BIT_ONE = "\u200C";
const MARKER_PATTERN = new RegExp(
  `${MARKER_START}([${BIT_ZERO}${BIT_ONE}]*)${MARKER_END}`,
);

export interface TranslationMarker {
  key: string;
  locale?: string;
}

export function withTranslationMarker(
  value: string,
  key: string,
  locale?: string,
): string {
  const marker: TranslationMarker = locale ? { key, locale } : { key };
  return `${value}${MARKER_START}${encodeMarkerPayload(marker)}${MARKER_END}`;
}

export function extractTranslationMarker(
  value: string,
): TranslationMarker | null {
  const match = value.match(MARKER_PATTERN);
  const payload = match?.[1];
  if (!payload) {
    return null;
  }

  try {
    const marker = JSON.parse(decodeMarkerPayload(payload)) as unknown;
    if (
      typeof marker === "object" &&
      marker !== null &&
      "key" in marker &&
      typeof marker.key === "string"
    ) {
      return {
        key: marker.key,
        ...("locale" in marker && typeof marker.locale === "string"
          ? { locale: marker.locale }
          : {}),
      };
    }
  } catch {
    return null;
  }

  return null;
}

export function stripTranslationMarker(value: string): string {
  return value.replace(MARKER_PATTERN, "");
}

function encodeMarkerPayload(marker: TranslationMarker): string {
  const bytes = new TextEncoder().encode(JSON.stringify(marker));
  let encoded = "";

  for (const byte of bytes) {
    for (let shift = 7; shift >= 0; shift -= 1) {
      encoded += byte & (1 << shift) ? BIT_ONE : BIT_ZERO;
    }
  }

  return encoded;
}

function decodeMarkerPayload(payload: string): string {
  if (payload.length % 8 !== 0) {
    throw new Error("Invalid translation marker payload");
  }

  const bytes = new Uint8Array(payload.length / 8);
  for (let index = 0; index < bytes.length; index += 1) {
    const chunk = payload.slice(index * 8, index * 8 + 8);
    let byte = 0;
    for (const bit of chunk) {
      byte = (byte << 1) | (bit === BIT_ONE ? 1 : 0);
    }
    bytes[index] = byte;
  }

  return new TextDecoder().decode(bytes);
}
