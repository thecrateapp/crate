#!/usr/bin/env bash
# Crate installer bootstrap.
#
#   curl -fsSL https://cratemusic.app/install.sh | bash
#
# Downloads the `crate` installer for this machine from GitHub Releases,
# verifies its checksum, keeps it on the PATH for later changes and runs
# `crate install`. Every flag is passed through, for example:
#
#   curl -fsSL https://cratemusic.app/install.sh | bash -s -- --dir /srv/crate
#
# CRATE_INSTALLER_VERSION pins a release tag; CRATE_BIN_DIR chooses where the
# binary is kept (default ~/.local/bin); CRATE_RELEASE_BASE points at a mirror;
# CRATE_INSTALLER_ONLY=1 keeps the binary without running it, for installing
# with an AI agent through `crate mcp`.
set -euo pipefail

CRATE_REPO="${CRATE_REPO:-thecrateapp/crate}"
CRATE_INSTALLER_VERSION="${CRATE_INSTALLER_VERSION:-latest}"
CRATE_BIN_DIR="${CRATE_BIN_DIR:-${HOME}/.local/bin}"

die() {
  printf 'Crate installer: %s\n' "$*" >&2
  exit 1
}

case "$(uname -s)" in
  Linux) os=linux ;;
  Darwin) os=darwin ;;
  *) die "Crate installs on Linux and macOS." ;;
esac

case "$(uname -m)" in
  x86_64 | amd64) arch=amd64 ;;
  arm64 | aarch64) arch=arm64 ;;
  *) die "unsupported processor $(uname -m)." ;;
esac

if [[ -n "${CRATE_RELEASE_BASE:-}" ]]; then
  base="${CRATE_RELEASE_BASE}"
elif [[ "${CRATE_INSTALLER_VERSION}" == "latest" ]]; then
  base="https://github.com/${CRATE_REPO}/releases/latest/download"
else
  base="https://github.com/${CRATE_REPO}/releases/download/${CRATE_INSTALLER_VERSION}"
fi

download() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$1" -o "$2"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$2" "$1"
  else
    die "curl or wget is required."
  fi
}

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

asset="crate-${os}-${arch}"
workdir="$(mktemp -d)"
trap 'rm -rf "${workdir}"' EXIT

printf 'Downloading the Crate installer for %s/%s…\n' "${os}" "${arch}"
download "${base}/${asset}" "${workdir}/crate" ||
  die "could not download ${asset} from ${base}."
download "${base}/crate-checksums.txt" "${workdir}/checksums.txt" ||
  die "could not download the checksums from ${base}."

expected="$(awk -v name="${asset}" '$2 == name { print $1 }' "${workdir}/checksums.txt")"
[[ -n "${expected}" ]] || die "no checksum published for ${asset}."
[[ "$(sha256 "${workdir}/crate")" == "${expected}" ]] ||
  die "checksum mismatch for ${asset}; the download is incomplete or was altered."

chmod +x "${workdir}/crate"
binary="${workdir}/crate"
if mkdir -p "${CRATE_BIN_DIR}" 2>/dev/null && cp "${workdir}/crate" "${CRATE_BIN_DIR}/crate" 2>/dev/null; then
  binary="${CRATE_BIN_DIR}/crate"
  case ":${PATH}:" in
    *":${CRATE_BIN_DIR}:"*) ;;
    *) printf 'The installer is kept at %s; add %s to your PATH to run `crate` later.\n' "${binary}" "${CRATE_BIN_DIR}" ;;
  esac
fi

if [[ "${CRATE_INSTALLER_ONLY:-0}" == "1" ]]; then
  printf 'The Crate installer is ready at %s.\n' "${binary}"
  printf 'Connect it to your AI agent with `crate mcp`, or run `crate install` yourself.\n'
  exit 0
fi

# Piped into bash, stdin is this script: read the answers from the terminal.
if [[ -r /dev/tty ]] && { exec </dev/tty; } 2>/dev/null; then
  :
fi
"${binary}" install "$@"
