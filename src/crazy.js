// Crazy mode: a chain of big gradient orbs behind the list, hanging from the cursor like a metal
// chain, bouncing off the screen's edges. When nobody's touching it, an invisible hand plays with it.
// startCrazy() puts the canvas behind the page and returns { stop, tune }: stop removes it again,
// tune shows or hides the tuning panel. Tuned settings are kept per device.

const DEFAULTS = {
  count: 7, size: 1.3, overlap: 0.22, gravity: 0.75, swing: 0.992, bounce: 0.82,
  // palette sampled from the reference, violet end (at the hand) to yellow end
  p0: '#c684e4', p1: '#9a9ce3', p2: '#60c9e3', p3: '#73d2b9', p4: '#85db94', p5: '#b1e860', p6: '#eee952',
  scale: 1.1, flow: 0.18, warp: 1.1, react: 1, shift: 0, glow: 0.5, spread: 0.9, noise: 1.2, sheen: 1, trail: 0.85, smear: 1, grain: 0.03,
  ground: 0.6, walls: true,
}
const KEY = 'crazy'
const S = { ...DEFAULTS }
try { const saved = JSON.parse(localStorage.getItem(KEY) || '{}'); for (const k in DEFAULTS) if (k in saved) S[k] = saved[k] } catch {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)) } catch {} }
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
const MAX = 12

// The tuning panel: [key, label, min, max, step]; a heading on its own is a string.
const CONTROLS = [
  'Chain',
  ['count', 'Orbs', 2, MAX, 1], ['size', 'Size', 0.4, 2, 0.01], ['overlap', 'Overlap', 0, 0.7, 0.01],
  ['gravity', 'Gravity', 0, 2.5, 0.01], ['swing', 'Swing', 0.95, 1, 0.0005], ['bounce', 'Bounce', 0, 0.95, 0.01], 'walls',
  'Gradient',
  'palette',
  ['spread', 'Spread', 0, 2, 0.01], ['shift', 'Shift', -1, 1, 0.01], ['noise', 'Noise', 0, 3, 0.01],
  ['scale', 'Scale', 0.2, 4, 0.01], ['warp', 'Warp', 0, 3, 0.01], ['flow', 'Flow', 0, 1, 0.01],
  ['react', 'React', 0, 2, 0.01], ['sheen', 'Sheen', 0, 3, 0.01], ['glow', 'Glow', 0, 1, 0.01],
  ['trail', 'Trail', 0, 0.99, 0.005], ['smear', 'Smear', 0, 3, 0.01], ['grain', 'Grain', 0, 0.2, 0.005],
  'Ground',
  ['ground', 'Grey', 0.4, 0.85, 0.005],
]
const grey = (l) => { const v = Math.round(Math.min(Math.max(l, 0), 1) * 255); return `rgb(${v} ${v} ${v})` }
// the page's greys follow the ground: paper is the ground, chips and rules a little darker
function paint() {
  const st = document.documentElement.style
  st.setProperty('--paper', grey(S.ground))
  st.setProperty('--chip', grey(S.ground - .067))
  st.setProperty('--strong', grey(S.ground - .12))
  st.setProperty('--rule', grey(S.ground - .1))
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', grey(S.ground))
}
function unpaint() {
  const st = document.documentElement.style
  for (const k of ['--paper', '--chip', '--strong', '--rule']) st.removeProperty(k)
}

