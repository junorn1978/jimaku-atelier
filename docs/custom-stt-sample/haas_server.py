"""rtl-stt/1 server on Haas-ja-v1.0 (Japanese only), on the CPU or an NVIDIA GPU through sherpa-onnx.

The official Haas-ja-v1.0 needs Linux and an NVIDIA GPU; this uses a community
ONNX conversion of it instead, which runs anywhere sherpa-onnx does, Windows
included. Sentences are cut as in whisper_server.py: the audio between two
`pause` messages from the client (capped at MAX_SEC) is transcribed whole and
returned as a final; there are no partials. Translation is left to the app.

    pip install websockets sherpa-onnx numpy

Download these files of oboroge0/Haas-ja-v1.0-onnx-quantized from Hugging Face
into one folder (encoder.data must sit next to encoder.quantized.onnx):

    encoder.quantized.onnx  encoder.data  decoder.onnx  joiner.onnx  tokens.txt

    python haas_server.py --model-dir path/to/Haas-ja-v1.0-onnx-quantized
    python haas_server.py --model-dir ... --threads 8

The unquantized oboroge0/Haas-ja-v1.0-onnx (encoder.onnx) works too; whichever
encoder the folder holds is used.

For an NVIDIA GPU, replace sherpa-onnx with its CUDA build (pick the cpXXX of
your Python) and add the CUDA 12 DLLs; this script finds them as
whisper_server.py does:

    pip uninstall sherpa-onnx sherpa-onnx-core
    pip install https://huggingface.co/csukuangfj2/sherpa-onnx-wheels/resolve/main/cuda/2.0.1/sherpa_onnx-2.0.1+cuda12.cudnn9-cp314-cp314-win_amd64.whl
    pip install nvidia-cublas-cu12 nvidia-cudnn-cu12 nvidia-cuda-runtime-cu12 nvidia-cufft-cu12 nvidia-curand-cu12
    python haas_server.py --model-dir path/to/Haas-ja-v1.0-onnx --provider cuda

On the GPU use the unquantized model: the 4-bit one barely gains there (RTX
2060: 880ms against 230ms for 9.3s of audio), but it takes about 3 GB of VRAM.

Limits:
- Japanese only. Speech in other languages is not dropped but comes out as
  made-up katakana (Chinese becomes "チャオス", "ファンビン"...).
- The GPU path is CUDA, so NVIDIA only. AMD and Intel GPUs fall back to the
  CPU, which takes about an eighth of the audio's length (12 threads: 10s of
  audio in about 1.2s).
- The ONNX files are an unofficial community conversion, not Third
  Intelligence's own; their author measured them on an Apple M1 only.
- The official model's custom vocabulary (names, terms) is not available here.
- Fillers such as えー and あの are mostly left out, and that cannot be changed.

Then, in the app's languages tab, open Advanced, turn on the recognition
server and enter ws://127.0.0.1:9000. Set the recognition language to Japanese.
"""

import argparse
import asyncio
import json
import os
import sys
import time
from pathlib import Path


def add_cuda_dlls():
    """Puts the DLLs of pip's nvidia-* packages on the DLL search path (Windows)."""
    if sys.platform != "win32":
        return
    for site in map(Path, sys.path):
        for bin_dir in site.glob("nvidia/*/bin"):
            os.add_dll_directory(str(bin_dir))
            os.environ["PATH"] = f"{bin_dir}{os.pathsep}{os.environ['PATH']}"


add_cuda_dlls()

import numpy as np  # noqa: E402
import sherpa_onnx  # noqa: E402
from websockets.asyncio.server import serve  # noqa: E402

SAMPLE_RATE = 16000
MAX_SEC = 10          # cut a sentence here if no pause comes
MIN_SEC = 0.3         # shorter than this is a click or a breath, not speech
SILENT_DBFS = -50     # quieter than this throughout: nothing to transcribe


def load_recognizer(model_dir: Path, threads: int, provider: str) -> sherpa_onnx.OfflineRecognizer:
    encoder = model_dir / "encoder.quantized.onnx"
    if not encoder.exists():
        encoder = model_dir / "encoder.onnx"
    print(f"loading {encoder} on {provider} ({threads} threads)...")
    return sherpa_onnx.OfflineRecognizer.from_transducer(
        encoder=str(encoder),
        decoder=str(model_dir / "decoder.onnx"),
        joiner=str(model_dir / "joiner.onnx"),
        tokens=str(model_dir / "tokens.txt"),
        model_type="nemo_transducer",
        feature_dim=128,
        num_threads=threads,
        provider=provider,
    )


class Session:
    def __init__(self, ws, recognizer: sherpa_onnx.OfflineRecognizer):
        self.ws = ws
        self.recognizer = recognizer
        self.buf = bytearray()
        self.lock = asyncio.Lock()  # one sentence at a time, in order

    def cut(self):
        """Takes the sentence so far off the buffer and transcribes it in the background."""
        pcm, self.buf = bytes(self.buf), bytearray()
        asyncio.create_task(self.flush(pcm))

    async def flush(self, pcm: bytes):
        if len(pcm) < MIN_SEC * SAMPLE_RATE * 2:
            return
        audio = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768
        if 20 * np.log10(np.sqrt(np.mean(audio**2)) + 1e-9) < SILENT_DBFS:
            return
        async with self.lock:
            started = time.perf_counter()
            text = await asyncio.to_thread(self.transcribe, audio)
            ms = (time.perf_counter() - started) * 1000
            print(f"{len(audio) / SAMPLE_RATE:4.1f}s audio, {ms:4.0f}ms: {text}")
            if text:
                await self.ws.send(json.dumps({"type": "final", "text": text}, ensure_ascii=False))

    def transcribe(self, audio) -> str:
        stream = self.recognizer.create_stream()
        stream.accept_waveform(SAMPLE_RATE, audio)
        self.recognizer.decode_stream(stream)
        return stream.result.text.strip()

    async def run(self):
        await self.ws.send(json.dumps({"type": "ready"}))
        async for message in self.ws:
            if isinstance(message, bytes):
                self.buf += message
                if len(self.buf) >= MAX_SEC * SAMPLE_RATE * 2:
                    self.cut()
                continue
            msg = json.loads(message)
            kind = msg.get("type")
            if kind == "config":
                print("config:", msg)
                if not msg.get("sourceLang", "").startswith("ja"):
                    print("  warning: this model only recognises Japanese")
            elif kind == "pause":
                self.cut()
            elif kind == "stop":
                break


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=9000)
    parser.add_argument("--model-dir", type=Path, default=Path("Haas-ja-v1.0-onnx-quantized"))
    parser.add_argument("--threads", type=int, default=max(1, (os.cpu_count() or 4) * 3 // 4),
                        help="CPU threads for the model; more is not always faster")
    parser.add_argument("--provider", default="cpu", choices=["cpu", "cuda"],
                        help="cuda needs sherpa-onnx's CUDA build")
    args = parser.parse_args()

    recognizer = load_recognizer(args.model_dir, args.threads, args.provider)
    # The first decode sets the GPU up and takes twice as long; spend it here,
    # not on the first sentence.
    warmup = recognizer.create_stream()
    warmup.accept_waveform(SAMPLE_RATE, np.zeros(SAMPLE_RATE, dtype=np.float32))
    recognizer.decode_stream(warmup)

    async def handle(ws):
        print("client connected")
        await Session(ws, recognizer).run()
        print("client disconnected")

    async with serve(handle, args.host, args.port, max_size=None):
        print(f"listening on ws://{args.host}:{args.port}")
        await asyncio.get_running_loop().create_future()


if __name__ == "__main__":
    asyncio.run(main())
