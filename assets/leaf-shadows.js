// Procedural header: a sunlit wall with tree-leaf shadows swaying in the wind,
// run through a mosaic + gradient map so it reads like the old header photo.
import * as THREE from 'three';

const canvas = document.getElementById('leaf-shadows');
const figure = canvas.closest('figure');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Brown gradient map, dark to light (sRGB, matches the site palette).
const PALETTE = ['#221810', '#45362a', '#7a634d', '#bfa586', '#f7ecdd'];
const MOSAIC = false; // off for now: render at full resolution
const SUB = MOSAIC ? 4 : 1; // scene samples per mosaic cell, per axis
const FPS = 24;
const VIEW_WIDTH = 16; // world units visible across the header

function mulberry32(seed) {
    return () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const rand = mulberry32(404);
const range = (a, b) => a + (b - a) * rand();

// ---------------------------------------------------------------- wall

const scene = new THREE.Scene();

function graniteTexture() {
    const size = 256;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    g.fillStyle = '#8a7a6c';
    g.fillRect(0, 0, size, size);
    for (let i = 0; i < 9000; i++) {
        const v = Math.floor(range(100, 220));
        g.fillStyle = `rgb(${v},${v * 0.92},${v * 0.85})`;
        const r = range(0.6, 2.2);
        g.fillRect(rand() * size, rand() * size, r, r);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(5, 5);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

const SEAM = 1.3; // granite on the left, painted wall on the right
const granite = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 20),
    new THREE.MeshLambertMaterial({ map: graniteTexture(), color: 0xf0e2d4 })
);
granite.position.set(SEAM - 15, 0, 0);
granite.receiveShadow = true;
scene.add(granite);

const paintMat = new THREE.MeshLambertMaterial({ color: 0xf2ebe0 });
const paint = new THREE.Mesh(new THREE.PlaneGeometry(30, 20), paintMat);
paint.position.set(SEAM + 15, 0, -0.001);
paint.receiveShadow = true;
scene.add(paint);

// Vertical ribs on the painted wall, broken by a horizontal gap.
const ribGeo = new THREE.BoxGeometry(0.3, 1, 0.14);
for (let x = 3.4; x < 16; x += 0.52) {
    for (const [y0, y1] of [[0.9, 12], [-12, 0.65]]) {
        const rib = new THREE.Mesh(ribGeo, paintMat);
        rib.scale.y = y1 - y0;
        rib.position.set(x, (y0 + y1) / 2, 0.07);
        rib.castShadow = rib.receiveShadow = true;
        scene.add(rib);
    }
}

// ---------------------------------------------------------------- sun

const SUN_DIR = new THREE.Vector3(5.5, 7, 7).normalize();
const sun = new THREE.DirectionalLight(0xfff1dc, 3.4);
sun.position.copy(SUN_DIR).multiplyScalar(25);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -15, right: 15, top: 15, bottom: -15, near: 1, far: 50 });
sun.shadow.radius = 4;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.01;
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xfff6ea, 0x3a2c20, 0.8));

// ---------------------------------------------------------------- tree

const segments = []; // { a, b, r0, r1, f0, f1 }
const leaves = []; // { pos, quat, scale, flex }

const UP = new THREE.Vector3(0, 1, 0);
const tmpQ = new THREE.Quaternion();

