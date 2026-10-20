# syntax=docker/dockerfile:1.7
# Build context: the repository root. app/cast-receiver/Dockerfile.dockerignore
# limits it to the root manifest and lockfile, app/cast-receiver and the shared
# Cast protocol and fonts, so the image installs exactly the workspace lockfile.
FROM node:22-alpine AS build

WORKDIR /repo

# Install the receiver workspace and the @crate/cast-protocol workspace it
# depends on from the root lockfile. npm links the protocol package itself.
COPY package.json package-lock.json ./
COPY app/cast-receiver/package.json app/cast-receiver/
COPY app/shared/cast/package.json app/shared/cast/
RUN npm ci --workspace=app/cast-receiver --workspace=app/shared/cast

# Shared Cast protocol and fonts, and the receiver source, at their repository
# paths.
COPY app/shared/ app/shared/
COPY app/cast-receiver/ app/cast-receiver/

WORKDIR /repo/app/cast-receiver

ARG VITE_SENTRY_DSN=
ARG VITE_SENTRY_ENVIRONMENT=production
ARG VITE_SENTRY_RELEASE=
ARG VITE_SENTRY_TRACES_SAMPLE_RATE=0.05
ARG SENTRY_ORG=ninja-development
ARG SENTRY_PROJECT=crate-cast-receiver
ENV VITE_SENTRY_DSN=$VITE_SENTRY_DSN \
    VITE_SENTRY_ENVIRONMENT=$VITE_SENTRY_ENVIRONMENT \
    VITE_SENTRY_RELEASE=$VITE_SENTRY_RELEASE \
    VITE_SENTRY_TRACES_SAMPLE_RATE=$VITE_SENTRY_TRACES_SAMPLE_RATE \
    SENTRY_ORG=$SENTRY_ORG \
    SENTRY_PROJECT=$SENTRY_PROJECT \
    SENTRY_RELEASE=$VITE_SENTRY_RELEASE

RUN --mount=type=secret,id=sentry_auth_token,required=false \
    if [ -s /run/secrets/sentry_auth_token ]; then \
      export SENTRY_AUTH_TOKEN="$(tr -d '\r\n' < /run/secrets/sentry_auth_token)"; \
    fi; \
    npm run build && npm run check:bundle

FROM nginx:1.27-alpine

COPY --from=build /repo/app/cast-receiver/dist /usr/share/nginx/html
COPY --from=build /repo/app/cast-receiver/nginx.conf /etc/nginx/conf.d/default.conf

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1

EXPOSE 80
