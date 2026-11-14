# syntax=docker/dockerfile:1.7
FROM node:24-alpine AS build
WORKDIR /repo/app/ryoku
COPY app/ryoku/package.json app/ryoku/package-lock.json ./
RUN npm ci --no-audit --no-fund
# The site builds on app/web's tokens, fonts and motion scripts (the @crate-web alias).
COPY app/web/src/ /repo/app/web/src/
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
