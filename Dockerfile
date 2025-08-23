FROM oven/bun:1.1

WORKDIR /app
=
COPY package.json tsconfig.json addresses.json ./
RUN bun install --ci
COPY src ./src

CMD ["bun", "run", "start"]