function buildPanel() {
  const el = document.createElement('div')
  el.className = 'tune'
  el.id = 'tune-panel'
  el.hidden = true
  el.setAttribute('role', 'region')
  el.setAttribute('aria-label', 'Crazy mode controls')
  const rows = CONTROLS.map((c) => {
    if (c === 'walls') return `<label class="tune-row wide tune-check"><input type="checkbox" data-k="walls"><span>Walls and floor</span></label>`
    if (c === 'palette') return `<div class="tune-row wide"><span>Colors</span><div class="tune-swatches">${[0, 1, 2, 3, 4, 5, 6].map((i) => `<input type="color" data-k="p${i}" aria-label="Color ${i + 1} of 7">`).join('')}</div></div>`
    if (typeof c === 'string') return `<h2>${c}</h2>`
    const [k, label, min, max, step] = c
    return `<label class="tune-row"><span>${label}</span><input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}"><output></output></label>`
  }).join('')
  el.innerHTML = rows + `<div class="tune-actions"><button type="button" data-act="copy" class="chip">Copy settings</button><button type="button" data-act="reset" class="chip">Reset</button><span class="tune-note" role="status"></span></div><textarea hidden readonly aria-label="Settings as JSON"></textarea>`
  const sync = () => {
    for (const input of el.querySelectorAll('[data-k]')) {
      const k = input.dataset.k
      if (input.type === 'checkbox') input.checked = S[k]
      else input.value = S[k]
      const out = input.parentElement.querySelector('output')
      if (out) { const v = Number(S[k]); out.textContent = v.toFixed((input.step.split('.')[1] || '').length) }
    }
  }
  el.addEventListener('input', (e) => {
    const k = e.target.dataset?.k
    if (!k) return
    const t = e.target.type
    S[k] = t === 'checkbox' ? e.target.checked : t === 'color' ? e.target.value : Number(e.target.value)
    save(); sync(); if (k === 'ground') paint()
  })
  el.addEventListener('click', (e) => {
    const act = e.target.dataset?.act
    const note = el.querySelector('.tune-note')
    if (act === 'reset') { Object.assign(S, DEFAULTS); save(); sync(); paint() }
    if (act === 'copy') {
      const json = JSON.stringify(S, null, 2)
      const fallback = () => { const t = el.querySelector('textarea'); t.hidden = false; t.value = json; t.focus(); t.select(); note.textContent = 'Select and copy' }
      try { navigator.clipboard.writeText(json).then(() => { note.textContent = 'Copied'; setTimeout(() => { note.textContent = '' }, 1600) }, fallback) } catch { fallback() }
    }
  })
  // keep the chain from chasing the cursor around inside the panel
  el.addEventListener('pointermove', (e) => e.stopPropagation())
  el.addEventListener('pointerdown', (e) => e.stopPropagation())
  sync()
  document.body.append(el)
  return el
}

const SHAPE = `
uniform int uCount;
uniform vec3 uB[${MAX}];
float shape(vec2 p) {
  float d = 1e5;
  for (int i = 0; i < ${MAX}; i++) {
    if (i >= uCount) break;
    d = min(d, length(p - uB[i].xy) - uB[i].z);
  }
  return d;
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1., 0.)), u.x), mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), u.x), u.y);
}
float fbm(vec2 p) { float v = 0., a = .5; for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + 17.; a *= .5; } return v; }
`

// Pass 1: the color field. The spectrum laid along the chain and swirled by noise, blended with
// last frame's field carried along by the orbs' motion, so colors trail behind fast moves.
const FIELD = `
precision highp float;
${SHAPE}
uniform vec2 uRes, uMouse;
uniform float uTime, uScale, uFlow, uWarp, uReact, uSpeed, uShift, uSpread, uNoise, uSheen, uGlow, uR, uKeep, uSmear, uDt;
uniform vec3 uPal[7];
uniform vec2 uV[${MAX}];
uniform sampler2D uPrev;
vec3 pal(float x) {
  vec3 c = uPal[0];
  for (int i = 0; i < 6; i++) c = mix(c, uPal[i + 1], smoothstep(0., 1., clamp(x - float(i), 0., 1.)));
  return c;
}
void main() {
  vec2 p = gl_FragCoord.xy;
  float m = min(uRes.x, uRes.y);
  float wsum = 0., tsum = 0.;
  vec2 vel = vec2(0.); float vs = 0.;
  for (int i = 0; i < ${MAX}; i++) {
    if (i >= uCount) break;
    float dist = length(p - uB[i].xy);
    float w = exp(-2.2 * dist / uB[i].z);
    wsum += w; tsum += w * float(i);
    float wv = exp(-2. * max(dist - uB[i].z * .5, 0.) / uB[i].z);
    vel += uV[i] * wv; vs += wv;
  }
  float along = tsum / max(wsum, 1e-5) / max(float(uCount - 1), 1.);

  vec2 q = p / m * uScale;
  float t = uTime * uFlow;
  float warp = uWarp * (1. + uReact * uSpeed * 2.5);
  vec2 wq = q + warp * vec2(fbm(q + vec2(0., t)), fbm(q + vec2(5.2, 1.3) - t));
  float n = fbm(wq * 1.4 + t * .6);
  float near = exp(-length(p - uMouse) / (m * .22));
  float x = along * uSpread + (n - .5) * uNoise + uShift - uReact * near * (.25 + .5 * uSpeed);
  // the outline lit toward the green-yellow end, with the swirl bending where the light reaches
  float rim = 1. - clamp(-shape(p + (vec2(n) - .5) * uR) / (.45 * uR), 0., 1.);
  x += uGlow * rim * rim * rim * .8;
  vec3 fresh = pal(clamp(x, 0., 1.) * 6.);
  fresh += smoothstep(.55, .95, fbm(wq * 2.2 - t)) * (.06 + .1 * uSpeed * uReact) * uSheen;

  vel /= max(vs, 1e-4);
  vec4 prev = texture2D(uPrev, (p - vel * uDt * uSmear) / uRes);
  gl_FragColor = vec4(mix(fresh, prev.rgb, uKeep * prev.a), 1.);
}`

