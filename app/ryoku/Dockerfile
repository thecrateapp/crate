# syntax=docker/dockerfile:1.7
FROM node:24-alpine AS build
WORKDIR /repo/app/ryoku
COPY app/ryoku/package.json app/ryoku/package-lock.json ./
RUN npm ci --no-audit --no-fund
# The site builds on app/web's tokens, fonts and motion scripts (the @crate-web alias).
# Copy only what it imports, so website content and blog edits do not rebuild it;
# scripts/release_manifest.py watches exactly these paths.
COPY app/web/src/styles/ /repo/app/web/src/styles/
COPY app/web/src/scripts/motion/ /repo/app/web/src/scripts/motion/
COPY app/web/src/lib/clipboard.ts /repo/app/web/src/lib/clipboard.ts
COPY app/web/public/fonts/ /repo/app/web/public/fonts/
COPY app/web/public/icons/ /repo/app/web/public/icons/
COPY app/ryoku/ .
RUN npm run build

FROM nginx:alpine
COPY --from=build /repo/app/ryoku/dist /usr/share/nginx/html
COPY app/ryoku/nginx.conf /etc/nginx/conf.d/default.conf
# Clips are not in the image: the host mounts them here (see docker-compose.project.yaml).
RUN mkdir -p /usr/share/nginx/media
EXPOSE 80
