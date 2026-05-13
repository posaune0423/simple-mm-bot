FROM oven/bun:1

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

ENV MODE=live
ENV CONFIG_VENUE=bulk
ENV CONFIG_PRESET=beta

CMD ["bun", "run", "src/main.ts", "run"]
