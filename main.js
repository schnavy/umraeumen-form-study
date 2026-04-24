const canvas = document.getElementById('c');
let W = innerWidth, H = innerHeight, S = Math.min(W, H);
canvas.width = W;
canvas.height = H;

const MAX_N = 30;

const P = {
    n: 14,
    kFactor: 0.05,
    kFactorChaotic: 0.05,
    speedVar: 0,
    orderedSize: 0.31,
    offset: 0.11,
    sizeVar: 1.4,
    sizeRange: 0.55,
    margin: 0.08,
    depth: 0.67,
    hold: 5,
    ramp: 0.3,
    curve: 2.5,
    sides: 0.78,
    pad: 0,
    tilt: 0,
    chaoticMode: 'offset',
    groupSize: 4,
    detour: 0,
    detourMode: 'arc',
    edgeMode: 'contain'
};

let currentEase = 0;
let autoMode = true;

const orderedData = new Float32Array(MAX_N * 3);
const chaoticData = new Float32Array(MAX_N * 3);
const liveData = new Float32Array(MAX_N * 3);
const _detourSign = new Float32Array(MAX_N);
const _speedVariation = new Float32Array(MAX_N);

// ── WebGL setup ───────────────────────────────────────────────────────────
const gl = canvas.getContext('webgl');
const vert = `attribute vec2 pos; void main(){gl_Position=vec4(pos,0,1);}`;
const frag = `
  precision mediump float;
  #define N ${MAX_N}
  uniform vec2 uRes;
  uniform float uK;
  uniform vec3 uCircles[N];
  uniform vec3 uColorBg, uColorFg;
  float smin(float a, float b, float k) {
    float h = max(k - abs(a - b), 0.0) / k;
    return min(a, b) - h * h * k * 0.25;
  }
  void main() {
    vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
    float d = 1.0e9;
    for (int i = 0; i < N; i++) {
      float dc = length(p - uCircles[i].xy) - uCircles[i].z;
      d = smin(d, dc, uK);
    }
    float v = clamp(d / 0.8 + 0.5, 0.0, 1.0);
    gl_FragColor = vec4(mix(uColorFg, uColorBg, v), 1.0);
  }
`;
const vs = gl.createShader(gl.VERTEX_SHADER);
gl.shaderSource(vs, vert);
gl.compileShader(vs);
const fs = gl.createShader(gl.FRAGMENT_SHADER);
gl.shaderSource(fs, frag);
gl.compileShader(fs);
const prog = gl.createProgram();
gl.attachShader(prog, vs);
gl.attachShader(prog, fs);
gl.linkProgram(prog);
gl.useProgram(prog);

const quadBuf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
const posLoc = gl.getAttribLocation(prog, 'pos');
gl.enableVertexAttribArray(posLoc);
gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

const locRes = gl.getUniformLocation(prog, 'uRes');
const locK = gl.getUniformLocation(prog, 'uK');
const locCircles = gl.getUniformLocation(prog, 'uCircles');
const locColorBg = gl.getUniformLocation(prog, 'uColorBg');
const locColorFg = gl.getUniformLocation(prog, 'uColorFg');
gl.uniform2f(locRes, W, H);
const [bgr, bgg, bgb] = hexToRgb('#e7e7e7');
const [fgr, fgg, fgb] = hexToRgb('#4a4a49');
gl.uniform3f(locColorBg, bgr, bgg, bgb);
gl.uniform3f(locColorFg, fgr, fgg, fgb);

// ── Circle generation ─────────────────────────────────────────────────────
let _pathPts = [], _cumLen = [], _total = 0, _spacing = 0, _padPx = 0;

function circleR(i, n) {
    const t = i / Math.max(n - 1, 1);
    const grad = 1 + Math.max(0, 1 - Math.abs(t - 0.5) * 2) * 0.35;
    return _spacing * 0.65 * grad * (1.0 + (Math.random() * 2 - 1) * P.sizeRange) * P.sizeVar;
}

