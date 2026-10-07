"""rtl-stt/1 server on faster-whisper: the smallest working example.

One sentence = the audio between two `pause` messages from the client (capped
at MAX_SEC, for speakers who never pause). Each one is transcribed whole and
returned as a final; there are no partials. Translation is left to the app.

With --detect, each sentence's language is picked from the listed ones (plus
the app's recognition language) instead of always being the app's, and the
final says which it was, so the app translates it from the right language:

    python whisper_server.py --detect ja,en,zh

    pip install websockets faster-whisper numpy
    python whisper_server.py                          # small model, GPU if usable
    python whisper_server.py --model large-v3-turbo --device cuda --compute-type int8_float16

For an NVIDIA GPU on Windows, CTranslate2 also needs the CUDA 12 cuBLAS and
cuDNN 9 DLLs. The pip packages are enough — this script finds them itself:

    pip install nvidia-cublas-cu12 nvidia-cudnn-cu12

Then pick "Custom STT" in the app's languages tab and enter ws://127.0.0.1:9000
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
from faster_whisper import WhisperModel  # noqa: E402
from websockets.asyncio.server import serve  # noqa: E402

SAMPLE_RATE = 16000
MAX_SEC = 10          # cut a sentence here if no pause comes
MIN_SEC = 0.3         # shorter than this is a click or a breath, not speech
SILENT_DBFS = -50     # quieter than this throughout: nothing to transcribe
NO_SPEECH_PROB = 0.6  # Whisper's own "this was not speech" above this: drop it


def whisper_lang(code: str) -> str | None:
    """The app sends translation codes (ja, en, zh-TW, yue...); Whisper wants ISO 639-1."""
    if not code:
        return None
    if code == "yue":
        return "yue"
    return code.split("-")[0]


class Session:
    def __init__(self, ws, model: WhisperModel, detect: list[str]):
        self.ws = ws
        self.model = model
        self.detect = detect
        self.source = ""  # the app's recognition language, as it sent it (e.g. zh-TW)
        self.lang = None  # the same, as Whisper names it (zh)
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
            lang, text = await asyncio.to_thread(self.transcribe, audio)
            ms = (time.perf_counter() - started) * 1000
        print(f"{len(audio) / SAMPLE_RATE:4.1f}s audio, {ms:4.0f}ms, {lang}: {text}")
        if not text:
            return
        reply = {"type": "final", "text": text}
        if self.detect:
            # Back in the app's terms: its own language as it named it, anything
            # else as Whisper does (the app matches "zh" to a Chinese it uses).
            reply["lang"] = self.source if lang == self.lang else lang
        await self.ws.send(json.dumps(reply, ensure_ascii=False))

    def pick_language(self, audio) -> str | None:
        """The likeliest of the allowed languages. Restricting the choice is what
        keeps a short "はい" or "OK" from coming out as some unrelated language."""
        allowed = set(self.detect) | ({self.lang} if self.lang else set())
        _, _, probs = self.model.detect_language(audio)
        candidates = [(prob, code) for code, prob in probs if code in allowed]
        return max(candidates)[1] if candidates else self.lang

    def transcribe(self, audio) -> tuple[str | None, str]:
        lang = self.pick_language(audio) if self.detect else self.lang
        segments, _ = self.model.transcribe(
            audio,
            language=lang,
            beam_size=1,
            condition_on_previous_text=False,
            vad_filter=True,
        )
        return lang, "".join(s.text for s in segments if s.no_speech_prob < NO_SPEECH_PROB).strip()

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
                self.source = msg.get("sourceLang", "")
                self.lang = whisper_lang(self.source)
                print("config:", msg)
            elif kind == "pause":
                self.cut()
            elif kind == "stop":
                break


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=9000)
    parser.add_argument("--model", default="small")
    parser.add_argument("--device", default="auto")
    parser.add_argument("--compute-type", default="default")
    parser.add_argument("--detect", default="",
                        help="languages to detect between, as Whisper names them: ja,en,zh,yue,ko...")
    args = parser.parse_args()
    detect = [code.strip() for code in args.detect.split(",") if code.strip()]

    print(f"loading {args.model}...")
    model = WhisperModel(args.model, device=args.device, compute_type=args.compute_type)

    async def handle(ws):
        print("client connected")
        await Session(ws, model, detect).run()
        print("client disconnected")

    async with serve(handle, args.host, args.port, max_size=None):
        print(f"listening on ws://{args.host}:{args.port}")
        await asyncio.get_running_loop().create_future()


if __name__ == "__main__":
    asyncio.run(main())
