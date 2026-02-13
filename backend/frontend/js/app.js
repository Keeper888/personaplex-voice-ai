import { OrbRenderer } from './orb.js';
import { AudioPipeline } from './audio.js';

// --- DOM ---
const canvas = document.getElementById('orb-canvas');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const transcript = document.getElementById('transcript');
const transcriptText = document.getElementById('transcript-text');
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');

// --- State ---
let ws = null;
let audio = null;
let opusEncoder = null;
let opusDecoder = null;
let inactivityTimer = null;

// --- Orb ---
const orb = new OrbRenderer(canvas);

// Animate orb from audio even when idle
function visualLoop() {
    requestAnimationFrame(visualLoop);
    if (audio) {
        const freq = audio.getFrequencyData();
        const amp = audio.getAmplitude();
        orb.updateAudio(freq, amp);
    }
}
visualLoop();

// --- Moshi WebSocket Protocol (all 7 types) ---
const MSG_HANDSHAKE = 0x00;
const MSG_AUDIO     = 0x01;
const MSG_TEXT      = 0x02;
const MSG_CONTROL   = 0x03;
const MSG_METADATA  = 0x04;
const MSG_ERROR     = 0x05;
const MSG_PING      = 0x06;

// Inactivity timeout (server may disconnect after 10s of silence)
const INACTIVITY_TIMEOUT_MS = 30000;

// --- Opus Codec (WebCodecs API with PCM fallback) ---
class OpusCodec {
    constructor(sampleRate = 24000) {
        this.sampleRate = sampleRate;
        this._encoderReady = false;
        this._decoderReady = false;
        this._fallback = false;
    }

    async init() {
        if ('AudioEncoder' in window && 'AudioDecoder' in window) {
            await this._initWebCodecs();
        } else {
            console.warn('WebCodecs not available, falling back to raw PCM');
            this._fallback = true;
        }
    }

    async _initWebCodecs() {
        this._decodedChunks = [];
        this.decoder = new AudioDecoder({
            output: (audioData) => {
                const pcm = new Float32Array(audioData.numberOfFrames);
                audioData.copyTo(pcm, { planeIndex: 0 });
                this._decodedChunks.push(pcm);
                audioData.close();
            },
            error: (e) => console.error('AudioDecoder error:', e),
        });

        await this.decoder.configure({
            codec: 'opus',
            sampleRate: this.sampleRate,
            numberOfChannels: 1,
        });
        this._decoderReady = true;

        this._encodedChunks = [];
        this.encoder = new AudioEncoder({
            output: (chunk) => {
                const data = new ArrayBuffer(chunk.byteLength);
                chunk.copyTo(data);
                this._encodedChunks.push(new Uint8Array(data));
            },
            error: (e) => console.error('AudioEncoder error:', e),
        });

        await this.encoder.configure({
            codec: 'opus',
            sampleRate: this.sampleRate,
            numberOfChannels: 1,
            bitrate: 64000,
        });
        this._encoderReady = true;
    }

    async encode(pcmFloat32) {
        if (this._fallback) return this._float32ToInt16Bytes(pcmFloat32);
        if (!this._encoderReady) return null;

        const audioData = new AudioData({
            format: 'f32-planar',
            sampleRate: this.sampleRate,
            numberOfFrames: pcmFloat32.length,
            numberOfChannels: 1,
            timestamp: 0,
            data: pcmFloat32,
        });

        this._encodedChunks = [];
        this.encoder.encode(audioData);
        await this.encoder.flush();
        audioData.close();

        return this._encodedChunks.length > 0 ? this._encodedChunks[0] : null;
    }

    async decode(opusData) {
        if (this._fallback) return this._int16BytesToFloat32(opusData);
        if (!this._decoderReady) return null;

        const chunk = new EncodedAudioChunk({
            type: 'key',
            timestamp: 0,
            data: opusData,
        });

        this._decodedChunks = [];
        this.decoder.decode(chunk);
        await this.decoder.flush();

        return this._decodedChunks.length > 0 ? this._decodedChunks[0] : null;
    }

    _float32ToInt16Bytes(float32) {
        const int16 = new Int16Array(float32.length);
        for (let i = 0; i < float32.length; i++) {
            int16[i] = Math.max(-32768, Math.min(32767, Math.round(float32[i] * 32767)));
        }
        return new Uint8Array(int16.buffer);
    }

    _int16BytesToFloat32(bytes) {
        const int16 = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
        const float32 = new Float32Array(int16.length);
        for (let i = 0; i < int16.length; i++) {
            float32[i] = int16[i] / 32768.0;
        }
        return float32;
    }

    destroy() {
        if (this.encoder) this.encoder.close();
        if (this.decoder) this.decoder.close();
    }
}

