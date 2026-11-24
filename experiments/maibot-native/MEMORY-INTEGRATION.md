# Native A_Memorix integration

Source snapshot: Mai-with-u/MaiBot `ac6ed61b7b9c971ad94921de3b16fa6f63c36a20` (project version 1.3.9), inspected 2026-10-18. This checkout already includes the native A_Memorix implementation at `upstream/src/A_memorix`, documented there as v2.0.0. Its upstream integration branch is [A-Dawn/A_memorix MaiBot_branch](https://github.com/A-Dawn/A_memorix/tree/MaiBot_branch). Do not install the legacy v1 plugin alongside it or substitute the standalone A_memorix main alpha package.

A real post-startup acceptance test found a native JSON metadata scope parsing defect: facts were persisted and visible in profiles but excluded from scoped `query_memory`. The deployment carries one transparent [local compatibility patch](patches/README.md), including a real SQLite regression and other-chat exclusion coverage. It preserves the native memory architecture and chat isolation. Source patch presence alone does not prove the already-running process has reloaded it; perform the native recall check after restart.

Runtime configuration is `instance/config/bot_config.toml` under `[a_memorix]`, as confirmed by `src/config/config.py` and `src/A_memorix/host_service.py`. Several bundled A_Memorix README/scripts still refer to the older standalone `config/a_memorix.toml`; follow the active host implementation and [current configuration documentation](https://docs.mai-mai.org/manual/configuration/amemorix-config).

## Configuration

The prepared instance enables the native memory host, query and profile tools, profile injection, person-fact writeback, chat-summary writeback and heuristic recall. Text embedding uses OpenRouter `qwen/qwen3-embedding-8b`, 4096 dimensions, `dimension_request_mode = "never"`. A direct real request succeeded with a Chinese sentence; its small nonsecret report is in `evidence/embedding-probe-2026-10-18.json`. This uses the existing OpenRouter key and requires no extra service or key.

Data belongs to the instance, not the source checkout: `instance/data/a-memorix/metadata/metadata.db`, plus `vectors/` and `graph/`. Main Python dependencies already include FAISS, NumPy, SciPy and jieba. Use the lockfile environment; do not run an unbounded requirements upgrade over it.

Full source availability is different from enabling every optional feature. Image embedding is currently unconfigured because the interface is text-only. Relation-vector encoding defaults to disabled upstream; ordinary paragraph vectors and graph relationships are distinct capabilities. Image search needs an actual image embedding task. Relation vectors can use the same text embedding provider when enabled. Model availability, actual runtime readiness, populated memory and successful conversational recall must be reported separately.

## Isolation

Keep `global_memory_sharing_enabled = false`, `shared_memory_groups = []`, and heuristic cross-chat recall disabled. Native `query_memory` supplies the real session ID to `MemoryService.search`; host_service then adds only explicitly shared session IDs. Do not create ad hoc hash IDs for memory ownership: use the session created by the native chat manager.

This is a local single-owner instance. Its WebUI memory console is an administrator interface, with access to the instance-wide corpus. Per-chat retrieval filters are not a complete multi-tenant authorization boundary. Different untrusted users should not share this administrator session; deploying this as a multi-user platform requires separate native instances or an audited identity and data-isolation layer.

## Verification

`verify-native-memory.py` runs without importing or starting MaiBot and never accepts its agreements. With the upstream virtual environment it checks configuration, dependency versions, agreement confirmation state, read-only SQLite integrity/counts and vector/graph file counts. It prints no API keys, tokens, prompts or memory contents.

```sh
upstream/.venv/bin/python verify-native-memory.py --out evidence/memory-preflight.json
```

Once the user has accepted the native terms and MaiBot is actually running, supply an existing native WebUI session token through the `MAIBOT_WEBUI_TOKEN` environment variable (never paste it into a terminal command or report). The optional local endpoint checks use the existing authenticated native WebUI and do not spawn an alternate runtime:

```sh
upstream/.venv/bin/python verify-native-memory.py --base-url http://127.0.0.1:18001 --probe-embedding --out evidence/memory-runtime.json
```

`--probe-embedding` invokes native `/api/webui/memory/runtime/self-check/refresh` and may make a small paid model request. The default HTTP check only reads runtime/config. In current upstream code even the GET self-check route performs a fresh embedding request, so the diagnostic does not call it implicitly. A successful HTTP status alone is not readiness: require the returned runtime/retrieval status and embedding self-check to be successful, with matching actual dimensions. No-memory and degraded sparse-only states must remain visible.

For recall verification use a known synthetic fact in a real test conversation, let native fact/summary writeback complete, then query that real session:

```sh
upstream/.venv/bin/python verify-native-memory.py --base-url http://127.0.0.1:18001 --query '阿舟喜欢什么茶' --chat-id REAL_NATIVE_SESSION_ID --expect-text '桂花乌龙' --out evidence/memory-recall.json
```

The report returns an expected-text boolean instead of the recalled contents. It must also be verified in actual conversation: ask about the fact after it has left the recent context, and inspect native monitor tool records for `query_memory`/profile recall and the generated answer. Merely recalling from current dialogue does not prove long-term memory.

## Planner and Replyer

The native reasoning engine injects profiles and heuristic memory into Planner context. Planner can also call `query_memory`, then supplies necessary factual context through the required `reply_reference` argument of native `reply`. Current Replyer intentionally removes raw ReferenceMessage and ToolResultMessage entries and sees real chat history plus the reply reference and expression choices. Therefore the correct end-to-end evidence is native recall → Planner reply reference → Replyer output; expecting every raw memory to appear directly in the Replyer prompt would contradict the current upstream implementation.

Native monitor prompt previews can contain personal dialogue. Keep acceptance evidence scoped to isolated synthetic sessions and do not publish private prompts or credentials.

## Actual acceptance on 2026-10-18

A synthetic user supplied “桂花乌龙，不加糖” through the real gateway/native chat at about 12:55. Native fact writeback stored it in SQLite with native chat ownership. After the graceful native restart at about 13:45, the same persisted fact was retrieved through the actual native aggregate search API. Querying another existing native chat excluded this tea fact while still returning that chat's own matches. See `evidence/memory-postrestart-recall-2026-10-18.json` and `evidence/memory-postrestart-scope-2026-10-18.json`.

At 13:46:23 the live Planner explicitly invoked native `query_memory`, which returned the stored tea preference successfully. The native reply tool then received the retrieved fact in `reply_reference` and sent two messages: “桂花乌龙不加糖，我都快背下来了” and “你这是考验我还是想听我再说一遍呀～”. Both were observed separately in the gateway. Sanitized tool records and the final observed messages are in `evidence/memory-postrestart-native-tools-2026-10-18.json`. This establishes actual persistence and native retrieval after restart, not just a correct answer from recent chat history. Recent history was not cleared, so this is not a separate evaluation of unprompted memory use after context eviction.

Runtime reported hybrid retrieval ready, with metadata, sparse, graph, vector read/write and embedding channels available. The real native embedding self-check succeeded at 4096 dimensions. Native core and extension plugin processes started; registered core commands confirmed their operation even though no third-party extension plugins were installed.

Limitations remain visible: the memory store contains two synonymous versions of the tea fact; this test does not establish strong semantic deduplication. Episodes and relations were still empty in the sampled store, so their generation quality was not evaluated. Native optional image embedding and relation-vector encoding were not enabled. This is the native runtime plus the single documented scope-parsing compatibility patch, not a claim of unchanged upstream source or universal memory quality.
