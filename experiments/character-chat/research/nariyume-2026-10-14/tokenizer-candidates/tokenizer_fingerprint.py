#!/usr/bin/env python3
"""Strictly offline tokenizer-family references and NariYume usage matching.

No network client, browser, inference request, or tokenizer download is used.
Shared tokenizer assets are official reference data, not DZMM observations.
"""
import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import random
import statistics
import sys

ROOT = Path(__file__).resolve().parent
REFERENCE_ROOT = ROOT.parent.parent / 'dzmm-2026-10-14' / 'model-fingerprint-2026-10-14'
DEFAULT_ASSETS = REFERENCE_ROOT / 'tokenizer-assets'

def dump(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

def load_encoders(asset_dir):
    runtime = os.environ.get('TOKENIZER_RUNTIME', '/tmp/dzmm-tokenizer-fingerprint-runtime')
    if Path(runtime).is_dir():
        sys.path.insert(0, runtime)
    import tiktoken
    import tiktoken_ext.openai_public as official
    from tiktoken.load import load_tiktoken_bpe
    from tokenizers import Tokenizer
    manifest = json.loads((ROOT / 'tokenizer-sources.json').read_text())
    verified = []
    for source in manifest['sources']:
        path = asset_dir / source['file']
        data = path.read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        if digest != source['sha256']:
            raise ValueError('Reference asset SHA-256 mismatch: ' + str(path))
        verified.append(dict(file=source['file'], bytes=len(data), sha256=digest))
    original_loader = official.load_tiktoken_bpe
    official.load_tiktoken_bpe = lambda url, expected_hash=None: load_tiktoken_bpe(
        str(asset_dir / url.rsplit('/', 1)[-1]), expected_hash=expected_hash)
    try:
        encoders = {name: tiktoken.Encoding(**getattr(official, name)())
                    for name in ['cl100k_base', 'o200k_base']}
    finally:
        official.load_tiktoken_bpe = original_loader
    encoders['qwen3'] = Tokenizer.from_file(str(asset_dir / 'qwen3-tokenizer.json'))
    encoders['deepseek_v3'] = Tokenizer.from_file(str(asset_dir / 'deepseek-v3-tokenizer.json'))
    return encoders, verified

def ids_for(encoders, text):
    return {family: (enc.encode(text, disallowed_special=())
                     if family in ['cl100k_base', 'o200k_base']
                     else enc.encode(text, add_special_tokens=False).ids)
            for family, enc in encoders.items()}

def score_vectors(counts, observations, tolerance, allow_offset):
    scores = []
    for family, vector in counts.items():
        deltas = [actual - expected for actual, expected in zip(observations, vector)]
        offset = statistics.median(deltas) if allow_offset else 0
        residuals = [delta - offset for delta in deltas]
        scores.append(dict(family=family, fitted_constant_offset=offset,
                           max_absolute_residual=max(abs(v) for v in residuals),
                           mean_absolute_residual=sum(abs(v) for v in residuals) / len(residuals)))
    scores.sort(key=lambda v: (v['max_absolute_residual'], v['mean_absolute_residual'], v['family']))
    compatible = [s['family'] for s in scores if s['max_absolute_residual'] <= tolerance]
    return scores, compatible

def validate_count(value):
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError('Usage counts must be nonnegative native integer counts')
    return value

def status_for(count, trusted, compatible):
    if count < 3:
        return 'insufficient_data'
    if not trusted:
        return 'unvalidated_measurement_assumptions'
    if not compatible:
        return 'unknown_or_pipeline_mismatch'
    if len(compatible) > 1:
        return 'candidate_tie'
    return 'compatible_single_reference_family_NOT_model_identity'

def prepare(asset_dir):
    encoders, verified = load_encoders(asset_dir)
    # Reuse ONLY inert input text and official-reference sources, never target data.
    original = json.loads((REFERENCE_ROOT / 'tokenizer-baseline.json').read_text())
    probes = [(r['id'], r['category'], r['text']) for r in original['probes']]
    seeded = random.Random(20261014)
    probes += [
        ('random_ascii', 'Seeded random ASCII', ''.join(seeded.choice('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-/+=') for _ in range(128))),
        ('random_hex', 'Seeded random hexadecimal', ''.join(seeded.choice('0123456789abcdef') for _ in range(128))),
        ('chat_chinese', 'Chinese chat with emotion label', '[playful] 你终于回来啦。\n\n我刚煮好一杯热可可，给你留了一半 🥹'),
        ('chat_english', 'English chat with emotion label', '[happy] You\'re back!\n\nI made hot chocolate. Come sit with me 🧸'),
    ]
    rows = []
    for ident, category, value in probes:
        ids = ids_for(encoders, value)
        rows.append(dict(id=ident, category=category, text=value,
                         utf8_bytes=len(value.encode()), unicode_codepoints=len(value),
                         sha256_utf8=hashlib.sha256(value.encode()).hexdigest(),
                         counts={family: len(tokens) for family, tokens in ids.items()}, token_ids=ids))
    families = list(encoders)
    result = dict(kind='OFFLINE_REFERENCE_NOT_NARIYUME_OR_DZMM_OBSERVATIONS',
                  target='NariYume', target_usage_observed=False, target_model_identity=None,
                  input_policy='Exact raw UTF-8 text; no external normalization; official internal normalization retained; no chat template, BOS/EOS or added special tokens.',
                  packages={name: importlib.metadata.version(name) for name in ['tiktoken', 'tokenizers']},
                  families=families, verified_assets=verified, probes=rows)
    dump(ROOT / 'tokenizer-baseline.json', result)
    dump(ROOT / 'prompt-observations-template.json', dict(
        kind='UNOBSERVED_TEMPLATE_NOT_NARIYUME_DATA', measurement_type=None,
        overhead_assumption=None, native_counter_source=None,
        observations={r['id']: None for r in rows}))
    dump(ROOT / 'completion-observations-template.json', dict(
        kind='UNOBSERVED_TEMPLATE_NOT_NARIYUME_DATA', measurement_type=None,
        completion_scope=None, fixed_special_token_offset_verified=False,
        native_counter_source=None,
        observations=[dict(id='capture_1', raw_completion_text=None, completion_tokens=None,
                           reasoning_tokens=None, model=None, provider=None)]))
    table = ['# 离线 tokenizer 参考向量', '',
             '以下为本地官方 tokenizer 实测，不是 NariYume/DZMM 的目标观测。', '',
             '| ID | cl100k | o200k | Qwen3 | DeepSeek V3 |', '|---|---:|---:|---:|---:|']
    table += ['| ' + ' | '.join([r['id']] + [str(r['counts'][f]) for f in families]) + ' |' for r in rows]
    separations = []
    for i, a in enumerate(families):
        for b in families[i + 1:]:
            differences = [r['counts'][a] - r['counts'][b] for r in rows]
            separations.append(dict(pair=[a, b], count_difference_range=max(differences)-min(differences)))
    result['pairwise_fixed_offset_separation'] = separations
    dump(ROOT / 'tokenizer-baseline.json', result)
    table += ['', '参考向量允许常量偏移后仍可分；未覆盖候选不能被排除。', '',
              '| Pair | 差值范围 |', '|---|---:|']
    table += ['| ' + ' / '.join(s['pair']) + ' | ' + str(s['count_difference_range']) + ' |' for s in separations]
    (ROOT / 'tokenizer-probes.md').write_text('\n'.join(table) + '\n', encoding='utf-8')
    print(json.dumps(dict(status='offline_reference_prepared', probes=len(rows), families=families,
                          target_observations=0, asset_bytes=sum(r['bytes'] for r in verified)), indent=2))

def compare_prompt(path, tolerance, no_offset):
    reference = json.loads((ROOT / 'tokenizer-baseline.json').read_text())
    data = json.loads(path.read_text())
    actual = data.get('observations', {})
    rows = [r for r in reference['probes'] if actual.get(r['id']) is not None]
    if not rows:
        return dict(status='insufficient_data', observed_count=0, target_model_identity=None)
    observed = [validate_count(actual[r['id']]) for r in rows]
    vectors = {family: [r['counts'][family] for r in rows] for family in reference['families']}
    scores, compatible = score_vectors(vectors, observed, tolerance, not no_offset)
    trusted = (data.get('measurement_type') == 'native_prompt_tokens'
               and bool(data.get('native_counter_source'))
               and (no_offset or data.get('overhead_assumption') == 'fixed'))
    return dict(status=status_for(len(rows), trusted, compatible), observed_count=len(rows),
                compatible_families=compatible, candidate_scores=scores, target_model_identity=None,
                warning='Fixed prompt/history/summary/dynamic/time/normalization/routing must be verified. Consecutive NariYume turns do not hold these fixed. BPE boundary merges may violate constant-offset assumptions.')

def compare_completion(path, asset_dir, tolerance, allow_offset):
    data = json.loads(path.read_text())
    rows = [r for r in data.get('observations', [])
            if r.get('completion_tokens') is not None and r.get('raw_completion_text') is not None]
    if not rows:
        return dict(status='insufficient_data', observed_count=0, target_model_identity=None)
    encoders, _ = load_encoders(asset_dir)
    counts = {family: [] for family in encoders}
    observed = []
    for row in rows:
        if not isinstance(row['raw_completion_text'], str):
            raise ValueError('raw_completion_text must be exact response JSON content string')
        ids = ids_for(encoders, row['raw_completion_text'])
        for family, tokens in ids.items():
            counts[family].append(len(tokens))
        observed.append(validate_count(row['completion_tokens']))
    scores, compatible = score_vectors(counts, observed, tolerance, allow_offset)
    trusted = (data.get('measurement_type') == 'native_completion_tokens'
               and data.get('completion_scope') == 'visible_raw_content_only'
               and bool(data.get('native_counter_source'))
               and (not allow_offset or data.get('fixed_special_token_offset_verified') is True))
    return dict(status=status_for(len(rows), trusted, compatible), observed_count=len(rows),
                compatible_families=compatible, candidate_scores=scores,
                raw_completion_reference_counts=counts, target_model_identity=None,
                warning='Use pre-parser raw content, not displayed bubbles. Reasoning/tool/EOS/filtered text can be counted but absent from visible content. Prompt drift is avoided here, but provider usage semantics and shared tokenizer still limit attribution.')

def self_test():
    ref = json.loads((ROOT / 'tokenizer-baseline.json').read_text())
    cases = []
    for family in ref['families']:
        counts = {f: [r['counts'][f] for r in ref['probes']] for f in ref['families']}
        _, matches = score_vectors(counts, [r['counts'][family]+37 for r in ref['probes']], 0, True)
        assert matches == [family], (family, matches)
        cases.append(dict(kind='SYNTHETIC_NOT_TARGET_DATA', family=family, matches=matches, passed=True))
    _, matches = score_vectors({'a':[1,2,3], 'b':[1,2,3]}, [9,10,11], 0, True)
    assert matches == ['a', 'b']
    cases.append(dict(kind='SYNTHETIC_NOT_TARGET_DATA', shared_tokenizer_tie=True, passed=True))
    output = dict(kind='SYNTHETIC_OFFLINE_TESTS_NOT_NARIYUME_OR_DZMM_DATA', all_passed=True, cases=cases)
    dump(ROOT / 'offline-self-test-results.json', output)
    print(json.dumps(output, indent=2))

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['prepare', 'prompt', 'completion', 'self-test'])
    parser.add_argument('--assets', type=Path, default=DEFAULT_ASSETS)
    parser.add_argument('--observations', type=Path)
    parser.add_argument('--tolerance', type=int, default=0)
    parser.add_argument('--no-offset', action='store_true', help='Prompt comparison without fixed hidden overhead')
    parser.add_argument('--completion-offset', action='store_true', help='Only with verified fixed EOS/special token inclusion')
    args = parser.parse_args()
    if args.tolerance < 0:
        parser.error('tolerance cannot be negative')
    if args.command == 'prepare':
        prepare(args.assets)
    elif args.command == 'self-test':
        self_test()
    else:
        if args.observations is None:
            parser.error('--observations is required')
        output = (compare_prompt(args.observations, args.tolerance, args.no_offset)
                  if args.command == 'prompt'
                  else compare_completion(args.observations, args.assets, args.tolerance, args.completion_offset))
        print(json.dumps(output, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    main()
