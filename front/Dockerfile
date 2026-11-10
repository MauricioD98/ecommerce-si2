# ─── STAGE 1: Builder ────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copiar archivos de dependencias
COPY package*.json ./

# Instalar dependencias
RUN npm install

# Copiar el resto del código fuente
COPY . .

# Variables necesarias durante el BUILD.
# Next.js incorpora las variables NEXT_PUBLIC_* en el bundle del navegador.
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_PLATFORM_HOSTS
ARG NEXT_PUBLIC_LEGACY_TENANT_ID

ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=$NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_PLATFORM_HOSTS=$NEXT_PUBLIC_PLATFORM_HOSTS
ENV NEXT_PUBLIC_LEGACY_TENANT_ID=$NEXT_PUBLIC_LEGACY_TENANT_ID

# Compilar Next.js
RUN npm run build

# ─── STAGE 2: Runner (imagen de producción) ──────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_PLATFORM_HOSTS
ARG NEXT_PUBLIC_LEGACY_TENANT_ID

ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=$NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_PLATFORM_HOSTS=$NEXT_PUBLIC_PLATFORM_HOSTS
ENV NEXT_PUBLIC_LEGACY_TENANT_ID=$NEXT_PUBLIC_LEGACY_TENANT_ID

# Copiar solo lo necesario para ejecutar Next.js en producción
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000

CMD ["node", "server.js"]
