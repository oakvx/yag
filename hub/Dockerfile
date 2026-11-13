FROM python:3.12-alpine
RUN addgroup -S -g 10001 yag && adduser -S -u 10001 -G yag yag \
    && mkdir -p /data && chown yag:yag /data
WORKDIR /opt/hub
COPY hub/ /opt/hub/
USER 10001:10001
ENV PYTHONUNBUFFERED=1 HUB_PORT=8081 HUB_DB=/data/hub.sqlite3
EXPOSE 8081
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8081/health', timeout=2).close()"
ENTRYPOINT ["python", "/opt/hub/server.py"]
