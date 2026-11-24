# Output Eval Status

- Updated: 2026-08-03
- Cases: 15
- Evidence kind: behavior specification
- Provider-backed runs: `missing evidence`
- Human blind review: `missing evidence`

The current cases cover fifteen high-risk behaviors: fabricated metrics, crawl/index control confusion, audit-only authorization, AI-search folklore and freshness, static-versus-rendered evidence, large-site overclaim, premature causality, IndexNow semantics, schema-versus-feature eligibility, field-versus-lab performance, Search Console incompleteness, international/ecommerce signal conflicts, programmatic launch gates, and destructive content pruning. They define regression expectations but do not prove that any model consistently passes them.

Before a public quality claim, run baseline and with-skill outputs through the same cases, preserve provider/model metadata, and use a blind review pack when subjective quality is compared.
