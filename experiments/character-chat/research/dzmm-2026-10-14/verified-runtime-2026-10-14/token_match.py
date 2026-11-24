#!/usr/bin/env python3
"""Offline reference-tokenizer comparison for saved official assembly diagnostics.

Consumes saved JSON/text only. Does not access browser, network, or model APIs.
Never maps a compatible tokenizer to model weights/provider.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
REFERENCE = ROOT.parent / 'model-fingerprint-2026-10-14'
FAMILIES = ['cl100k_base', 'o200k_base', 'qwen3', 'deepseek_v3']


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_encoders():
    runtime = os.environ.get('TOKENIZER_RUNTIME', '/tmp/dzmm-tokenizer-fingerprint-runtime')
    if Path(runtime).is_dir():
        sys.path.insert(0, runtime)
    import tiktoken
    import tiktoken_ext.openai_public as official
    from tiktoken.load import load_tiktoken_bpe
    from tokenizers import Tokenizer
    assets = REFERENCE / 'tokenizer-assets'
    manifest = json.loads((REFERENCE / 'tokenizer-sources.json').read_text())
    for source in manifest['sources']:
        if digest(assets / source['file']) != source['sha256']:
            raise ValueError('Reference asset digest mismatch: ' + source['file'])
    original_loader = official.load_tiktoken_bpe
    official.load_tiktoken_bpe = lambda url, expected_hash=None: load_tiktoken_bpe(
        str(assets / url.rsplit('/', 1)[-1]), expected_hash=expected_hash)
    try:
        encoders = {name: tiktoken.Encoding(**getattr(official, name)())
                    for name in FAMILIES[:2]}
    finally:
        official.load_tiktoken_bpe = original_loader
    encoders['qwen3'] = Tokenizer.from_file(str(assets / 'qwen3-tokenizer.json'))
    encoders['deepseek_v3'] = Tokenizer.from_file(str(assets / 'deepseek-v3-tokenizer.json'))
    extra_sources = ROOT / 'deepseek-v3.1-sources.json'
    if extra_sources.exists():
        for source in json.loads(extra_sources.read_text()):
            if digest(ROOT/source['file']) != source['sha256']:
                raise ValueError('DeepSeek-V3.1 reference digest mismatch')
        encoders['deepseek_v3_1'] = Tokenizer.from_file(str(ROOT/'deepseek-v3.1-tokenizer.json'))
    return encoders


def token_count(family, encoder, text):
    if family in FAMILIES[:2]:
        return len(encoder.encode(text, disallowed_special=()))
    return len(encoder.encode(text, add_special_tokens=False).ids)


def official_deepseek_template_count(encoder, messages):
    # Transcribe only the published text-only branches, without running its Jinja.
    # This is a reference template, not an assertion about DZMM serialization.
    config_path = ROOT / 'deepseek-v3-tokenizer-config.json'
    source_path = ROOT / 'deepseek-v3-template-source.json'
    if not config_path.exists() or not source_path.exists():
        return None
    source = json.loads(source_path.read_text())
    if digest(config_path) != source['sha256']:
        raise ValueError('Official template config digest mismatch')
    if any(m['role'] not in ['system', 'user', 'assistant'] for m in messages):
        return None
    config = json.loads(config_path.read_text())
    bos = config['bos_token']
    if isinstance(bos, dict):
        bos = bos['content']
    serialized = bos + '\n\n'.join(m['content'] for m in messages if m['role']=='system')
    for message in messages:
        if message['role'] == 'user':
            serialized += '<｜User｜>' + message['content']
        elif message['role'] == 'assistant':
            serialized += '<｜Assistant｜>' + message['content'] + '<｜end▁of▁sentence｜>'
    serialized += '<｜Assistant｜>'  # add_generation_prompt=True
    return token_count('deepseek_v3', encoder, serialized)


def match_sample(encoders, assembly_path, metadata_path):
    assembly_path, metadata_path = Path(assembly_path), Path(metadata_path)
    messages = json.loads(assembly_path.read_text())
    metadata = json.loads(metadata_path.read_text())
    if not isinstance(messages, list) or not all(
            isinstance(m.get('content'), str) and isinstance(m.get('role'), str)
            for m in messages):
        raise ValueError('Expected a list of text role/content messages')
    observed = metadata['config']['prompt_tokens']
    rows = []
    for family, encoder in encoders.items():
        counts = [token_count(family, encoder, m['content']) for m in messages]
        rows.append(dict(family=family, per_message_content_tokens=counts,
                         content_token_sum=sum(counts),
                         observed_minus_content_sum=observed-sum(counts),
                         direct_concatenation_tokens=token_count(
                             family, encoder, ''.join(m['content'] for m in messages)),
                         newline_concatenation_tokens=token_count(
                             family, encoder, '\n'.join(m['content'] for m in messages))))
    deepseek_template = official_deepseek_template_count(encoders['deepseek_v3'], messages)
    return dict(assembly_file=str(assembly_path.resolve()),
                official_deepseek_v3_template_tokens=deepseek_template,
                observed_minus_official_deepseek_template=(observed-deepseek_template if deepseek_template is not None else None),
                metadata_file=str(metadata_path.resolve()),
                assembly_sha256=digest(assembly_path), metadata_sha256=digest(metadata_path),
                roles=[m['role'] for m in messages],
                prefix_messages_sha256=hashlib.sha256(json.dumps(messages[:-1], ensure_ascii=False, sort_keys=True).encode()).hexdigest(),
                last_message_content_sha256=hashlib.sha256(messages[-1]['content'].encode()).hexdigest(),
                content_codepoints=[len(m['content']) for m in messages],
                observed_prompt_tokens=observed,
                observed_completion_tokens=metadata['config'].get('completion_tokens'),
                observed_cached_tokens=metadata['config'].get('cached_tokens'),
                displayed_model=metadata.get('displayedModel'),
                generation_id=metadata.get('generationId'), counts=rows)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sample', nargs=2, action='append', metavar=('ASSEMBLY', 'METADATA'),
                        help='Repeat for independent generation snapshots')
    parser.add_argument('--completion', nargs=2, action='append', metavar=('TEXT', 'METADATA'),
                        help='Optional exact saved generated text and its metadata')
    parser.add_argument('--output', type=Path, default=ROOT / 'token-match.json')
    args = parser.parse_args()
    encoders = load_encoders()
    samples = args.sample or [[ROOT/'assembly-final-input.json', ROOT/'generation-metadata.json']]
    result = dict(date='2026-10-14', kind='offline_comparison_of_official_UI_diagnostics',
                  target_model_identity=None, target_provider=None,
                  tokenization_policy='Each message content separately, without a chat template, BOS/EOS or externally added normalization; official tokenizer internal normalization retained.',
                  reference_sources=str((REFERENCE/'tokenizer-sources.json').resolve()),
                  additional_reference_sources=str((ROOT/'deepseek-v3.1-sources.json').resolve()) if (ROOT/'deepseek-v3.1-sources.json').exists() else None,
                  samples=[match_sample(encoders, *sample) for sample in samples],
                  completions=[], cross_sample_residuals=[])
    result['identical_prefix_messages_across_samples'] = len({s['prefix_messages_sha256'] for s in result['samples']}) == 1
    result['identical_role_sequences_across_samples'] = len({tuple(s['roles']) for s in result['samples']}) == 1
    for text_path, metadata_path in args.completion or []:
        text_path, metadata_path = Path(text_path), Path(metadata_path)
        output = text_path.read_text()
        metadata = json.loads(metadata_path.read_text())
        observed = metadata['config']['completion_tokens']
        result['completions'].append(dict(
            text_file=str(text_path.resolve()), text_sha256=digest(text_path),
            source_exactness='The script counts the saved text exactly, but cannot verify whether the UI preserved raw provider whitespace/Markdown.',
            metadata_file=str(metadata_path.resolve()),
            codepoints=len(output), observed_completion_tokens=observed,
            rows=[dict(family=f, content_tokens=token_count(f, e, output),
                       observed_minus_content_tokens=observed-token_count(f, e, output))
                  for f, e in encoders.items()]))
    for family in encoders:
        residuals = [next(r for r in s['counts'] if r['family']==family)['observed_minus_content_sum']
                     for s in result['samples']]
        result['cross_sample_residuals'].append(dict(family=family, residuals=residuals,
                                                    residual_range=max(residuals)-min(residuals)))
    result['limitations'] = [
        'Official UI usage is observed, but the provider origin/counting implementation is not independently known.',
        'A small constant residual is compatible with wrappers/special tokens; the exact chat template has not been observed.',
        'Same message count/roles does not guarantee identical hidden context. Compare saved assemblies, not assumed backgrounds.',
        'Tokenizer compatibility cannot identify weights, vendor, size, distillation, fine-tune, or routing.',
        'The finite reference set does not include every tokenizer or private/current Grok, Claude, or Gemini encodings.'
    ]
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps(dict(output=str(args.output), samples=len(result['samples']),
                          completions=len(result['completions']),
                          cross_sample_residuals=result['cross_sample_residuals']), indent=2))


if __name__ == '__main__':
    main()
