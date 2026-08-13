# Imagen del panel. Se construye desde la raíz del monorepo:
#   docker build -f apps/web/Dockerfile -t autoelite-web .

FROM node:22-slim AS build
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

COPY packages/shared packages/shared
COPY apps/web apps/web
COPY tsconfig.base.json ./
RUN pnpm --filter @autoelite/web build

# ---------- Runtime ----------
# El panel es estático: lo sirve nginx, que además hace de proxy hacia la API
# para que todo quede en el mismo origen y la cookie del refresh token funcione
# sin configuración de CORS.
FROM nginx:1.27-alpine AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
