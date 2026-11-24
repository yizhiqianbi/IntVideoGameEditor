#!/bin/sh
# Fetch the exact official source revision and its locked dependency environment.
set -eu
ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
REV=ac6ed61b7b9c971ad94921de3b16fa6f63c36a20
if [ ! -d "$ROOT/upstream/.git" ]; then
  git clone https://github.com/Mai-with-u/MaiBot.git "$ROOT/upstream"
  git -C "$ROOT/upstream" checkout --detach "$REV"
fi
if [ "$(git -C "$ROOT/upstream" rev-parse HEAD)" != "$REV" ]; then
  echo 'Upstream revision differs; refusing to overwrite an existing checkout.' >&2
  exit 1
fi
PATCH="$ROOT/patches/0001-metadata-json-scope.patch"
if git -C "$ROOT/upstream" apply --check "$PATCH" 2>/dev/null; then
  git -C "$ROOT/upstream" apply "$PATCH"
elif ! git -C "$ROOT/upstream" apply --reverse --check "$PATCH" 2>/dev/null; then
  echo 'Native memory compatibility patch conflicts with this checkout; no automatic overwrite.' >&2
  exit 1
fi
UV_BIN=${UV_BIN:-uv}
(cd "$ROOT/upstream" && "$UV_BIN" sync --frozen --no-dev)
"$ROOT/upstream/.venv/bin/python" "$ROOT/setup/configure.py" "$@"
