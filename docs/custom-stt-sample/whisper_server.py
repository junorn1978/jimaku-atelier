"""rtl-stt/1 server on faster-whisper: the smallest working example.

One sentence = the audio between two `pause` messages from the client (capped
at MAX_SEC, for speakers who never pause). Each one is transcribed whole and
returned as a final; there are no partials. Translation is left to the app.

    pip install websockets faster-whisper numpy
    python whisper_server.py                          # small model on CPU
    python whisper_server.py --model large-v3 --device cuda

Then pick "Custom STT" in the app's languages tab and enter ws://127.0.0.1:9000
"""

import argparse
import asyncio
import json

import numpy as np
from faster_whisper import WhisperModel
from websockets.asyncio.server import serve

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
    def __init__(self, ws, model: WhisperModel):
        self.ws = ws
        self.model = model
        self.lang = None
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
            text = await asyncio.to_thread(self.transcribe, audio)
        if text:
            await self.ws.send(json.dumps({"type": "final", "text": text}, ensure_ascii=False))

    def transcribe(self, audio) -> str:
        segments, _ = self.model.transcribe(
            audio,
            language=self.lang,
            beam_size=1,
            condition_on_previous_text=False,
            vad_filter=True,
        )
        return "".join(s.text for s in segments if s.no_speech_prob < NO_SPEECH_PROB).strip()

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
                self.lang = whisper_lang(msg.get("sourceLang", ""))
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
    args = parser.parse_args()

    print(f"loading {args.model}...")
    model = WhisperModel(args.model, device=args.device, compute_type=args.compute_type)

    async def handle(ws):
        print("client connected")
        await Session(ws, model).run()
        print("client disconnected")

    async with serve(handle, args.host, args.port, max_size=None):
        print(f"listening on ws://{args.host}:{args.port}")
        await asyncio.get_running_loop().create_future()


if __name__ == "__main__":
    asyncio.run(main())
