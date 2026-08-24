FROM oven/bun:1.3.14-slim

WORKDIR /app
ENV NODE_ENV=production

COPY --chown=bun:bun package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY --chown=bun:bun src ./src
COPY --chown=bun:bun public ./public
COPY --chown=bun:bun docs/consent ./docs/consent

USER bun
EXPOSE 3000
CMD ["bun", "run", "src/index.ts"]

