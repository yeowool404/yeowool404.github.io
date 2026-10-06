// Procedural header: a sunlit wall with tree-leaf shadows swaying in the wind,
// run through an optional mosaic + gradient map so it reads like the old header photo.
// Every knob lives in DEFAULTS; tune.html drives them live.
import * as THREE from 'three';

export const DEFAULTS = {
    seed: 79911,
    // tree (rebuild)
    limbs: 6,
    limbLength: 0.96,
    branchThickness: 0.225,
    wiggle: 0.24,
    droop: -0.05,
    twigChance: 0.7,
    twigDepth: 2,
    twigLength: 0.4,
    twigAngle: 0.79,
    leafChance: 0.35,
    extraLeafChance: 0.77,
    tipLeaves: 3,
    leafSize: 0.47,
    leafWidth: 1.52,
    leafSpread: 0,
    leafJitter: 0.76,
    canopyNear: 5.7,
    canopyFar: 6.3,
    // wall (rebuild)
    granite: true,
    seam: 2,
    ribs: false,
    ribGap: true,
    ribSpacing: 0.4,
    ribWidth: 0.3,
    ribDepth: 0.14,
    // wall + light (live)
    graniteTint: '#f0e2d4',
    wallColor: '#f2ebe0',
    sunAngle: 52, // degrees, direction across the wall (0 = from the right, 90 = from above)
    sunHeight: 38, // degrees above the wall plane
    sunIntensity: 3.4,
    ambient: 0.8,
    shadowSoftness: 20,
    shadowRes: 4096,
    viewWidth: 16,
    // wind (live)
    windSpeed: 1.05,
    sway: 0.015,
    gustStrength: 0.16,
    gustEvery: 3.5,
    gustThreshold: 0.36,
    flutter: 0.03,
    gustFlutter: 0.7,
    leafTwist: 0.2, // twist around the midrib, relative to the flap
    autoGust: true,
    gust: 0,
    // post (live)
    mosaic: true,
    cellSize: 6, // css px per mosaic cell
    samples: 5, // scene samples per cell, per axis
    gradientMap: true,
    black: 0.12,
    white: 0.74,
    posterize: 0, // 0 = smooth gradient
    palette0: '#221810',
    palette1: '#45362a',
    palette2: '#7a634d',
    palette3: '#bfa586',
    palette4: '#f7ecdd',
    fps: 24,
    // intro (live): the black point sweeps in, so the shadows sink into a washed-out wall
    introDuration: 2.4, // seconds, 0 = off
    introFromDark: false, // sweep up from all-dark instead
};

// Limbs reach in from outside the frame, up and to the right of it: the sun is
// up-right, so their shadows fall down-left onto the visible wall.
const LIMBS = [
    [14, 9, 4.2, -1, -0.35, 13],
    [13, 3, 3.4, -1, 0.1, 11],
    [6, 12, 3.8, -0.35, -1, 10],
    [-1, 11, 3.0, 0.15, -1, 9],
    [-9, 7, 4.6, 1, -0.25, 10],
    [-10, 1, 3.2, 1, 0.2, 7],
];

