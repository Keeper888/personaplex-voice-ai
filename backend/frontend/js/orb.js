import * as THREE from 'three';

const vertexShader = `
    uniform float uTime;
    uniform float uAmplitude;
    uniform float uFreqData[32];

    varying vec3 vNormal;
    varying vec3 vPosition;
    varying float vDisplacement;

    //
    // Simplex 3D noise
    //
    vec4 permute(vec4 x) { return mod(((x*34.0)+1.0)*x, 289.0); }
    vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

    float snoise(vec3 v) {
        const vec2 C = vec2(1.0/6.0, 1.0/3.0);
        const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

        vec3 i  = floor(v + dot(v, C.yyy));
        vec3 x0 = v - i + dot(i, C.xxx);

        vec3 g = step(x0.yzx, x0.xyz);
        vec3 l = 1.0 - g;
        vec3 i1 = min(g.xyz, l.zxy);
        vec3 i2 = max(g.xyz, l.zxy);

        vec3 x1 = x0 - i1 + C.xxx;
        vec3 x2 = x0 - i2 + C.yyy;
        vec3 x3 = x0 - D.yyy;

        i = mod(i, 289.0);
        vec4 p = permute(permute(permute(
                    i.z + vec4(0.0, i1.z, i2.z, 1.0))
                  + i.y + vec4(0.0, i1.y, i2.y, 1.0))
                  + i.x + vec4(0.0, i1.x, i2.x, 1.0));

        float n_ = 1.0/7.0;
        vec3 ns = n_ * D.wyz - D.xzx;

        vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

        vec4 x_ = floor(j * ns.z);
        vec4 y_ = floor(j - 7.0 * x_);

        vec4 x = x_ * ns.x + ns.yyyy;
        vec4 y = y_ * ns.x + ns.yyyy;
        vec4 h = 1.0 - abs(x) - abs(y);

        vec4 b0 = vec4(x.xy, y.xy);
        vec4 b1 = vec4(x.zw, y.zw);

        vec4 s0 = floor(b0)*2.0 + 1.0;
        vec4 s1 = floor(b1)*2.0 + 1.0;
        vec4 sh = -step(h, vec4(0.0));

        vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
        vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;

        vec3 p0 = vec3(a0.xy,h.x);
        vec3 p1 = vec3(a0.zw,h.y);
        vec3 p2 = vec3(a1.xy,h.z);
        vec3 p3 = vec3(a1.zw,h.w);

        vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
        p0 *= norm.x;
        p1 *= norm.y;
        p2 *= norm.z;
        p3 *= norm.w;

        vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
        m = m * m;
        return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
    }

    void main() {
        vNormal = normal;
        vPosition = position;

        // Sample frequency bins for this vertex based on its angle
        float angle = atan(position.y, position.x);
        float normalizedAngle = (angle + 3.14159) / 6.28318;
        int bin = int(normalizedAngle * 31.0);

        // Base noise displacement
        float noiseScale = 1.5;
        float noise = snoise(position * noiseScale + uTime * 0.3);

        // Idle breathing
        float breathing = sin(uTime * 0.8) * 0.03;

        // Audio-reactive displacement
        float freqDisplace = uFreqData[bin] * 0.4;
        float ampDisplace = uAmplitude * 0.25;

        float totalDisplace = noise * (0.08 + ampDisplace + freqDisplace) + breathing;
        vDisplacement = totalDisplace;

        vec3 newPos = position + normal * totalDisplace;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(newPos, 1.0);
    }
`;

const fragmentShader = `
    uniform float uTime;
    uniform float uAmplitude;
    uniform vec3 uBaseColor;
    uniform vec3 uActiveColor;

    varying vec3 vNormal;
    varying vec3 vPosition;
    varying float vDisplacement;

    void main() {
        // Fresnel for edge glow
        vec3 viewDir = normalize(cameraPosition - vPosition);
        float fresnel = pow(1.0 - max(dot(vNormal, viewDir), 0.0), 3.0);

        // Color mix based on amplitude
        vec3 color = mix(uBaseColor, uActiveColor, uAmplitude * 0.8 + vDisplacement * 2.0);

        // Add glow
        float glowIntensity = 0.3 + uAmplitude * 0.7;
        vec3 glow = color * fresnel * glowIntensity;

        // Final color
        vec3 finalColor = color * (0.6 + vDisplacement * 1.5) + glow;

        // Alpha based on fresnel for ethereal look
        float alpha = 0.85 + fresnel * 0.15;

        gl_FragColor = vec4(finalColor, alpha);
    }
`;

export class OrbRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.freqData = new Float32Array(32);
        this.amplitude = 0;
        this.targetAmplitude = 0;

        this._initScene();
        this._initOrb();
        this._animate();
    }

    _initScene() {
        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: true,
            alpha: true,
        });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setSize(window.innerWidth, window.innerHeight);

        this.scene = new THREE.Scene();

        this.camera = new THREE.PerspectiveCamera(
            45, window.innerWidth / window.innerHeight, 0.1, 100
        );
        this.camera.position.z = 4;

        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });
    }

    _initOrb() {
        const geometry = new THREE.IcosahedronGeometry(1, 64);

        this.uniforms = {
            uTime: { value: 0 },
            uAmplitude: { value: 0 },
            uFreqData: { value: new Float32Array(32) },
            uBaseColor: { value: new THREE.Color(0.15, 0.05, 0.35) },    // deep purple
            uActiveColor: { value: new THREE.Color(0.45, 0.20, 0.85) },  // bright violet
        };

        const material = new THREE.ShaderMaterial({
            vertexShader,
            fragmentShader,
            uniforms: this.uniforms,
            transparent: true,
            wireframe: false,
        });

        this.orb = new THREE.Mesh(geometry, material);
        this.scene.add(this.orb);

        // Subtle ambient particles (background dots)
        const particleGeom = new THREE.BufferGeometry();
        const count = 500;
        const positions = new Float32Array(count * 3);
        for (let i = 0; i < count * 3; i++) {
            positions[i] = (Math.random() - 0.5) * 10;
        }
        particleGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const particleMat = new THREE.PointsMaterial({
            color: 0x6633aa,
            size: 0.015,
            transparent: true,
            opacity: 0.4,
        });
        this.particles = new THREE.Points(particleGeom, particleMat);
        this.scene.add(this.particles);
    }

    updateAudio(frequencyData, amplitude) {
        // Downsample frequency data to 32 bins
        if (frequencyData && frequencyData.length > 0) {
            const step = Math.floor(frequencyData.length / 32);
            for (let i = 0; i < 32; i++) {
                this.freqData[i] = frequencyData[i * step] / 255.0;
            }
        }
        this.targetAmplitude = amplitude;
    }

    _animate() {
        const clock = new THREE.Clock();

        const tick = () => {
            requestAnimationFrame(tick);

            const elapsed = clock.getElapsedTime();

            // Smooth amplitude
            this.amplitude += (this.targetAmplitude - this.amplitude) * 0.1;

            // Update uniforms
            this.uniforms.uTime.value = elapsed;
            this.uniforms.uAmplitude.value = this.amplitude;
            this.uniforms.uFreqData.value.set(this.freqData);

            // Slow rotation
            this.orb.rotation.y = elapsed * 0.1;
            this.orb.rotation.x = Math.sin(elapsed * 0.05) * 0.1;

            // Scale pulse with amplitude
            const scale = 1 + this.amplitude * 0.15;
            this.orb.scale.setScalar(scale);

            // Rotate particles
            this.particles.rotation.y = elapsed * 0.02;

            this.renderer.render(this.scene, this.camera);
        };

        tick();
    }
}
