FROM oven/bun:1.1

WORKDIR /app
COPY package.json tsconfig.json addresses.json ./
RUN bun install --ci
COPY src ./src

ENV APP_ENV=production
CMD ["bun", "run", "start"]
