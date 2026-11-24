"""Adapt full AdaLN Turbo adapters to pruned H3's 8-channel time curve.

Run on GPU host with torch/safetensors installed (conversion uses CPU).
Grid source: Larryvrh/ComfyUI-MiniMax-H3-Turbo/h3_silu_temb_grid.safetensors.
Pass an existing grid file; this script does not download or replace originals.
"""
import argparse
import json
from pathlib import Path
import torch
from safetensors.torch import load_file, save_file
from safetensors import safe_open

parser = argparse.ArgumentParser()
parser.add_argument('--models', type=Path, default=Path('/root/ComfyUI/models'))
parser.add_argument('--grid', type=Path, required=True)
parser.add_argument('--source', type=Path, required=True)
args = parser.parse_args()
torch.set_num_threads(8)
grid_tensors = load_file(str(args.grid), device='cpu')
grid = next(v for v in grid_tensors.values() if tuple(v.shape) == (1025, 2688)).double()
original = load_file(str(args.source), device='cpu')
for mode in ['fl2va', 'ref2va']:
    model = args.models / 'diffusion_models' / f'minimax_h3_{mode}_pruned_int8_convrot.safetensors'
    with safe_open(str(model), framework='pt', device='cpu') as f:
        key = next(k for k in f.keys() if k.endswith('adaln_t_table'))
        table = f.get_tensor(key).double()
    x = torch.cat([table, torch.ones((len(table), 1), dtype=torch.float64)], dim=1)
    coefficients = torch.linalg.lstsq(x, grid).solution
    residual = float(torch.linalg.norm(x @ coefficients - grid) / torch.linalg.norm(grid))
    if residual > 0.005:
        raise ValueError(f'Unexpected time-grid fit error: {residual}')
    c = coefficients.float()
    result = dict(original)
    count = 0
    for key in original:
        if '.adaln_proj.linear.lora_A.weight' not in key:
            continue
        prefix = key.removesuffix('.lora_A.weight')
        a, b = original[key].float(), original[prefix + '.lora_B.weight'].float()
        alpha = original.get(prefix + '.alpha')
        scale = float(alpha) / a.shape[0] if alpha is not None else 1.0
        result[prefix + '.diff'] = (b @ (a @ c[:8].T) * scale).contiguous()
        result[prefix + '.diff_b'] = (b @ (a @ c[8]) * scale).contiguous()
        result.pop(key)
        result.pop(prefix + '.lora_B.weight')
        result.pop(prefix + '.alpha', None)
        count += 1
    if count != 51:
        raise ValueError(f'Expected 51 AdaLN adapters, found {count}')
    out = args.models / 'loras' / f'pencil_h3_{mode}_turbo_curve.safetensors'
    save_file(result, str(out), metadata={'conversion': 'affine fit including DC bias',
                                         'relative_fit_residual': str(residual), 'source': str(args.source)})
    print(json.dumps({'file': str(out), 'layers': count, 'relative_fit_residual': residual}))
