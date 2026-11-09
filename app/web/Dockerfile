# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS build
WORKDIR /app
COPY app/web/package.json app/web/package-lock.json ./
RUN npm ci
COPY app/web/ .
COPY app/shared/ /shared/
# Declared after the dependency layers: a new commit only invalidates the build.
ARG BLOG_SOURCE_COMMIT
ENV BLOG_SOURCE_COMMIT=${BLOG_SOURCE_COMMIT}
# This image has no Git history, so source previews are read from GitHub. An
# optional token raises GitHub's rate limits; it is never written to a layer.
RUN --mount=type=secret,id=blog_source_github_token \
    BLOG_SOURCE_GITHUB_TOKEN="$(cat /run/secrets/blog_source_github_token 2>/dev/null || true)" npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY install.sh /usr/share/nginx/html/install.sh
COPY app/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
