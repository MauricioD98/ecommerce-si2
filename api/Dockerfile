# ─── STAGE 1: Compilar NestJS y Prisma ───────────────────────────────────────
FROM node:22-trixie-slim AS builder

WORKDIR /app

COPY api/package*.json ./
COPY api/prisma ./prisma/
COPY api/prisma.config.ts ./
COPY api/prisma.control.config.ts ./

ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"

RUN npm install --legacy-peer-deps

RUN npx prisma generate \
    && npx prisma generate --config prisma.control.config.ts

COPY api/ ./

RUN npm run build

# ─── STAGE 2: API de producción con Python ───────────────────────────────────
FROM node:22-trixie-slim AS runner

WORKDIR /app

# Python 3.13 y librerías del sistema requeridas por NumPy/scikit-learn/Prisma
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 \
        python3-venv \
        ca-certificates \
        libgomp1 \
        openssl \
    && rm -rf /var/lib/apt/lists/*

# Un entorno Python compartido para pronóstico y segmentación
COPY IA/AS/requirements.txt /tmp/requirements-as.txt
COPY IA/ANS/requirements.txt /tmp/requirements-ans.txt

RUN python3 -m venv /opt/ml-venv \
    && /opt/ml-venv/bin/python -m pip install --no-cache-dir --upgrade pip \
    && /opt/ml-venv/bin/python -m pip install --no-cache-dir \
        -r /tmp/requirements-as.txt \
        -r /tmp/requirements-ans.txt \
    && rm -f /tmp/requirements-as.txt /tmp/requirements-ans.txt

# Aplicación NestJS
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/prisma.control.config.ts ./prisma.control.config.ts

# Módulos Python
COPY IA/AS/pronostico_ventas ./IA/AS/pronostico_ventas
COPY IA/ANS/segmentacion_clientes ./IA/ANS/segmentacion_clientes

RUN mkdir -p /app/IA/AS/salidas /app/IA/ANS/salidas \
    && cd /app/IA/AS \
    && /opt/ml-venv/bin/python -c "import pandas, numpy, sklearn, scipy, joblib, pronostico_ventas" \
    && cd /app/IA/ANS \
    && /opt/ml-venv/bin/python -c "import pandas, numpy, sklearn, scipy, joblib, segmentacion_clientes"

ENV NODE_ENV=production
ENV PORT=3001

ENV FORECAST_DIR=/app/IA/AS
ENV FORECAST_PYTHON=/opt/ml-venv/bin/python
ENV SEGMENTATION_DIR=/app/IA/ANS
ENV SEGMENTATION_PYTHON=/opt/ml-venv/bin/python

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

EXPOSE 3001

CMD ["sh", "-c", "node dist/scripts/migrate.js && node dist/main"]