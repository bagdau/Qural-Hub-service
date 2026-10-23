# syntax=docker/dockerfile:1
FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
RUN apt-get update && apt-get install -y --no-install-recommends tini fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS builder
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
COPY requirements.lock /tmp/requirements.lock
RUN pip install -r /tmp/requirements.lock

FROM base AS runtime
ARG APP_VERSION=0.1.0
ARG GIT_SHA=unknown
LABEL org.opencontainers.image.title="qural-hub-backend" org.opencontainers.image.version=$APP_VERSION org.opencontainers.image.revision=$GIT_SHA
COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH" APP_VERSION=$APP_VERSION
RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin app \
    && mkdir -p /var/lib/alageum/files && chown -R app:app /var/lib/alageum
COPY alembic.ini ./
COPY migrations ./migrations
COPY app ./app
COPY seed ./seed
USER app
ENTRYPOINT ["tini", "--"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2", "--proxy-headers"]

FROM runtime AS test
USER root
COPY requirements-dev.lock /tmp/requirements-dev.lock
RUN pip install -r /tmp/requirements-dev.lock
COPY tests ./tests
USER app
CMD ["pytest", "-q", "-x"]
