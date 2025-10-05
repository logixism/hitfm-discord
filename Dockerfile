FROM oven/bun:1

RUN apt-get update && apt-get install -y \
    ffmpeg \
    build-essential \
    pkg-config \
    libopus-dev \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json bun.lockb* ./

RUN bun install

COPY . .

ENV NODE_ENV=production

CMD ["bun", "src/index.ts"]