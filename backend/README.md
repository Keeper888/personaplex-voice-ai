---
title: PersonaPlex Voice AI
emoji: "\U0001F3A4"
colorFrom: purple
colorTo: blue
sdk: docker
app_port: 8998
suggested_hardware: a10g-large
startup_duration_timeout: 1h
models:
  - nvidia/personaplex-7b-v1
tags:
  - speech-to-speech
  - voice-ai
---

# PersonaPlex Voice AI

Speech-to-speech AI powered by NVIDIA PersonaPlex-7B-v1 (Moshi architecture) with a reactive Three.js orb frontend.

## Setup

1. Create a new HF Space with **Docker** SDK and **A10G Large** GPU
2. Add your `HF_TOKEN` as a **Repository Secret** in Space settings
3. Push this directory's contents to the Space repo
4. Wait for the build + model download (first boot takes ~10-15 min)

## Protocol

The moshi.server exposes a WebSocket at `/api/chat` for bidirectional audio streaming.

| Byte | Type | Direction |
|------|------|-----------|
| `0x00` | Handshake | Server -> Client (client must respond) |
| `0x01` | Opus audio frame | Bidirectional |
| `0x02` | Text token | Server -> Client |
| `0x03` | Control command | Server -> Client |
| `0x04` | Metadata (JSON) | Server -> Client |
| `0x05` | Error | Server -> Client |
| `0x06` | Ping | Server -> Client (client responds with pong) |

Audio: 24kHz mono, Opus-encoded via Mimi codec.
