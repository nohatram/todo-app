// His paintings: what you'd make in MS Paint with a mouse in about a minute. Tiny canvas, hard pixel
// brush, wobbly lines that overshoot or don't meet, flat Paint colors, and a bucket fill that misses
// the outline a bit. Scaled up so the pixels show. Six are in color, four are just black lines.
// Each one comes out a little different every time.
export const PAINT = { white: [255, 255, 255], black: [0, 0, 0], grey: [127, 127, 127], orange: [255, 127, 39], yellow: [255, 242, 0], green: [34, 177, 76], lime: [181, 230, 29], sky: [153, 217, 234], blue: [63, 72, 204], pink: [255, 174, 201], red: [237, 28, 36], purple: [163, 73, 164], brown: [185, 122, 87], dark: [136, 0, 21], violet: [200, 140, 230], teal: [96, 201, 227] }
let lastPainting = -1

function makeBrush(cv) {
  const Wc = cv.width, Hc = cv.height, ctx = cv.getContext('2d')
  const img = ctx.createImageData(Wc, Hc), px = img.data
  for (let i = 0; i < px.length; i += 4) { px[i] = px[i + 1] = px[i + 2] = px[i + 3] = 255 }
  const j = (a) => (Math.random() - .5) * 2 * a
  const set = (x, y, c) => { x |= 0; y |= 0; if (x < 0 || y < 0 || x >= Wc || y >= Hc) return; const i = (y * Wc + x) * 4; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2] }
  const dot = (x, y, c, size) => { for (let a = 0; a < size; a++) for (let b = 0; b < size; b++) set(x - (size >> 1) + a, y - (size >> 1) + b, c) }
  const line = (x0, y0, x1, y1, c, size) => {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1)
    for (let i = 0; i <= n; i++) dot(Math.round(x0 + (x1 - x0) * i / n), Math.round(y0 + (y1 - y0) * i / n), c, size)
  }
  const B = {
    W: Wc, H: Hc, C: PAINT, j,
    rand: (a, b) => a + Math.random() * (b - a),
    // a shaky hand-drawn stroke through points
    stroke(pts, c = PAINT.black, size = 2, wob = 1.3) {
      const q = pts.map(([x, y]) => [x + j(wob), y + j(wob)])
      for (let i = 1; i < q.length; i++) line(q[i - 1][0], q[i - 1][1], q[i][0], q[i][1], c, size)
    },
    // bucket fill that's slightly off from where the lines are
    fill(pts, c, miss = 2) {
      const ox = j(miss), oy = j(miss)
      pts = pts.map(([x, y]) => [x + ox, y + oy])
      let x0 = Wc, x1 = 0, y0 = Hc, y1 = 0
      for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y) }
      for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(Hc - 1, y1); y++) for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(Wc - 1, x1); x++) {
        let inside = false
        for (let i = 0, k = pts.length - 1; i < pts.length; k = i++) {
          const [xi, yi] = pts[i], [xk, yk] = pts[k]
          if ((yi > y) !== (yk > y) && x < (xk - xi) * (y - yi) / (yk - yi) + xi) inside = !inside
        }
        if (inside) set(x, y, c)
      }
    },
    // a lumpy ellipse, as points
    blob(cx, cy, rx, ry, lump = .1, n = 24) {
      return Array.from({ length: n }, (_, i) => {
        const a = i / n * Math.PI * 2, k = 1 + j(lump)
        return [cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]
      })
    },
    // trace a shape, closing it badly: overshooting the start, or stopping short of it
    outline(pts, c = PAINT.black, size = 2) {
      const close = Math.random() < .5 ? [pts[0], pts[1], [pts[2][0] + j(3), pts[2][1] + j(3)]] : [[pts[pts.length - 1][0] + j(2), pts[pts.length - 1][1] + j(2)]]
      B.stroke([...pts, ...close], c, size, 1)
    },
    shape(pts, fillColor, line = PAINT.black, size = 2) { if (fillColor) B.fill(pts, fillColor); B.outline(pts, line, size) },
    dot: (x, y, c = PAINT.black, size = 3) => dot(x + j(1), y + j(1), c, size),
    // Paint text: typed with the text tool, so it's hard-edged
    text(str, x, y, c = PAINT.black, size = 11, rot = 0) {
      const tc = document.createElement('canvas'); tc.width = Wc; tc.height = Hc
      const tx = tc.getContext('2d')
      tx.font = `bold ${size}px "Comic Sans MS", "Comic Neue", sans-serif`
      tx.translate(x, y); tx.rotate(rot); tx.fillText(str, 0, 0)
      const a = tx.getImageData(0, 0, Wc, Hc).data
      for (let i = 0; i < a.length; i += 4) if (a[i + 3] > 110) { px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2] }
    },
    done: () => ctx.putImageData(img, 0, 0),
  }
  return B
}

