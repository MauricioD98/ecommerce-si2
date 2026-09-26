# ─── STAGE 1: Builder ────────────────────────────────────────────────────────
# Node 22 requerido por: openai@7, @nestjs/schematics@12, commander@15, etc.
FROM node:22-alpine AS builder

WORKDIR /app

# Copiar archivos de dependencias y config de Prisma
COPY package*.json ./
COPY prisma ./prisma/
COPY prisma.config.ts ./

# Instalar TODAS las dependencias (incluyendo devDependencies para compilar)
RUN npm install --legacy-peer-deps

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

# Variables de entorno por defecto (se sobreescriben en docker-compose)
ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

# Al iniciar: aplicar migraciones pendientes y arrancar la app
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
