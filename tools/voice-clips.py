"""Generate the session's voice building blocks (assets/voice/<lang>/<key>.m4a).

Generator: Piper (https://github.com/OHF-Voice/piper1-gpl), one voice per language, models
from huggingface.co/rhasspy/piper-voices (<lang>/<region>/<name>/<quality>/<model>.onnx and
.onnx.json). Only voices whose recordings are CC0, CC BY, MIT or public domain (read the
MODEL_CARD of every voice before adding one); licences and links are in CREDITS.md.

    de  de_DE-thorsten-medium   Thorsten-Voice, CC0
    en  en_GB-cori-medium       LibriVox, public domain
    fr  fr_FR-siwis-medium      SIWIS database, CC BY 4.0
    es  es_ES-davefx-medium     Open Home Foundation voice datasets, CC0
    it  it_IT-paola-medium      Open Home Foundation voice datasets, CC0
    pt-BR  pt_BR-faber-medium   Open Home Foundation voice datasets, CC0
    nl  nl_NL-alex-medium       Open Home Foundation voice datasets, CC0

The texts come from the catalogs of the language via js/voice.js (voiceTexts) and
tools/voice-texts.mjs, which takes the language as its argument.

    python3 -m venv /tmp/piper && /tmp/piper/bin/pip install piper-tts
    node --import ./test-setup.js tools/voice-texts.mjs fr > /tmp/voice-fr.json
    /tmp/piper/bin/python tools/voice-clips.py /tmp/voice-fr.json <model.onnx> assets/voice/fr [--only key,key]

The output folder is the language's own (assets/voice/<lang>); VOICE_LANGUAGES in js/voice.js
lists the languages that have one.

Silence at the start and end is trimmed, the volume levelled (peak 0.9), then
converted to AAC (32 kbit/s, mono) with macOS afconvert. Existing files are kept,
unless they are listed in --only.
"""
import array
import json
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

from piper import PiperVoice, SynthesisConfig


def trim_and_normalize(src: Path, dst: Path) -> None:
    with wave.open(str(src), 'rb') as w:
        rate = w.getframerate()
        data = array.array('h', w.readframes(w.getnframes()))
    if not data:
        raise ValueError('empty')
    limit = 600
    first = next((i for i, v in enumerate(data) if abs(v) > limit), 0)
    last = next((i for i in range(len(data) - 1, -1, -1) if abs(data[i]) > limit), len(data) - 1)
    pad = int(rate * 0.03)
    data = data[max(0, first - pad):min(len(data), last + pad)]
    peak = max(abs(v) for v in data) or 1
    k = 0.9 * 32767 / peak
    data = array.array('h', (max(-32768, min(32767, int(v * k))) for v in data))
    with wave.open(str(dst), 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(data.tobytes())


def main() -> None:
    texts = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
    model = str(Path(sys.argv[2]).resolve())
    out = Path(sys.argv[3]).resolve()
    only = set(sys.argv[sys.argv.index('--only') + 1].split(',')) if '--only' in sys.argv else None
    out.mkdir(parents=True, exist_ok=True)
    # eSpeak copes only with short paths (otherwise it falls back to the build machine's
    # path): load from within the Piper folder using a relative path.
    import os
    import piper
    os.chdir(Path(piper.__file__).parent)
    voice = PiperVoice.load(model, espeak_data_dir='espeak-ng-data')
    cfg = SynthesisConfig(length_scale=0.95)
    tmp = Path(tempfile.mkdtemp())
    done = 0
    for key, text in texts.items():
        target = out / f'{key}.m4a'
        if target.exists() and not (only and key in only):
            continue
        if only and key not in only:
            continue
        raw = tmp / f'{key}.raw.wav'
        clean = tmp / f'{key}.wav'
        with wave.open(str(raw), 'wb') as w:
            voice.synthesize_wav(text, w, syn_config=cfg)
        trim_and_normalize(raw, clean)
        subprocess.run(['afconvert', '-f', 'm4af', '-d', 'aac', '-b', '32000', '-c', '1', str(clean), str(target)], check=True)
        done += 1
    print(f'{done} clips generated in {out}')


if __name__ == '__main__':
    main()