const PAINTINGS = [
  // 1. cat
  (B) => {
    const { C, j } = B
    B.fill([[0, 0], [B.W, 0], [B.W, 20 + j(4)], [0, 16 + j(4)]], C.sky, 0)
    const ground = Array.from({ length: 7 }, (_, i) => [i * B.W / 6, 72 + j(4)])
    B.fill([...ground, [B.W, B.H], [0, B.H]], C.green, 0); B.stroke(ground, C.black, 1)
    const sun = B.blob(104, 12, 9, 9, .12, 14); B.shape(sun, C.yellow, C.black, 1)
    for (let i = 0; i < 6; i++) { const a = i / 6 * 6.28 + .3; B.stroke([[104 + Math.cos(a) * 12, 12 + Math.sin(a) * 12], [104 + Math.cos(a) * 18, 12 + Math.sin(a) * 18]], C.yellow, 2) }
    B.shape(B.blob(72, 62, 23 + j(3), 10 + j(2), .1), C.orange)
    B.stroke([[92, 58], [99, 50], [98, 42], [94, 37], [100, 31]], C.orange, 3, 1.8)
    B.stroke([[58, 70], [56, 78]]); B.stroke([[83, 70], [85, 78]])
    const earL = [[29, 34], [29 + j(3), 12 + j(4)], [42, 27]], earR = [[50, 26], [64 + j(3), 11 + j(4)], [63, 34]]
    B.shape(earL, C.orange); B.shape(earR, C.orange)
    B.shape(B.blob(46, 43, 19 + j(3), 16 + j(2), .1), C.orange)
    B.dot(39, 38, C.black, 4); B.dot(54, 36, C.black, 2)
    B.fill([[45, 44], [49, 45], [47, 48]], C.pink, 1)
    B.stroke([[41, 49], [44, 52], [47, 49], [50, 53], [53, 49]], C.black, 1, .6)
    for (const s of [-1, 1]) for (let i = 0; i < 3; i++) B.stroke([[47 + s * 8, 46 + i * 3], [47 + s * (26 + j(6)), 41 + i * 5 + j(4)]], C.black, 1)
    B.fill([[14, 52], [10, 47], [10, 43], [13, 41], [16, 44], [19, 41], [22, 43], [22, 47], [18, 52], [16, 55]], C.red)
    B.text('4 U :)', 5, 14, C.red, 11, -.08)
  },
  // 2. dog
  (B) => {
    const { C, j } = B
    const ground = Array.from({ length: 7 }, (_, i) => [i * B.W / 6, 70 + j(4)])
    B.fill([...ground, [B.W, B.H], [0, B.H]], C.lime, 0)
    B.shape(B.blob(68, 55, 28, 13, .12), C.brown)
    for (const x of [48, 58, 78, 88]) B.stroke([[x + j(2), 64], [x + j(4), 78]], C.black, 3)
    B.stroke([[95, 50], [104, 40 + j(4)], [108, 36]], C.black, 3)
    B.shape(B.blob(36, 38, 16, 14, .12), C.brown)
    B.shape(B.blob(22, 42, 5, 11, .2), C.dark); B.shape(B.blob(50, 40, 5, 10, .2), C.dark)
    B.dot(31, 35, C.black, 3); B.dot(41, 36, C.black, 3)
    B.shape(B.blob(36, 45, 4, 3, .1), C.black, C.black, 1)
    B.fill([[33, 50], [39, 50], [37, 56], [34, 56]], C.pink, 1)
    B.stroke([[108, 20], [114, 18], [112, 24], [108, 20]], C.black, 1)
    B.text('woof', 72, 22, C.black, 12, .1)
    B.text('my dog', 6, 84, C.blue, 9)
  },
  // 3. house
  (B) => {
    const { C, j } = B
    B.fill([[0, 0], [B.W, 0], [B.W, B.H], [0, B.H]], C.sky, 0)
    const ground = Array.from({ length: 7 }, (_, i) => [i * B.W / 6, 70 + j(3)])
    B.fill([...ground, [B.W, B.H], [0, B.H]], C.green, 0)
    B.shape([[28, 40], [70 + j(3), 41], [69, 74], [29, 73]], C.red)
    B.shape([[22, 42], [49 + j(4), 16 + j(4)], [77, 43]], C.brown)
    B.shape([[44, 58], [54, 58], [54, 74], [44, 74]], C.dark, C.black, 1)
    B.shape([[32, 47], [41, 47], [41, 55], [32, 55]], C.yellow, C.black, 1); B.stroke([[36, 47], [36, 55]], C.black, 1); B.stroke([[32, 51], [41, 51]], C.black, 1)
    B.shape([[60, 22], [65, 22], [65, 33], [60, 31]], C.grey, C.black, 1)
    B.stroke([[62, 20], [60, 15], [65, 11], [62, 6], [66, 2]], C.grey, 2, 1)
    B.shape(B.blob(98, 52, 12, 10, .2), C.green); B.shape([[95, 60], [101, 60], [101, 74], [95, 74]], C.brown, C.black, 1)
    const sun = B.blob(14, 12, 8, 8, .15, 12); B.shape(sun, C.yellow, C.orange, 2)
    B.text('home', 82, 18, C.white, 11, -.1)
  },
  // 4. rainbow
  (B) => {
    const { C, j } = B
    B.fill([[0, 0], [B.W, 0], [B.W, B.H], [0, B.H]], C.sky, 0)
    const bands = [C.red, C.orange, C.yellow, C.green, C.blue, C.purple]
    bands.forEach((c, i) => {
      const r = 46 - i * 4.5
      B.stroke(Array.from({ length: 16 }, (_, k) => { const a = Math.PI + k / 15 * Math.PI; return [60 + Math.cos(a) * r, 80 + Math.sin(a) * r * .95] }), c, 5, 1.4)
    })
    for (const x of [18, 102]) B.shape(B.blob(x, 76, 16 + j(3), 8, .25, 14), C.white)
    B.text('yay', 48, 70, C.black, 13, .05)
  },
  // 5. a self portrait: him
  (B) => {
    const { C, j } = B
    B.fill([[0, 0], [B.W, 0], [B.W, B.H], [0, B.H]], C.grey, 0)
    const cols = [C.yellow, C.lime, C.teal, C.blue, C.violet]
    const pts = [[96, 70], [80, 58], [64, 50], [50, 40], [38, 30]]
    pts.forEach(([x, y], i) => B.shape(B.blob(x + j(3), y + j(3), 14 + j(2), 14 + j(2), .12), cols[i]))
    B.dot(33, 26, C.black, 3); B.dot(43, 25, C.black, 3)
    B.stroke([[32, 33], [37, 37], [44, 34]], C.black, 2, .6)
    B.stroke([[18, 4], [26, 14]], C.black, 1); B.stroke([[26, 14], [22, 14]], C.black, 1); B.stroke([[26, 14], [26, 10]], C.black, 1)
    B.text('ME', 6, 14, C.white, 12, -.1)
    B.text('handsome', 64, 16, C.white, 9, .08)
  },
  // 6. flower
  (B) => {
    const { C, j } = B
    B.shape([[44, 66], [76, 66], [72, 88], [48, 88]], C.brown)
    B.stroke([[60, 66], [58 + j(3), 50], [61, 34]], C.green, 3)
    B.shape([[58, 54], [46, 46], [44, 52]], C.green); B.shape([[61, 48], [74, 42], [73, 49]], C.green)
    for (let i = 0; i < 6; i++) { const a = i / 6 * 6.28 + j(.2); B.shape(B.blob(61 + Math.cos(a) * 10, 26 + Math.sin(a) * 10, 6, 6, .2, 10), C.pink, C.black, 1) }
    B.shape(B.blob(61, 26, 6, 6, .15, 10), C.yellow)
    const bee = B.blob(96, 18, 7, 5, .1, 12); B.shape(bee, C.yellow, C.black, 1)
    B.stroke([[94, 13], [94, 23]], C.black, 1); B.stroke([[98, 13], [98, 23]], C.black, 1)
    B.stroke([[88, 22], [82, 26], [78, 22], [74, 28]], C.black, 1, .8)
    B.text('4 u', 8, 18, C.purple, 13, -.15)
  },
  // 7. lines: you
  (B) => {
    const { C, j } = B
    B.outline(B.blob(56, 22, 11, 12, .12, 16))
    B.dot(52, 20, C.black, 2); B.dot(60, 20, C.black, 2)
    B.stroke([[51, 27], [56, 30], [61, 27]], C.black, 1)
    for (let i = 0; i < 5; i++) B.stroke([[48 + i * 4, 11], [46 + i * 5 + j(3), 4 + j(2)]], C.black, 1)
    B.stroke([[56, 34], [55, 62]])
    B.stroke([[56, 42], [40, 50 + j(6)], [34, 44]]); B.stroke([[56, 42], [72, 36 + j(6)], [80, 30]])
    B.stroke([[55, 62], [44, 84]]); B.stroke([[55, 62], [66, 84]])
    B.stroke([[96, 30], [80, 26]], C.black, 1); B.stroke([[80, 26], [85, 23]], C.black, 1); B.stroke([[80, 26], [85, 30]], C.black, 1)
    B.text('u', 98, 34, C.black, 14)
    B.text('ur so cool', 4, 84, C.black, 9, -.05)
  },
  // 8. lines: fish
  (B) => {
    const { C, j } = B
    const body = B.blob(52, 46, 28, 15, .08, 20); B.outline(body)
    B.outline([[80, 46], [100, 32 + j(3)], [98, 60 + j(3)]])
    B.outline(B.blob(36, 42, 4, 4, .1, 8), C.black, 1); B.dot(37, 42, C.black, 2)
    B.stroke([[26, 50], [32, 52]], C.black, 1)
    B.stroke([[50, 34], [56, 46], [50, 58]], C.black, 1)
    for (const [x, y, r] of [[20, 30, 3], [14, 20, 4], [22, 10, 2]]) B.outline(B.blob(x, y, r, r, .1, 8), C.black, 1)
    for (const y of [78, 84]) B.stroke(Array.from({ length: 9 }, (_, i) => [i * 15, y + (i % 2 ? 2 : -2)]), C.black, 1, .5)
    B.text('blub', 80, 16, C.black, 11, .1)
  },
  // 9. lines: car
  (B) => {
    const { C, j } = B
    B.outline([[14, 56], [102, 57], [104, 70], [12, 70]])
    B.outline([[34, 56], [42, 40 + j(2)], [76, 40 + j(2)], [86, 57]])
    B.stroke([[60, 41], [60, 56]], C.black, 1)
    for (const x of [32, 84]) { B.outline(B.blob(x, 72, 9, 9, .1, 14)); B.dot(x, 72, C.black, 3) }
    for (let i = 0; i < 3; i++) B.stroke([[2, 52 + i * 7], [8 + j(2), 52 + i * 7]], C.black, 1)
    B.text('vroom', 64, 20, C.black, 12, -.12)
  },
  // 10. lines: a cool sun
  (B) => {
    const { C, j } = B
    B.outline(B.blob(60, 45, 22, 21, .07, 20))
    for (let i = 0; i < 10; i++) { const a = i / 10 * 6.28 + j(.15); B.stroke([[60 + Math.cos(a) * 26, 45 + Math.sin(a) * 25], [60 + Math.cos(a) * (36 + j(4)), 45 + Math.sin(a) * (34 + j(4))]], C.black, 2) }
    B.fill([[44, 37], [58, 37], [56, 46], [46, 46]], C.black, 0); B.fill([[62, 37], [76, 37], [74, 46], [64, 46]], C.black, 0)
    B.stroke([[58, 39], [62, 39]], C.black, 1)
    B.stroke([[48, 54], [54, 59], [62, 60], [70, 55]])
    B.text('hot', 4, 84, C.black, 12)
  },
]

export function paintSomething(cv) {
  let n
  do n = Math.floor(Math.random() * PAINTINGS.length); while (n === lastPainting)
  lastPainting = n
  const B = makeBrush(cv)
  PAINTINGS[n](B)
  B.done()
  return n
}
