# Build only the context emitted by prepare-context.py, never the workspace.
# All image manifests and upstream source/uv.lock are pinned in that context.
FROM ghcr.io/astral-sh/uv:0.13.0@sha256:cdc6093146eb3ff6a40107b38f008b789e050e77ad87865e381d9917da55a168 AS uv
FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS node
FROM python:3.13-slim@sha256:70729b46c69b4f1e97c4822c1af3df53a1476cf5ddc6c087c0c10bc3a5678c2f

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 UV_LINK_MODE=copy \
    PATH="/opt/maibot/.venv/bin:/usr/local/bin:/usr/bin:/bin" \
    MAIBOT_SOURCE_DIR=/opt/maibot \
    COMPANION_INSTANCE_DIR=/var/lib/qingyu-companion/instance \
    TZ=Asia/Shanghai
COPY --from=uv /uv /bin/uv
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/lib/x86_64-linux-gnu/libstdc++.so.6 /usr/lib/x86_64-linux-gnu/libstdc++.so.6
COPY --from=node /usr/share/doc/libstdc++6/copyright /usr/share/doc/companion-libstdc++/copyright
WORKDIR /opt/maibot
COPY upstream/ /opt/maibot/
RUN uv sync --no-cache --frozen --no-dev --no-editable \
    && node --version \
    && .venv/bin/python -c "import faiss, numpy, scipy, tomlkit, sqlmodel"
WORKDIR /opt/companion
COPY runtime/ /opt/companion/
COPY plugins/ /opt/companion/plugins/
COPY licenses/ /opt/companion/licenses/
COPY build-manifest.json /opt/companion/build-manifest.json
RUN node --check control.mjs && node --check lifecycle.mjs && node --check gateway.mjs \
    && python -c "import ast,pathlib; [ast.parse(p.read_text()) for p in pathlib.Path('.').glob('*.py')]" \
    && python -c "import ast,pathlib; [ast.parse(p.read_text()) for p in pathlib.Path('plugins').rglob('*.py')]" \
    && mkdir -p /var/lib/qingyu-companion \
    && chown -R 10001:10001 /var/lib/qingyu-companion
USER 10001:10001
EXPOSE 8080
# The controller starts no models automatically. Authenticated /internal/start
# is owned by the durable host after account and restore checks have passed.
ENTRYPOINT ["node", "/opt/companion/control.mjs"]
