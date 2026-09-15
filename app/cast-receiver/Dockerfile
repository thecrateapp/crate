# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS build

WORKDIR /app

COPY cast-receiver/package.json ./
RUN sed -i '/"@crate\/cast-protocol"/d' package.json \
    && npm install --ignore-scripts --legacy-peer-deps --package-lock=false

COPY shared/cast /shared/cast
COPY shared/fonts /shared/fonts
RUN mkdir -p node_modules/@crate \
    && ln -s /shared/cast node_modules/@crate/cast-protocol

COPY cast-receiver/ .

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

COPY --from=build /app/dist /usr/share/nginx/html
COPY --from=build /app/nginx.conf /etc/nginx/conf.d/default.conf

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1

EXPOSE 80