function placeCircle(i, n, px, py) {
    const r = circleR(i, n);
    const rMax = Math.min(px - _padPx, W - px - _padPx, py - _padPx, H - py - _padPx);
    if (P.edgeMode === 'restrict' && r > rMax) return;
    chaoticData[i * 3] = px;
    chaoticData[i * 3 + 1] = py;
    chaoticData[i * 3 + 2] = P.edgeMode === 'overflow'
        ? Math.max(_spacing * 0.35, r)
        : Math.min(Math.max(_spacing * 0.35, r), rMax);
}

// Ensure circles absent from either state are absent from both, so blending
// never causes a circle to fly between a valid position and the parked sentinel.
function syncRestrict() {
    if (P.edgeMode !== 'restrict') return;
    const n = P.n;
    for (let i = 0; i < n; i++) {
        if (orderedData[i * 3] < -9000 || chaoticData[i * 3] < -9000) {
            orderedData[i * 3] = orderedData[i * 3 + 1] = -99999;
            orderedData[i * 3 + 2] = 1;
            chaoticData[i * 3] = chaoticData[i * 3 + 1] = -99999;
            chaoticData[i * 3 + 2] = 1;
        }
    }
}

function randomiseChaotic() {
    const n = P.n;

    // In restrict mode, pre-mark active slots as absent so any circle that
    // placeCircle skips simply stays absent rather than holding stale data.
    if (P.edgeMode === 'restrict') {
        for (let i = 0; i < n; i++) {
            chaoticData[i * 3] = chaoticData[i * 3 + 1] = -99999;
            chaoticData[i * 3 + 2] = 1;
        }
    }

    if (P.chaoticMode === 'island') {
        const gs = Math.max(1, P.groupSize);
        const numGroups = Math.ceil(n / gs);
        const margin = _padPx + _spacing;
        const spread = _spacing * 1.5;
        const centers = [];
        for (let g = 0; g < numGroups; g++) {
            centers.push({
                x: margin + Math.random() * (W - 2 * margin),
                y: margin + Math.random() * (H - 2 * margin)
            });
        }
        for (let i = 0; i < n; i++) {
            const c = centers[Math.floor(i / gs)];
            placeCircle(i, n, c.x + (Math.random() - 0.5) * spread, c.y + (Math.random() - 0.5) * spread);
        }

    } else if (P.chaoticMode === 'random') {
        for (let i = 0; i < n; i++) {
            placeCircle(i, n,
                _padPx + Math.random() * (W - 2 * _padPx),
                _padPx + Math.random() * (H - 2 * _padPx));
        }

    } else if (P.chaoticMode === 'collect') {
        const r = _spacing * P.orderedSize;
        const cell = r * 2.2;
        const maxCols = Math.max(1, Math.floor((W - 2 * _padPx) / cell));
        const maxRows = Math.max(1, Math.floor((H - 2 * _padPx) / cell));
        const valid = [];
        for (let c = 1; c <= Math.min(n, maxCols); c++) {
            const ro = Math.ceil(n / c);
            if (ro <= maxRows) valid.push([c, ro]);
        }
        const [cols, rows] = valid[Math.floor(Math.random() * valid.length)] || [Math.min(n, maxCols), Math.ceil(n / Math.min(n, maxCols))];
        const gridW = cols * cell;
        const gridH = rows * cell;
        const ox = _padPx + Math.random() * Math.max(0, W - 2 * _padPx - gridW);
        const oy = _padPx + Math.random() * Math.max(0, H - 2 * _padPx - gridH);
        for (let i = 0; i < n; i++) {
            const col = i % cols;
            const row = Math.floor(i / cols);
            chaoticData[i * 3] = ox + col * cell + cell / 2;
            chaoticData[i * 3 + 1] = oy + row * cell + cell / 2;
            chaoticData[i * 3 + 2] = r;
        }

    } else if (P.chaoticMode === 'disk') {
        const r = _spacing * P.orderedSize;
        const R = r * Math.sqrt(n) * 1.05;
        const margin = _padPx + R;
        const cx = margin + Math.random() * Math.max(0, W - 2 * margin);
        const cy = margin + Math.random() * Math.max(0, H - 2 * margin);
        const goldenAngle = Math.PI * (3 - Math.sqrt(5));
        for (let i = 0; i < n; i++) {
            const dr = Math.sqrt((i + 0.5) / n) * R;
            const theta = i * goldenAngle;
            chaoticData[i * 3] = cx + dr * Math.cos(theta);
            chaoticData[i * 3 + 1] = cy + dr * Math.sin(theta);
            chaoticData[i * 3 + 2] = r;
        }

    } else { // offset
        let si = 0;
        for (let i = 0; i < n; i++) {
            const tgt = (i / Math.max(n - 1, 1)) * _total;
            while (si < _pathPts.length - 2 && _cumLen[si + 1] < tgt) si++;
            const frac = (tgt - _cumLen[si]) / (_cumLen[si + 1] - _cumLen[si] || 1);
            const px0 = _pathPts[si].x + frac * (_pathPts[si + 1].x - _pathPts[si].x);
            const py0 = _pathPts[si].y + frac * (_pathPts[si + 1].y - _pathPts[si].y);
            placeCircle(i, n, px0 + (Math.random() - 0.5) * W * P.offset, py0 + (Math.random() - 0.5) * H * P.offset);
        }
    }

    for (let i = 0; i < MAX_N; i++) {
        _detourSign[i] = Math.random() < 0.5 ? 1 : -1;
        _speedVariation[i] = Math.random() * 2 - 1; // [-1, 1]
    }

    syncRestrict();
}