function mulberry32(seed) {
    return () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function sunDirection(p) {
    const a = THREE.MathUtils.degToRad(p.sunAngle);
    const e = THREE.MathUtils.degToRad(p.sunHeight);
    return new THREE.Vector3(Math.cos(a) * Math.cos(e), Math.sin(a) * Math.cos(e), Math.sin(e));
}

function graniteTexture() {
    const rand = mulberry32(7);
    const size = 256;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    g.fillStyle = '#8a7a6c';
    g.fillRect(0, 0, size, size);
    for (let i = 0; i < 9000; i++) {
        const v = Math.floor(100 + 120 * rand());
        g.fillStyle = `rgb(${v},${v * 0.92},${v * 0.85})`;
        const r = 0.6 + 1.6 * rand();
        g.fillRect(rand() * size, rand() * size, r, r);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(5, 5);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

// ---------------------------------------------------------------- tree

function growTree(p) {
    const rand = mulberry32(p.seed);
    const range = (a, b) => a + (b - a) * rand();
    const jitter = (r) => new THREE.Vector3(range(-r, r), range(-r, r), range(-r, r) * 0.6);
    const sunDir = sunDirection(p);
    const Z = new THREE.Vector3(0, 0, 1);
    const segments = []; // { a, b, r0, r1, f0, f1 }
    const leaves = []; // { pos, quat, scale, flex }

    function addLeaf(pos, flex) {
        // Leaves face roughly toward the sun, with plenty of jitter.
        const normal = sunDir.clone().add(jitter(1).multiplyScalar(p.leafJitter)).normalize();
        const quat = new THREE.Quaternion().setFromUnitVectors(Z, normal);
        quat.multiply(new THREE.Quaternion().setFromAxisAngle(Z, rand() * Math.PI * 2));
        leaves.push({ pos: pos.clone(), quat, scale: p.leafSize * range(0.77, 1.23), flex });
    }

    // A limb walks forward in small steps, sprouting side twigs (alternating left and
    // right) and, once thin enough, leaves along its length.
    function grow(start, dir, length, radius, depth, flex) {
        const steps = Math.max(3, Math.round(length / 0.35));
        const step = length / steps;
        const pos = start.clone();
        const d = dir.clone().normalize();
        let side = rand() < 0.5 ? 1 : -1;
        for (let i = 0; i < steps; i++) {
            d.x += range(-p.wiggle, p.wiggle);
            d.y += range(-p.wiggle, p.wiggle) - p.droop * depth; // twigs droop a little
            d.z += range(-p.wiggle, p.wiggle) / 2;
            // keep the canopy in a slab between the wall and the sun
            if (pos.z < p.canopyNear) d.z += 0.08;
            if (pos.z > p.canopyFar) d.z -= 0.08;
            d.normalize();
            const next = pos.clone().addScaledVector(d, step);
            const r0 = radius * (1 - 0.6 * (i / steps));
            const r1 = radius * (1 - 0.6 * ((i + 1) / steps));
            const f1 = flex + step / 6;
            segments.push({ a: pos.clone(), b: next.clone(), r0, r1, f0: flex, f1 });

            if (depth < p.twigDepth && i % 2 === 1 && rand() < p.twigChance) {
                // twigs leave at an angle from the parent, in the wall plane
                const angle = side * p.twigAngle * range(0.7, 1.3);
                const childDir = d.clone().applyAxisAngle(Z, angle);
                grow(next, childDir, length * p.twigLength * range(0.75, 1.25), r1 * 0.6, depth + 1, f1);
                side = -side;
            }
            if (depth >= 1 && i % 2 === 1 && rand() < p.leafChance) {
                const n = new THREE.Vector3(-d.y, d.x, 0);
                addLeaf(next.clone().addScaledVector(n, p.leafSpread * side).add(jitter(0.08)), f1);
                if (rand() < p.extraLeafChance) {
                    addLeaf(next.clone().addScaledVector(n, -p.leafSpread * side).add(jitter(0.08)), f1);
                }
            }
            pos.copy(next);
            flex = f1;
        }
        if (depth >= 1) for (let k = 0; k < p.tipLeaves; k++) addLeaf(pos.clone().add(jitter(0.3)), flex);
    }

    for (let i = 0; i < p.limbs; i++) {
        const [x, y, z, dx, dy, len] = LIMBS[i % LIMBS.length];
        // past the six hand-placed limbs, reuse them with an offset
        const off = i < LIMBS.length ? 0 : 3;
        grow(
            new THREE.Vector3(x + range(-off, off), y + range(-off, off), z),
            new THREE.Vector3(dx, dy, 0),
            len * p.limbLength,
            p.branchThickness,
            0,
            0.1
        );
    }
    return { segments, leaves };
}

// Shared wind, applied in the shadow (depth) pass only: the tree itself is never drawn.
const WIND_GLSL = /* glsl */ `
    uniform float uTime;
    uniform float uGust;
    uniform float uSway;
    uniform float uGustAmp;
    uniform float uFlutter;
    uniform float uGustFlutter;
    uniform float uTwist;
    attribute vec2 aFlex;
    vec3 windOffset(vec3 p, float flex) {
        float w = sin(uTime * 1.1 - p.x * 0.35 + p.y * 0.12)
                + 0.5 * sin(uTime * 1.9 - p.x * 0.7 + 1.3)
                + 0.25 * sin(uTime * 3.3 + p.y * 0.9);
        float amp = (uSway + uGustAmp * uGust) * flex;
        return vec3(1.0, -0.35, 0.3) * w * amp;
    }
`;

function windDepthMaterial(kind, windUniforms) {
    const mat = new THREE.MeshDepthMaterial({ side: THREE.DoubleSide });
    mat.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, windUniforms);
        const extra = kind === 'branch' ? 'attribute vec2 aRadius;' : '';
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', `#include <common>\n${WIND_GLSL}\n${extra}`)
            .replace('#include <project_vertex>', kind === 'branch' ? /* glsl */ `
                float along = position.y;
                transformed.xz *= mix(aRadius.x, aRadius.y, along);
                vec4 wp = instanceMatrix * vec4(transformed, 1.0);
                wp.xyz += windOffset(wp.xyz, mix(aFlex.x, aFlex.y, along));
                vec4 mvPosition = modelViewMatrix * wp;
                gl_Position = projectionMatrix * mvPosition;
            ` : /* glsl */ `
                vec3 anchor = instanceMatrix[3].xyz;
                float phase = fract(sin(dot(anchor, vec3(12.9898, 78.233, 37.719))) * 43758.5453) * 6.2832;
                // each leaf flutters on its stem: mostly a flap, hinged across the base
                // (the tip swings in and out of the leaf plane), plus a little twist
                // around the midrib
                float amp = uFlutter + uGustFlutter * uGust;
                float flap = sin(uTime * (4.0 + phase * 0.6) + phase) * amp;
                float twist = sin(uTime * (3.1 + phase * 0.5) + phase * 1.7) * amp * uTwist;
                float c = cos(twist), s = sin(twist);
                transformed.xz = mat2(c, -s, s, c) * transformed.xz;
                c = cos(flap); s = sin(flap);
                transformed.yz = mat2(c, -s, s, c) * transformed.yz;
                vec4 wp = instanceMatrix * vec4(transformed, 1.0);
                wp.xyz += windOffset(anchor, aFlex.x);
                vec4 mvPosition = modelViewMatrix * wp;
                gl_Position = projectionMatrix * mvPosition;
            `);
    };
    mat.customProgramCacheKey = () => kind;
    return mat;
}

// ---------------------------------------------------------------- the whole thing

export function createLeafShadows(canvas, overrides = {}) {
    const p = { ...DEFAULTS, ...overrides };
    const scene = new THREE.Scene();

    // wall
    const graniteMat = new THREE.MeshLambertMaterial({ map: graniteTexture() });
    const paintMat = new THREE.MeshLambertMaterial();
    const wallGroup = new THREE.Group();
    scene.add(wallGroup);

    // sun
    const sun = new THREE.DirectionalLight(0xfff1dc);
    sun.castShadow = true;
    Object.assign(sun.shadow.camera, { left: -15, right: 15, top: 15, bottom: -15, near: 1, far: 50 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.01;
    scene.add(sun);
    const hemi = new THREE.HemisphereLight(0xfff6ea, 0x3a2c20);
    scene.add(hemi);

    // tree
    const windUniforms = {
        uTime: { value: 0 },
        uGust: { value: 0 },
        uSway: { value: 0 },
        uGustAmp: { value: 0 },
        uFlutter: { value: 0 },
        uGustFlutter: { value: 0 },
        uTwist: { value: 0 },
    };
    const branchDepth = windDepthMaterial('branch', windUniforms);
    const leafDepth = windDepthMaterial('leaf', windUniforms);
    const hidden = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide });
    const treeGroup = new THREE.Group();
    scene.add(treeGroup);
    const stats = { segments: 0, leaves: 0 };

    function instanced(geometry, count, depthMat) {
        const mesh = new THREE.InstancedMesh(geometry, hidden, count);
        mesh.customDepthMaterial = depthMat;
        mesh.castShadow = true;
        mesh.frustumCulled = false;
        treeGroup.add(mesh);
        return mesh;
    }

    function clear(group) {
        for (const child of [...group.children]) {
            child.geometry.dispose();
            if (child.isInstancedMesh) child.dispose();
            group.remove(child);
        }
    }

    function buildWall() {
        clear(wallGroup);
        const plane = () => new THREE.PlaneGeometry(30, 20);
        const paint = new THREE.Mesh(plane(), paintMat);
        paint.position.set(p.granite ? p.seam + 15 : 0, 0, -0.001);
        paint.receiveShadow = true;
        wallGroup.add(paint);
        if (p.granite) {
            const granite = new THREE.Mesh(plane(), graniteMat);
            granite.position.set(p.seam - 15, 0, 0);
            granite.receiveShadow = true;
            wallGroup.add(granite);
        }
        if (p.ribs) {
            // vertical ribs on the painted wall, optionally broken by a horizontal gap
            const runs = p.ribGap ? [[0.9, 12], [-12, 0.65]] : [[-12, 12]];
            const start = p.granite ? p.seam + 2.1 : -12;
            const xs = [];
            for (let x = start; x < 16; x += Math.max(p.ribSpacing, p.ribWidth + 0.02)) xs.push(x);
            const ribs = new THREE.InstancedMesh(new THREE.BoxGeometry(p.ribWidth, 1, p.ribDepth), paintMat, xs.length * runs.length);
            const m = new THREE.Matrix4();
            let i = 0;
            for (const x of xs) {
                for (const [y0, y1] of runs) {
                    m.compose(
                        new THREE.Vector3(x, (y0 + y1) / 2, p.ribDepth / 2),
                        new THREE.Quaternion(),
                        new THREE.Vector3(1, y1 - y0, 1)
                    );
                    ribs.setMatrixAt(i++, m);
                }
            }
            ribs.castShadow = ribs.receiveShadow = true;
            wallGroup.add(ribs);
        }
    }

    function buildTree() {
        clear(treeGroup);
        const { segments, leaves } = growTree(p);
        stats.segments = segments.length;
        stats.leaves = leaves.length;
        const m = new THREE.Matrix4();
        const q = new THREE.Quaternion();
        const UP = new THREE.Vector3(0, 1, 0);

        if (segments.length) {
            const geo = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true).translate(0, 0.5, 0);
            const radius = new Float32Array(segments.length * 2);
            const flex = new Float32Array(segments.length * 2);
            const mesh = instanced(geo, segments.length, branchDepth);
            segments.forEach((s, i) => {
                const dir = s.b.clone().sub(s.a);
                const len = dir.length();
                q.setFromUnitVectors(UP, dir.normalize());
                m.compose(s.a, q, new THREE.Vector3(1, len, 1));
                mesh.setMatrixAt(i, m);
                radius.set([s.r0, s.r1], i * 2);
                flex.set([s.f0, s.f1], i * 2);
            });
            geo.setAttribute('aRadius', new THREE.InstancedBufferAttribute(radius, 2));
            geo.setAttribute('aFlex', new THREE.InstancedBufferAttribute(flex, 2));
        }

        if (leaves.length) {
            // ovate leaf, base at the origin, tip at +y
            const w = p.leafWidth;
            const shape = new THREE.Shape();
            shape.moveTo(0, 0);
            shape.bezierCurveTo(0.38 * w, 0.12, 0.34 * w, 0.68, 0, 1);
            shape.bezierCurveTo(-0.34 * w, 0.68, -0.38 * w, 0.12, 0, 0);
            const geo = new THREE.ShapeGeometry(shape, 5);
            const flex = new Float32Array(leaves.length * 2);
            const mesh = instanced(geo, leaves.length, leafDepth);
            leaves.forEach((l, i) => {
                m.compose(l.pos, l.quat, new THREE.Vector3(l.scale, l.scale, l.scale));
                mesh.setMatrixAt(i, m);
                flex.set([l.flex, l.flex], i * 2);
            });
            geo.setAttribute('aFlex', new THREE.InstancedBufferAttribute(flex, 2));
        }
    }

    // camera + post
    const camera = new THREE.PerspectiveCamera(30, 16 / 9, 1, 100);
    camera.position.set(0, 0, 18);

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'low-power' });
    renderer.setPixelRatio(1);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;

    const target = new THREE.WebGLRenderTarget(1, 1);
    const postUniforms = {
        tScene: { value: target.texture },
        uSub: { value: 1 },
        uBlack: { value: 0 },
        uWhite: { value: 1 },
        uPoster: { value: 0 },
        uMap: { value: true },
        uStops: { value: Array.from({ length: 5 }, () => new THREE.Vector3()) },
    };
    const post = new THREE.Mesh(
        new THREE.PlaneGeometry(2, 2),
        new THREE.ShaderMaterial({
            uniforms: postUniforms,
            vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
            fragmentShader: /* glsl */ `
                uniform sampler2D tScene;
                uniform int uSub;
                uniform float uBlack, uWhite, uPoster;
                uniform bool uMap;
                uniform vec3 uStops[5];
                void main() {
                    // mosaic: average the uSub x uSub scene samples under this cell
                    ivec2 base = ivec2(gl_FragCoord.xy) * uSub;
                    vec3 acc = vec3(0.0);
                    for (int j = 0; j < uSub; j++)
                        for (int i = 0; i < uSub; i++)
                            acc += texelFetch(tScene, base + ivec2(i, j), 0).rgb;
                    acc /= float(uSub * uSub);
                    // gradient map on perceptual luminance
                    float l = pow(dot(acc, vec3(0.2126, 0.7152, 0.0722)), 1.0 / 2.2);
                    l = clamp((l - uBlack) / max(uWhite - uBlack, 0.001), 0.0, 1.0); // levels
                    if (uPoster > 1.0) l = floor(l * uPoster) / (uPoster - 1.0);
                    l = clamp(l, 0.0, 1.0);
                    if (!uMap) { gl_FragColor = vec4(vec3(l), 1.0); return; }
                    l *= 4.0;
                    int k = int(min(floor(l), 3.0));
                    gl_FragColor = vec4(mix(uStops[k], uStops[k + 1], l - float(k)), 1.0);
                }
            `,
            depthTest: false,
        })
    );
    post.frustumCulled = false;
    const postScene = new THREE.Scene();
    postScene.add(post);
    const postCamera = new THREE.Camera();

    function resize() {
        const { width, height } = canvas.getBoundingClientRect();
        if (!width || !height) return;
        const sub = p.mosaic ? p.samples : 1;
        const cols = p.mosaic
            ? Math.round(THREE.MathUtils.clamp(width / p.cellSize, 4, 1024))
            : Math.round(width * Math.min(devicePixelRatio, 2));
        const rows = Math.max(1, Math.round((cols * height) / width));
        renderer.setSize(cols, rows, false);
        target.setSize(cols * sub, rows * sub);
        postUniforms.uSub.value = sub;
        // keep viewWidth units across; the height follows the aspect
        const aspect = width / height;
        camera.aspect = aspect;
        const halfH = p.viewWidth / 2 / aspect;
        camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(halfH / camera.position.z));
        camera.updateProjectionMatrix();
    }

    // Push the live (no-rebuild) params into lights, materials and uniforms.
    function apply() {
        graniteMat.color.set(p.graniteTint);
        paintMat.color.set(p.wallColor);
        sun.position.copy(sunDirection(p)).multiplyScalar(25);
        sun.intensity = p.sunIntensity;
        sun.shadow.radius = p.shadowSoftness;
        if (sun.shadow.mapSize.x !== p.shadowRes) {
            sun.shadow.mapSize.set(p.shadowRes, p.shadowRes);
            sun.shadow.map?.dispose();
            sun.shadow.map = null;
        }
        hemi.intensity = p.ambient;
        windUniforms.uSway.value = p.sway;
        windUniforms.uGustAmp.value = p.gustStrength;
        windUniforms.uFlutter.value = p.flutter;
        windUniforms.uGustFlutter.value = p.gustFlutter;
        windUniforms.uTwist.value = p.leafTwist;
        postUniforms.uWhite.value = p.white;
        postUniforms.uPoster.value = p.posterize;
        postUniforms.uMap.value = p.gradientMap;
        postUniforms.uStops.value.forEach((v, i) => {
            // palette colors stay in sRGB; the canvas shows them as-is
            const n = parseInt(p[`palette${i}`].slice(1), 16);
            v.set((n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
        });
        resize();
    }

    // Gusts: smooth random knots a few seconds apart, squared so it's mostly calm.
    const gustRand = mulberry32(404);
    const gustKnots = Array.from({ length: 64 }, gustRand);
    function gustAt(t) {
        const x = t / p.gustEvery;
        const i = Math.floor(x);
        const f = x - i;
        const s = f * f * (3 - 2 * f);
        const a = gustKnots[i % 64];
        const b = gustKnots[(i + 1) % 64];
        const g = a + (b - a) * s;
        return Math.max(0, g - p.gustThreshold) ** 2 * 2.4;
    }

    let time = 0;
    let introStart = null; // set on first play()
    function introBlack() {
        if (introStart === null || p.introDuration <= 0) return p.black;
        const k = Math.min((performance.now() - introStart) / 1000 / p.introDuration, 1);
        const ease = 1 - (1 - k) ** 3;
        // From light, the black point starts infinitely low (flat cream) and the
        // contrast ramps up; from dark, it starts at the white point (all shadow).
        const span = p.white - p.black;
        return p.introFromDark ? p.white - span * ease : p.white - span / Math.max(ease, 1e-4);
    }

    function render() {
        postUniforms.uBlack.value = introBlack();
        windUniforms.uTime.value = time;
        windUniforms.uGust.value = p.autoGust ? gustAt(time) : p.gust;
        renderer.setRenderTarget(target);
        renderer.render(scene, camera);
        renderer.setRenderTarget(null);
        renderer.render(postScene, postCamera);
    }

    let running = false;
    let visible = true;
    let last = 0;
    function loop(now) {
        if (!running) return;
        requestAnimationFrame(loop);
        if (!visible || now - last < 1000 / p.fps) return;
        time += (Math.min(now - last, 250) / 1000) * p.windSpeed;
        last = now;
        render();
    }

    buildWall();
    buildTree();
    apply();
    render();
    addEventListener('resize', () => {
        resize();
        if (!running) render();
    });
    new IntersectionObserver(([e]) => (visible = e.isIntersecting)).observe(canvas);

    return {
        params: p,
        stats,
        apply,
        render,
        rebuild() {
            buildWall();
            buildTree();
            apply();
            render();
        },
        play() {
            if (running) return;
            running = true;
            last = performance.now();
            if (introStart === null) this.replayIntro();
            requestAnimationFrame(loop);
        },
        replayIntro() {
            introStart = performance.now();
            render();
        },
        pause() {
            running = false;
        },
    };
}
