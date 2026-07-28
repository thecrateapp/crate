const TAG_PATTERN =
  /^v?(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta|rc)(?:[.-]?(\d+))?)?$/;

export function parseAndroidReleaseVersion(rawTag) {
  const tag = String(rawTag ?? "").trim();
  const match = TAG_PATTERN.exec(tag);
  if (!match) {
    throw new Error(`Invalid Android release tag: ${tag || "<empty>"}`);
  }

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  const channel = match[4] ?? "stable";
  const iteration = Number(match[5] ?? 0);
  if (major > 20 || minor > 999 || patch > 999 || iteration > 19) {
    throw new Error(`Android release tag exceeds versionCode bounds: ${tag}`);
  }

  const channelBase = {
    alpha: 0,
    beta: 40,
    rc: 80,
    stable: 99,
  }[channel];
  const versionCode =
    major * 100_000_000 +
    minor * 100_000 +
    patch * 100 +
    channelBase +
    iteration;

  return {
    versionName: tag.replace(/^v/, ""),
    versionCode,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const version = parseAndroidReleaseVersion(process.argv[2]);
  process.stdout.write(
    `CRATE_ANDROID_VERSION_NAME=${version.versionName}\n` +
      `CRATE_ANDROID_VERSION_CODE=${version.versionCode}\n`,
  );
}