function rebuild() {
    _padPx = S * P.pad;
    const availW = W - 2 * _padPx;
    const availH = H - 2 * _padPx;
    const lx = _padPx + availW * P.margin;
    const rx = W - _padPx - availW * P.margin;
    const curveH = availH * P.depth;
    const ty = _padPx + (availH - curveH) / 2;
    const by = ty + curveH;

    const STEPS = 500;
    const midY = (ty + by) / 2;
    _pathPts = [];
    for (let i = 0; i <= STEPS; i++) {
        const u = i / STEPS;
        const nu = 2 * u - 1;
        const ss = u * u * (3 - 2 * u);
        const xt = u + (ss - u) * P.sides;
        const y = ty + (by - ty) * (1 - Math.pow(Math.abs(nu), P.curve));
        const x = lx + xt * (rx - lx) + P.tilt * (midY - y);
        _pathPts.push({x, y});
    }
    _cumLen = [0];
    for (let i = 1; i <= STEPS; i++) {
        const dx = _pathPts[i].x - _pathPts[i - 1].x, dy = _pathPts[i].y - _pathPts[i - 1].y;
        _cumLen.push(_cumLen[i - 1] + Math.sqrt(dx * dx + dy * dy));
    }
    _total = _cumLen[STEPS];
    const n = P.n;
    _spacing = _total / Math.max(n - 1, 1);
    let si = 0;

    // Pre-mark active ordered slots as absent so restrict skips leave clean state.
    if (P.edgeMode === 'restrict') {
        for (let i = 0; i < n; i++) {
            orderedData[i * 3] = orderedData[i * 3 + 1] = -99999;
            orderedData[i * 3 + 2] = 1;
        }
    }

    for (let i = 0; i < n; i++) {
        const tgt = (i / Math.max(n - 1, 1)) * _total;
        while (si < STEPS - 1 && _cumLen[si + 1] < tgt) si++;
        const frac = (tgt - _cumLen[si]) / (_cumLen[si + 1] - _cumLen[si] || 1);
        const px0 = _pathPts[si].x + frac * (_pathPts[si + 1].x - _pathPts[si].x);
        const py0 = _pathPts[si].y + frac * (_pathPts[si + 1].y - _pathPts[si].y);
        const or = _spacing * P.orderedSize;
        const orMax = Math.min(px0 - _padPx, W - px0 - _padPx, py0 - _padPx, H - py0 - _padPx);
        if (P.edgeMode === 'restrict' && or > orMax) continue;
        orderedData[i * 3] = px0;
        orderedData[i * 3 + 1] = py0;
        orderedData[i * 3 + 2] = P.edgeMode === 'overflow' ? or : Math.min(or, orMax);
    }

    for (let i = n; i < MAX_N; i++) {
        orderedData[i * 3] = orderedData[i * 3 + 1] = chaoticData[i * 3] = chaoticData[i * 3 + 1] = -99999;
        orderedData[i * 3 + 2] = chaoticData[i * 3 + 2] = 1;
    }

    randomiseChaotic();
    gl.uniform1f(locK, S * (P.kFactor + (P.kFactorChaotic - P.kFactor) * currentEase));
}

