# Local compatibility patch

Base: `Mai-with-u/MaiBot` commit `ac6ed61b7b9c971ad94921de3b16fa6f63c36a20` (version 1.3.9).

`0001-metadata-json-scope.patch` is a narrow runtime compatibility repair permitted by the bundled `src/A_memorix/MODIFICATION_POLICY.md` local-exception rule. It is transparently maintained here; it has not been submitted upstream. This deployment is native MaiBot plus this patch, not an untouched checkout.

The real native test conversation stored a synthetic tea preference through `memory_flow_service`, with the correct session ID in JSON metadata. Native `query_memory` and the native WebUI aggregate query nevertheless returned no hits. `MetadataStore.query()` returns the metadata SQLite column as a JSON string, while `_paragraph_scope_identity()` called `coerce_metadata_dict()`, which accepts only mappings. This discarded ownership before constructing the retrieval scope and excluded valid `person_fact` rows. Native profile lookup followed a different path and did return the fact, which is why a plausible spoken answer alone did not validate search.

The patch decodes a string metadata field in `_paragraph_scope_identity()` before the existing mapping check. It does not change prompts, ranking, embedding, memory writing, sharing policy or invalid-data fallback. Invalid JSON and JSON values that are not objects remain unknown scope. Other chats stay excluded; intentionally global data retains its existing semantics.

The new tests use the real SQLite MetadataStore with current-chat and other-chat person facts, explicit global metadata, seven malformed/non-object cases and an already-decoded mapping. Before the fix the real-store regression failed; after the fix the targeted regression, existing graph/search tests and shared-memory host tests passed: 48 tests. Evidence: `../evidence/memory-scope-patch-tests-2026-10-18.json`.

Apply from the pinned upstream source directory:

```sh
git apply --check ../patches/0001-metadata-json-scope.patch
git apply ../patches/0001-metadata-json-scope.patch
```

An installer should first check whether `git apply --reverse --check` succeeds to detect an already-applied patch. On a different base commit or a patch conflict, stop with a visible error instead of applying a fuzzy replacement. Restart the native process after applying it; the currently running Python process retains old imported code until restarted.