// Pass 2: the page ground with the field clipped to the orbs, plus grain.
// (The cell grid is drawn by CSS on top, so it scrolls with the list.)
const PAGE = `
precision highp float;
${SHAPE}
uniform vec2 uRes;
uniform float uTime, uDpr, uGrain;
uniform vec3 uGround;
uniform sampler2D uField;
void main() {
  vec2 p = gl_FragCoord.xy;
  vec3 col = texture2D(uField, p / uRes).rgb + (hash(p + fract(uTime) * 91.7) - .5) * uGrain;
  float a = clamp(.5 - shape(p) / uDpr, 0., 1.);
  gl_FragColor = vec4(mix(uGround, col, a), 1.);
}`

const VERT = `attribute vec2 a; void main() { gl_Position = vec4(a, 0., 1.); }`

export function startCrazy() {
  const canvas = document.createElement('canvas')
  canvas.className = 'crazy-bg'
  canvas.setAttribute('aria-hidden', 'true')
  document.body.prepend(canvas)
  const gl = canvas.getContext('webgl', { antialias: false, premultipliedAlpha: false })
  if (!gl) { canvas.remove(); return { stop() {}, tune() {} } }

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches

  function program(frag, names) {
    const sh = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s))
      return s
    }
    const p = gl.createProgram()
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, frag))
    gl.linkProgram(p)
    const u = {}
    for (const n of names) u[n] = gl.getUniformLocation(p, n)
    return { p, u, a: gl.getAttribLocation(p, 'a') }
  }
  const field = program(FIELD, ['uCount', 'uB', 'uRes', 'uMouse', 'uTime', 'uScale', 'uFlow', 'uWarp', 'uReact', 'uSpeed', 'uShift', 'uSpread', 'uNoise', 'uSheen', 'uGlow', 'uR', 'uKeep', 'uSmear', 'uDt', 'uPal', 'uV', 'uPrev'])
  const page = program(PAGE, ['uCount', 'uB', 'uRes', 'uTime', 'uDpr', 'uGrain', 'uGround', 'uField'])
  const quad = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, quad)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)

  // two color-field buffers, swapped every frame (read last frame's, write this frame's)
  let targets = []
  function makeTargets() {
    for (const t of targets) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb) }
    targets = [0, 1].map(() => {
      const tex = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, canvas.width, canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      const fb = gl.createFramebuffer()
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT)
      return { tex, fb }
    })
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  let W = 0, H = 0, dpr = 1
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5)
    W = canvas.clientWidth; H = canvas.clientHeight
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr)
    makeTargets()
  }
  resize()

  // ---------- the chain ----------
  // The first orb is held by an invisible hand; the rest are loose weights under gravity, joined by
  // links that can't stretch. Verlet integration at a fixed 120 steps a second keeps it stable.
  // Left alone, the hand wanders around on its own. Wiggle the pointer and it notices, comes over and
  // follows the pointer until it settles, then wanders off again.
  const pointer = { x: W * .5, y: H * .25, last: -1e9 }
  let speed = 0
  const radius = () => S.size * Math.min(W, H) * 0.16
  const balls = Array.from({ length: MAX }, () => ({ x: W * .5, y: H * .5, px: W * .5, py: H * .5, vx: 0, vy: 0 }))
  // Wiggle: the pointer changing direction 6 times within 2 seconds, with real moves in between.
  // Ordinary mousing around doesn't count.
  const attn = { on: false, flips: [], dx: 0, dy: 0 }
  const onPointer = (e) => {
    const now = performance.now(), dx = e.clientX - pointer.x, dy = e.clientY - pointer.y
    pointer.x = e.clientX; pointer.y = e.clientY; pointer.last = now
    if (e.type !== 'pointermove') { attn.dx = attn.dy = 0; return }
    const ax = Math.abs(dx) > 3, ay = Math.abs(dy) > 3
    if ((ax && dx * attn.dx < 0) || (ay && dy * attn.dy < 0)) attn.flips.push(now)
    if (ax) attn.dx = dx
    if (ay) attn.dy = dy
    while (attn.flips.length && now - attn.flips[0] > 2000) attn.flips.shift()
    if (attn.flips.length >= 6) attn.on = true
  }

  // Idle: an invisible hand picks a move, makes it with a little overshoot, then picks another after
  // a random wait: lazy drifts, quick darts, a drop into the floor, a shake in place, or a pause.
  const wander = { x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0, k: 10, z: .6, next: 0, shakeFrom: 0, shakeTo: 0, shakeAmp: 0 }
  const rand = (a, b) => a + Math.random() * (b - a)
  const clampX = (x) => Math.min(Math.max(x, W * .12), W * .88)
  const high = () => Math.max(H * .1, radius() * 1.05)
  const clampY = (y, top = .62) => Math.min(Math.max(y, high()), Math.max(H * top, high()))
  function pick(t) {
    const w = wander, roll = Math.random()
    if (roll < .38) {
      w.tx = rand(W * .15, W * .85); w.ty = clampY(rand(H * .12, H * .42), .42); w.k = rand(5, 12); w.z = .6; w.next = t + rand(1.2, 3)
    } else if (roll < .66) {
      w.tx = clampX(w.x + rand(.2, .45) * W * (Math.random() < .5 ? -1 : 1)); w.ty = clampY(w.y + rand(-.12, .12) * H, .45)
      w.k = rand(70, 140); w.z = .38; w.next = t + rand(.35, 1)
    } else if (roll < .78) {
      w.tx = clampX(w.x + rand(-.1, .1) * W); w.ty = H * rand(.5, .62); w.k = rand(90, 150); w.z = .5; w.next = t + rand(.25, .45)
    } else if (roll < .9) {
      w.shakeFrom = t; w.shakeTo = t + rand(.35, .8); w.shakeAmp = radius() * rand(.25, .5); w.next = w.shakeTo + rand(.1, .5)
    } else {
      w.next = t + rand(.6, 1.8)
    }
  }
  function roam(h, t) {
    const w = wander
    if (!reduced && t >= w.next) pick(t)
    const damp = 2 * w.z * Math.sqrt(w.k)
    w.vx += (w.k * (w.tx - w.x) - damp * w.vx) * h; w.x += w.vx * h
    w.vy += (w.k * (w.ty - w.y) - damp * w.vy) * h; w.y += w.vy * h
    let sx = 0
    if (t < w.shakeTo) sx = Math.sin((t - w.shakeFrom) * Math.PI * 13) * w.shakeAmp * Math.sin(Math.PI * (t - w.shakeFrom) / (w.shakeTo - w.shakeFrom))
    return { x: w.x + sx, y: w.y }
  }

  function walls(b, r) {
    if (b.y > H - r) b.y = H - r
    if (b.y < r) b.y = r
    if (b.x < r) b.x = r
    if (b.x > W - r) b.x = W - r
  }
  // orbs that hit an edge bounce off it; slow contacts rest instead of buzzing
  function bounce(b, r, h) {
    const vx = b.x - b.px, vy = b.y - b.py, e = S.bounce, slow = 45 * h
    if (b.y >= H - r - 0.5) { b.px = b.x - vx * 0.96; if (vy > 0) b.py = vy > slow ? b.y + vy * e : b.y }
    if (b.y <= r + 0.5 && vy < 0) b.py = b.y + vy * e
    if (b.x <= r + 0.5 && vx < 0) b.px = vx < -slow ? b.x + vx * e : b.x
    if (b.x >= W - r - 0.5 && vx > 0) b.px = vx > slow ? b.x + vx * e : b.x
  }

  function tick(h, target) {
    const r = radius(), link = 2 * r * (1 - S.overlap)
    const g = S.gravity * 2600 * (Math.min(W, H) / 900)
    const keep = Math.pow(S.swing, h * 120)
    const head = balls[0]
    head.px = head.x; head.py = head.y
    head.x = target.x; head.y = target.y
    for (let i = 1; i < S.count; i++) {
      const b = balls[i]
      const vx = (b.x - b.px) * keep, vy = (b.y - b.py) * keep
      b.px = b.x; b.py = b.y
      b.x += vx; b.y += vy + g * h * h
    }
    // links only pull when stretched; solved from the hand down, then each orb gives back most of
    // the pull it handed on, so a quick yank doesn't throw the chain into the air
    const fix = new Float32Array(S.count * 2)
    for (let i = 1; i < S.count; i++) {
      const a = balls[i - 1], b = balls[i]
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1e-6
      const ox = b.x, oy = b.y
      if (d > link) { b.x = a.x + dx / d * link; b.y = a.y + dy / d * link }
      if (S.walls) walls(b, r)
      fix[i * 2] = b.x - ox; fix[i * 2 + 1] = b.y - oy
    }
    for (let i = 1; i < S.count - 1; i++) {
      balls[i].px += fix[(i + 1) * 2] * 0.9
      balls[i].py += fix[(i + 1) * 2 + 1] * 0.9
    }
    if (S.walls) for (let i = 1; i < S.count; i++) bounce(balls[i], r, h)
    const cap = 2600 * h * (Math.min(W, H) / 900)
    for (let i = 1; i < S.count; i++) {
      const b = balls[i], vx = b.x - b.px, vy = b.y - b.py, sp = Math.hypot(vx, vy)
      if (sp > cap) { b.px = b.x - vx / sp * cap; b.py = b.y - vy / sp * cap }
    }
    for (let i = 0; i < S.count; i++) {
      const b = balls[i]
      b.vx += ((b.x - b.px) / h - b.vx) * 0.2
      b.vy += ((b.y - b.py) / h - b.vy) * 0.2
    }
  }

  // Following: the hand springs after the pointer, so he swoops over with a little overshoot and
  // trails it slightly. When he first notices, he gives a quick excited shake.
  function chase(h, t) {
    const w = wander
    w.tx = pointer.x; w.ty = pointer.y; w.k = 80; w.z = .55
    return roam(h, t)
  }

  // The hand is stepped along with the physics, 120 times a second, so every move is smooth.
  const STEP = 1 / 120
  let acc = 0, following = false
  function step(dt, t, now) {
    // notice a wiggle; lose interest once the pointer has been still for most of a second
    if (attn.on && now - pointer.last > 900) { attn.on = false; attn.flips = [] }
    if (attn.on && !following) {
      following = true
      Object.assign(wander, { shakeFrom: t, shakeTo: t + .3, shakeAmp: radius() * .22, next: Infinity })
    } else if (!attn.on && following) {
      following = false
      // stay put for a beat, then wander off
      Object.assign(wander, { tx: wander.x, ty: wander.y, k: 30, z: .7, next: t + rand(.5, 1.2) })
    }
    acc = Math.min(acc + dt, 0.1)
    const n = Math.floor(acc / STEP)
    for (let k = 1; k <= n; k++) {
      const tk = t - (n - k) * STEP
      tick(STEP, following ? chase(STEP, tk) : roam(STEP, tk))
    }
    acc -= n * STEP
  }
  {
    const start = { x: W * .5, y: H * .3 }, link = 2 * radius() * (1 - S.overlap)
    balls.forEach((b, i) => { b.x = b.px = start.x; b.y = b.py = Math.min(start.y + i * link, H - radius()) })
    Object.assign(wander, { x: start.x, y: start.y, tx: start.x, ty: start.y, next: 20.5 })
  }
  for (let i = 0; i < 180; i++) step(1 / 60, 20 + i / 60, 0)

  // ---------- draw ----------
  const B = new Float32Array(MAX * 3), V = new Float32Array(MAX * 2)
  let last = performance.now(), clock = 20, cur = 0, raf = 0
  function use(prog) {
    gl.useProgram(prog.p)
    gl.bindBuffer(gl.ARRAY_BUFFER, quad)
    gl.enableVertexAttribArray(prog.a)
    gl.vertexAttribPointer(prog.a, 2, gl.FLOAT, false, 0, 0)
    gl.uniform1i(prog.u.uCount, S.count)
    gl.uniform3fv(prog.u.uB, B)
    gl.uniform2f(prog.u.uRes, canvas.width, canvas.height)
    gl.uniform1f(prog.u.uTime, clock)
  }
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05); last = now
    clock += dt
    step(dt, clock, now)
    const r = radius()
    for (let i = 0; i < MAX; i++) {
      const b = balls[i]
      B[i * 3] = b.x * dpr; B[i * 3 + 1] = (H - b.y) * dpr; B[i * 3 + 2] = r * dpr
      V[i * 2] = b.vx * dpr; V[i * 2 + 1] = -b.vy * dpr
    }
    let sum = 0
    for (let i = 0; i < S.count; i++) sum += Math.hypot(balls[i].vx, balls[i].vy)
    speed += (Math.min(sum / S.count / 1400, 1.5) - speed) * Math.min(dt * 4, 1)
    const read = targets[cur], write = targets[1 - cur]

    gl.bindFramebuffer(gl.FRAMEBUFFER, write.fb)
    gl.viewport(0, 0, canvas.width, canvas.height)
    use(field)
    const fu = field.u
    gl.uniform2f(fu.uMouse, balls[0].x * dpr, (H - balls[0].y) * dpr)
    gl.uniform1f(fu.uScale, S.scale)
    gl.uniform1f(fu.uFlow, reduced ? 0 : S.flow)
    gl.uniform1f(fu.uWarp, S.warp)
    gl.uniform1f(fu.uReact, S.react)
    gl.uniform1f(fu.uSpeed, speed)
    gl.uniform1f(fu.uShift, S.shift)
    gl.uniform1f(fu.uSpread, S.spread)
    gl.uniform1f(fu.uNoise, S.noise)
    gl.uniform1f(fu.uSheen, S.sheen)
    gl.uniform1f(fu.uGlow, S.glow)
    gl.uniform1f(fu.uR, r * dpr)
    gl.uniform1f(fu.uKeep, Math.pow(S.trail, dt * 60))
    gl.uniform1f(fu.uSmear, S.smear)
    gl.uniform1f(fu.uDt, dt)
    gl.uniform3fv(fu.uPal, [S.p0, S.p1, S.p2, S.p3, S.p4, S.p5, S.p6].flatMap(hex))
    gl.uniform2fv(fu.uV, V)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, read.tex)
    gl.uniform1i(fu.uPrev, 0)
    gl.drawArrays(gl.TRIANGLES, 0, 3)

    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    use(page)
    const pu = page.u
    gl.uniform1f(pu.uDpr, dpr)
    gl.uniform1f(pu.uGrain, S.grain)
    gl.uniform3f(pu.uGround, S.ground, S.ground, S.ground)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, write.tex)
    gl.uniform1i(pu.uField, 0)
    gl.drawArrays(gl.TRIANGLES, 0, 3)

    cur = 1 - cur
    raf = requestAnimationFrame(frame)
  }
  raf = requestAnimationFrame(frame)

  addEventListener('pointermove', onPointer)
  addEventListener('pointerdown', onPointer)
  addEventListener('resize', resize)
  paint()
  const panel = buildPanel()
  const stop = () => {
    panel.remove()
    unpaint()
    cancelAnimationFrame(raf)
    removeEventListener('pointermove', onPointer)
    removeEventListener('pointerdown', onPointer)
    removeEventListener('resize', resize)
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    canvas.remove()
  }
  const tune = (show = panel.hidden) => { panel.hidden = !show; return show }
  return { stop, tune }
}
