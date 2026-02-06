FROM oven/bun:1.3.8 AS base
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN mkdir -p /data/logs
USER bun

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e 'fetch("http://127.0.0.1:3000/healthz").then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))'

CMD ["bun", "src/index.ts"]
