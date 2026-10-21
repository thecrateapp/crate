# syntax=docker/dockerfile:1.7
# Build context: the repository root. app/listen/Dockerfile.dockerignore limits
# it to the root manifest and lockfile, app/listen and the shared code Listen
# imports, so the image installs exactly the workspace lockfile.
FROM node:22-alpine AS build

WORKDIR /repo

# Install the Listen workspace and the workspaces it depends on (@crate/ui and
# @crate/cast-protocol) from the root lockfile. npm links them itself.
COPY package.json package-lock.json ./
COPY app/listen/package.json app/listen/
COPY app/shared/ui/package.json app/shared/ui/
COPY app/shared/cast/package.json app/shared/cast/
RUN npm ci --workspace=app/listen --workspace=app/shared/ui --workspace=app/shared/cast

# Shared code (@crate/ui, @crate/cast-protocol, plus shared/web and
# shared/fonts imported by relative path) and the Listen source, at their
# repository paths.
COPY app/shared/ app/shared/
COPY app/listen/ app/listen/

WORKDIR /repo/app/listen

ARG VITE_SENTRY_DSN=
ARG VITE_SENTRY_ENVIRONMENT=production
ARG VITE_SENTRY_RELEASE=
ARG SENTRY_ORG=ninja-development
ARG SENTRY_PROJECT=crate-listen
ARG VITE_CAST_CUSTOM_RECEIVER_ENABLED=false
ARG VITE_CAST_RECEIVER_APP_ID=CC1AD845
ARG VITE_CRATE_CONNECT_FEATURE_ENABLED=false
RUN if [ "$VITE_CAST_CUSTOM_RECEIVER_ENABLED" = "true" ]; then \
      printf '%s' "$VITE_CAST_RECEIVER_APP_ID" | grep -Eq '^[A-Za-z0-9]{8}$' \
        && [ "$VITE_CAST_RECEIVER_APP_ID" != "CC1AD845" ] \
        || { echo 'A registered VITE_CAST_RECEIVER_APP_ID is required when custom Cast is enabled' >&2; exit 1; }; \
    fi
ENV VITE_SENTRY_DSN=$VITE_SENTRY_DSN \
    VITE_SENTRY_ENVIRONMENT=$VITE_SENTRY_ENVIRONMENT \
    VITE_SENTRY_RELEASE=$VITE_SENTRY_RELEASE \
    SENTRY_ORG=$SENTRY_ORG \
    SENTRY_PROJECT=$SENTRY_PROJECT \
    SENTRY_RELEASE=$VITE_SENTRY_RELEASE \
    VITE_CAST_CUSTOM_RECEIVER_ENABLED=$VITE_CAST_CUSTOM_RECEIVER_ENABLED \
    VITE_CAST_RECEIVER_APP_ID=$VITE_CAST_RECEIVER_APP_ID \
    VITE_CRATE_CONNECT_FEATURE_ENABLED=$VITE_CRATE_CONNECT_FEATURE_ENABLED
# Skip tsc typecheck in Docker (CI handles it separately).
RUN --mount=type=secret,id=sentry_auth_token,required=false \
    if [ -s /run/secrets/sentry_auth_token ]; then \
      export SENTRY_AUTH_TOKEN="$(tr -d '\r\n' < /run/secrets/sentry_auth_token)"; \
    fi; \
    npx --no-install vite build

FROM nginx:alpine
COPY --from=build /repo/app/listen/dist /usr/share/nginx/html
COPY --from=build /repo/app/listen/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
