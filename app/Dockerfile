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


FROM worker-core-deps AS worker-core

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


FROM worker-core-deps AS worker-analysis-deps

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements-worker-analysis.txt .
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --prefer-binary -r requirements-worker-analysis.txt

# PyTorch CPU-only + PANNs for audio classification. PANNS=on installs them on
# every architecture (release images); auto keeps local ARM builds light by
# installing them on x86_64 only; off skips them.
ARG PANNS=auto
RUN --mount=type=cache,target=/root/.cache/pip \
    if [ "$PANNS" = "on" ] || { [ "$PANNS" = "auto" ] && [ "$(uname -m)" = "x86_64" ]; }; then \
        pip install torch --index-url https://download.pytorch.org/whl/cpu && \
        pip install panns_inference; \
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
