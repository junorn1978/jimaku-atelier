"""rtl-stt/1 echo server: no model, for checking the connection only.

Speaks the protocol in docs/custom-stt.md, but instead of recognising speech it
reports what it received: while you talk, a partial with the seconds of audio
so far; at each pause, a final with the segment's length and loudness.

    pip install websockets
    python echo_server.py                # ws://127.0.0.1:9000
    python echo_server.py --translate    # also return made-up translations
"""

import argparse
import asyncio
import json
import math
import struct

from websockets.asyncio.server import serve

SAMPLE_RATE = 16000
SILENT_DB = -50


def level_db(pcm: bytes) -> float:
    n = len(pcm) // 2
    if n == 0:
        return -120.0
    samples = struct.unpack(f"<{n}h", pcm[: n * 2])
    mean_sq = sum(s * s for s in samples) / n / (32768 * 32768)
    return 10 * math.log10(mean_sq + 1e-12)


async def handle(ws, translate: bool):
    config = {}
    segment = bytearray()
    count = 0
    last_partial = 0.0
    print("client connected")
    await ws.send(json.dumps({"type": "ready"}))

    async for message in ws:
        if isinstance(message, bytes):
            segment += message
            seconds = len(segment) / 2 / SAMPLE_RATE
            # Only while someone is talking: a partial during the silence after a
            # final would read as speech to the app and keep the subtitles up.
            if seconds - last_partial >= 0.5 and level_db(message) > SILENT_DB:
                last_partial = seconds
                await ws.send(json.dumps({"type": "partial", "text": f"音声 {seconds:.1f} 秒"}))
            continue

        msg = json.loads(message)
        if msg.get("type") == "config":
            config = msg
            print("config:", msg)
        elif msg.get("type") == "pause":
            if not segment:
                continue
            count += 1
            seconds = len(segment) / 2 / SAMPLE_RATE
            text = f"セグメント {count}：{seconds:.1f} 秒、{level_db(bytes(segment)):.0f} dB"
            reply = {"type": "final", "text": text}
            if translate:
                reply["translations"] = [f"[{lang}] {text}" for lang in config.get("targetLangs", [])]
            await ws.send(json.dumps(reply, ensure_ascii=False))
            segment.clear()
            last_partial = 0.0
        elif msg.get("type") == "stop":
            break
    print("client disconnected")


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=9000)
    parser.add_argument("--translate", action="store_true")
    args = parser.parse_args()
    async with serve(lambda ws: handle(ws, args.translate), args.host, args.port):
        print(f"listening on ws://{args.host}:{args.port}")
        await asyncio.get_running_loop().create_future()


if __name__ == "__main__":
    asyncio.run(main())