rebuild();

let _resizeTimer;
window.addEventListener('resize', () => {
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(() => {
        W = innerWidth;
        H = innerHeight;
        S = Math.min(W, H);
        canvas.width = W;
        canvas.height = H;
        gl.viewport(0, 0, W, H);
        gl.uniform2f(locRes, W, H);
        rebuild();
    }, 100);
});

// ── Control panel ─────────────────────────────────────────────────────────
function setMode(auto) {
    autoMode = auto;
    document.getElementById('p-mode').textContent = auto ? '● auto' : '● manual';
    document.getElementById('p-mode').classList.toggle('on', auto);
    document.getElementById('p-btn').textContent = auto ? 'manual' : 'auto';
    document.getElementById('row-bl').classList.toggle('dim', auto);
}

document.getElementById('p-btn').addEventListener('click', () => {
    setMode(!autoMode);
    updateURL();
});

const pBody = document.getElementById('p-body');
const pCollapse = document.getElementById('p-collapse');
pCollapse.addEventListener('click', () => {
    const hidden = pBody.classList.toggle('hidden');
    pCollapse.textContent = hidden ? '+' : '-';
});

const uiEls = [document.querySelector('h1'), document.querySelector('.primary-navigation-menu')];
document.getElementById('p-ui').addEventListener('click', function () {
    const hide = uiEls[0].style.display !== 'none';
    uiEls.forEach(el => {
        el.style.display = hide ? 'none' : '';
    });
    this.classList.toggle('on', hide);
});

const PALETTE = [
    // vibrant ('#5ab464' green removed)
    '#ffed00', '#807ac6', '#ff5100',
    '#374bd2', '#f197a1', '#8c0000',
    // greys
    '#e7e7e7', '#b3b6b9', '#4a4a49'
];

function hexToRgb(hex) {
    return [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255];
}

function applyColors(bg, fg) {
    const [br, bg2, bb] = hexToRgb(bg);
    const [fr, fg2, fb] = hexToRgb(fg);
    gl.uniform3f(locColorBg, br, bg2, bb);
    gl.uniform3f(locColorFg, fr, fg2, fb);
    document.body.style.background = bg;
    document.getElementById('c-bg').value = bg;
    document.getElementById('c-fg').value = fg;
}

document.getElementById('c-random').addEventListener('click', () => {
    const shuffled = PALETTE.slice().sort(() => Math.random() - 0.5);
    applyColors(shuffled[0], shuffled[1]);
    updateURL();
});
document.getElementById('c-bg').addEventListener('input', e => {
    const [r, g, b] = hexToRgb(e.target.value);
    gl.uniform3f(locColorBg, r, g, b);
    document.body.style.background = e.target.value;
    updateURL();
});
document.getElementById('c-fg').addEventListener('input', e => {
    const [r, g, b] = hexToRgb(e.target.value);
    gl.uniform3f(locColorFg, r, g, b);
    updateURL();
});


