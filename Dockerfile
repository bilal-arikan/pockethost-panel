# PocketHost Panel — Bun runtime, no build step, no dependencies.
FROM oven/bun:1-alpine

# CLI tools the panel shells out to:
#   procps         -> full `ps -eo args` (busybox ps lacks the format flags)
#   coreutils      -> GNU `du -b --max-depth` (busybox du lacks these)
#   curl           -> internal provision/health requests
#   openssh-client -> control the host's systemd over ssh (see PH_*_CMD)
RUN apk add --no-cache procps coreutils curl openssh-client

WORKDIR /app

# No package manager step: the project has zero dependencies.
COPY package.json ./
COPY src ./src
COPY public ./public

EXPOSE 8096

CMD ["bun", "run", "src/server.js"]
