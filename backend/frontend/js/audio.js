/**
 * AudioPipeline handles:
 * - Mic capture -> raw PCM at mic's native rate
 * - Playback of incoming Opus audio from the server
 * - AnalyserNode on output for orb visualization
 */
export class AudioPipeline {
    constructor() {
        this.audioContext = null;
        this.micStream = null;
        this.analyser = null;
        this.frequencyData = null;
        this.onMicData = null; // callback: (Float32Array) => void
        this._playbackQueue = [];
        this._isPlaying = false;
    }

    async init() {
        this.audioContext = new AudioContext({ sampleRate: 24000 });

        // Analyser for visualizing output audio
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 256;
        this.analyser.smoothingTimeConstant = 0.8;
        this.analyser.connect(this.audioContext.destination);
        this.frequencyData = new Uint8Array(this.analyser.frequencyBinCount);
    }

    async startMic() {
        this.micStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                sampleRate: 24000,
                channelCount: 1,
                echoCancellation: true,
                noiseSuppression: true,
            }
        });

        const source = this.audioContext.createMediaStreamSource(this.micStream);

        // Use ScriptProcessor for raw PCM access (AudioWorklet would be cleaner
        // but this is simpler for a POC)
        const processor = this.audioContext.createScriptProcessor(4096, 1, 1);
        processor.onaudioprocess = (e) => {
            if (this.onMicData) {
                const pcm = e.inputBuffer.getChannelData(0);
                this.onMicData(new Float32Array(pcm));
            }
        };

        source.connect(processor);
        processor.connect(this.audioContext.destination);

        this._micSource = source;
        this._micProcessor = processor;
    }

    stopMic() {
        if (this.micStream) {
            this.micStream.getTracks().forEach(t => t.stop());
            this.micStream = null;
        }
        if (this._micProcessor) {
            this._micProcessor.disconnect();
            this._micProcessor = null;
        }
        if (this._micSource) {
            this._micSource.disconnect();
            this._micSource = null;
        }
    }

    /**
     * Queue decoded PCM (Float32Array, 24kHz mono) for playback
     */
    playPCM(pcmData) {
        this._playbackQueue.push(pcmData);
        if (!this._isPlaying) {
            this._drainQueue();
        }
    }

    _drainQueue() {
        if (this._playbackQueue.length === 0) {
            this._isPlaying = false;
            return;
        }

        this._isPlaying = true;
        const pcm = this._playbackQueue.shift();

        const buffer = this.audioContext.createBuffer(1, pcm.length, 24000);
        buffer.getChannelData(0).set(pcm);

        const src = this.audioContext.createBufferSource();
        src.buffer = buffer;
        src.connect(this.analyser);
        src.onended = () => this._drainQueue();
        src.start();
    }

    getFrequencyData() {
        if (this.analyser) {
            this.analyser.getByteFrequencyData(this.frequencyData);
        }
        return this.frequencyData;
    }

    getAmplitude() {
        const data = this.getFrequencyData();
        if (!data || data.length === 0) return 0;
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
            sum += data[i];
        }
        return (sum / data.length) / 255.0;
    }

    destroy() {
        this.stopMic();
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
    }
}