function wire(sliderId, valId, display, apply) {
    document.getElementById(sliderId).addEventListener('input', e => {
        document.getElementById(valId).textContent = display(+e.target.value);
        apply(+e.target.value);
        updateURL();
    });
}

wire('s-n', 'v-n', v => v, v => {
    P.n = v;
    rebuild();
});
wire('s-k', 'v-k', v => (v / 1000).toFixed(3), v => {
    P.kFactor = v / 1000;
});
wire('s-kc', 'v-kc', v => (v / 1000).toFixed(3), v => {
    P.kFactorChaotic = v / 1000;
});
wire('s-osz', 'v-osz', v => (v / 100).toFixed(2), v => {
    P.orderedSize = v / 100;
    rebuild();
});
wire('s-off', 'v-off', v => (v / 100).toFixed(2), v => {
    P.offset = v / 100;
    rebuild();
});
wire('s-sz', 'v-sz', v => (v / 100).toFixed(1) + '×', v => {
    P.sizeVar = v / 100;
    rebuild();
});
wire('s-var', 'v-var', v => (v / 100).toFixed(2), v => {
    P.sizeRange = v / 100;
    rebuild();
});
wire('s-mg', 'v-mg', v => (v / 100).toFixed(2), v => {
    P.margin = v / 100;
    rebuild();
});
wire('s-dp', 'v-dp', v => (v / 100).toFixed(2), v => {
    P.depth = v / 100;
    rebuild();
});
wire('s-curve', 'v-curve', v => (v / 10).toFixed(1), v => {
    P.curve = v / 10;
    rebuild();
});
wire('s-sides', 'v-sides', v => (v / 100).toFixed(2), v => {
    P.sides = v / 100;
    rebuild();
});
wire('s-pad', 'v-pad', v => v + '%', v => {
    P.pad = v / 100;
    rebuild();
});
wire('s-tilt', 'v-tilt', v => (v / 100).toFixed(2), v => {
    P.tilt = v / 200;
    rebuild();
});
wire('s-hold', 'v-hold', v => v + 's', v => {
    P.hold = v;
});
wire('s-ramp', 'v-ramp', v => (v / 10).toFixed(1) + 's', v => {
    P.ramp = v / 10;
});
wire('s-spv', 'v-spv', v => v, v => {
    P.speedVar = v / 100;
});
wire('s-detour', 'v-detour', v => (v / 100).toFixed(1), v => {
    P.detour = v / 100;
});
wire('s-gs', 'v-gs', v => v, v => {
    P.groupSize = v;
    randomiseChaotic();
});

function updateModeUI() {
    const m = P.chaoticMode;
    document.getElementById('row-off').classList.toggle('dim', m !== 'offset');
    document.getElementById('row-gs').classList.toggle('dim', m !== 'island');
}

document.getElementById('s-mode').addEventListener('change', e => {
    P.chaoticMode = e.target.value;
    updateModeUI();
    randomiseChaotic();
    updateURL();
});

document.getElementById('s-edge').addEventListener('change', e => {
    P.edgeMode = e.target.value;
    rebuild();
    updateURL();
});

document.getElementById('s-dtmode').addEventListener('change', e => {
    P.detourMode = e.target.value;
    updateURL();
});

document.getElementById('s-bl').addEventListener('input', e => {
    if (autoMode) setMode(false);
    currentEase = e.target.value / 100;
    document.getElementById('v-bl').textContent = e.target.value + '%';
    updateURL();
});

// ── URL state ─────────────────────────────────────────────────────────────
const URL_SLIDERS = ['n', 'k', 'kc', 'osz', 'off', 'gs', 'sz', 'var', 'mg', 'dp', 'curve', 'sides', 'pad', 'tilt', 'hold', 'ramp', 'spv', 'detour'];

let _suppressURLUpdate = false;

