# ─── STAGE 1: Builder ────────────────────────────────────────────────────────
# Node 22 requerido por: openai@7, @nestjs/schematics@12, commander@15, etc.
FROM node:22-alpine AS builder

WORKDIR /app

# Copiar archivos de dependencias y config de Prisma
COPY package*.json ./
COPY prisma ./prisma/
COPY prisma.config.ts ./
COPY prisma.control.config.ts ./

# Variable para que prisma generate no falle durante el build
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"

# Instalar TODAS las dependencias (incluyendo devDependencies para compilar)
RUN npm install --legacy-peer-deps

# Dos clientes: el de las tiendas (@prisma/client, prisma/schema.prisma) y el del plano de control
# (src/generated/control, prisma/control/schema.prisma). Tienen que existir antes de `nest build`.
RUN npx prisma generate && npx prisma generate --config prisma.control.config.ts

# Copiar el resto del código fuente
COPY . .

# Compilar TypeScript → dist/
RUN npm run build

# ─── STAGE 2: Runner (imagen de producción) ──────────────────────────────────
FROM node:22-alpine AS runner

WORKDIR /app

# Solo copiar lo necesario desde el builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/prisma ./prisma
# prisma.config.ts define el datasource (requerido por Prisma 7 para migrate deploy)
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/prisma.control.config.ts ./prisma.control.config.ts

# Variables de entorno por defecto (se sobreescriben en docker-compose)
ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

# Al iniciar: migrar el plano de control (public) y cada schema de tienda, y arrancar la app.
# Ya NO se corre `npx prisma migrate deploy` a secas: con prisma.config.ts eso aplicaría las
# migraciones de TIENDA sobre public (el plano de control). Ver src/scripts/migrate.ts.
# Requiere DIRECT_URL (Neon sin "-pooler") además de DATABASE_URL.
CMD ["sh", "-c", "node dist/scripts/migrate.js && node dist/main"]
