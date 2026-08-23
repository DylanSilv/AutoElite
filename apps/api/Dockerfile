# Imagen de la API. Se construye desde la raíz del monorepo:
#   docker build -f apps/api/Dockerfile -t autoelite-api .

FROM node:22-slim AS base
# Prisma necesita openssl para su motor de consultas.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

# ---------- Dependencias ----------
# Se copian sólo los manifiestos primero: mientras no cambien, Docker reutiliza
# la capa de instalación y el build queda en segundos.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

# ---------- Build ----------
FROM deps AS build
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY tsconfig.base.json ./
RUN pnpm --filter @autoelite/api exec prisma generate
RUN pnpm --filter @autoelite/api build

# ---------- Runtime ----------
FROM base AS runtime
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/apps/api/package.json ./apps/api/package.json

WORKDIR /app/apps/api

# No corre como root: si alguien logra ejecutar algo dentro del contenedor, que
# tenga los mínimos permisos posibles.
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