function encodeState() {
    const p = new URLSearchParams();
    URL_SLIDERS.forEach(k => p.set(k, document.getElementById('s-' + k).value));
    p.set('bl', document.getElementById('s-bl').value);
    p.set('mode', P.chaoticMode);
    p.set('edge', P.edgeMode);
    p.set('dtmode', P.detourMode);
    p.set('auto', autoMode ? '1' : '0');
    p.set('bg', document.getElementById('c-bg').value.slice(1));
    p.set('fg', document.getElementById('c-fg').value.slice(1));
    return p;
}

let _urlTimer = null;

function updateURL() {
    if (_suppressURLUpdate) return;
    clearTimeout(_urlTimer);
    _urlTimer = setTimeout(() => {
        history.replaceState(null, '', '?' + encodeState());
    }, 300);
}

function applyFromURL() {
    const p = new URLSearchParams(location.search);
    if (!p.has('n')) return;
    _suppressURLUpdate = true;
    URL_SLIDERS.forEach(k => {
        if (!p.has(k)) return;
        const el = document.getElementById('s-' + k);
        if (el) {
            el.value = p.get(k);
            el.dispatchEvent(new Event('input'));
        }
    });
    if (p.has('mode')) {
        const el = document.getElementById('s-mode');
        el.value = p.get('mode');
        el.dispatchEvent(new Event('change'));
    }
    if (p.has('edge')) {
        const el = document.getElementById('s-edge');
        el.value = p.get('edge');
        el.dispatchEvent(new Event('change'));
    }
    if (p.has('dtmode')) {
        const el = document.getElementById('s-dtmode');
        el.value = p.get('dtmode');
        el.dispatchEvent(new Event('change'));
    }
    if (p.has('bl')) {
        const v = +p.get('bl');
        document.getElementById('s-bl').value = v;
        document.getElementById('v-bl').textContent = v + '%';
        currentEase = v / 100;
    }
    if (p.has('auto')) setMode(p.get('auto') === '1');
    if (p.has('bg') && p.has('fg')) applyColors('#' + p.get('bg'), '#' + p.get('fg'));
    _suppressURLUpdate = false;
}

applyFromURL();

document.getElementById('p-random-all').addEventListener('click', () => {
    _suppressURLUpdate = true;
    const sliders = ['n', 'k', 'kc', 'osz', 'off', 'gs', 'sz', 'var', 'mg', 'dp', 'curve', 'sides', 'tilt', 'spv', 'detour'];
    sliders.forEach(k => {
        const el = document.getElementById('s-' + k);
        const min = +el.min, max = +el.max, step = +(el.step) || 1;
        const steps = Math.floor((max - min) / step);
        el.value = min + Math.floor(Math.random() * (steps + 1)) * step;
        el.dispatchEvent(new Event('input'));
    });
    const modes = ['offset', 'island', 'collect', 'disk']; // random removed
    const modeEl = document.getElementById('s-mode');
    modeEl.value = modes[Math.floor(Math.random() * modes.length)];
    modeEl.dispatchEvent(new Event('change'));
    const dtmodes = ['arc', 'cascade', 'radial'];
    const dtEl = document.getElementById('s-dtmode');
    dtEl.value = dtmodes[Math.floor(Math.random() * dtmodes.length)];
    dtEl.dispatchEvent(new Event('change'));
    const edges = ['contain', 'overflow']; // restrict removed
    const edgeEl = document.getElementById('s-edge');
    edgeEl.value = edges[Math.floor(Math.random() * edges.length)];
    edgeEl.dispatchEvent(new Event('change'));
    const shuffled = PALETTE.slice().sort(() => Math.random() - 0.5);
    applyColors(shuffled[0], shuffled[1]);
    _suppressURLUpdate = false;
    updateURL();
});

document.getElementById('p-link').addEventListener('click', () => {
    updateURL();
    navigator.clipboard.writeText(location.href).then(() => {
        const btn = document.getElementById('p-link');
        btn.textContent = 'copied!';
        setTimeout(() => {
            btn.textContent = 'copy link';
        }, 1500);
    });
});

