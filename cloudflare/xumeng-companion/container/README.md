# Xumeng companion container package

This package implements a private, single-account native MaiBot runtime for an explicitly assigned administrator trial. It is not a public multi-account deployment. Starting the image starts only its authenticated controller; native MaiBot and the transport gateway start only after the durable host calls `POST /internal/start`.

The controller distinguishes native readiness from durability. `ready:true` means the official native WebUI transport is connected; it does not prove a model reply or durable storage. `durabilityReady:false` is intentional: the outer Durable Object/R2 host must verify account authorization, writer ownership, committed backups, crash detection, and restore before accepting public traffic.

## Build from a clean, allowlisted context

Run from the workspace root with a new destination outside the repository:

```sh
python3 cloudflare/xumeng-companion/container/prepare-context.py /tmp/xumeng-companion-context
docker --context colima-xumeng-build build --platform linux/amd64 \
  -t xumeng-companion:review /tmp/xumeng-companion-context
```

The script refuses an existing destination and reads Git objects at upstream commit `ac6ed61b7b9c971ad94921de3b16fa6f63c36a20`, not the mutable checkout. It whitelists native runtime source/resources, exact `uv.lock`, metadata and license documents, then applies only the reviewed metadata JSON scope patch. The complete patch is retained with licenses. The existing pure-transport gateway is copied explicitly and hashed. Local instance files, conversations, `.data`, `.env`, logs, virtual environments and credentials are never copied.

The context manifest records each file's SHA-256; timestamps are normalized. Python, uv and Node images are pinned by digest. `uv sync --no-cache --frozen --no-dev --no-editable` retains native dependency versions without embedding a package download cache. Inputs are deterministic; bit-identical OCI image output is not claimed. The target is Linux amd64. The image runs as UID 10001 and exposes only port 8080. Native WebUI/message ports and gateway remain on loopback. Chromium downloading, telemetry and MCP are disabled for this trial. Original licenses and agreements remain included.

## Runtime inputs

Values must be injected at runtime, never as Docker build arguments or browser parameters:

| Variable | Purpose |
| --- | --- |
| `COMPANION_CONTROL_TOKEN` | Private host bearer secret, at least 32 characters; required on every route |
| `COMPANION_ACCOUNT_ID` | Server-selected single trial account UUID |
| `COMPANION_AGREEMENTS_ACCEPTED=1` | Explicit operator acceptance of this bundled native version |
| `COMPANION_EULA_MD5` | Exact accepted bundled EULA fingerprint |
| `COMPANION_PRIVACY_MD5` | Exact accepted bundled privacy fingerprint |
| `COMPANION_OPENROUTER_API_KEY` | Runtime provider secret |
| `COMPANION_OPENROUTER_BASE_URL` | Pinned HTTPS OpenRouter API base URL |
| `COMPANION_CHAT_MODEL` | Explicit model ID; no silent fallback |
| `COMPANION_EMBEDDING_MODEL` | Explicit embedding model ID |
| `COMPANION_EMBEDDING_DIMENSION` | Dimension matching the selected embedding model |
| `COMPANION_IMAGE_MODEL` | OpenRouter image model used by the photo action |
| `COMPANION_IMAGE_RESOLUTION` | OpenRouter image resolution, such as `1K` or `2K` |
| `COMPANION_IMAGE_QUALITY` | Provider-specific image quality; Grok Imagine uses `low` or `medium` |
| `COMPANION_TTS_MODEL` | OpenRouter speech model used by the voice action |
| `COMPANION_TTS_VOICE` | Voice ID for the selected speech model |
| `COMPANION_INSTANCE_DIR` | Fixed `/var/lib/xumeng-companion/instance` in the image |
| `MAIBOT_SOURCE_DIR` | Image default `/opt/maibot` |
| `PORT` | Controller port, default 8080 |

Reading an agreement fingerprint does not imply consent. All three explicit agreement inputs are required; there is no build-time or default acceptance. The parent release task has recorded the user's acceptance for this pinned version. `prepare-instance.py` creates markers only after this gate passes, uses official `maibot init`, validates official Config/ModelConfig classes, writes that instance's persona into `bot_config.toml` from `COMPANION_PERSONA`, and creates fresh internal credentials with mode 0600. An existing instance keeps its memory and secrets; the next start rewrites only the persona fields. No model runs during preparation.

Initialization and configuration validation run with the new private staging directory as their working directory because the native logger creates a relative `logs/` directory on import. The caller's working directory is restored afterward, and the image's code directories remain read-only to UID 10001. Native startup also explicitly uses the instance as its working directory; the official `maibot run` CLI independently switches there before importing business modules. The configured final memory path remains the fixed instance path, not the temporary staging path.

On an existing/restored instance, `--check-existing` checks account binding, agreement markers and required native configuration without overwriting user state. It does rebind the only location-specific settings, the A_Memorix `data_dir` and the WebUI/maim_message ports, so a snapshot can be restored into a different instance directory or pool slot; the rewrite is atomic and keeps the file at mode 0600. Existing restored provider configuration is retained; changing injected values alone does not rotate a secret already stored in that configuration. Secret rotation needs a separate stopped-state migration. No `.env` file is loaded and configuration errors are redacted.

## Control contract

