#!/usr/bin/env bash
set -euo pipefail

artifact_suffix="${1:?usage: collect-artifacts.sh <artifact-suffix> [bundle-dir] [output-dir]}"
bundle_dir="${2:-app/listen-desktop/src-tauri/target/release/bundle}"
output_dir="${3:-desktop-artifacts}"
runner_os="${RUNNER_OS:-$(uname -s)}"
if [[ -n "${CRATE_DESKTOP_VERSION:-}" ]]; then
  version="$CRATE_DESKTOP_VERSION"
elif [[ "${GITHUB_REF_TYPE:-}" == "tag" && -n "${GITHUB_REF_NAME:-}" ]]; then
  version="$GITHUB_REF_NAME"
else
  version="$(node -p "require('./app/listen-desktop/src-tauri/tauri.conf.json').version")"
fi

mkdir -p "$output_dir"
find "$output_dir" -maxdepth 1 -type f -delete

if [[ "$runner_os" == "macOS" || "$runner_os" == "Darwin" ]]; then
  while IFS= read -r -d "" app_bundle; do
    if command -v ditto >/dev/null 2>&1; then
      ditto -c -k --sequesterRsrc --keepParent "$app_bundle" \
        "$output_dir/crate-${artifact_suffix}-${version}.app.zip"
    else
      (cd "$(dirname "$app_bundle")" && zip -qry "$OLDPWD/$output_dir/crate-${artifact_suffix}-${version}.app.zip" "$(basename "$app_bundle")")
    fi
  done < <(find "$bundle_dir/macos" -type d -name "Crate.app" -prune -print0 2>/dev/null || true)
fi

while IFS= read -r -d "" artifact; do
  base="$(basename "$artifact")"
  case "$base" in
    *.AppImage) target="crate-${artifact_suffix}-${version}.AppImage" ;;
    *.deb) target="crate-${artifact_suffix}-${version}.deb" ;;
    *.rpm) target="crate-${artifact_suffix}-${version}.rpm" ;;
    *.dmg) target="crate-${artifact_suffix}-${version}.dmg" ;;
    *.msi) target="crate-${artifact_suffix}-${version}.msi" ;;
    *.exe) target="crate-${artifact_suffix}-${version}.exe" ;;
    *) target="crate-${artifact_suffix}-${version}-${base}" ;;
  esac
  cp "$artifact" "$output_dir/$target"
done < <(
  find "$bundle_dir" -type f \( \
    -name "*.AppImage" -o \
    -name "*.deb" -o \
    -name "*.rpm" -o \
    -name "*.dmg" -o \
    -name "*.msi" -o \
    -name "*.exe" \
  \) -print0 2>/dev/null || true
)

find "$output_dir" -type f -print | sort
test "$(find "$output_dir" -type f -print | wc -l)" -gt 0
