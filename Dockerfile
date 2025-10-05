FROM oven/bun:1

RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json bun.lockb* ./

RUN bun install

COPY . .

CMD ["bun", "run", "start"]
