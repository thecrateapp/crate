# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS build
WORKDIR /app
COPY app/web/package.json app/web/package-lock.json ./
RUN npm ci
COPY app/web/ .
COPY app/shared/ /shared/
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY install.sh /usr/share/nginx/html/install.sh
COPY app/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
