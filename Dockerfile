FROM oven/bun:1

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

ENV MODE=live
ENV CONFIG_PATH=config/config.bulk.beta.yml

CMD ["bun", "run", "src/main.ts", "run"]
