FROM oven/bun:1 AS base
WORKDIR /usr/src/app

FROM base AS deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM base AS builder
COPY --from=deps /usr/src/app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production
RUN bun run build

FROM scratch AS release
WORKDIR /
COPY --from=builder /usr/src/app/dist/Lucky /Lucky
RUN chmod +x /Lucky && /Lucky -v
EXPOSE 3000/tcp
ENTRYPOINT ["/Lucky"]
