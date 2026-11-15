# Off-site copies of the PostgreSQL dumps written by crate-postgres-backup.
# restic and rclone are pinned release binaries checked against their SHA256SUMS.
# The PostgreSQL 15 + pgvector base matches production, so the monthly drill can
# replay the dump's schema (extensions included) into a throwaway cluster.

FROM debian:bookworm-slim AS tools
ARG TARGETARCH
ARG RESTIC_VERSION=0.19.1
ARG RCLONE_VERSION=1.76.0
ARG RESTIC_SHA256_AMD64=f415415624dcc452f2a02b8c33641791a8c6d6d3b65bbb3543fcf9a25151585c
ARG RESTIC_SHA256_ARM64=a5f64aaab53d51e311fa3829124c5b703f2d14cf187d8640b6be3b2b49376465
ARG RCLONE_SHA256_AMD64=b00f00b3266c3764413afe599d3ec316f6f43b3e0ea8a0bc1d186d2133e46df7
ARG RCLONE_SHA256_ARM64=ee169016675e23a69d77240565133ff7dbc9b33d16fa8f7053d4af39f1eaeb78
RUN apt-get update \
  && apt-get install -y --no-install-recommends bzip2 ca-certificates curl unzip \
  && rm -rf /var/lib/apt/lists/*
RUN set -eu; \
  arch="${TARGETARCH:-amd64}"; \
  case "$arch" in \
    amd64) restic_sha="$RESTIC_SHA256_AMD64"; rclone_sha="$RCLONE_SHA256_AMD64" ;; \
    arm64) restic_sha="$RESTIC_SHA256_ARM64"; rclone_sha="$RCLONE_SHA256_ARM64" ;; \
    *) echo "unsupported architecture: $arch" >&2; exit 1 ;; \
  esac; \
  cd /tmp; \
  curl -fsSLo restic.bz2 \
    "https://github.com/restic/restic/releases/download/v${RESTIC_VERSION}/restic_${RESTIC_VERSION}_linux_${arch}.bz2"; \
  echo "${restic_sha}  restic.bz2" | sha256sum -c -; \
  bunzip2 restic.bz2; \
  install -m 0755 restic /usr/local/bin/restic; \
  curl -fsSLo rclone.zip \
    "https://downloads.rclone.org/v${RCLONE_VERSION}/rclone-v${RCLONE_VERSION}-linux-${arch}.zip"; \
  echo "${rclone_sha}  rclone.zip" | sha256sum -c -; \
  unzip -q rclone.zip; \
  install -m 0755 "rclone-v${RCLONE_VERSION}-linux-${arch}/rclone" /usr/local/bin/rclone; \
  restic version; rclone version | head -1

FROM pgvector/pgvector:0.8.7-pg15-bookworm
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates jq \
  && rm -rf /var/lib/apt/lists/*
COPY --from=tools /usr/local/bin/restic /usr/local/bin/rclone /usr/local/bin/
COPY offsite.sh /usr/local/bin/crate-offsite
RUN chmod 0755 /usr/local/bin/crate-offsite \
  && install -d -o postgres -g postgres -m 0700 /state
ENV CRATE_OFFSITE_STATE_DIR=/state \
  RESTIC_CACHE_DIR=/state/cache \
  PATH="/usr/lib/postgresql/15/bin:${PATH}"
USER postgres
WORKDIR /state
HEALTHCHECK --interval=5m --timeout=10s --start-period=2m \
  CMD ["crate-offsite", "health"]
ENTRYPOINT ["crate-offsite"]
CMD ["schedule"]
