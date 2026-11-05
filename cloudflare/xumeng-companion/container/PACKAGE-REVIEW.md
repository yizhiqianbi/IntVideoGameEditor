# Container package review — 2026-10-18

Scope: only this new `container/` package was changed. Existing MaiBot source, gateway, local instances, provider settings, and user histories were not changed. No existing instance directory or secret file was read. No model was started and no provider request was made by this audit.

Final reviewed context: `/private/tmp/xumeng-companion-build-context-final-r5-20261018`.

- 785 allowlisted files; all 784 file hashes in the manifest verified.
- Manifest SHA-256: `bb1ca6759f8f6a60836830a056a09837e9756f92a4b2306cb18b6939cb376148`.
- 603 Python files parsed successfully; the verifier decodes UTF-8 BOM correctly.
- Node syntax checks passed for the controller, lifecycle and unchanged transport gateway.
- Context runtime files and Dockerfile match the reviewed package sources.
- No symlinks, instance state, `.data`, `.env`, virtual environments, runtime logs, secrets or Python caches entered the context.
- The native metadata JSON compatibility patch is present. Applying it is isolated from parent Git repositories and requires successful forward/reverse checks plus explicit content verification.
- Complete per-runtime and preparer hashes are in `package-verification.json` beside this report.

Node tests: **10/10 passed**. They cover authenticated route allowlisting and rejecting browser account overrides; fixed-length snapshot streaming and transfer SHA rejection; readiness, lifecycle serialization, clean-stop archive gating, unexpected child exit, request drain and drain timeout; actual disposable Node child graceful stop and forced group termination; and immediate spawn failure without an unhandled controller error. No native model process was used.

Python tests: **10/10 passed**. They cover synthetic native database/WAL/config/gateway receipt round trips, excluding logs, rejecting wrong accounts, source symlinks, archive traversal/symlink/hardlink/hash attacks, packaging allowlists, missing/mismatched agreement gates, and a full context generated inside this Git workspace. The final regression confirms the metadata JSON decode actually exists; a skipped Git patch cannot pass silently.

The parent release task separately reported full official `maibot init` plus native Config/ModelConfig validation passed with a dummy key in a new empty `/private/tmp/xumeng-companion-config-offline-20261018` instance. It did not start a model. An earlier container-side prepare attempt encountered build VM filesystem I/O failure and is not counted as passing. Docker image builds and Cloudflare deployment validation belong to the parent release evidence, not these offline checks.

Implemented here: authenticated single-account process controller; explicit agreement/account startup checks; stopped complete-instance archive with account/file hashes; bounded graceful shutdown; process-group cleanup on timeout; empty-target atomic restore; and loopback-only allowlisted gateway proxy. The default image still starts no native process automatically.

Not accepted by these tests: Cloudflare runtime behavior, native provider replies, model quality, production routing, multi-account service, R2 durability, crash recovery or zero data loss. Native `ready:true` indicates WebUI transport connectivity only. The container always reports `durabilityReady:false`; the outer host must separately prove verified durable commit and must fail closed after dirty interruption. It must not expose archive endpoints or provider configuration to browsers.

Earlier contexts named `audit`, `lifecycle`, and `lifecycle-r2` are superseded. Only the final path and hashes above include both process-group timeout cleanup and immediate spawn-error handling. Review/build from that final context or regenerate with the verified current preparer.

## Read-only image cwd regression — r4

The parent image test found that direct configuration imports used the read-only `/opt/companion` cwd and native logger creation failed. The configurator now runs official init and direct Config/ModelConfig validation inside its private staging directory, restores the caller cwd afterward, and keeps the final memory path unchanged. Native process launch explicitly uses the instance cwd; the official CLI also changes to the instance before business imports. Code directories are not made writable. A new non-root test actually ran the complete official initialization/configuration path from a temporary mode-0555 directory, using a dummy key and fresh temporary state; it passed and wrote nothing into that read-only directory. Node remained 10/10 and Python became 9/9 with no skips. Docker non-root acceptance must still be rerun by the parent; the earlier image prepare failure is not a pass. The pre-r4 final context is also superseded.

## Archive CLI argument regression — r5

The parent real HTTP restore test exposed reversed restore arguments in the Python CLI dispatcher: direct-function tests passed, while the actual subprocess route supplied instance/archive in snapshot order. The dispatcher now calls snapshot(instance, archive, account) and restore(archive, instance, account) explicitly. A new real CLI subprocess roundtrip verifies native-state fixture bytes, WAL and gateway receipt restoration, original archive SHA preservation, log exclusion, and refusal to restore over an existing target. Python is now 10/10 with no skips; no Node/runtime-controller code changed since its 10/10 run. The parent real HTTP/container restore acceptance remains a separate pending check. The r4 context is superseded by the r5 path/hash at the top of this report.
