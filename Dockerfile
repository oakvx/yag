# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS ui
WORKDIR /src/console
COPY console/package.json console/package-lock.json ./
RUN npm ci
COPY console/ ./
RUN npm run build

FROM debian:bookworm-slim AS compile
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential cmake pkg-config libcurl4-openssl-dev ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY CMakeLists.txt ./
COPY host/ host/
COPY third_party/ third_party/
RUN cmake -S . -B build -DCMAKE_BUILD_TYPE=Release \
    && cmake --build build --parallel

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    libcurl4 ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 --system yag
RUN mkdir -p /opt/yag/state && chown -R 10001:10001 /opt/yag/state
COPY --from=compile /src/build/yag /usr/local/bin/yag
COPY --from=ui /src/console/dist /opt/yag/console/dist
WORKDIR /opt/yag
USER 10001:10001
ENV YAG_BIND=0.0.0.0 \
    YAG_PORT=8080 \
    YAG_ASSETS=/opt/yag/console/dist
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD curl --fail --silent --show-error http://127.0.0.1:8080/health > /dev/null || exit 1
ENTRYPOINT ["/usr/local/bin/yag"]
