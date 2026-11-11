# syntax=docker/dockerfile:1
FROM node:22-bookworm AS console
WORKDIR /src/console
COPY console/package*.json ./
RUN npm ci
COPY console/ ./
RUN npm run build

FROM debian:bookworm AS build
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential cmake libcurl4-openssl-dev ca-certificates && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY CMakeLists.txt ./
COPY host/ host/
COPY third_party/ third_party/
RUN cmake -S . -B /tmp/yag-build -DCMAKE_BUILD_TYPE=Release && \
    cmake --build /tmp/yag-build --parallel

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    libcurl4 ca-certificates curl && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/yag
COPY --from=build /tmp/yag-build/yag /opt/yag/yag
COPY --from=console /src/console/dist /opt/yag/console/dist
ENV YAG_ASSETS=/opt/yag/console/dist \
    YAG_BIND=0.0.0.0 \
    YAG_PORT=8080
USER 65532:65532
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl --fail --silent http://127.0.0.1:8080/health >/dev/null || exit 1
ENTRYPOINT ["/opt/yag/yag"]
