# Qiaomu SEO 1.2 Upgrade Handoff

## Result

- Skill: `qiaomu-seo` 1.2.0
- Job: current-source, evidence-bound SEO research, auditing, implementation, experimentation, and verification across web and AI-search surfaces
- Status: upgraded locally; not published to GitHub

## Reference skills studied

### `coreyhaines31/marketingskills@seo-audit`

- Signal: 177.3K skills.sh installs on 2026-08-03.
- Learned: diagnose blockers in dependency order, inspect rendered output, and finish with prioritized actions.
- Applied in: `SKILL.md`, `references/technical-seo.md`, and `references/audit-playbook.md`.
- Rejected: universal title/meta/H1/word-count tests.

### `coreyhaines31/marketingskills@programmatic-seo`

- Signal: 112.5K skills.sh installs on 2026-08-03.
- Learned: page-specific value, defensible data, crawlable architecture, and post-launch monitoring matter more than URL count.
- Applied in: `references/content-quality.md` programmatic launch gate.
- Rejected: universal subfolder superiority and unsourced demand/authority assumptions.

### `agricidaniel/claude-seo@seo-ecommerce`

- Signal: 3.5K skills.sh installs on 2026-08-03.
- Learned: optional live-data degradation, cost boundaries, product/variant checks, and marketplace-specific evidence.
- Applied in: `references/international-commerce.md` and the engine/surface output contract.
- Rejected: fixed content thresholds, weighted SEO scores, one-vendor dependency, and mixing paid Shopping with organic SEO.

### `affaan-m/ECC@seo`

- Signal: SkillsMP discovery; 233,627 stars belong to the repository, not the skill.
- Learned: concise findings tied directly to implementation actions.
- Applied in: audit finding/action contract.
- Rejected: repository popularity as quality evidence and checklist certainty without source scope.

## Web knowledge research

- Reviewed 33 official sources across 10 official domains.
- Corrected a stale 1.1 Google generative-AI reporting claim.
- Added current feature lifecycle, provider bot separation, Search Console data limits, schema/feature separation, IndexNow semantics, vertical search, international/ecommerce, and experiment design.
- Full record: `reports/seo-knowledge-research.md`.

## Absorbed, rejected, and invented

- `keep`: dependency ordering, rendered evidence, page-specific value, graceful data-source degradation, and actionable output.
- `adapt`: provider mechanics become dated source-backed rules; programmatic and ecommerce advice gains staged rollout and surface separation.
- `reject`: universal thresholds/scores, fabricated metrics, platform guarantees, vendor lock-in, and stale AI/structured-data folklore.
- `invent`: official-source freshness registry, stale-claim validator, engine/crawler matrix, experiment gate, content lifecycle ledger, and four-stage outcome verification.

## Advantages and highlights

- `design advantage`: mutable SEO knowledge has an official source, stability class, review cadence, and lifecycle state. Evidence: `data/seo-source-registry.json`.
- `design advantage`: package validation can fail when a deprecated claim re-enters `SKILL.md` or references. Evidence: `scripts/validate_knowledge.py`.
- `design advantage`: Search discovery, model training, and user-triggered agent access are separate decisions. Evidence: `references/engine-matrix.md`.
- `design advantage`: Schema.org syntax, platform feature eligibility, and observed appearance remain distinct. Evidence: `SKILL.md` and `references/official-sources.md`.
- `design advantage`: programmatic publishing and destructive pruning require staged evidence and rollback. Evidence: `references/content-quality.md`.
- `validated advantage`: route evaluation passed 30/30 with no false positives or false negatives; all 9 unit tests passed; strict freshness validation passed for 33 sources and 4 lifecycle facts; the audit fixture and both package validators passed with zero warnings.
- `hypothesis`: freshness gates and specialist modules should reduce stale or overgeneralized SEO advice, but provider-backed output comparison remains missing evidence.

## Verification and limits

- Source registry: 33 official sources; 4 lifecycle facts; strict run passed with no overdue sources, failures, or warnings.
- Unit tests: 9/9 passed.
- Trigger evaluation: 30/30 passed; 0 false positives; 0 false negatives.
- Output behavior specifications: 15 cases; provider-backed execution missing evidence.
- Audit fixture: passed with no failures or warnings.
- Package validation: local and Qiaomu Meta validators passed with zero failures and zero warnings.
- Human blind comparison and live-site benchmark: missing evidence.
- Publication/install from GitHub: not performed; local package only.
