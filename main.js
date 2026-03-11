const canvas = document.getElementById('c');
const W = innerWidth, H = innerHeight, S = Math.min(W, H);
canvas.width = W; canvas.height = H;

const MAX_N = 30;

const P = { n: 14, kFactor: 0.015, orderedSize: 0.31, offset: 0.11, sizeVar: 1.4, sizeRange: 0.55, margin: 0.08, depth: 0.67, hold: 5, ramp: 0.3, curve: 2.5, sides: 0.78, pad: 0.0 };

let currentEase = 0;
let autoMode    = true;

const orderedData = new Float32Array(MAX_N * 3);
const chaoticData = new Float32Array(MAX_N * 3);
const liveData    = new Float32Array(MAX_N * 3);

// ── WebGL setup ───────────────────────────────────────────────────────────
const gl   = canvas.getContext('webgl');
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
    float v = clamp(d / 1.5 + 0.5, 0.0, 1.0);
    gl_FragColor = vec4(mix(uColorFg, uColorBg, v), 1.0);
  }
`;
const vs = gl.createShader(gl.VERTEX_SHADER);
gl.shaderSource(vs, vert); gl.compileShader(vs);
const fs = gl.createShader(gl.FRAGMENT_SHADER);
gl.shaderSource(fs, frag); gl.compileShader(fs);
const prog = gl.createProgram();
gl.attachShader(prog, vs); gl.attachShader(prog, fs);
gl.linkProgram(prog); gl.useProgram(prog);

const quadBuf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
const posLoc = gl.getAttribLocation(prog, 'pos');
gl.enableVertexAttribArray(posLoc);
gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

const locRes     = gl.getUniformLocation(prog, 'uRes');
const locK       = gl.getUniformLocation(prog, 'uK');
const locCircles = gl.getUniformLocation(prog, 'uCircles');
const locColorBg = gl.getUniformLocation(prog, 'uColorBg');
const locColorFg = gl.getUniformLocation(prog, 'uColorFg');
gl.uniform2f(locRes, W, H);
gl.uniform3f(locColorBg, 1, 1, 1);
gl.uniform3f(locColorFg, 0, 0, 0);

// ── Circle generation ─────────────────────────────────────────────────────
let _pathPts = [], _cumLen = [], _total = 0, _spacing = 0, _padPx = 0;

function randomiseChaotic() {
  const n = P.n;
  let si = 0;
  for (let i = 0; i < n; i++) {
    const tgt  = (i / Math.max(n - 1, 1)) * _total;
    while (si < _pathPts.length - 2 && _cumLen[si + 1] < tgt) si++;
    const frac = (tgt - _cumLen[si]) / (_cumLen[si + 1] - _cumLen[si] || 1);
    const px0  = _pathPts[si].x + frac * (_pathPts[si + 1].x - _pathPts[si].x);
    const py0  = _pathPts[si].y + frac * (_pathPts[si + 1].y - _pathPts[si].y);
    const px1  = px0 + (Math.random() - 0.5) * W * P.offset;
    const py1  = py0 + (Math.random() - 0.5) * H * P.offset;
    const t    = i / Math.max(n - 1, 1);
    const grad = 1 + Math.max(0, 1 - Math.abs(t - 0.5) * 2) * 0.35;
    const r    = _spacing * 0.65 * grad * (1.0 + (Math.random() * 2 - 1) * P.sizeRange) * P.sizeVar;
    const rMax = Math.min(px1 - _padPx, W - px1 - _padPx, py1 - _padPx, H - py1 - _padPx);
    chaoticData[i*3]   = px1;
    chaoticData[i*3+1] = py1;
    chaoticData[i*3+2] = Math.min(Math.max(_spacing * 0.35, r), rMax);
  }
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
  _pathPts = [];
  for (let i = 0; i <= STEPS; i++) {
    const u  = i / STEPS;
    const nu = 2 * u - 1;
    const ss = u * u * (3 - 2 * u);
    const xt = u + (ss - u) * P.sides;
    _pathPts.push({ x: lx + xt * (rx - lx), y: ty + (by - ty) * (1 - Math.pow(Math.abs(nu), P.curve)) });
  }
  _cumLen = [0];
  for (let i = 1; i <= STEPS; i++) {
    const dx = _pathPts[i].x - _pathPts[i-1].x, dy = _pathPts[i].y - _pathPts[i-1].y;
    _cumLen.push(_cumLen[i-1] + Math.sqrt(dx * dx + dy * dy));
  }
  _total   = _cumLen[STEPS];
  const n  = P.n;
  _spacing = _total / Math.max(n - 1, 1);
  let si = 0;

  for (let i = 0; i < n; i++) {
    const tgt  = (i / Math.max(n - 1, 1)) * _total;
    while (si < STEPS - 1 && _cumLen[si + 1] < tgt) si++;
    const frac = (tgt - _cumLen[si]) / (_cumLen[si + 1] - _cumLen[si] || 1);
    const px0  = _pathPts[si].x + frac * (_pathPts[si + 1].x - _pathPts[si].x);
    const py0  = _pathPts[si].y + frac * (_pathPts[si + 1].y - _pathPts[si].y);
    orderedData[i*3]   = px0;
    orderedData[i*3+1] = py0;
    orderedData[i*3+2] = Math.min(_spacing * P.orderedSize, Math.min(px0 - _padPx, W - px0 - _padPx, py0 - _padPx, H - py0 - _padPx));
  }

  for (let i = n; i < MAX_N; i++) {
    orderedData[i*3] = orderedData[i*3+1] = chaoticData[i*3] = chaoticData[i*3+1] = -99999;
    orderedData[i*3+2] = chaoticData[i*3+2] = 1;
  }

  randomiseChaotic();
  gl.uniform1f(locK, S * P.kFactor);
}

rebuild();

// ── Control panel ─────────────────────────────────────────────────────────
function setMode(auto) {
  autoMode = auto;
  document.getElementById('p-mode').textContent = auto ? '● auto' : '● manual';
  document.getElementById('p-mode').classList.toggle('on', auto);
  document.getElementById('p-btn').textContent = auto ? 'manual' : 'auto';
  document.getElementById('row-bl').classList.toggle('dim', auto);
}

document.getElementById('p-btn').addEventListener('click', () => setMode(!autoMode));

const pBody = document.getElementById('p-body');
const pCollapse = document.getElementById('p-collapse');
pCollapse.addEventListener('click', () => {
  const hidden = pBody.classList.toggle('hidden');
  pCollapse.textContent = hidden ? '+' : '-';
});

const PALETTE = [
  // vibrant
  '#ffed00', '#807ac6', '#5ab464', '#ff5100',
  '#374bd2', '#f197a1', '#8c0000',
  // greys
  '#e7e7e7', '#b3b6b9', '#4a4a49'
];

function hexToRgb(hex) {
  return [parseInt(hex.slice(1,3),16)/255, parseInt(hex.slice(3,5),16)/255, parseInt(hex.slice(5,7),16)/255];
}

function applyColors(bg, fg) {
  const [br,bg2,bb] = hexToRgb(bg);
  const [fr,fg2,fb] = hexToRgb(fg);
  gl.uniform3f(locColorBg, br, bg2, bb);
  gl.uniform3f(locColorFg, fr, fg2, fb);
  document.body.style.background = bg;
  document.getElementById('c-bg').value = bg;
  document.getElementById('c-fg').value = fg;
}

document.getElementById('c-random').addEventListener('click', () => {
  const shuffled = PALETTE.slice().sort(() => Math.random() - 0.5);
  applyColors(shuffled[0], shuffled[1]);
});
document.getElementById('c-bg').addEventListener('input', e => {
  const [r,g,b] = hexToRgb(e.target.value);
  gl.uniform3f(locColorBg, r, g, b);
  document.body.style.background = e.target.value;
});
document.getElementById('c-fg').addEventListener('input', e => {
  const [r,g,b] = hexToRgb(e.target.value);
  gl.uniform3f(locColorFg, r, g, b);
});


function wire(sliderId, valId, display, apply) {
  document.getElementById(sliderId).addEventListener('input', e => {
    document.getElementById(valId).textContent = display(+e.target.value);
    apply(+e.target.value);
  });
}

wire('s-n',    'v-n',     v => v,                          v => { P.n = v; rebuild(); });
wire('s-k',    'v-k',     v => (v/1000).toFixed(3),        v => { P.kFactor = v/1000; gl.uniform1f(locK, S * P.kFactor); });
wire('s-osz',  'v-osz',   v => (v/100).toFixed(2),         v => { P.orderedSize = v/100; rebuild(); });
wire('s-off',  'v-off',   v => (v/100).toFixed(2),         v => { P.offset = v/100; rebuild(); });
wire('s-sz',   'v-sz',    v => (v/100).toFixed(1)+'×',     v => { P.sizeVar = v/100; rebuild(); });
wire('s-var',  'v-var',   v => (v/100).toFixed(2),         v => { P.sizeRange = v/100; rebuild(); });
wire('s-mg',   'v-mg',    v => (v/100).toFixed(2),         v => { P.margin = v/100; rebuild(); });
wire('s-dp',   'v-dp',    v => (v/100).toFixed(2),         v => { P.depth = v/100; rebuild(); });
wire('s-curve','v-curve', v => (v/10).toFixed(1),          v => { P.curve = v/10; rebuild(); });
wire('s-sides','v-sides', v => (v/100).toFixed(2),         v => { P.sides = v/100; rebuild(); });
wire('s-pad',  'v-pad',   v => v + '%',                    v => { P.pad = v/100; rebuild(); });
wire('s-hold', 'v-hold',  v => v + 's',                    v => { P.hold = v; });
wire('s-ramp', 'v-ramp',  v => (v/10).toFixed(1) + 's',   v => { P.ramp = v/10; });

document.getElementById('s-bl').addEventListener('input', e => {
  if (autoMode) setMode(false);
  currentEase = e.target.value / 100;
  document.getElementById('v-bl').textContent = e.target.value + '%';
});

// ── Animation ─────────────────────────────────────────────────────────────
function holdEase(t) {
  const HOLD = P.hold, RAMP = P.ramp, PERIOD = (HOLD + RAMP) * 2;
  const phase = t % PERIOD;
  const s = x => x * x * (3 - 2 * x);
  if (phase < RAMP)            return s(phase / RAMP);
  if (phase < HOLD + RAMP)     return 1;
  if (phase < HOLD + RAMP * 2) return 1 - s((phase - HOLD - RAMP) / RAMP);
  return 0;
}

let start = null;
let lastTransition = -1;
function frame(ts) {
  requestAnimationFrame(frame);
  if (!start) start = ts;

  if (autoMode) {
    const t = Math.max(0, (ts - start) * 0.001 - 1);
    const PERIOD = (P.hold + P.ramp) * 2;
    // each half-period marks the start of a new transition
    const halfPeriod = Math.floor(t / (PERIOD / 2));
    if (halfPeriod !== lastTransition) {
      lastTransition = halfPeriod;
      randomiseChaotic();
    }
    currentEase = holdEase(t);
    const pct = Math.round(currentEase * 100);
    document.getElementById('s-bl').value = pct;
    document.getElementById('v-bl').textContent = pct + '%';
  }

  for (let i = 0; i < MAX_N * 3; i++) {
    liveData[i] = orderedData[i] + (chaoticData[i] - orderedData[i]) * currentEase;
  }
  gl.uniform3fv(locCircles, liveData);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}
requestAnimationFrame(frame);