document.getElementById('p-reset').addEventListener('click', () => {
    history.replaceState(null, '', location.pathname);
    location.reload();
});

// ── Animation ─────────────────────────────────────────────────────────────
function holdEase(t) {
    const HOLD = P.hold, RAMP = P.ramp, PERIOD = (HOLD + RAMP) * 2;
    const phase = t % PERIOD;
    const s = x => x * x * (3 - 2 * x);
    if (phase < RAMP) return s(phase / RAMP);
    if (phase < HOLD + RAMP) return 1;
    if (phase < HOLD + RAMP * 2) return 1 - s((phase - HOLD - RAMP) / RAMP);
    return 0;
}

let constraintEase = 0;
let constraintTarget = 0;
let constraintFrom = 0;
let constraintTs = 0;
let _constraintRawP = 0;
let _preConstraintAuto = false;
const CONSTRAINT_DUR = 600; // ms

let _organicActive = false;
let _organicTs = 0;
let _organicFrom = 0;
let _pendingAutoRestore = false;

canvas.addEventListener('click', () => {
    constraintTarget = constraintTarget === 0 ? 1 : 0;
    constraintFrom = constraintEase;
    constraintTs = performance.now();
    document.body.setAttribute('state', constraintTarget);
    if (constraintTarget === 1) {
        _preConstraintAuto = autoMode;
        if (autoMode) setMode(false);
    } else {
        _organicActive = false;
        _pendingAutoRestore = _preConstraintAuto;
        // auto mode restored only after release animation completes
    }
});

let start = null;
let lastTransition = -1;

