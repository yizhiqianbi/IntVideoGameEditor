#!/usr/bin/env python3
"""Offline tokenizer-family reference counts; never identifies a model's weights.

prepare: fetch pinned, public tokenizer data (no model weights or remote code).
compare: compare externally observed *native* input-token counts to the reference.
self-test: exercise only synthetic, clearly labelled matching fixtures.
"""
import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import statistics
import sys
import urllib.request

ROOT = Path(__file__).resolve().parent
ASSETS = ROOT / 'tokenizer-assets'
TOTAL_LIMIT = 30_000_000
SOURCES = [
    dict(family='cl100k_base', file='cl100k_base.tiktoken',
         url='https://openaipublic.blob.core.windows.net/encodings/cl100k_base.tiktoken',
         revision='tiktoken 0.12.0 encoding data hash',
         expected_sha256='223921b76ee99bde995b7ff738513eef100fb51d18c93597a113bcffe865b2a7'),
    dict(family='o200k_base', file='o200k_base.tiktoken',
         url='https://openaipublic.blob.core.windows.net/encodings/o200k_base.tiktoken',
         revision='tiktoken 0.12.0 encoding data hash',
         expected_sha256='446a9538cb6c348e3516120d7c08b09f57c36495e2acfffe59a5bf8b0cfb1a2d'),
    dict(family='qwen3', file='qwen3-tokenizer.json',
         url='https://huggingface.co/Qwen/Qwen3-0.6B/resolve/c1899de289a04d12100db370d81485cdf75e47ca/tokenizer.json',
         revision='c1899de289a04d12100db370d81485cdf75e47ca'),
    dict(family='deepseek_v3', file='deepseek-v3-tokenizer.json',
         url='https://huggingface.co/deepseek-ai/DeepSeek-V3/resolve/e815299b0bcbac849fa540c768ef21845365c9eb/tokenizer.json',
         revision='e815299b0bcbac849fa540c768ef21845365c9eb'),
]

# These are inert payloads. Send exactly the UTF-8 text, without added instructions,
# only where a real native usage counter is available. No self-reported counts.
PROBES = [
    ('zh_common', 'Chinese, common', '我刚到家，今天有点累。你在做什么？晚饭想吃番茄鸡蛋面。'),
    ('zh_rare', 'Chinese, rare characters', '龘靐齉爩麤灪籲爨癵骉鱻羴犇猋骉毳淼焱垚'),
    ('zh_traditional', 'Chinese, traditional', '臺灣圖書館裡的貓咪正在觀察窗外飄落的楓葉。'),
    ('zh_mixed', 'Chinese/English/punctuation', '模型A的tokenization不等于模型B：hello世界，v2.71828，2026年10月14日。'),
    ('en_morphology', 'English morphology', 'Antidisestablishmentarianism, counterrevolutionaries, uncharacteristically, incomprehensibility.'),
    ('code', 'Python code', 'def greet(user_name: str) -> str:\n\treturn f"Hello, {user_name.strip()}!"\n\nprint(greet("Ada"))'),
    ('digits', 'Long digit runs', '012345678901234567890123456789 314159265358979323846264338327 987654321098765432109876543210'),
    ('numbers', 'Numbers and separators', '-1.23456789e+10 0xDEADBEEF 1_000_000 2026-10-14T12:34:56.789Z 123/456/789'),
    ('whitespace', 'Whitespace and indentation', 'a b  c   d    e\n\n\tf\t\tg\r\nh\u00a0i\u2009j'),
    ('emoji', 'Emoji, ZWJ and modifiers', '🙂🙃🫠🥹🧋🧸✨ 👩🏽‍💻 👨‍👩‍👧‍👦 🇨🇳 🇯🇵 ❤️'),
    ('unicode_nfc', 'Unicode NFC', 'café naïve résumé Ångström élève coöperate'),
    ('unicode_nfd', 'Unicode NFD', 'cafe\u0301 nai\u0308ve re\u0301sume\u0301 A\u030angstro\u0308m e\u0301le\u0300ve coo\u0308perate'),
]

