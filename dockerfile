FROM oven/bun:alpine

LABEL maintainer="garandplg@garandplg.com"
LABEL version="0.0.10"
LABEL description="Mikroserwis API do obsługi Redis"

WORKDIR /api

COPY package.json bun.lockb ./

RUN bun install --production --frozen-lockfile \
  && bun pm cache rm \
  && rm -rf /root/.bun

COPY . .

RUN addgroup --system redis_api \
  && adduser --system --no-create-home --ingroup redis_api redis_api \
  && chown -R redis_api:redis_api /api

USER redis_api

ENV IS_DOCKER=true

EXPOSE 5001

CMD ["bun", "run", "index.ts"]
