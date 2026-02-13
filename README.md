# PersonaPlex Voice AI

Voice-to-voice web app powered by NVIDIA's PersonaPlex-7B-v1 speech-to-speech model. Features a reactive Three.js orb that animates with AI speech.

## Architecture

Single HF Space runs everything - the moshi.server serves both the WebSocket API and the frontend static files via `--static`.

```
Browser  <--HTTPS/WSS-->  HuggingFace Space (A10G Large GPU)
                          ├── moshi.server (PersonaPlex inference, port 8998)
                          └── static files (Three.js orb frontend)
```

## Deploy to HuggingFace Spaces

### Prerequisites
- Accept the model license at [nvidia/personaplex-7b-v1](https://huggingface.co/nvidia/personaplex-7b-v1)
- HuggingFace account with SSH key configured

### Steps

1. Create a new HF Space:
   - SDK: **Docker**
   - Hardware: **A10G Large** ($1.50/hr, 24GB VRAM, 46GB RAM)

2. Add `HF_TOKEN` as a **Repository Secret** in Space Settings

3. Push the `backend/` directory to your Space via SSH:
   ```bash
   cd backend
   git init && git add -A && git commit -m "init"
   git remote add space git@hf.co:spaces/raven34980/personaplex-voice-ai
   git push space main
   ```

4. Wait for build + model download (~10-15 min on first cold start)

5. Open `https://raven34980-personaplex-voice-ai.hf.space` - click "Start Conversation"

### Cold Start

The model (~14GB fp16) downloads from HuggingFace on every cold start since persistent storage is deprecated on Spaces. First boot takes ~10-15 min. Subsequent warm starts are instant.

### Hardware

- **A10G Large**: 24GB VRAM, 12 vCPU, 46GB RAM ($1.50/hr)
- Model: ~14GB (fp16) + Mimi codec ~1GB + activations
- Fallback if OOM: A100 Large (80GB VRAM, $2.50/hr)
- Server supports `--cpu-offload` if VRAM is tight (uses system RAM)

## Local Frontend Dev

```bash
cd frontend
npx serve .
```

The orb animation works locally. WebSocket requires the HF Space backend running.

## Protocol

WebSocket endpoint: `/api/chat`

The server sends a `0x00` handshake byte when the model is loaded and ready. The client waits for this before starting mic capture. Audio is 24kHz mono Opus-encoded, prefixed with `0x01`. Text tokens are UTF-8, prefixed with `0x02`.

See `backend/README.md` for the full protocol table.
