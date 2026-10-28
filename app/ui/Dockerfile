# syntax=docker/dockerfile:1.7
# Build context: the repository root. app/ui/Dockerfile.dockerignore limits it
# to the root manifest and lockfile, app/ui and the shared code the admin
# imports, so the image installs exactly the workspace lockfile.
# The bundle is the same on every architecture: build it once on the builder's
# platform and copy it into each architecture's nginx.
FROM --platform=$BUILDPLATFORM node:22-alpine AS build

WORKDIR /repo

# Install the admin workspace and the @crate/ui workspace it depends on, from
# the root lockfile. npm links @crate/ui to app/shared/ui itself.
COPY package.json package-lock.json ./
COPY app/ui/package.json app/ui/
COPY app/shared/ui/package.json app/shared/ui/
RUN npm ci --workspace=app/ui --workspace=app/shared/ui

# Shared code (@crate/ui, plus shared/web and shared/fonts imported by
# relative path) and the admin source, at their repository paths.
COPY app/shared/ app/shared/
COPY app/ui/ app/ui/

WORKDIR /repo/app/ui

ARG VITE_SENTRY_DSN=
ARG VITE_SENTRY_ENVIRONMENT=production
ARG VITE_SENTRY_RELEASE=
ARG VITE_CARTO_API_KEY=
ARG SENTRY_ORG=ninja-development
ARG SENTRY_PROJECT=crate-admin
ENV VITE_SENTRY_DSN=$VITE_SENTRY_DSN \
    VITE_SENTRY_ENVIRONMENT=$VITE_SENTRY_ENVIRONMENT \
    VITE_SENTRY_RELEASE=$VITE_SENTRY_RELEASE \
    VITE_CARTO_API_KEY=$VITE_CARTO_API_KEY \
    SENTRY_ORG=$SENTRY_ORG \
    SENTRY_PROJECT=$SENTRY_PROJECT \
    SENTRY_RELEASE=$VITE_SENTRY_RELEASE
# Skip tsc typecheck in Docker (CI handles it separately).
RUN --mount=type=secret,id=sentry_auth_token,required=false \
    if [ -s /run/secrets/sentry_auth_token ]; then \
      export SENTRY_AUTH_TOKEN="$(tr -d '\r\n' < /run/secrets/sentry_auth_token)"; \
    fi; \
    npx --no-install vite build

FROM nginx:alpine
COPY --from=build /repo/app/ui/dist /usr/share/nginx/html
COPY --from=build /repo/app/ui/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