function addLeaf(pos, flex) {
    // Leaves face roughly toward the sun, with plenty of jitter.
    const normal = SUN_DIR.clone()
        .add(new THREE.Vector3(range(-1, 1), range(-1, 1), range(-1, 1)).multiplyScalar(0.9))
        .normalize();
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    quat.multiply(tmpQ.setFromAxisAngle(new THREE.Vector3(0, 0, 1), rand() * Math.PI * 2));
    leaves.push({ pos: pos.clone(), quat, scale: range(0.5, 0.8), flex });
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
        d.x += range(-0.12, 0.12);
        d.y += range(-0.12, 0.12) - 0.02 * depth; // twigs droop a little
        d.z += range(-0.06, 0.06);
        // keep the canopy in a slab between the wall and the sun
        if (pos.z < 2.6) d.z += 0.08;
        if (pos.z > 5.2) d.z -= 0.08;
        d.normalize();
        const next = pos.clone().addScaledVector(d, step);
        const r0 = radius * (1 - 0.6 * (i / steps));
        const r1 = radius * (1 - 0.6 * ((i + 1) / steps));
        const f1 = flex + step / 6;
        segments.push({ a: pos.clone(), b: next.clone(), r0, r1, f0: flex, f1 });

        if (depth < 2 && i % 2 === 1 && rand() < 0.6) {
            // twig leaves at 35-65 degrees from the parent, in the wall plane
            const angle = side * range(0.6, 1.1);
            const childDir = d.clone().applyAxisAngle(new THREE.Vector3(0, 0, 1), angle);
            grow(next, childDir, length * range(0.3, 0.5), r1 * 0.6, depth + 1, f1);
            side = -side;
        }
        if (depth >= 1 && i % 2 === 1) {
            const n = new THREE.Vector3(-d.y, d.x, 0);
            addLeaf(next.clone().addScaledVector(n, 0.22 * side).add(jitter(0.08)), f1);
            if (rand() < 0.4) addLeaf(next.clone().addScaledVector(n, -0.22 * side).add(jitter(0.08)), f1);
        }
        pos.copy(next);
        flex = f1;
    }
    if (depth >= 1) for (let k = 0; k < 3; k++) addLeaf(pos.clone().add(jitter(0.3)), flex);
}

function jitter(r) {
    return new THREE.Vector3(range(-r, r), range(-r, r), range(-r, r) * 0.6);
}

// Limbs reach in from outside the frame, up and to the right of it: the sun is
// up-right, so their shadows fall down-left onto the visible wall.
for (const [x, y, z, dx, dy, len] of [
    [14, 9, 4.2, -1, -0.35, 13],
    [13, 3, 3.4, -1, 0.1, 11],
    [6, 12, 3.8, -0.35, -1, 10],
    [-1, 11, 3.0, 0.15, -1, 9],
    [-9, 7, 4.6, 1, -0.25, 10],
    [-10, 1, 3.2, 1, 0.2, 7],
]) {
    grow(new THREE.Vector3(x, y, z), new THREE.Vector3(dx, dy, 0), len, 0.07, 0, 0.1);
}

// Shared wind, applied in the shadow (depth) pass only: the tree itself is never drawn.
const windUniforms = { uTime: { value: 0 }, uGust: { value: 0 } };
const WIND_GLSL = /* glsl */ `
    uniform float uTime;
    uniform float uGust;
    attribute vec2 aFlex;
    vec3 windOffset(vec3 p, float flex) {
        float w = sin(uTime * 1.1 - p.x * 0.35 + p.y * 0.12)
                + 0.5 * sin(uTime * 1.9 - p.x * 0.7 + 1.3)
                + 0.25 * sin(uTime * 3.3 + p.y * 0.9);
        float amp = (0.025 + 0.16 * uGust) * flex;
        return vec3(1.0, -0.35, 0.3) * w * amp;
    }
`;