// --- Build WebSocket URL from current page host ---
function getWsUrl() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/api/chat`;
}

// --- Connection logic ---
function setStatus(state, text) {
    statusDot.className = state;
    statusText.textContent = text;
}

function resetInactivityTimer() {
    clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => {
        console.warn('Inactivity timeout - no messages received');
        setStatus('error', 'Connection timed out');
        stop();
    }, INACTIVITY_TIMEOUT_MS);
}

async function start() {
    setStatus('connecting', 'Connecting...');

    try {
        audio = new AudioPipeline();
        await audio.init();

        opusEncoder = new OpusCodec(24000);
        await opusEncoder.init();
        opusDecoder = new OpusCodec(24000);
        await opusDecoder.init();

        const url = getWsUrl();
        console.log('Connecting to', url);
        ws = new WebSocket(url);
        ws.binaryType = 'arraybuffer';

        ws.onopen = () => {
            // Don't mark as connected yet - wait for handshake (0x00) from server
            setStatus('connecting', 'Waiting for model...');
            startBtn.classList.add('hidden');
            stopBtn.classList.remove('hidden');
            resetInactivityTimer();
        };

        ws.onmessage = async (event) => {
            const data = new Uint8Array(event.data);
            if (data.length === 0) return;

            resetInactivityTimer();

            const msgType = data[0];
            const payload = data.slice(1);

            switch (msgType) {
                case MSG_HANDSHAKE:
                    // Server signals ready after loading model/prompts
                    // No response needed - just start mic and mark connected
                    console.log('Handshake received - server ready');
                    setStatus('connected', 'Connected - speak now');
                    await audio.startMic();
                    audio.onMicData = async (pcm) => {
                        if (ws && ws.readyState === WebSocket.OPEN) {
                            const encoded = await opusEncoder.encode(pcm);
                            if (encoded) {
                                const frame = new Uint8Array(1 + encoded.length);
                                frame[0] = MSG_AUDIO;
                                frame.set(encoded, 1);
                                ws.send(frame.buffer);
                            }
                        }
                    };
                    break;

                case MSG_AUDIO: {
                    const pcm = await opusDecoder.decode(payload);
                    if (pcm) audio.playPCM(pcm);
                    break;
                }

                case MSG_TEXT: {
                    const text = new TextDecoder().decode(payload);
                    if (text.trim()) {
                        transcript.classList.remove('hidden');
                        transcriptText.textContent += text;
                        clearTimeout(window._transcriptTimeout);
                        window._transcriptTimeout = setTimeout(() => {
                            transcriptText.textContent = '';
                            transcript.classList.add('hidden');
                        }, 5000);
                    }
                    break;
                }

                case MSG_CONTROL: {
                    // Control commands from server (not currently sent, but handle defensively)
                    const action = payload.length > 0 ? payload[0] : -1;
                    const actions = { 0: 'start', 1: 'endTurn', 2: 'pause', 3: 'restart' };
                    console.log('Control message:', actions[action] || `unknown(${action})`);
                    break;
                }

                case MSG_METADATA: {
                    // JSON metadata from server
                    try {
                        const json = JSON.parse(new TextDecoder().decode(payload));
                        console.log('Metadata:', json);
                    } catch (e) {
                        console.warn('Failed to parse metadata:', e);
                    }
                    break;
                }

                case MSG_ERROR: {
                    const errorMsg = new TextDecoder().decode(payload);
                    console.error('Server error:', errorMsg);
                    setStatus('error', errorMsg);
                    break;
                }

                case MSG_PING: {
                    // Respond with pong (send ping back)
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        ws.send(new Uint8Array([MSG_PING]).buffer);
                    }
                    break;
                }

                default:
                    console.warn('Unknown message type:', msgType);
            }
        };

        ws.onerror = (e) => {
            console.error('WebSocket error:', e);
            setStatus('error', 'Connection error');
        };

        ws.onclose = (e) => {
            console.log('WebSocket closed:', e.code, e.reason);
            setStatus('', 'Disconnected');
            cleanup();
        };

    } catch (err) {
        console.error('Connection failed:', err);
        setStatus('error', `Failed: ${err.message}`);
        cleanup();
    }
}

function cleanup() {
    clearTimeout(inactivityTimer);
    if (audio) { audio.destroy(); audio = null; }
    if (opusEncoder) { opusEncoder.destroy(); opusEncoder = null; }
    if (opusDecoder) { opusDecoder.destroy(); opusDecoder = null; }
    startBtn.classList.remove('hidden');
    stopBtn.classList.add('hidden');
    transcript.classList.add('hidden');
    transcriptText.textContent = '';
}

function stop() {
    if (ws) { ws.close(); ws = null; }
    cleanup();
    setStatus('', 'Ready');
}

// --- Event listeners ---
startBtn.addEventListener('click', start);
stopBtn.addEventListener('click', stop);