def dump(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

def fetch_assets():
    ASSETS.mkdir(exist_ok=True)
    previous = {}
    manifest_path = ROOT / 'tokenizer-sources.json'
    if manifest_path.exists():
        previous = {s['file']: s for s in json.loads(manifest_path.read_text())['sources']}
    manifest, total = [], 0
    for source in SOURCES:
        dest = ASSETS / source['file']
        if dest.exists():
            raw = dest.read_bytes()
        else:
            req = urllib.request.Request(source['url'], headers={'User-Agent': 'TokenizerFingerprintResearch/1.0'})
            with urllib.request.urlopen(req, timeout=60) as response:
                raw = response.read(TOTAL_LIMIT - total + 1)
            if total + len(raw) > TOTAL_LIMIT:
                raise RuntimeError('Tokenizer data exceeds 30 MB cap')
            dest.write_bytes(raw)
        total += len(raw)
        if total > TOTAL_LIMIT:
            raise RuntimeError('Tokenizer data exceeds 30 MB cap')
        digest = hashlib.sha256(raw).hexdigest()
        expected = source.get('expected_sha256') or previous.get(source['file'], {}).get('sha256')
        if expected and expected != digest:
            raise RuntimeError('SHA-256 mismatch: ' + source['file'])
        manifest.append(dict(source, bytes=len(raw), sha256=digest))
    result = dict(recorded_date='2026-10-14', total_asset_bytes=total, sources=manifest)
    dump(manifest_path, result)
    return result

def prepare():
    # Optional isolated dependency path. No model repository code is imported.
    if os.environ.get('TOKENIZER_RUNTIME'):
        sys.path.insert(0, os.environ['TOKENIZER_RUNTIME'])
    import tiktoken
    import tiktoken_ext.openai_public as official
    from tiktoken.load import load_tiktoken_bpe
    from tokenizers import Tokenizer
    sources = fetch_assets()

    # Replace only the official package's data-loader so constructors use our
    # locally hashed encoding files, retaining the package's exact regex/specials.
    original_loader = official.load_tiktoken_bpe
    official.load_tiktoken_bpe = lambda url, expected_hash=None: load_tiktoken_bpe(
        str(ASSETS / url.rsplit('/', 1)[-1]), expected_hash=expected_hash)
    try:
        encoders = {
            name: tiktoken.Encoding(**getattr(official, name)())
            for name in ['cl100k_base', 'o200k_base']
        }
    finally:
        official.load_tiktoken_bpe = original_loader
    encoders['qwen3'] = Tokenizer.from_file(str(ASSETS / 'qwen3-tokenizer.json'))
    encoders['deepseek_v3'] = Tokenizer.from_file(str(ASSETS / 'deepseek-v3-tokenizer.json'))

    rows = []
    for ident, category, text in PROBES:
        ids = {}
        for family, enc in encoders.items():
            if family in ['cl100k_base', 'o200k_base']:
                ids[family] = enc.encode(text, disallowed_special=())
            else:
                ids[family] = enc.encode(text, add_special_tokens=False).ids
        rows.append(dict(id=ident, category=category, text=text,
                         utf8_bytes=len(text.encode()), unicode_codepoints=len(text),
                         sha256_utf8=hashlib.sha256(text.encode()).hexdigest(),
                         counts={family: len(value) for family, value in ids.items()},
                         token_ids=ids))
    result = dict(kind='offline_reference_only', target='DZMM',
                  target_usage_observed=False, target_identity=None,
                  encoding_policy='Raw text; no chat template; no BOS/EOS; add_special_tokens=False; no external Unicode normalization; official tokenizer-internal normalization is preserved.',
                  packages={m: importlib.metadata.version(m) for m in ['tiktoken', 'tokenizers']},
                  families=list(encoders), sources_file='tokenizer-sources.json', probes=rows)
    dump(ROOT / 'tokenizer-baseline.json', result)
    dump(ROOT / 'observations-template.json', dict(
        status='UNOBSERVED_TEMPLATE_NOT_TARGET_DATA', measurement_type=None,
        overhead_assumption=None,
        notes='Use native input/prompt tokens only; keep hidden prompt/history/worldbook/template/normalization fixed. Do not use model self-reported counts or SSE chunk counts.',
        observations={r['id']: None for r in rows}))
    table = ['# Offline tokenizer reference counts', '',
             '**No DZMM native token usage has been observed by this kit. This is not model identification.**', '',
             '| ID | Category | cl100k | o200k | Qwen3 | DeepSeek V3 |',
             '|---|---|---:|---:|---:|---:|']
    for row in rows:
        table.append('| ' + ' | '.join([row['id'], row['category']] + [str(row['counts'][f]) for f in encoders]) + ' |')
    table += ['', 'The exact UTF-8 text, hashes, and token IDs are in `tokenizer-baseline.json`. Counts exclude message wrappers and special tokens.', '',
              '## Pairwise separation after an unknown constant offset', '',
              'For each pair, the range below is max(count difference) minus min(count difference) across the 12 probes. A nonzero range means these finite reference vectors cannot be made identical by adding one constant. It does not establish separation from all other tokenizers or shared-tokenizer models.', '',
              '| Pair | Range of count differences |', '|---|---:|']
    families = list(encoders)
    for i, a in enumerate(families):
        for b in families[i + 1:]:
            delta = [r['counts'][a] - r['counts'][b] for r in rows]
            table.append('| %s / %s | %s |' % (a, b, max(delta) - min(delta)))
    (ROOT / 'tokenizer-probes.md').write_text('\n'.join(table) + '\n')
    print(json.dumps(dict(families=families, probes=len(rows), asset_bytes=sources['total_asset_bytes']), indent=2))

def compare_data(reference, observations, tolerance=0, allow_offset=True):
    observed = observations.get('observations', {})
    invalid = {k: v for k, v in observed.items()
               if v is not None and (isinstance(v, bool) or not isinstance(v, int) or v < 0)}
    if invalid:
        raise ValueError('Native token counts must be nonnegative integers or null: ' + str(list(invalid)))
    rows = [r for r in reference['probes'] if observed.get(r['id']) is not None]
    unknown_ids = sorted(set(observed) - {r['id'] for r in reference['probes']})
    if not rows:
        return dict(status='insufficient_data', observed_count=0, compatible_families=[],
                    target_model_identity=None, ignored_unknown_ids=unknown_ids)
    scores = []
    for family in reference['families']:
        deltas = [observed[r['id']] - r['counts'][family] for r in rows]
        offset = statistics.median(deltas) if allow_offset else 0
        residuals = [delta - offset for delta in deltas]
        max_error = max(abs(r) for r in residuals)
        scores.append(dict(family=family, fitted_constant_offset=offset,
                           max_absolute_residual=max_error,
                           mean_absolute_residual=sum(abs(r) for r in residuals) / len(rows),
                           compatible=max_error <= tolerance))
    scores.sort(key=lambda s: (s['max_absolute_residual'], s['mean_absolute_residual'], s['family']))
    compatible = [s['family'] for s in scores if s['compatible']]
    trusted_type = observations.get('measurement_type') == 'native_prompt_tokens'
    fixed = observations.get('overhead_assumption') == 'fixed'
    if len(rows) < 3:
        status = 'insufficient_data'
    elif not trusted_type or (allow_offset and not fixed):
        status = 'unvalidated_measurement_assumptions'
    elif not compatible:
        status = 'unknown_or_pipeline_mismatch'
    elif len(compatible) > 1:
        status = 'candidate_tie'
    else:
        status = 'compatible_single_reference_family_NOT_model_identity'
    return dict(status=status, observed_count=len(rows), missing_count=len(reference['probes']) - len(rows),
                compatible_families=compatible, candidate_scores=scores, target_model_identity=None,
                ignored_unknown_ids=unknown_ids, tolerance=tolerance,
                warning='A tokenizer match cannot identify model weights, size, vendor, fine-tune or routing. An offset is valid only for fixed hidden prompt/history/worldbook/template/normalization; token-boundary merges may also violate the assumption.')

def self_test(reference):
    base = dict(measurement_type='native_prompt_tokens', overhead_assumption='fixed')
    first = reference['families'][0]
    obs = {r['id']: r['counts'][first] + 37 for r in reference['probes']}
    cases = []
    def check(name, ref, data, expected):
        result = compare_data(ref, data)
        assert result['status'] == expected, (name, result)
        cases.append(dict(name=name, expected=expected, observed=result['status'], passed=True))
    check('synthetic_exact_family_plus_37', reference, dict(base, observations=obs),
          'compatible_single_reference_family_NOT_model_identity')
    missing = dict(obs)
    for r in reference['probes'][:2]:
        missing[r['id']] = None
    check('synthetic_two_missing_counts', reference, dict(base, observations=missing),
          'compatible_single_reference_family_NOT_model_identity')
    tie = json.loads(json.dumps(reference))
    tie['families'] = [first, 'synthetic_duplicate_tokenizer']
    for r in tie['probes']:
        r['counts']['synthetic_duplicate_tokenizer'] = r['counts'][first]
    check('synthetic_shared_tokenizer_tie', tie, dict(base, observations=obs), 'candidate_tie')
    corrupted = dict(obs)
    corrupted[reference['probes'][0]['id']] += 1000
    check('synthetic_out_of_set_or_bad_pipeline', reference, dict(base, observations=corrupted), 'unknown_or_pipeline_mismatch')
    check('all_missing', reference, dict(base, observations={}), 'insufficient_data')
    check('synthetic_one_count', reference, dict(base, observations={reference['probes'][0]['id']: 100}), 'insufficient_data')
    check('missing_native_measurement_declaration', reference, dict(observations=obs), 'unvalidated_measurement_assumptions')
    result = dict(kind='SYNTHETIC_OFFLINE_TESTS_NOT_DZMM_DATA', cases=cases, all_passed=True)
    dump(ROOT / 'offline-self-test-results.json', result)
    print(json.dumps(result, indent=2))

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['prepare', 'compare', 'self-test'])
    parser.add_argument('--observations', type=Path)
    parser.add_argument('--tolerance', type=int, default=0)
    parser.add_argument('--no-offset', action='store_true')
    args = parser.parse_args()
    if args.tolerance < 0:
        parser.error('tolerance must be nonnegative')
    if args.command == 'prepare':
        prepare()
        return
    reference = json.loads((ROOT / 'tokenizer-baseline.json').read_text())
    if args.command == 'self-test':
        self_test(reference)
    else:
        if args.observations is None:
            parser.error('--observations is required for compare')
        observations = json.loads(args.observations.read_text())
        print(json.dumps(compare_data(reference, observations, args.tolerance, not args.no_offset), ensure_ascii=False, indent=2))

if __name__ == '__main__':
    main()