function windDepthMaterial(kind) {
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
                // each leaf flutters around its own stem
                float a = sin(uTime * (5.0 + phase) + phase) * (0.12 + 0.7 * uGust);
                float c = cos(a), s = sin(a);
                transformed.xz = mat2(c, -s, s, c) * transformed.xz;
                vec4 wp = instanceMatrix * vec4(transformed, 1.0);
                wp.xyz += windOffset(anchor, aFlex.x);
                vec4 mvPosition = modelViewMatrix * wp;
                gl_Position = projectionMatrix * mvPosition;
            `);
    };
    mat.customProgramCacheKey = () => kind;
    return mat;
}

function instanced(geometry, count, depthMat) {
    const hidden = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.InstancedMesh(geometry, hidden, count);
    mesh.customDepthMaterial = depthMat;
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    scene.add(mesh);
    return mesh;
}

{
    const geo = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true).translate(0, 0.5, 0);
    const radius = new Float32Array(segments.length * 2);
    const flex = new Float32Array(segments.length * 2);
    const mesh = instanced(geo, segments.length, windDepthMaterial('branch'));
    const m = new THREE.Matrix4();
    segments.forEach((s, i) => {
        const dir = s.b.clone().sub(s.a);
        const len = dir.length();
        tmpQ.setFromUnitVectors(UP, dir.normalize());
        m.compose(s.a, tmpQ, new THREE.Vector3(1, len, 1));
        mesh.setMatrixAt(i, m);
        radius.set([s.r0, s.r1], i * 2);
        flex.set([s.f0, s.f1], i * 2);
    });
    geo.setAttribute('aRadius', new THREE.InstancedBufferAttribute(radius, 2));
    geo.setAttribute('aFlex', new THREE.InstancedBufferAttribute(flex, 2));
}

{
    // ovate leaf, base at the origin, tip at +y
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.bezierCurveTo(0.38, 0.12, 0.34, 0.68, 0, 1);
    shape.bezierCurveTo(-0.34, 0.68, -0.38, 0.12, 0, 0);
    const geo = new THREE.ShapeGeometry(shape, 5);
    const flex = new Float32Array(leaves.length * 2);
    const mesh = instanced(geo, leaves.length, windDepthMaterial('leaf'));
    const m = new THREE.Matrix4();
    leaves.forEach((l, i) => {
        m.compose(l.pos, l.quat, new THREE.Vector3(l.scale, l.scale, l.scale));
        mesh.setMatrixAt(i, m);
        flex.set([l.flex, l.flex], i * 2);
    });
    geo.setAttribute('aFlex', new THREE.InstancedBufferAttribute(flex, 2));
}

// ---------------------------------------------------------------- camera + post

const camera = new THREE.PerspectiveCamera(30, 16 / 9, 1, 100);
camera.position.set(0, 0, 18);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'low-power' });
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const target = new THREE.WebGLRenderTarget(1, 1);

const post = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
        uniforms: {
            tScene: { value: target.texture },
            // palette colors stay in sRGB; the canvas shows them as-is
            uStops: {
                value: PALETTE.map((hex) => {
                    const n = parseInt(hex.slice(1), 16);
                    return new THREE.Vector3((n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
                }),
            },
        },
        vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: /* glsl */ `
            uniform sampler2D tScene;
            uniform vec3 uStops[5];
            void main() {
                // mosaic: average the SUB x SUB scene samples under this cell
                ivec2 base = ivec2(gl_FragCoord.xy) * ${SUB};
                vec3 acc = vec3(0.0);
                for (int j = 0; j < ${SUB}; j++)
                    for (int i = 0; i < ${SUB}; i++)
                        acc += texelFetch(tScene, base + ivec2(i, j), 0).rgb;
                acc /= float(${SUB * SUB});
                // gradient map on perceptual luminance
                float l = pow(dot(acc, vec3(0.2126, 0.7152, 0.0722)), 1.0 / 2.2);
                l = clamp((l - 0.12) / 0.62, 0.0, 1.0) * 4.0; // levels
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
    const cols = MOSAIC
        ? Math.round(THREE.MathUtils.clamp(width / 13, 48, 128))
        : Math.round(width * Math.min(devicePixelRatio, 2));
    const rows = Math.max(1, Math.round((cols * height) / width));
    renderer.setSize(cols, rows, false);
    target.setSize(cols * SUB, rows * SUB);
    // keep VIEW_WIDTH units across; the height follows the aspect
    const aspect = width / height;
    camera.aspect = aspect;
    const halfH = VIEW_WIDTH / 2 / aspect;
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(halfH / camera.position.z));
    camera.updateProjectionMatrix();
}

// ---------------------------------------------------------------- wind + loop

// Gusts: smooth random knots a few seconds apart, squared so it's mostly calm.
const gustKnots = Array.from({ length: 64 }, () => rand());
function gustAt(t) {
    const x = t / 3.5;
    const i = Math.floor(x);
    const f = x - i;
    const s = f * f * (3 - 2 * f);
    const a = gustKnots[i % 64];
    const b = gustKnots[(i + 1) % 64];
    const g = a + (b - a) * s;
    return Math.max(0, g - 0.35) ** 2 * 2.4;
}

function render(t) {
    windUniforms.uTime.value = t;
    windUniforms.uGust.value = gustAt(t);
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(postScene, postCamera);
}

let visible = true;
let last = 0;
function loop(now) {
    requestAnimationFrame(loop);
    if (!visible || now - last < 1000 / FPS) return;
    last = now;
    render(now / 1000);
}

figure.classList.add('live'); // swap the fallback photo for the canvas
resize();
render(0);
addEventListener('resize', () => {
    resize();
    if (reduceMotion) render(0);
});
if (!reduceMotion) {
    new IntersectionObserver(([e]) => (visible = e.isIntersecting)).observe(canvas);
    requestAnimationFrame(loop);
}
