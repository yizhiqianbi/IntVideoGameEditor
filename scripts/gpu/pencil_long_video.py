"""ComfyUI nodes for two sequential 15-second H3 windows at 24 fps."""
import torch

class PencilContinuationFrame:
    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {'images': ('IMAGE',), 'audio': ('AUDIO',)}}
    RETURN_TYPES = ('IMAGE',)
    FUNCTION = 'run'
    CATEGORY = 'Pencil/video'

    def run(self, images, audio):
        # Audio dependency completes first-window decoding before continuation.
        index = min(359, len(images) - 1)
        return (images[index:index + 1].clone().cpu(),)

class PencilJoinVideoAudio:
    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {'images1': ('IMAGE',), 'images2': ('IMAGE',),
                             'audio1': ('AUDIO',), 'audio2': ('AUDIO',)}}
    RETURN_TYPES = ('IMAGE', 'AUDIO')
    FUNCTION = 'run'
    CATEGORY = 'Pencil/video'

    def run(self, images1, images2, audio1, audio2):
        if audio1['sample_rate'] != audio2['sample_rate']:
            raise ValueError('Audio sample rates differ')
        sr = audio1['sample_rate']
        n = 15 * sr
        waves = []
        for audio in [audio1, audio2]:
            wave = audio['waveform'].cpu()[..., :n]
            if wave.shape[-1] < n:
                wave = torch.nn.functional.pad(wave, (0, n - wave.shape[-1]))
            wave = wave.clone()
            fade = min(int(sr * 0.03), wave.shape[-1])
            wave[..., :fade] *= torch.linspace(0, 1, fade)
            wave[..., -fade:] *= torch.linspace(1, 0, fade)
            waves.append(wave)
        return (torch.cat([images1[:360].cpu(), images2[:360].cpu()], dim=0),
                {'waveform': torch.cat(waves, dim=-1), 'sample_rate': sr})

NODE_CLASS_MAPPINGS = {
    'PencilContinuationFrame': PencilContinuationFrame,
    'PencilJoinVideoAudio': PencilJoinVideoAudio,
}
