# Beat This! checkpoint for the Smart Mix beats (SM3-D14). final0 swaps in the larger
# model: BEAT_THIS_CHECKPOINT=final0 and
# BEAT_THIS_SHA256=8c328b45f59d8dd3dff219253ff6a8d6482be57d0133a29140e2febbf8eb8331.
ARG BEAT_THIS_CHECKPOINT=small0
# PyTorch, PANNs, Beat This! and madmom for the analysis worker: on installs them on
# every architecture (release images), auto on x86_64 only, off nowhere (see
# worker-analysis-deps).
ARG PANNS=auto
# htdemucs exported to ONNX for the Smart Mix Stems separation (STEM-D3): release
# downloads the Crate Decks release asset, context takes the file from the named build
# context htdemucs-onnx (local and dev builds, see htdemucs-onnx-context). Both check
# the same SHA-256.
ARG HTDEMUCS_ONNX_SOURCE=release
ARG HTDEMUCS_ONNX_SHA256=808790c0f71069e6fa42572bc5b97752add35a49b4c40559098d92bc342d6a08

FROM python:3.13-slim AS base

ENV HOME=/app
ENV MPLCONFIGDIR=/tmp/matplotlib
ENV PIP_DISABLE_PIP_VERSION_CHECK=1
ENV PYTHONDONTWRITEBYTECODE=1

WORKDIR /app


FROM base AS api

COPY requirements-api.txt .
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --prefer-binary --retries 10 --timeout 60 -r requirements-api.txt

COPY alembic.ini .
COPY crate ./crate
COPY scripts ./scripts
COPY bin ./bin

ENTRYPOINT ["python", "-m", "crate"]
CMD ["api"]


