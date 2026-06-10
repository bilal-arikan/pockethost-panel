# Self-contained image: Bun runtime + the PocketBase binary. No host coupling.
ARG PB_VERSION=0.39.3

# --- fetch the PocketBase binary for the target arch ---
FROM alpine AS pb
ARG PB_VERSION
ARG TARGETARCH
RUN apk add --no-cache unzip wget ca-certificates
WORKDIR /pb
RUN arch="amd64"; [ "$TARGETARCH" = "arm64" ] && arch="arm64"; \
    wget -q "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${arch}.zip" -O pb.zip \
    && unzip pb.zip && chmod +x pocketbase

# --- runtime ---
FROM oven/bun:1-alpine
USER root
COPY --from=pb /pb/pocketbase /usr/local/bin/pocketbase

WORKDIR /app
# Zero dependencies — no install step.
COPY package.json ./
COPY src ./src
COPY public ./public

RUN mkdir -p /data
ENV DATA_DIR=/data
EXPOSE 8090

CMD ["bun", "run", "src/server.js"]