function frame(ts) {
    requestAnimationFrame(frame);
    if (!start) start = ts;

    // smooth constraint transition
    if (constraintEase !== constraintTarget) {
        const p = Math.min((ts - constraintTs) / CONSTRAINT_DUR, 1);
        _constraintRawP = p;
        const ep = p * p * (3 - 2 * p); // smoothstep
        constraintEase = constraintFrom + (constraintTarget - constraintFrom) * ep;
        if (p >= 1) {
            constraintEase = constraintTarget;
            _constraintRawP = 1;
            if (constraintTarget === 0 && _pendingAutoRestore) {
                _pendingAutoRestore = false;
                // resume timeline at the start of "hold at organic" so auto begins from organic state
                start = ts - (P.ramp + 1) * 1000;
                const t0 = Math.max(0, (ts - start) * 0.001 - 1);
                lastTransition = Math.floor(t0 / ((P.hold + P.ramp)));
                setMode(true);
            }
        }
    }

    // stay organic while releasing constraint
    if (constraintTarget === 0 && constraintEase > 0) currentEase = 1;

    if (autoMode) {
        const t = Math.max(0, (ts - start) * 0.001 - 1);
        const PERIOD = (P.hold + P.ramp) * 2;
        // each half-period marks the start of a new transition
        const halfPeriod = Math.floor(t / (PERIOD / 2));
        if (halfPeriod !== lastTransition) {
            lastTransition = halfPeriod;
            if (halfPeriod % 2 === 0) randomiseChaotic();
        }
        currentEase = holdEase(t);
        const pct = Math.round(currentEase * 100);
        document.getElementById('s-bl').value = pct;
        document.getElementById('v-bl').textContent = pct + '%';
    }

    // after constraint settles, animate toward organic state
    if (constraintTarget === 1 && constraintEase === 1) {
        if (!_organicActive && currentEase < 1) {
            _organicActive = true;
            _organicTs = ts;
            _organicFrom = currentEase;
        }
    }
    if (_organicActive) {
        const p = Math.min((ts - _organicTs) / (P.ramp * 1000), 1);
        const ep = p * p * (3 - 2 * p);
        currentEase = _organicFrom + (1 - _organicFrom) * ep;
        if (p >= 1) {
            currentEase = 1;
            _organicActive = false;
        }
    }

    const t = currentEase;
    const _n = P.n;
    for (let i = 0; i < MAX_N; i++) {
        const ox = orderedData[i * 3], oy = orderedData[i * 3 + 1];
        const cx = chaoticData[i * 3], cy = chaoticData[i * 3 + 1];
        const dx = cx - ox, dy = cy - oy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        let px, py;

        const maxDelay = P.speedVar * 0.4;
        const duration = 1 - maxDelay;
        const delay = ((_speedVariation[i] + 1) / 2) * maxDelay;
        const tEff = duration > 0 ? Math.max(0, Math.min(1, (t - delay) / duration)) : t;

        if (P.detourMode === 'cascade') {
            // staggered timing: circles travel in sequence (index 0 leads)
            const stagger = P.detour * 0.4; // max ~0.8 of period is stagger offset
            const lag = (i / Math.max(_n - 1, 1)) * stagger;
            const tiBase = Math.max(0, Math.min(1, stagger > 0 ? (t - lag) / (1 - stagger) : t));
            const maxDelayC = P.speedVar * 0.4;
            const durationC = 1 - maxDelayC;
            const ti = durationC > 0 ? Math.max(0, Math.min(1, (tiBase - delay) / durationC)) : tiBase;
            const ti1 = 1 - ti;
            // small perpendicular arc per circle so they don't stack
            const amp = 0.2 * dist * _detourSign[i];
            const mx = (ox + cx) * 0.5 + (-dy / (dist || 1)) * amp;
            const my = (oy + cy) * 0.5 + (dx / (dist || 1)) * amp;
            px = ti1 * ti1 * ox + 2 * ti1 * ti * mx + ti * ti * cx;
            py = ti1 * ti1 * oy + 2 * ti1 * ti * my + ti * ti * cy;

        } else if (P.detourMode === 'radial') {
            // all paths curve toward the canvas centre — centripetal, orchestrated
            const midX = (ox + cx) * 0.5;
            const midY = (oy + cy) * 0.5;
            const mx = midX + (W * 0.5 - midX) * P.detour;
            const my = midY + (H * 0.5 - midY) * P.detour;
            const e1 = 1 - tEff;
            px = e1 * e1 * ox + 2 * e1 * tEff * mx + tEff * tEff * cx;
            py = e1 * e1 * oy + 2 * e1 * tEff * my + tEff * tEff * cy;

        } else {
            // arc (default): quadratic bezier, perpendicular midpoint offset
            const amp = P.detour * dist * 0.4 * _detourSign[i];
            const mx = (ox + cx) * 0.5 + (-dy / (dist || 1)) * amp;
            const my = (oy + cy) * 0.5 + (dx / (dist || 1)) * amp;
            const e1 = 1 - tEff;
            px = e1 * e1 * ox + 2 * e1 * tEff * mx + tEff * tEff * cx;
            py = e1 * e1 * oy + 2 * e1 * tEff * my + tEff * tEff * cy;
        }

        const stgDelay = ((_speedVariation[i] + 1) / 2) * 0.4;
        const stgP = Math.max(0, Math.min(1, (_constraintRawP - stgDelay) / 0.6));
        const stgEp = stgP * stgP * (3 - 2 * stgP);
        const ceI = constraintFrom + (constraintTarget - constraintFrom) * stgEp;
        const cxFactor = 1 - 0.75 * ceI;
        const rFactor = 1 - 0.5 * ceI;
        liveData[i * 3] = px * cxFactor;
        liveData[i * 3 + 1] = py;
        liveData[i * 3 + 2] = (orderedData[i * 3 + 2] + (chaoticData[i * 3 + 2] - orderedData[i * 3 + 2]) * tEff) * rFactor;
    }
    gl.uniform3fv(locCircles, liveData);
    gl.uniform1f(locK, S * (P.kFactor + (P.kFactorChaotic - P.kFactor) * currentEase));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

requestAnimationFrame(frame);