FROM base AS worker-core-deps

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libchromaprint-tools \
    tesseract-ocr tesseract-ocr-eng tesseract-ocr-spa \
    && rm -rf /var/lib/apt/lists/*

COPY requirements-api.txt requirements-worker-core.txt .
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --prefer-binary -r requirements-worker-core.txt


# restic and rclone for the backups engine (admin backups, BK1): pinned release
# binaries checked against the SHA-256 their projects publish (restic SHA256SUMS,
# downloads.rclone.org SHA256SUMS). Only the two binaries reach the worker image.
# The build args carry a CRATE_ prefix: rclone reads any RCLONE_* variable as a flag.
FROM python:3.13-slim AS backup-tools

ARG TARGETARCH
ARG CRATE_RESTIC_VERSION=0.19.1
ARG CRATE_RESTIC_SHA256_AMD64=f415415624dcc452f2a02b8c33641791a8c6d6d3b65bbb3543fcf9a25151585c
ARG CRATE_RESTIC_SHA256_ARM64=a5f64aaab53d51e311fa3829124c5b703f2d14cf187d8640b6be3b2b49376465
ARG CRATE_RCLONE_VERSION=1.76.0
ARG CRATE_RCLONE_SHA256_AMD64=b00f00b3266c3764413afe599d3ec316f6f43b3e0ea8a0bc1d186d2133e46df7
ARG CRATE_RCLONE_SHA256_ARM64=ee169016675e23a69d77240565133ff7dbc9b33d16fa8f7053d4af39f1eaeb78
RUN apt-get update && apt-get install -y --no-install-recommends \
    bzip2 ca-certificates curl unzip \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /backup-tools
RUN set -eu; \
    arch="${TARGETARCH:-amd64}"; \
    case "$arch" in \
        amd64) restic_sha="$CRATE_RESTIC_SHA256_AMD64"; rclone_sha="$CRATE_RCLONE_SHA256_AMD64" ;; \
        arm64) restic_sha="$CRATE_RESTIC_SHA256_ARM64"; rclone_sha="$CRATE_RCLONE_SHA256_ARM64" ;; \
        *) echo "no pinned restic/rclone for $arch" >&2; exit 1 ;; \
    esac; \
    curl -fsSL --retry 5 -o restic.bz2 \
        "https://github.com/restic/restic/releases/download/v${CRATE_RESTIC_VERSION}/restic_${CRATE_RESTIC_VERSION}_linux_${arch}.bz2"; \
    echo "${restic_sha}  restic.bz2" | sha256sum -c -; \
    bunzip2 restic.bz2; \
    install -m 0755 restic /usr/local/bin/restic; \
    curl -fsSL --retry 5 -o rclone.zip \
        "https://downloads.rclone.org/v${CRATE_RCLONE_VERSION}/rclone-v${CRATE_RCLONE_VERSION}-linux-${arch}.zip"; \
    echo "${rclone_sha}  rclone.zip" | sha256sum -c -; \
    unzip -q rclone.zip; \
    install -m 0755 "rclone-v${CRATE_RCLONE_VERSION}-linux-${arch}/rclone" /usr/local/bin/rclone; \
    restic version | grep -q "^restic ${CRATE_RESTIC_VERSION} "; \
    rclone version | head -n 1 | grep -qx "rclone v${CRATE_RCLONE_VERSION}"


FROM worker-core-deps AS worker-core

# Backups engine (admin backups, BK1): pg_dump and pg_restore 15 from the PostgreSQL
# apt repository, matching the PostgreSQL 15 server (Debian's own client is 17, whose
# archives a 15 pg_restore cannot read). The repository key is checked by SHA-256
# (fingerprint B97B 0AFC AA1A 47F0 44F2 44A0 7FCC 7D46 ACCC 4CF8) and the package
# version is pinned; apt checks every package against the signed index. Bump
# PG_CLIENT_VERSION when PGDG drops it from the pool (the build fails loudly).
# openssh-client gives restic's sftp backend its ssh (BK2).
ARG PGDG_ACCC4CF8_ASC_SHA256=0144068502a1eddd2a0280ede10ef607d1ec592ce819940991203941564e8e76
ARG PG_CLIENT_VERSION=15.19-1.pgdg13+2
RUN set -eu; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl; \
    curl -fsSL --retry 5 -o /usr/share/keyrings/pgdg.asc \
        https://www.postgresql.org/media/keys/ACCC4CF8.asc; \
    echo "${PGDG_ACCC4CF8_ASC_SHA256}  /usr/share/keyrings/pgdg.asc" | sha256sum -c -; \
    . /etc/os-release; \
    echo "deb [signed-by=/usr/share/keyrings/pgdg.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" \
        > /etc/apt/sources.list.d/pgdg.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends "postgresql-client-15=${PG_CLIENT_VERSION}" \
        openssh-client; \
    apt-get purge -y --auto-remove curl; \
    rm -rf /var/lib/apt/lists/*
ENV PATH="/usr/lib/postgresql/15/bin:${PATH}"
COPY --from=backup-tools /usr/local/bin/restic /usr/local/bin/rclone /usr/local/bin/
RUN pg_dump --version | grep -q "^pg_dump (PostgreSQL) 15\." && \
    pg_restore --version | grep -q "^pg_restore (PostgreSQL) 15\." && \
    restic version && rclone version | head -n 1 && ssh -V

COPY alembic.ini .
COPY crate ./crate
COPY scripts ./scripts
COPY bin ./bin

# Install crate-cli for production Linux workers: required on x86_64, used on
# ARM when the build provides it (release builds do; local ARM builds fall back
# to the Python paths). Core workers use it for fast scan/quality/tag/
# fingerprint paths, but do not carry the heavy ML stack of the analysis worker.
RUN if [ "$(uname -m)" = "x86_64" ]; then \
        test -f bin/crate-cli-linux-amd64 || (echo "bin/crate-cli-linux-amd64 is required for x86_64 worker images" >&2; exit 1); \
        cp bin/crate-cli-linux-amd64 /usr/local/bin/crate-cli && \
        chmod +x /usr/local/bin/crate-cli; \
    elif [ "$(uname -m)" = "aarch64" ] && [ -f bin/crate-cli-linux-arm64 ]; then \
        cp bin/crate-cli-linux-arm64 /usr/local/bin/crate-cli && \
        chmod +x /usr/local/bin/crate-cli; \
    fi

ENTRYPOINT ["python", "-m", "crate"]
CMD ["worker"]


# Backwards-compatible target name for local scripts and older compose files.
FROM worker-core AS worker


FROM base AS worker-playback

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY requirements-api.txt .
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --prefer-binary -r requirements-api.txt

COPY alembic.ini .
COPY crate ./crate
COPY scripts ./scripts

ENTRYPOINT ["python", "-m", "crate"]
CMD ["worker"]


# YAMNet (Google, tensorflow/models research/audioset/yamnet, Apache-2.0) for the
# Smart Mix per-phrase voice (SM3-D13). Google's Keras weights are converted here to
# the .npz crate.smart_mix.voice_model loads, so the analysis image needs neither
# h5py nor TensorFlow. Essentia's packaged YAMNet graph is non-commercial, so it is
# not used.
FROM python:3.13-slim AS yamnet-weights

ARG YAMNET_H5_SHA256=13c3308955bbfaef262f175ac9c40e47b134573a93984f009220dd7cc12a1744
ARG YAMNET_CLASS_MAP_SHA256=cdf24d193e196d9e95912a2667051ae203e92a2ba09449218ccb40ef787c6df2
ARG YAMNET_LICENSE_SHA256=5b17814bf0de8cf65069bc6d7cc38cff19fcaa864d243423ad3ef3db01b52385
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
RUN --mount=type=cache,target=/root/.cache/pip pip install h5py numpy
WORKDIR /yamnet
RUN curl -fsSL --retry 5 -o yamnet.h5 https://storage.googleapis.com/audioset/yamnet.h5 && \
    curl -fsSL --retry 5 -o yamnet_class_map.csv \
        https://raw.githubusercontent.com/tensorflow/models/master/research/audioset/yamnet/yamnet_class_map.csv && \
    curl -fsSL --retry 5 -o LICENSE \
        https://raw.githubusercontent.com/tensorflow/models/master/LICENSE && \
    echo "$YAMNET_H5_SHA256  yamnet.h5" | sha256sum -c - && \
    echo "$YAMNET_CLASS_MAP_SHA256  yamnet_class_map.csv" | sha256sum -c - && \
    echo "$YAMNET_LICENSE_SHA256  LICENSE" | sha256sum -c -
COPY scripts/convert_yamnet_weights.py ./
RUN python convert_yamnet_weights.py yamnet.h5 yamnet_class_map.csv yamnet.npz


# Beat This! (CPJKU, ISMIR 2024; code and weights MIT) for the Smart Mix beats and
# downbeats (SM3-D14). The checkpoint is fetched and checked here, so the worker never
# downloads it: beat_this would fetch any checkpoint it cannot open from disk.
FROM python:3.13-slim AS beat-this-weights

ARG BEAT_THIS_CHECKPOINT
ARG BEAT_THIS_SHA256=6074be2c4d490c5f6101fcc374a1ec72ae93456e23bb6019783b849f5dc7d47b
ARG BEAT_THIS_LICENSE_SHA256=909ab6549794a18e9bb243aacfadda4a5f308436fc2846f350755c53c4f06ae1
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /beat-this
RUN curl -fsSL --retry 5 -o "beat_this-${BEAT_THIS_CHECKPOINT}.ckpt" \
        "https://cloud.cp.jku.at/public.php/dav/files/7ik4RrBKTS273gp/${BEAT_THIS_CHECKPOINT}.ckpt" && \
    curl -fsSL --retry 5 -o beat_this.LICENSE \
        https://raw.githubusercontent.com/CPJKU/beat_this/v1.1.0/LICENSE && \
    echo "$BEAT_THIS_SHA256  beat_this-${BEAT_THIS_CHECKPOINT}.ckpt" | sha256sum -c - && \
    echo "$BEAT_THIS_LICENSE_SHA256  beat_this.LICENSE" | sha256sum -c -


# htdemucs (Demucs v4, Meta AI; code MIT) exported to ONNX by Crate Decks: the network
# only, run on ONNX Runtime CPU for the stems of Smart Mix playlists (STEM-D3). The
# weights state no licence of their own and were trained partly on research-only data;
# Diego accepted them at STEM-G0 for Crate, which is free and non-commercial, and they
# ship with the attribution below. The graph is fetched and checked here, so the worker
# never downloads it. The default URL is the planned Crate Decks release asset, which
# must be published before an image can build from it.
FROM python:3.13-slim AS htdemucs-onnx-release

ARG HTDEMUCS_ONNX_URL=https://github.com/thecrateapp/crate-decks/releases/download/models-htdemucs-onnx-1/htdemucs-onnx-1.onnx
ARG HTDEMUCS_ONNX_SHA256
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /htdemucs
RUN curl -fsSL --retry 5 -o htdemucs-onnx-1.onnx "$HTDEMUCS_ONNX_URL" && \
    echo "$HTDEMUCS_ONNX_SHA256  htdemucs-onnx-1.onnx" | sha256sum -c -


# Local and dev builds take the same file from a named build context, with the same
# check: docker build --build-arg HTDEMUCS_ONNX_SOURCE=context
# --build-context htdemucs-onnx=<directory with htdemucs-onnx-1.onnx> ...
FROM python:3.13-slim AS htdemucs-onnx-context

ARG HTDEMUCS_ONNX_SHA256
WORKDIR /htdemucs
COPY --from=htdemucs-onnx htdemucs-onnx-1.onnx ./
RUN echo "$HTDEMUCS_ONNX_SHA256  htdemucs-onnx-1.onnx" | sha256sum -c -


FROM htdemucs-onnx-${HTDEMUCS_ONNX_SOURCE} AS htdemucs-onnx-weights

RUN printf '%s\n' \
    "htdemucs-onnx-1: Hybrid Transformer Demucs (htdemucs) by Simon Rouard, Francisco" \
    "Massa and Alexandre Defossez, Meta AI (Hybrid Transformers for Music Source" \
    "Separation, ICASSP 2023, arXiv:2211.08553). Code: https://github.com/facebookresearch/demucs" \
    "and https://github.com/adefossez/demucs, MIT licence. Weights:" \
    "https://huggingface.co/adefossez/HTDemucs (revision" \
    "cbc8a9b1a87023b7fd74e7b3412e6321c0eab003); they carry no licence of their own" \
    "beyond the repository's MIT licence and were trained on MUSDB18-HQ, licensed for" \
    "research use only, plus Meta's internal songs. Exported to ONNX (network only, no" \
    "retraining) by Crate Decks, tools/crate-stems/export_htdemucs.py. Used by Crate, a" \
    "free and non-commercial project, as accepted at STEM-G0." \
    > htdemucs-onnx-1.NOTICE


FROM worker-core-deps AS worker-analysis-python

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements-worker-analysis.txt .
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --prefer-binary -r requirements-worker-analysis.txt


# madmom (CPJKU) for the DBN that post-processes the Beat This! beats and downbeats
# (SM3-D14). Its PyPI release, 0.16.1, does not build on Python 3.13, so its wheel is
# built here from a pinned commit, against the numpy of the analysis image, and only
# the wheel reaches the image, without the compilers. madmom's code is BSD; its package
# also ships model files under CC BY-NC-SA 4.0. Since smart-mix-audio-v10 the meter
# arbiter runs its downbeat networks on the tracks Beat This!'s DBN hears in three
# (crate/smart_mix/meter_arbiter.py, gate MG1), which is acceptable for Crate as free and
# open-source software. The licence travels with the wheel and is installed with it as
# /app/models/madmom.LICENSE.
FROM worker-analysis-python AS madmom-build

ARG MADMOM_COMMIT=27f032e8947204902c675e5e341a3faf5dc86dae
RUN apt-get update && apt-get install -y --no-install-recommends build-essential git \
    && rm -rf /var/lib/apt/lists/*
RUN --mount=type=cache,target=/root/.cache/pip \
    pip freeze | grep -i '^numpy==' > /tmp/numpy-constraint.txt && \
    pip install -c /tmp/numpy-constraint.txt \
        cython==3.3.1 setuptools==84.2.1 wheel==0.48.0
WORKDIR /madmom
RUN git init -q . && \
    git fetch -q --depth 1 https://github.com/CPJKU/madmom.git "$MADMOM_COMMIT" && \
    git checkout -q FETCH_HEAD && \
    git submodule update -q --init --depth 1 && \
    pip wheel --no-build-isolation --no-deps --wheel-dir /wheels .
RUN cp LICENSE /wheels/madmom.LICENSE


# Images without torch never install madmom, so they take an empty /wheels instead of
# fetching and compiling it.
FROM scratch AS madmom-skip
WORKDIR /wheels


# madmom-wheel follows the torch rule of worker-analysis-deps: PANNS=on builds madmom
# on every architecture, auto on amd64 (x86_64) only, off nowhere. BuildKit builds
# only the stages the target reaches, so the other branch costs nothing. Release
# images are amd64 and arm64; auto on another architecture names no stage here.
FROM madmom-build AS madmom-on
FROM madmom-skip AS madmom-off
FROM madmom-build AS madmom-auto-amd64
FROM madmom-skip AS madmom-auto-arm64
FROM madmom-auto-${TARGETARCH} AS madmom-auto
FROM madmom-${PANNS} AS madmom-wheel


FROM worker-analysis-python AS worker-analysis-deps

# PyTorch CPU-only + PANNs for audio classification, and Beat This! for the Smart
# Mix beats. PANNS=on installs them on every architecture (release images); auto
# keeps local ARM builds light by installing them on x86_64 only; off skips them.
# Beat This! installs against the torch just installed (pinned by constraint), with
# torchaudio from the same CPU index, so it never moves torch, and with the madmom
# wheel built above for its DBN. numpy is held from the start, so it stays the one
# madmom was built against. The imports at the end catch a broken set at build time.
# torch is pinned because Beat This! needs torchaudio, which stopped at 2.11 while
# torch moved on: torchaudio 2.11.1 (requirements-beat-this.txt) declares only
# torch>=2.11, so an unpinned torch would pair itself with a torchaudio nobody ran on
# it. Bump both together and check Beat This! on the new pair. madmom's licence ships
# with madmom, so images without torch carry neither.
ARG PANNS
ARG TORCH_VERSION=2.15.0
COPY requirements-beat-this.txt .
RUN --mount=type=cache,target=/root/.cache/pip \
    --mount=type=bind,from=madmom-wheel,source=/wheels,target=/tmp/madmom-wheels \
    if [ "$PANNS" = "on" ] || { [ "$PANNS" = "auto" ] && [ "$(uname -m)" = "x86_64" ]; }; then \
        pip freeze | grep -i '^numpy==' > /tmp/analysis-constraint.txt && \
        pip install -c /tmp/analysis-constraint.txt "torch==${TORCH_VERSION}" \
            --index-url https://download.pytorch.org/whl/cpu && \
        pip install -c /tmp/analysis-constraint.txt panns_inference && \
        pip freeze | grep -i '^torch==' >> /tmp/analysis-constraint.txt && \
        pip install --prefer-binary -c /tmp/analysis-constraint.txt \
            --extra-index-url https://download.pytorch.org/whl/cpu \
            -r requirements-beat-this.txt /tmp/madmom-wheels/madmom-*.whl && \
        pip freeze | grep -iE '^(numpy|torch)==' | sort > /tmp/analysis-installed.txt && \
        sort /tmp/analysis-constraint.txt | cmp -s - /tmp/analysis-installed.txt && \
        python -c "import torchaudio, beat_this.inference, madmom.features.downbeats" && \
        mkdir -p /app/models && \
        cp /tmp/madmom-wheels/madmom.LICENSE /app/models/madmom.LICENSE && \
        rm /tmp/analysis-constraint.txt /tmp/analysis-installed.txt; \
    fi

# Download PANNs CNN14 checkpoint before mutable source COPY so Docker layer
# caching preserves this expensive step across code-only changes.
COPY scripts/download_models.sh ./scripts/
RUN if [ "$PANNS" = "on" ] || { [ "$PANNS" = "auto" ] && [ "$(uname -m)" = "x86_64" ]; }; then \
        bash scripts/download_models.sh /app/models && \
        chmod -R 755 /app/panns_data && \
        apt-get purge -y --auto-remove curl && \
        rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*; \
    fi

# Smart Mix voice model: without torch (PANNS=off) it is ignored and profiles keep
# no voice.
COPY --from=yamnet-weights /yamnet/yamnet.npz /app/models/yamnet.npz
COPY --from=yamnet-weights /yamnet/LICENSE /app/models/yamnet.LICENSE

# Smart Mix beats (SM3-D14): without torch, beat_this or madmom the analyzers keep
# their own beat tracker.
ARG BEAT_THIS_CHECKPOINT
ENV CRATE_BEAT_THIS_CHECKPOINT=${BEAT_THIS_CHECKPOINT}
COPY --from=beat-this-weights /beat-this/ /app/models/

# Smart Mix Stems separation (STEM-D3): the htdemucs ONNX graph and its attribution.
# ONNX Runtime needs no torch, so PANNS=off images separate too.
COPY --from=htdemucs-onnx-weights /htdemucs/ /app/models/


FROM worker-analysis-deps AS worker-analysis

COPY alembic.ini .
COPY crate ./crate
COPY scripts ./scripts
COPY bin ./bin

# Install crate-cli: required on x86_64 production images, optional on ARM
# (build it with `make crate-cli-linux-arm64`; without it the Python fallback runs).
RUN if [ "$(uname -m)" = "x86_64" ]; then \
        test -f bin/crate-cli-linux-amd64 || (echo "bin/crate-cli-linux-amd64 is required for x86_64 worker images" >&2; exit 1); \
        cp bin/crate-cli-linux-amd64 /usr/local/bin/crate-cli && \
        chmod +x /usr/local/bin/crate-cli; \
    elif [ "$(uname -m)" = "aarch64" ] && [ -f bin/crate-cli-linux-arm64 ]; then \
        cp bin/crate-cli-linux-arm64 /usr/local/bin/crate-cli && \
        chmod +x /usr/local/bin/crate-cli; \
    else \
        echo "crate-cli not installed for $(uname -m); Smart Mix uses the Python analyzer" >&2; \
    fi

ENTRYPOINT ["python", "-m", "crate"]
CMD ["worker"]


FROM rust:1.88-slim AS media-worker-builder

WORKDIR /src/media-worker
COPY media-worker/Cargo.toml media-worker/Cargo.lock ./
COPY media-worker/src ./src
RUN cargo build --release --locked


FROM debian:bookworm-slim AS media-worker

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=media-worker-builder /src/media-worker/target/release/crate-media-worker /usr/local/bin/crate-media-worker

ENTRYPOINT ["crate-media-worker"]
CMD ["serve", "--addr", "0.0.0.0:8687"]