Every endpoint requires `Authorization: Bearer <COMPANION_CONTROL_TOKEN>`. Browser cookies, account IDs and authorization headers are never forwarded to the native gateway. There is no arbitrary command/path endpoint. Start and stop accept an empty body or `{}` only.

| Operation | Behavior |
| --- | --- |
| `GET /health` | Controller liveness with random per-process `bootId`, `runtimeStarted`, state, native readiness and clean-stop flag |
| `GET /ready` | 200 only while native transport is running, otherwise 503 |
| `POST /internal/start` | Prepare an empty instance or validate restored state, start official Runner and loopback gateway; return success only after native health is ready |
| `POST /internal/stop` | Reject new proxy work, drain accepted transport requests, stop Runner then gateway, with a shared 90-second deadline |
| `GET /internal/snapshot` | Only after a clean stop; stream a complete instance tar.gz except logs, with `Content-Length` and `X-Snapshot-Sha256` |
| `POST /internal/restore` | Only while stopped, to an absent target; verify optional transfer length/SHA plus required manifest/account/file SHA before atomic rename |
| `GET /api/health`, `/api/sessions`, `/api/sessions/:uuid` | Allowlisted loopback gateway proxy while running |
| `POST /api/sessions`, `/api/sessions/:uuid/messages` | Allowlisted JSON proxy while running |

Lifecycle operations serialize. Native start has a 120-second readiness polling budget plus bounded helper calls. An unexpected child exit, failed shutdown, or request-drain timeout marks the runtime failed and prohibits snapshots; it cannot silently become a clean backup. Each native/gateway child has its own process group. Normal SIGTERM lets the Runner forward shutdown and flush state; an expired deadline kills its entire process group so an orphaned Worker cannot continue model calls or writes. Forced termination is never reported as clean. The host must treat a changed boot ID while dirty as an interrupted runtime and must not automatically restore an older committed generation or replay a user send.

The snapshot contains native SQLite and any WAL files, memory graph/vector state, plugins, config, account binding and gateway receipts. It excludes `logs/`, `*.log` and `*.log.*`. Symlinks, hardlinks, device members, noncanonical paths, traversal, cross-account archives, duplicates, missing files and hash mismatches are rejected. Restore extracts only validated regular files into a private staging directory and then atomically renames it. Bounds are 1 GiB expanded data, 100,000 files/directories and a 16 MiB manifest. The HTTP upload is also bounded at 1 GiB. Snapshots contain private history and provider configuration, so the outer host must store them only in its private R2 bucket and never return them to browsers.

Start responses and `/health` include `timings` (`prepareMs`, `nativeBootMs`, `startMs`, `restoreMs`) so the host can attribute slow cold starts.

## Pool mode

With `COMPANION_POOL_MODE=1` one container hosts up to `COMPANION_POOL_CAPACITY` (default 8) accounts, each as its own Runner/gateway process pair with its own instance directory under `COMPANION_TENANTS_DIR` and its own port block (`20000 + slot * 10`, offsets 1–4). Single-account routes are served under `/tenants/<64-hex tenant key>/…`; the key is derived by the host and is not the account ID.

| Operation | Behavior |
| --- | --- |
| `GET /health` | `{ pool: true, bootId, tenants, capacity }` |
| `POST /tenants/<key>/create` | `{ accountId, chatModel? }`; 201 new, 200 existing, 409 account mismatch, 503 `POOL_FULL` |
| `GET /tenants/<key>/exists` | 200 or 404 without starting anything |
| `POST /tenants/<key>/destroy` | Stop that tenant's processes, delete its directory and free the slot |

Tenants share the container user, so isolation is process and path level, not a security boundary between accounts; the control token is not passed to tenant processes. A container crash interrupts every tenant in it, and the host treats each dirty tenant as an interrupted runtime. Snapshots keep the single-account format, so an account can move between legacy and pool runtimes only from a clean checkpoint.

## Durable-service boundary

This directory does not implement R2 access, Durable Object account routing, lease/fencing, billing, rate limits, migration from an existing local instance, or backup generation retention. Those belong to the outer host. A platform filesystem snapshot does not include memory and is not a long-term backup.

A stopped-state archive gives a consistent filesystem checkpoint after the native shutdown path finishes. It does not guarantee work survived an unexpected process/platform failure before checkpoint. The outer host must commit a verified R2 generation before acknowledging durable completion, preserve its prior generation on backup failure, and report interrupted dirty state rather than pretend a missing update succeeded. Verify the integrated host's cold restore, forced restart, failed upload, checksum rejection, cross-account access and acknowledged-message behavior before enabling the trial. General public traffic remains outside this package's accepted scope.

## Offline checks

```sh
node --test cloudflare/xumeng-companion/container/control.test.mjs \
  cloudflare/xumeng-companion/container/lifecycle.test.mjs
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover \
  -s cloudflare/xumeng-companion/container -p 'test_*.py' -v
```

These use fake child handles, disposable Node child processes and synthetic state only, including actual local HTTP streaming. They check both graceful process exit and forced group termination. Snapshot and restore are also invoked through real Python CLI subprocesses, checking the argument boundary used by the controller instead of only calling Python functions directly. When the local official virtual environment is available and tests run as a non-root user, a full native configuration preparation is executed from a temporary read-only working directory with a dummy key; it verifies that only the temporary instance receives state. They do not call providers or read existing conversations. Native model behavior, Cloudflare lifecycle behavior and durable-host acceptance require separate evidence.
