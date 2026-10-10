"""rtl-stt/1 server relaying to Soniox real-time speech recognition (cloud).

The app's audio is passed through to Soniox as it comes; Soniox decides where
a sentence ends (its own endpoint detection, so `pause` is not used), and its
tokens come back as partials and finals. Translation is left to the app.

The API key stays here, on the server, never in the browser:

    pip install websockets
    $env:SONIOX_API_KEY = "..."        # PowerShell (cmd: set SONIOX_API_KEY=...)
    python soniox_server.py

With --detect, Soniox also identifies each sentence's language among the listed
ones (plus the app's recognition language), and the final says which it was:

    python soniox_server.py --detect ja,en

Billing is by stream time, and the app streams for as long as it runs —
silence included.

Then, in the app's languages tab, open Advanced, turn on the recognition
server and enter ws://127.0.0.1:9000
"""

import argparse
import asyncio
import json
import os
from collections import Counter

from websockets.asyncio.client import connect
from websockets.asyncio.server import serve
from websockets.exceptions import ConnectionClosed

SONIOX_URL = "wss://stt-rt.soniox.com/transcribe-websocket"
MODEL = "stt-rt-v5"
# Endpoint detection, at the low-latency starting point Soniox suggests. Raise
# max_endpoint_delay_ms / lower the sensitivity for longer sentences.
ENDPOINT = {
    "endpoint_latency_adjustment_level": 2,
    "endpoint_sensitivity": 0.3,
    "max_endpoint_delay_ms": 1500,
}
END_TOKENS = {"<end>", "<fin>"}


def soniox_lang(code: str) -> str:
    """The app sends translation codes (ja, en, zh-TW...); Soniox wants the bare language."""
    return code.split("-")[0] if code else ""


class Session:
    def __init__(self, client, key: str, detect: list[str]):
        self.client = client
        self.key = key
        self.detect = detect
        self.source = ""      # the app's recognition language, as it sent it (e.g. zh-TW)
        self.upstream = None  # the Soniox connection
        self.reader = None
        self.final = []       # the sentence's final tokens so far
        self.langs = Counter()
        self.partial = ""

    async def send(self, msg: dict):
        try:
            await self.client.send(json.dumps(msg, ensure_ascii=False))
        except ConnectionClosed:
            pass

    async def fail(self, message: str):
        """Reports the error and closes; the app reconnects (and so retries) every 2s."""
        print(message)
        await self.send({"type": "error", "message": message})
        # A close reason is limited to 123 bytes.
        await self.client.close(1011, message.encode()[:120].decode(errors="ignore"))

    async def start(self, source: str) -> bool:
        await self.stop_upstream()
        self.source = source
        hints = list(dict.fromkeys(c for c in [soniox_lang(source), *self.detect] if c))
        try:
            upstream = await connect(SONIOX_URL, additional_headers={"Authorization": f"Bearer {self.key}"})
            await upstream.send(json.dumps({
                "model": MODEL,
                "audio_format": "pcm_s16le",
                "sample_rate": 16000,
                "num_channels": 1,
                "language_hints": hints,
                "enable_language_identification": bool(self.detect),
                "enable_endpoint_detection": True,
                **ENDPOINT,
            }))
        except Exception as err:
            await self.fail(f"Soniox: {err}")
            return False
        self.upstream = upstream
        self.reader = asyncio.create_task(self.read(upstream))
        return True

    async def stop_upstream(self):
        upstream, self.upstream = self.upstream, None
        if self.reader:
            self.reader.cancel()
            self.reader = None
        if upstream:
            await upstream.close()
        self.final, self.partial = [], ""
        self.langs.clear()

    async def read(self, upstream):
        try:
            async for message in upstream:
                msg = json.loads(message)
                if msg.get("error_code"):
                    await self.fail(f"Soniox {msg['error_code']}: {msg.get('error_message', '')}")
                    return
                await self.on_tokens(msg.get("tokens", []))
        except ConnectionClosed:
            pass
        if upstream is self.upstream:  # closed without being asked to
            await self.fail("Soniox closed the connection")

    async def on_tokens(self, tokens: list[dict]):
        # Final tokens arrive once; non-final ones are resent in full with every response.
        pending = []
        for token in tokens:
            text = token.get("text", "")
            if text in END_TOKENS:
                await self.emit_final()
            elif token.get("is_final"):
                self.final.append(text)
                if token.get("language"):
                    self.langs[token["language"]] += 1
            else:
                pending.append(text)
        partial = "".join(self.final + pending).strip()
        if partial and partial != self.partial:
            self.partial = partial
            await self.send({"type": "partial", "text": partial})

    async def emit_final(self):
        text = "".join(self.final).strip()
        lang = self.langs.most_common(1)[0][0] if self.langs else None
        self.final, self.partial = [], ""
        self.langs.clear()
        if not text:
            return
        print(f"{lang or ''}: {text}")
        reply = {"type": "final", "text": text}
        if self.detect and lang:
            # Back in the app's terms: its own language as it named it, anything
            # else as Soniox does (the app matches "zh" to a Chinese it uses).
            reply["lang"] = self.source if lang == soniox_lang(self.source) else lang
        await self.send(reply)

    async def run(self):
        try:
            async for message in self.client:
                if isinstance(message, bytes):
                    if self.upstream:
                        try:
                            await self.upstream.send(message)
                        except ConnectionClosed:
                            pass  # read() reports it
                    continue
                msg = json.loads(message)
                kind = msg.get("type")
                if kind == "config":
                    print("config:", msg)
                    # Sent again when the translation slots change; only a new
                    # recognition language needs a new Soniox session.
                    source = msg.get("sourceLang", "")
                    if self.upstream is None or source != self.source:
                        if not await self.start(source):
                            return
                        await self.send({"type": "ready"})
                elif kind == "stop":
                    break
        except ConnectionClosed:
            pass  # the app went away, or fail() closed it
        finally:
            await self.stop_upstream()


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=9000)
    parser.add_argument("--key", default=os.environ.get("SONIOX_API_KEY", ""),
                        help="Soniox API key (default: the SONIOX_API_KEY environment variable)")
    parser.add_argument("--detect", default="",
                        help="languages to identify between: ja,en,zh,ko...")
    args = parser.parse_args()
    if not args.key:
        parser.error("no API key: set SONIOX_API_KEY or pass --key")
    detect = [code.strip() for code in args.detect.split(",") if code.strip()]

    async def handle(ws):
        print("client connected")
        await Session(ws, args.key, detect).run()
        print("client disconnected")

    async with serve(handle, args.host, args.port):
        print(f"listening on ws://{args.host}:{args.port}")
        await asyncio.get_running_loop().create_future()


if __name__ == "__main__":
    asyncio.run(main())
