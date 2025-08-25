FROM oven/bun:1.1-alpine

ENV NODE_ENV=production \
    APP_ENV=production

WORKDIR /app

# Create non-root user
RUN addgroup -g 10001 app \
  && adduser -D -G app -u 10001 app \
  && mkdir -p /app/cache /app/logs

COPY package.json tsconfig.json addresses.json ./
RUN bun install --ci
COPY src ./src

# Fix ownership for runtime write dirs
RUN chown -R app:app /app

USER app

# Run the app directly (skip prestart hooks like lint in prod)
CMD ["bun", "src/index.ts"]
