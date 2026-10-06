import * as THREE from 'three'

// AIエージェントの「街」。部門ごとの部屋（アイソメ3D）に、担当者の机と人が座っている。
// 表示専用。React 側から setAgents / setStates で中身を渡し、描画ループはここで回す。

export interface CityAgent { id: string; parent_id: string | null; layer: number; label: string; enabled: boolean; dept: string }
export type CityState = 'run' | 'warm' | 'err' | 'idle' | 'off'
export interface CityStateInfo { st: CityState; task?: string; wait?: number }
export interface CityCallbacks {
  onPickAgent: (id: string | null) => void
  onPickDept: (id: string) => void
  onZoom: (k: number) => void
}
export interface DeptStat { busy: number; bad: number; total: number; wait: number }

const FONT = '"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Yu Gothic",system-ui,sans-serif'
const ACCENT: Record<string, number> = { exec: 0xf5b942, site: 0x7c8cff, sns: 0xf472b6, gear: 0xfb923c, cs: 0x34d399, amazon: 0xfacc15, creashot: 0xa78bfa, other: 0x94a3b8 }
const STATE_COLOR: Record<CityState, number> = { run: 0x22d3ee, warm: 0x4ade80, err: 0xf87171, idle: 0x64748b, off: 0x334155 }
const SKIN = 0xf2c9a5
const TIER_COLOR = { boss: 0xf59e0b, lead: 0x38bdf8, staff: 0x6366f1, owner: 0xef4444 }

const SW = 1.5            // 通りの幅
const CELL_X = 1.9        // 机1台の横幅
const CELL_Z = 1.75
const BASE_VIEW = 20      // 正射影カメラの基準の高さ（ワールド単位）
const ELEV = Math.atan(1 / Math.SQRT2) // 等角投影の仰角（約35.26度）
const AZ = Math.PI / 4

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

interface TextSprite { sprite: THREE.Sprite; set: (text: string) => void; text: string; bw: number; bh: number; boost: number }
interface TextStyle { size: number; fg: string; bg: string; border?: string; pad?: number; height: number; radius?: number }

// 文字を貼ったカード（常にカメラの方を向く）。文字が変わったときだけ描き直す
function makeText(text: string, style: TextStyle): TextSprite {
  const canvas = document.createElement('canvas')
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.minFilter = THREE.LinearFilter
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false })
  const sprite = new THREE.Sprite(mat)
  sprite.renderOrder = 10
  const out: TextSprite = { sprite, text: '', set: () => {}, bw: 1, bh: 1, boost: 1 }
  out.set = (t: string) => {
    if (t === out.text) return
    out.text = t
    const dpr = 2
    const px = style.size * dpr
    const ctx = canvas.getContext('2d')!
    ctx.font = `700 ${px}px ${FONT}`
    const pad = (style.pad ?? 0.5) * px
    const w = Math.ceil(ctx.measureText(t).width + pad * 2)
    const h = Math.ceil(px * 1.5)
    canvas.width = w; canvas.height = h
    ctx.font = `700 ${px}px ${FONT}`
    ctx.textBaseline = 'middle'
    const r = (style.radius ?? 0.5) * h
    ctx.beginPath()
    ctx.roundRect(1, 1, w - 2, h - 2, r)
    ctx.fillStyle = style.bg
    ctx.fill()
    if (style.border) { ctx.lineWidth = 2 * dpr; ctx.strokeStyle = style.border; ctx.stroke() }
    ctx.fillStyle = style.fg
    ctx.fillText(t, pad, h / 2 + px * 0.04)
    tex.needsUpdate = true
    out.bw = (style.height * w) / h; out.bh = style.height
    sprite.scale.set(out.bw * out.boost, out.bh * out.boost, 1)
  }
  out.set(text)
  return out
}

function chevronTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 128; c.height = 128
  const g = c.getContext('2d')!
  g.fillStyle = '#5a4fe0'
  g.fillRect(0, 0, 128, 128)
  g.strokeStyle = 'rgba(255,255,255,.85)'
  g.lineWidth = 9; g.lineCap = 'round'; g.lineJoin = 'round'
  g.beginPath(); g.moveTo(44, 36); g.lineTo(84, 64); g.lineTo(44, 92); g.stroke()
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.anisotropy = 4
  return t
}

interface Slot { id: string; x: number; z: number }
interface Room { id: string; cx: number; cz: number; w: number; d: number; back: number; front: number; left: number; slots: Slot[] }
interface Street { x1: number; z1: number; x2: number; z2: number }
interface AgentObj {
  id: string; group: THREE.Group; fig: THREE.Group; body: THREE.MeshStandardMaterial; head: THREE.MeshStandardMaterial
  screen: THREE.MeshStandardMaterial; ring: THREE.Mesh; ringMat: THREE.MeshBasicMaterial; sel: THREE.Mesh
  name: TextSprite; bubble: TextSprite; warn: TextSprite; x: number; z: number; seed: number
  info: CityStateInfo; enabled: boolean; tier: 'boss' | 'lead' | 'staff' | 'owner'
}
interface DeptObj { id: string; sign: TextSprite; room: Room; glow: THREE.Mesh; glowMat: THREE.MeshBasicMaterial }
interface Walker { g: THREE.Group; seg: Street; t: number; dir: 1 | -1; speed: number; pause: number; phase: number }
interface Pop { s: TextSprite; age: number; x: number; z: number }

export class CityScene {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera: THREE.OrthographicCamera
  private root = new THREE.Group()
  private holder: HTMLElement
  private cb: CityCallbacks
  private raf = 0
  private ro: ResizeObserver
  private io: IntersectionObserver
  private visible = true
  private clock = new THREE.Clock()
  private time = 0

  private agentObjs = new Map<string, AgentObj>()
  private deptObjs = new Map<string, DeptObj>()
  private rooms = new Map<string, Room>()
  private streets: Street[] = []
  private walkers: Walker[] = []
  private pops: Pop[] = []
  private texts = new Set<TextSprite>()
  private pickables: THREE.Object3D[] = []
  private ownerObj: THREE.Group | null = null
  private ownerPos = { x: 0, z: 0 }
  private sig = ''
  private bounds = new THREE.Box3()
  private selected: string | null = null
  private hover: string | null = null
  private focusId: string | null = null
  private deptStats = new Map<string, DeptStat>()

  private target = new THREE.Vector3()
  private goalTarget = new THREE.Vector3()
  private zoom = 1
  private goalZoom = 1
  private fitZoom = 1
  private lastZoomReport = 0

  private ptrs = new Map<number, { x: number; y: number }>()
  private moved = false
  private pinch = 0
  private downAt = { x: 0, y: 0 }

  constructor(holder: HTMLElement, cb: CityCallbacks) {
    this.cb = cb
    this.holder = holder
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.scene.background = new THREE.Color(0xe4e1f8)
    this.scene.add(this.root)
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -200, 400)

    const hemi = new THREE.HemisphereLight(0xffffff, 0xb9c3ee, 1.35)
    this.scene.add(hemi)
    const sun = new THREE.DirectionalLight(0xffffff, 1.5)
    sun.position.set(-16, 28, 14)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.bias = -0.0006
    sun.shadow.normalBias = 0.03
    this.sun = sun
    this.scene.add(sun, sun.target)

    const el = this.renderer.domElement
    el.style.display = 'block'; el.style.width = '100%'; el.style.height = '100%'; el.style.touchAction = 'none'
    holder.appendChild(el)
    el.addEventListener('pointerdown', this.onDown)
    el.addEventListener('pointermove', this.onMove)
    el.addEventListener('pointerup', this.onUp)
    el.addEventListener('pointercancel', this.onCancel)
    el.addEventListener('pointerleave', this.onLeave)
    el.addEventListener('wheel', this.onWheel, { passive: false })
    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(holder)
    this.io = new IntersectionObserver((e) => { this.visible = e.some((x) => x.isIntersecting) })
    this.io.observe(holder)
    this.resize()
    this.loop()
  }
  private sun: THREE.DirectionalLight

  private text(t: string, style: TextStyle): TextSprite { const x = makeText(t, style); this.texts.add(x); return x }

  // ───────── 見た目の部品 ─────────
  private mats = new Map<number, THREE.MeshStandardMaterial>()
  private mat(color: number, rough = 0.85) {
    const k = color * 10 + Math.round(rough * 9)
    let m = this.mats.get(k)
    if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0 }); this.mats.set(k, m) }
    return m
  }
  private box(w: number, h: number, d: number, color: number, x: number, y: number, z: number, parent: THREE.Object3D = this.root, shadow = true, material?: THREE.Material) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material ?? this.mat(color))
    m.position.set(x, y, z)
    m.castShadow = shadow; m.receiveShadow = true
    parent.add(m)
    return m
  }

  // ───────── 街の組み立て ─────────
  setAgents(agents: CityAgent[], deptOrder: string[], deptLabels: Record<string, string>) {
    const sig = JSON.stringify([agents.map((a) => [a.id, a.dept, a.parent_id, a.layer, a.label, a.enabled]), deptOrder, deptLabels])
    if (sig === this.sig) return
    this.sig = sig
    this.rebuild(agents, deptOrder, deptLabels)
  }

  private clearWorld() {
    const shared = new Set<THREE.Material>(this.mats.values())
    this.root.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.geometry) m.geometry.dispose()
      const mat = m.material as THREE.Material | THREE.Material[] | undefined
      if (!mat) return
      for (const x of Array.isArray(mat) ? mat : [mat]) {
        if (shared.has(x)) continue
        ;(x as THREE.MeshStandardMaterial).map?.dispose()
        x.dispose()
      }
    })
    this.root.clear()
    this.agentObjs.clear(); this.deptObjs.clear(); this.rooms.clear()
    this.streets = []; this.walkers = []; this.pops = []; this.pickables = []; this.ownerObj = null; this.texts.clear()
  }

  private rebuild(agents: CityAgent[], deptOrder: string[], deptLabels: Record<string, string>) {
    this.clearWorld()
    const by = new Map<string, CityAgent[]>()
    for (const a of agents) by.set(a.dept, [...(by.get(a.dept) || []), a])
    const rank = (k: string) => (deptOrder.indexOf(k) < 0 ? 99 : deptOrder.indexOf(k))
    const keys = [...by.keys()].sort((p, q) => rank(p) - rank(q))

    // 部門内は上司→部下の順。深さで役職を決める（0=部長、部下を持つ=課長、他=社員）
    type Seat = { a: CityAgent | null; tier: AgentObj['tier'] }
    const seatsOf = (k: string): Seat[] => {
      const list = [...by.get(k)!].sort((p, q) => p.layer - q.layer || p.id.localeCompare(q.id))
      const ids = new Set(list.map((a) => a.id))
      const kids = (id: string | null) => list.filter((a) => (id === null ? !a.parent_id || !ids.has(a.parent_id) : a.parent_id === id))
      const out: Seat[] = []
      const walk = (a: CityAgent, depth: number) => {
        out.push({ a, tier: depth === 0 ? 'boss' : kids(a.id).length ? 'lead' : 'staff' })
        for (const c of kids(a.id)) walk(c, depth + 1)
      }
      for (const r of kids(null)) walk(r, 0)
      return out
    }
    const seats = new Map<string, Seat[]>()
    for (const k of keys) {
      const s = seatsOf(k)
      if (k === 'exec') s.unshift({ a: null, tier: 'owner' })
      seats.set(k, s)
    }
    if (!seats.has('exec')) { seats.set('exec', [{ a: null, tier: 'owner' }]); keys.unshift('exec') }

    const dims = (n: number) => {
      const cols = Math.min(4, Math.max(2, Math.ceil(Math.sqrt(n * 1.4))))
      const rows = Math.ceil(n / cols)
      return { cols, rows, w: cols * CELL_X + 1.4, d: rows * CELL_Z + 1.9 }
    }
    const rest = keys.filter((k) => k !== 'exec')
    const gcols = Math.max(1, Math.ceil(Math.sqrt(rest.length * 1.3)))
    const grid: string[][] = []
    rest.forEach((k, i) => { (grid[Math.floor(i / gcols)] ||= []).push(k) })
    const colW: number[] = []
    for (const row of grid) row.forEach((k, c) => { colW[c] = Math.max(colW[c] || 0, dims(seats.get(k)!.length).w) })
    const nCols = colW.length || 1
    const gridW = colW.reduce((s, v) => s + v, 0) + SW * (nCols - 1)
    const colX: number[] = []
    let ax = 0
    for (let c = 0; c < nCols; c++) { colX[c] = ax; ax += (colW[c] || 0) + SW }

    // 行ごとの手前・奥。最上段は社長室
    const place = (k: string, cx: number, back: number): Room => {
      const s = seats.get(k)!
      const dm = dims(s.length)
      const room: Room = { id: k, cx, cz: back + dm.d / 2, w: dm.w, d: dm.d, back, front: back + dm.d, left: cx - dm.w / 2, slots: [] }
      s.forEach((seat, i) => {
        const c = i % dm.cols, r = Math.floor(i / dm.cols)
        const slot: Slot = { id: seat.a?.id ?? '__owner', x: room.left + 0.7 + (c + 0.5) * CELL_X, z: back + 1.2 + r * CELL_Z }
        room.slots.push(slot)
      })
      this.rooms.set(k, room)
      return room
    }
    const placed: { k: string; room: Room }[] = []
    const execDims = dims(seats.get('exec')!.length)
    const execBack = -execDims.d
    placed.push({ k: 'exec', room: place('exec', gridW / 2, execBack) })
    const streetZ = SW / 2 // 社長室の手前の通り（z=0 が社長室の手前の縁）
    const streetsH: number[] = [streetZ]
    let rowBack = SW
    const gridTop = SW
    grid.forEach((row) => {
      const rd = Math.max(...row.map((k) => dims(seats.get(k)!.length).d))
      row.forEach((k, c) => placed.push({ k, room: place(k, colX[c] + colW[c] / 2, rowBack) }))
      rowBack += rd + SW
      streetsH.push(rowBack - SW / 2)
    })
    const gridBottom = rowBack - SW
    // 通り
    const x0 = -SW, x1 = gridW + SW
    for (const z of streetsH) this.streets.push({ x1: x0, z1: z, x2: x1, z2: z })
    for (let c = 0; c < nCols - 1; c++) {
      const x = colX[c] + colW[c] + SW / 2
      if (grid.length) this.streets.push({ x1: x, z1: gridTop - SW / 2, x2: x, z2: gridBottom + SW / 2 })
    }
    if (grid.length) {
      this.streets.push({ x1: x0, z1: gridTop - SW / 2, x2: x0, z2: gridBottom + SW / 2 })
      this.streets.push({ x1: x1, z1: gridTop - SW / 2, x2: x1, z2: gridBottom + SW / 2 })
    }

    // 地面
    const minX = x0 - 16, maxX = x1 + 16, minZ = execBack - 16, maxZ = Math.max(gridBottom, SW) + 16
    const ground = this.box(maxX - minX, 1, maxZ - minZ, 0xe4e1f8, (minX + maxX) / 2, -0.8, (minZ + maxZ) / 2, this.root, false)
    ground.castShadow = false
    // 水の溜まり（ところどころの青）
    const wx0 = x0 - 2.2, wx1 = x1 + 2.2, wz0 = execBack - 2.2, wz1 = Math.max(gridBottom, SW) + 2.2
    const water = new THREE.Mesh(new THREE.PlaneGeometry(wx1 - wx0, wz1 - wz0), new THREE.MeshStandardMaterial({ color: 0xa8d8f2, roughness: 0.4 }))
    water.rotation.x = -Math.PI / 2; water.position.set((wx0 + wx1) / 2, -0.29, (wz0 + wz1) / 2); water.receiveShadow = true
    this.root.add(water)

    // 通りを描く（矢印の流れる青い道）
    const chev = chevronTexture()
    for (const s of this.streets) {
      const horiz = s.z1 === s.z2
      const len = horiz ? s.x2 - s.x1 : s.z2 - s.z1
      const tex = chev.clone()
      tex.needsUpdate = true
      tex.repeat.set(len / SW, 1)
      if (!horiz) { tex.center.set(0.5, 0.5); tex.rotation = Math.PI / 2; tex.repeat.set(1, len / SW) }
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(horiz ? len : SW * 0.8, 0.12, horiz ? SW * 0.8 : len), [
        this.mat(0x4a40c8), this.mat(0x4a40c8), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }), this.mat(0x4a40c8), this.mat(0x4a40c8), this.mat(0x4a40c8),
      ])
      mesh.position.set((s.x1 + s.x2) / 2, -0.2, (s.z1 + s.z2) / 2)
      mesh.receiveShadow = true
      this.root.add(mesh)
    }

    // 部屋
    for (const { k, room } of placed) this.buildRoom(k, room, seats.get(k)!, deptLabels[k] || (k === 'other' ? 'その他' : k))

    this.buildBillboard(placed[0].room.cx - 2.5, execBack - 4)

    // 木
    let seed = 7
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
    const occupied = (x: number, z: number) => [...this.rooms.values()].some((r) => x > r.left - 0.6 && x < r.left + r.w + 0.6 && z > r.back - 0.6 && z < r.front + 0.6) || this.streets.some((s) => x > Math.min(s.x1, s.x2) - SW && x < Math.max(s.x1, s.x2) + SW && z > Math.min(s.z1, s.z2) - SW && z < Math.max(s.z1, s.z2) + SW)
    for (let i = 0, n = 0; i < 400 && n < 34; i++) {
      const x = minX + 1 + rnd() * (maxX - minX - 2), z = minZ + 1 + rnd() * (maxZ - minZ - 2)
      if (occupied(x, z)) continue
      this.tree(x, z, 0.7 + rnd() * 0.6); n++
    }
    // 部屋の前の空きに、街灯がわりの小さな木
    for (const r of this.rooms.values()) { this.tree(r.left + r.w + 0.35, r.front - 0.3, 0.7); this.tree(r.left - 0.35, r.front - 0.3, 0.7) }

    // 歩く人（通りを行き来する）
    const cols = [0x6366f1, 0x818cf8, 0x38bdf8, 0xf59e0b, 0xfb7185, 0x34d399]
    for (let i = 0; i < 14; i++) {
      const seg = this.streets[Math.floor(rnd() * this.streets.length)]
      const g = new THREE.Group()
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.22, 4, 8), this.mat(cols[i % cols.length]))
      body.position.y = 0.36; body.castShadow = true
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), this.mat(SKIN))
      head.position.y = 0.66; head.castShadow = true
      g.add(body, head)
      this.root.add(g)
      this.walkers.push({ g, seg, t: rnd(), dir: rnd() > 0.5 ? 1 : -1, speed: 0.5 + rnd() * 0.6, pause: 0, phase: rnd() * 6 })
    }

    // 範囲と影のカメラ
    this.bounds = new THREE.Box3(new THREE.Vector3(x0 - 1.5, -0.4, execBack - 5.2), new THREE.Vector3(x1 + 1.5, 4.6, Math.max(gridBottom, SW) + 2))
    const cx = (this.bounds.min.x + this.bounds.max.x) / 2, cz = (this.bounds.min.z + this.bounds.max.z) / 2
    const ext = Math.max(this.bounds.max.x - this.bounds.min.x, this.bounds.max.z - this.bounds.min.z) * 0.75
    this.sun.position.set(cx - ext * 0.6, ext * 1.2, cz + ext * 0.5)
    this.sun.target.position.set(cx, 0, cz)
    const sc = this.sun.shadow.camera
    sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 1; sc.far = ext * 4
    sc.updateProjectionMatrix()

    this.resize()
    this.applyStates()
    this.fit(this.bounds, true)
    if (this.focusId && this.rooms.has(this.focusId)) this.focus(this.focusId)
    else if (this.selected) this.setSelected(this.selected)
  }

  // 街の入口の大きな看板「FITPEAK AI Office」
  private buildBillboard(cx: number, cz: number) {
    const W = 7.4, H = 1.9
    const c = document.createElement('canvas')
    c.width = 1480; c.height = 380
    const g = c.getContext('2d')!
    const grad = g.createLinearGradient(0, 0, c.width, c.height)
    grad.addColorStop(0, '#4338ca'); grad.addColorStop(1, '#7c3aed')
    g.fillStyle = grad
    g.beginPath(); g.roundRect(0, 0, c.width, c.height, 46); g.fill()
    g.lineWidth = 12; g.strokeStyle = 'rgba(255,255,255,.9)'
    g.beginPath(); g.roundRect(18, 18, c.width - 36, c.height - 36, 34); g.stroke()
    g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle'
    g.font = `800 128px ${FONT}`
    g.fillText('FITPEAK AI Office', c.width / 2, c.height / 2 + 6)
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 8
    const group = new THREE.Group()
    group.position.set(cx, 0, cz)
    group.rotation.y = 0
    const face = new THREE.MeshBasicMaterial({ map: tex })
    const side = this.mat(0x312e81)
    const board = new THREE.Mesh(new THREE.BoxGeometry(W, H, 0.22), [side, side, side, side, face, side])
    board.position.y = 2.75; board.castShadow = true
    group.add(board)
    for (const dx of [-W / 2 + 0.7, W / 2 - 0.7]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 2.0, 10), this.mat(0xcfc9f0))
      post.position.set(dx, 1.0, 0); post.castShadow = true
      group.add(post)
    }
    this.root.add(group)
  }

  private tree(x: number, z: number, s: number) {
    const g = new THREE.Group()
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.07 * s, 0.09 * s, 0.4 * s, 6), this.mat(0x8b6b4a))
    trunk.position.y = 0.2 * s; trunk.castShadow = true
    const c1 = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34 * s, 0), this.mat(0x34b36f))
    c1.position.y = 0.62 * s; c1.castShadow = true
    const c2 = new THREE.Mesh(new THREE.IcosahedronGeometry(0.24 * s, 0), this.mat(0x4ccb86))
    c2.position.y = 0.95 * s; c2.castShadow = true
    g.add(trunk, c1, c2)
    g.position.set(x, -0.28, z)
    this.root.add(g)
  }

  private buildRoom(k: string, room: Room, seats: { a: CityAgent | null; tier: AgentObj['tier'] }[], label: string) {
    const accent = ACCENT[k] ?? ACCENT.other
    const { cx, cz, w, d, left, back } = room
    // 土台（島）
    const base = this.box(w, 0.4, d, 0xf3f1fc, cx, -0.2, cz, this.root, false)
    base.userData = { dept: k }
    this.pickables.push(base)
    this.box(w + 0.16, 0.12, d + 0.16, 0xcfc9f0, cx, -0.34, cz, this.root, false)
    // 絨毯（部門の色）
    const carpet = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.5, d - 0.5), new THREE.MeshStandardMaterial({ color: new THREE.Color(accent).lerp(new THREE.Color(0xffffff), 0.82), roughness: 1 }))
    carpet.rotation.x = -Math.PI / 2; carpet.position.set(cx, 0.012, cz); carpet.receiveShadow = true
    carpet.userData = { dept: k }
    this.root.add(carpet); this.pickables.push(carpet)
    // 作業中の発光（床のふち）
    const glowMat = new THREE.MeshBasicMaterial({ color: STATE_COLOR.run, transparent: true, opacity: 0, depthWrite: false })
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.5, d + 0.5), glowMat)
    glow.rotation.x = -Math.PI / 2; glow.position.set(cx, -0.26, cz)
    this.root.add(glow)

    // 奥の壁（2面）。窓つき
    const wallC = 0xdcd7f6, WH = 1.9, T = 0.18
    this.box(w, WH, T, wallC, cx, WH / 2, back + T / 2)
    this.box(T, WH, d - T, wallC, left + T / 2, WH / 2, back + T + (d - T) / 2)
    this.box(w, 0.12, T + 0.08, accent, cx, WH + 0.06, back + T / 2, this.root, true)
    this.box(T + 0.08, 0.12, d - T, accent, left + T / 2, WH + 0.06, back + T + (d - T) / 2, this.root, true)
    const glass = new THREE.MeshStandardMaterial({ color: 0x9fb4ff, roughness: 0.2, transparent: true, opacity: 0.75 })
    const nWin = Math.max(2, Math.floor(w / 2.2))
    for (let i = 0; i < nWin; i++) this.box(0.9, 0.7, 0.05, 0, left + ((i + 0.5) * w) / nWin, 1.05, back + T + 0.02, this.root, false, glass)
    const nWinL = Math.max(1, Math.floor(d / 2.4))
    for (let i = 0; i < nWinL; i++) this.box(0.05, 0.7, 0.9, 0, left + T + 0.02, 1.05, back + T + ((i + 0.5) * (d - T)) / nWinL, this.root, false, glass)

    // 部門の看板（壁の上）
    const sign = this.text(label, { size: 38, fg: '#ffffff', bg: '#5b4be0', pad: 0.55, height: 0.78, radius: 0.35 })
    sign.sprite.position.set(cx - w * 0.12, WH + 0.95, back + 0.2)
    sign.sprite.userData = { dept: k }
    this.root.add(sign.sprite); this.pickables.push(sign.sprite)
    this.deptObjs.set(k, { id: k, sign, room, glow, glowMat })
    sign.set(label)

    // 机と人
    seats.forEach((seat, i) => {
      const slot = room.slots[i]
      this.buildSeat(k, slot, seat.a, seat.tier)
    })
    // 観葉植物
    this.plant(left + w - 0.5, back + 0.55)
    this.plant(left + 0.55, back + d - 0.5)
  }

  private plant(x: number, z: number) {
    this.box(0.34, 0.3, 0.34, 0xffffff, x, 0.15, z)
    const l = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28, 0), this.mat(0x3fbf7f))
    l.position.set(x, 0.55, z); l.castShadow = true
    this.root.add(l)
  }

  private buildSeat(dept: string, slot: Slot, a: CityAgent | null, tier: AgentObj['tier']) {
    const id = slot.id
    const g = new THREE.Group()
    g.position.set(slot.x, 0, slot.z)
    this.root.add(g)
    // 机
    const top = this.box(1.25, 0.08, 0.66, 0xffffff, 0, 0.62, 0, g)
    this.box(1.12, 0.56, 0.5, 0xe4e0f7, 0, 0.3, 0.02, g)
    // 画面。作業中は光る（4面とも光らせて、奥からでも見えるように）
    const screen = new THREE.MeshStandardMaterial({ color: 0x1e293b, emissive: 0x000000, roughness: 0.4 })
    const mon = this.box(0.62, 0.4, 0.06, 0, 0, 0.9, -0.12, g, true, screen)
    mon.rotation.y = 0.35
    this.box(0.08, 0.16, 0.08, 0x94a3b8, 0, 0.7, -0.12, g)
    // いす
    this.box(0.5, 0.08, 0.46, tier === 'boss' ? 0xf59e0b : 0x7c83a8, -0.1, 0.38, -0.62, g)
    this.box(0.5, 0.45, 0.06, tier === 'boss' ? 0xd48806 : 0x626a92, -0.1, 0.62, -0.84, g)
    // 人
    const fig = new THREE.Group()
    fig.position.set(-0.1, 0, -0.62)
    const bodyM = new THREE.MeshStandardMaterial({ color: TIER_COLOR[tier], roughness: 0.7, transparent: true })
    const headM = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.8, transparent: true })
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.3, 4, 10), bodyM)
    body.position.y = 0.78; body.castShadow = true
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), headM)
    head.position.y = 1.2; head.castShadow = true
    const arm1 = this.box(0.09, 0.09, 0.42, 0, -0.2, 0.74, 0.3, fig, true, bodyM)
    const arm2 = this.box(0.09, 0.09, 0.42, 0, 0.2, 0.74, 0.3, fig, true, bodyM)
    fig.add(body, head)
    if (tier === 'boss' || tier === 'owner') {
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.1, 5), this.mat(0xfacc15, 0.4))
      crown.position.y = 1.42; crown.castShadow = true
      fig.add(crown)
    }
    g.add(fig)
    // 足元のリング（状態）と選択のリング
    const ringMat = new THREE.MeshBasicMaterial({ color: STATE_COLOR.run, transparent: true, opacity: 0, depthWrite: false })
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.78, 40), ringMat)
    ring.rotation.x = -Math.PI / 2; ring.position.set(0, 0.03, -0.4)
    g.add(ring)
    const sel = new THREE.Mesh(new THREE.RingGeometry(0.88, 0.98, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false }))
    sel.rotation.x = -Math.PI / 2; sel.position.set(0, 0.05, -0.4); sel.visible = false
    g.add(sel)
    // 名前・吹き出し・警告
    const label = a?.label || 'Taku（最終意思決定者）'
    const name = this.text(label, { size: 24, fg: '#1e1b4b', bg: 'rgba(255,255,255,.94)', border: '#c7c2ee', height: 0.34, pad: 0.45 })
    name.sprite.position.set(-0.1, 1.78, -0.62); name.sprite.visible = false
    g.add(name.sprite)
    const bubble = this.text('', { size: 24, fg: '#0e4f5c', bg: 'rgba(207,250,254,.97)', border: '#22d3ee', height: 0.4, pad: 0.5 })
    bubble.boost = 1.25; bubble.sprite.position.set(-0.1, 2.25, -0.62); bubble.sprite.visible = false
    g.add(bubble.sprite)
    const warn = this.text('!', { size: 30, fg: '#ffffff', bg: '#ef4444', height: 0.42, pad: 0.55, radius: 0.5 })
    warn.sprite.position.set(-0.1, 1.85, -0.62); warn.sprite.visible = false
    g.add(warn.sprite)

    for (const o of [top, mon, body, head, arm1, arm2]) o.userData = { agent: id }
    this.pickables.push(top, mon, body, head, arm1, arm2)
    if (a === null) { this.ownerObj = g; this.ownerPos = { x: slot.x, z: slot.z }; return }
    this.agentObjs.set(id, { id, group: g, fig, body: bodyM, head: headM, screen, ring, ringMat, sel, name, bubble, warn, x: slot.x, z: slot.z, seed: (id.length * 37 + slot.x * 11) % 6.28, info: { st: 'idle' }, enabled: a.enabled, tier })
    void dept
  }

  // ───────── 状態の反映 ─────────
  setStates(states: Record<string, CityStateInfo>, stats: Record<string, DeptStat>) {
    for (const [id, o] of this.agentObjs) o.info = states[id] || { st: 'idle' }
    this.deptStats.clear()
    for (const [k, v] of Object.entries(stats)) this.deptStats.set(k, v)
    this.applyStates()
  }

  private applyStates() {
    for (const [, o] of this.agentObjs) {
      const off = o.info.st === 'off'
      o.body.opacity = off ? 0.35 : 1
      o.head.opacity = off ? 0.35 : 1
      const wait = !!o.info.wait
      const run = o.info.st === 'run' && !wait, err = o.info.st === 'err' || wait
      o.screen.emissive.set(run ? 0x22d3ee : err ? 0xf87171 : 0x000000)
      o.screen.color.set(run ? 0x67e8f9 : err ? 0xfca5a5 : off ? 0x475569 : 0x1e293b)
      o.ringMat.color.set(err ? STATE_COLOR.err : STATE_COLOR[o.info.st])
      o.warn.sprite.visible = err
      o.warn.set(wait ? '判断待ち' : '!')
      const showBubble = run && !!o.info.task
      o.bubble.sprite.visible = showBubble
      if (showBubble) o.bubble.set(clip(o.info.task || '', 18))
    }
    for (const [k, d] of this.deptObjs) {
      const s = this.deptStats.get(k)
      const label = this.labelOf(k)
      d.sign.set(s && (s.busy || s.bad || s.wait) ? `${label}  ${s.busy ? `作業中 ${s.busy}` : ''}${s.bad ? ` 失敗 ${s.bad}` : ''}${s.wait ? ` 判断待ち ${s.wait}` : ''}`.trim() : `${label}  ${s?.total ?? 0}体`)
      d.glowMat.color.set(s?.bad || s?.wait ? STATE_COLOR.err : STATE_COLOR.run)
    }
    this.updateLabels()
  }
  private labels: Record<string, string> = {}
  private labelOf(k: string) { return this.labels[k] || k }
  setLabels(l: Record<string, string>) { this.labels = l }

  private updateLabels() {
    for (const o of this.agentObjs.values()) {
      const near = this.zoom > this.fitZoom * 1.9
      o.name.sprite.visible = near || this.selected === o.id || this.hover === o.id
      o.sel.visible = this.selected === o.id
    }
    if (this.ownerObj) {
      const near = this.zoom > this.fitZoom * 1.9
      this.ownerObj.children.forEach((c) => { if (c instanceof THREE.Sprite) c.visible = near || this.hover === '__owner' })
    }
  }

  pop(agentId: string, text: string) {
    const o = this.agentObjs.get(agentId)
    if (!o) return
    const s = this.text(clip(text, 22), { size: 24, fg: '#312e81', bg: 'rgba(255,255,255,.97)', border: '#a5b4fc', height: 0.38, pad: 0.5 })
    s.sprite.position.set(o.x - 0.1, 2.5, o.z - 0.62)
    this.root.add(s.sprite)
    this.pops.push({ s, age: 0, x: o.x - 0.1, z: o.z - 0.62 })
    if (this.pops.length > 24) { const old = this.pops.shift()!; this.root.remove(old.s.sprite); this.texts.delete(old.s) }
  }

  // ───────── カメラ ─────────
  private viewSize() { return { w: this.holder.clientWidth || 1, h: this.holder.clientHeight || 1 } }
  private resize() {
    const { w, h } = this.viewSize()
    this.renderer.setSize(w, h, false)
    const aspect = w / h
    this.camera.left = (-BASE_VIEW * aspect) / 2; this.camera.right = (BASE_VIEW * aspect) / 2
    this.camera.top = BASE_VIEW / 2; this.camera.bottom = -BASE_VIEW / 2
    this.camera.updateProjectionMatrix()
    if (this.bounds.isEmpty() === false) { const old = this.fitZoom; this.computeFit(); if (Math.abs(old - this.fitZoom) > 1e-6) { if (this.focusId) this.focus(this.focusId); else if (Math.abs(this.goalZoom - old) < 1e-6) { this.goalZoom = this.fitZoom; this.zoom = this.fitZoom } } }
  }
  private placeCamera() {
    const dist = 60
    this.camera.position.set(
      this.target.x + Math.sin(AZ) * Math.cos(ELEV) * dist,
      this.target.y + Math.sin(ELEV) * dist,
      this.target.z + Math.cos(AZ) * Math.cos(ELEV) * dist,
    )
    this.camera.zoom = this.zoom
    this.camera.lookAt(this.target)
    this.camera.updateProjectionMatrix()
    this.camera.updateMatrixWorld()
  }
  // 範囲が画面にちょうど収まる倍率
  private zoomFor(box: THREE.Box3, margin = 0.92) {
    const { w, h } = this.viewSize()
    const aspect = w / h
    const cam = this.camera.clone()
    cam.zoom = 1
    cam.position.set(Math.sin(AZ) * Math.cos(ELEV) * 60, Math.sin(ELEV) * 60, Math.cos(AZ) * Math.cos(ELEV) * 60)
    cam.lookAt(0, 0, 0); cam.updateMatrixWorld(); cam.updateProjectionMatrix()
    const inv = cam.matrixWorldInverse
    let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      const v = new THREE.Vector3(x, y, z).applyMatrix4(inv)
      minx = Math.min(minx, v.x); maxx = Math.max(maxx, v.x); miny = Math.min(miny, v.y); maxy = Math.max(maxy, v.y)
    }
    const need = Math.max((maxy - miny) / margin / BASE_VIEW, (maxx - minx) / margin / (BASE_VIEW * aspect))
    return 1 / need
  }
  private computeFit() { this.fitZoom = this.zoomFor(this.bounds) }
  private fit(box: THREE.Box3, snap = false, margin = 0.92) {
    this.computeFit()
    const c = new THREE.Vector3(); box.getCenter(c)
    this.goalTarget.copy(c); this.goalZoom = this.zoomFor(box, margin)
    if (snap) { this.target.copy(this.goalTarget); this.zoom = this.goalZoom }
  }
  overview() { this.focusId = null; this.fit(this.bounds) }
  focus(dept: string) {
    const r = this.rooms.get(dept)
    if (!r) return
    this.focusId = dept
    const box = new THREE.Box3(new THREE.Vector3(r.left - 0.8, -0.4, r.back - 0.6), new THREE.Vector3(r.left + r.w + 0.8, 3.4, r.front + 0.8))
    this.fit(box, false, 0.82)
    this.goalZoom = Math.min(this.goalZoom, this.fitZoom * 5)
    // 右にカードが出るぶん、部屋を少し左へ寄せる（狭い画面では寄せない）
    const { w, h } = this.viewSize()
    if (w > 640) {
      const worldW = (BASE_VIEW * (w / h)) / this.goalZoom
      this.goalTarget.x += Math.cos(AZ) * worldW * 0.13
      this.goalTarget.z += -Math.sin(AZ) * worldW * 0.13
    } else {
      // スマホは下からシートが出るので、部屋を上半分へ寄せる
      const k = ((BASE_VIEW / this.goalZoom) * 0.2) / Math.sin(ELEV)
      this.goalTarget.x += Math.sin(AZ) * k
      this.goalTarget.z += Math.cos(AZ) * k
    }
  }
  focusAgent(id: string) {
    const o = this.agentObjs.get(id)
    if (!o) return
    const r = [...this.rooms.values()].find((x) => x.slots.some((s) => s.id === id))
    if (r && this.focusId !== r.id) this.focus(r.id)
  }
  setSelected(id: string | null) {
    this.selected = id
    this.updateLabels()
  }
  zoomBy(f: number) {
    this.goalZoom = Math.min(this.fitZoom * 7, Math.max(this.fitZoom * 0.7, this.goalZoom * f))
  }

  // ───────── 操作 ─────────
  private onDown = (e: PointerEvent) => {
    this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY })
    this.downAt = { x: e.clientX, y: e.clientY }
    this.moved = false
    if (this.ptrs.size === 2) { const [a, b] = [...this.ptrs.values()]; this.pinch = Math.hypot(a.x - b.x, a.y - b.y) }
    try { this.renderer.domElement.setPointerCapture(e.pointerId) } catch { /* noop */ }
  }
  private onMove = (e: PointerEvent) => {
    const prev = this.ptrs.get(e.pointerId)
    if (!prev) { if (e.pointerType === 'mouse') this.hoverAt(e.clientX, e.clientY); return }
    const cur = { x: e.clientX, y: e.clientY }
    if (this.ptrs.size === 1) {
      if (!this.moved && Math.hypot(cur.x - this.downAt.x, cur.y - this.downAt.y) < 5) return
      this.moved = true
      this.panBy(cur.x - prev.x, cur.y - prev.y)
    } else if (this.ptrs.size === 2) {
      this.ptrs.set(e.pointerId, cur)
      const [a, b] = [...this.ptrs.values()]
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      if (this.pinch > 0 && d > 0) { this.moved = true; this.zoomNow(Math.pow(d / this.pinch, 0.6)) }
      this.pinch = d
    }
    this.ptrs.set(e.pointerId, cur)
  }
  private onUp = (e: PointerEvent) => {
    const had = this.ptrs.has(e.pointerId)
    this.ptrs.delete(e.pointerId)
    if (had && !this.moved && this.ptrs.size === 0) this.pickAt(e.clientX, e.clientY)
  }
  private onCancel = (e: PointerEvent) => { this.ptrs.delete(e.pointerId) }
  private onLeave = () => { if (this.hover) { this.hover = null; this.updateLabels(); this.renderer.domElement.style.cursor = '' } }
  private onWheel = (e: WheelEvent) => {
    e.preventDefault()
    this.zoomNow(Math.exp(-Math.max(-80, Math.min(80, e.deltaY)) * (e.ctrlKey ? 0.006 : 0.0012)))
  }
  private zoomNow(f: number) {
    this.goalZoom = Math.min(this.fitZoom * 7, Math.max(this.fitZoom * 0.7, this.goalZoom * f))
    this.zoom = this.goalZoom
    this.focusId = null
  }
  private panBy(dx: number, dy: number) {
    const { h } = this.viewSize()
    const u = BASE_VIEW / this.zoom / h
    const rx = Math.cos(AZ), rz = -Math.sin(AZ)       // 画面の右
    const ax = -Math.sin(AZ), az = -Math.cos(AZ)      // 画面の奥
    const k = u / Math.sin(ELEV)
    this.goalTarget.x += -rx * dx * u + ax * dy * k
    this.goalTarget.z += -rz * dx * u + az * dy * k
    this.goalTarget.x = Math.min(this.bounds.max.x, Math.max(this.bounds.min.x, this.goalTarget.x))
    this.goalTarget.z = Math.min(this.bounds.max.z, Math.max(this.bounds.min.z, this.goalTarget.z))
    this.target.copy(this.goalTarget)
    this.focusId = null
  }

  private ray = new THREE.Raycaster()
  private pickInfo(cx: number, cy: number): { agent?: string; dept?: string } {
    const r = this.renderer.domElement.getBoundingClientRect()
    const v = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1)
    this.ray.setFromCamera(v, this.camera)
    const hits = this.ray.intersectObjects(this.pickables, false)
    for (const h of hits) { const a = h.object.userData?.agent; if (a) return { agent: a } }
    // 人は小さいので、近くを押しても拾う（画面上の距離で最も近い人）
    let best: string | null = null, bd = 30
    const pt = new THREE.Vector3()
    const test = (id: string, x: number, z: number) => {
      pt.set(x - 0.1, 0.9, z - 0.62).project(this.camera)
      const px = ((pt.x + 1) / 2) * r.width + r.left, py = ((1 - pt.y) / 2) * r.height + r.top
      const dist = Math.hypot(px - cx, py - cy)
      if (dist < bd) { bd = dist; best = id }
    }
    for (const o of this.agentObjs.values()) test(o.id, o.x, o.z)
    if (this.ownerObj) test('__owner', this.ownerPos.x, this.ownerPos.z)
    if (best) return { agent: best }
    for (const h of hits) { const d = h.object.userData?.dept; if (d) return { dept: d } }
    return {}
  }
  private hoverAt(cx: number, cy: number) {
    const p = this.pickInfo(cx, cy)
    const id = p.agent ?? null
    if (id !== this.hover) { this.hover = id; this.updateLabels() }
    this.renderer.domElement.style.cursor = p.agent || p.dept ? 'pointer' : ''
  }
  private pickAt(cx: number, cy: number) {
    const p = this.pickInfo(cx, cy)
    if (p.agent) { this.cb.onPickAgent(p.agent === '__owner' ? null : p.agent); return }
    if (p.dept) { this.focus(p.dept); this.cb.onPickDept(p.dept); return }
    this.cb.onPickAgent(null)
  }

  // ───────── 毎フレーム ─────────
  private loop = () => {
    this.raf = requestAnimationFrame(this.loop)
    if (document.hidden || !this.visible) { this.clock.getDelta(); return }
    const dt = Math.min(0.05, this.clock.getDelta())
    this.time += dt
    const t = this.time
    // カメラのなめらかな移動
    const k = 1 - Math.pow(0.0015, dt)
    this.target.lerp(this.goalTarget, k)
    this.zoom += (this.goalZoom - this.zoom) * k
    this.placeCamera()
    const ls = Math.min(1.5, Math.max(0.42, Math.pow(this.fitZoom / (this.zoom || 1), 0.55)))
    for (const x of this.texts) x.sprite.scale.set(x.bw * ls * x.boost, x.bh * ls * x.boost, 1)
    if (Math.abs(this.zoom - this.lastZoomReport) > 0.002) { this.lastZoomReport = this.zoom; this.cb.onZoom(this.zoom / (this.fitZoom || 1)); this.updateLabels() }

    for (const o of this.agentObjs.values()) {
      const st = o.info.wait ? 'err' : o.info.st
      const ph = o.seed
      if (st === 'run') {
        o.fig.position.y = Math.abs(Math.sin(t * 7 + ph)) * 0.035
        o.fig.rotation.z = Math.sin(t * 3.1 + ph) * 0.05
        const p = (t * 0.9 + ph) % 1
        o.ring.scale.setScalar(0.85 + p * 0.7)
        o.ringMat.opacity = 0.7 * (1 - p)
        o.screen.emissiveIntensity = 0.85 + Math.sin(t * 9 + ph) * 0.2
        o.bubble.sprite.position.y = 2.25 + Math.sin(t * 2 + ph) * 0.04
      } else if (st === 'err') {
        o.fig.position.y = 0
        o.fig.rotation.z = Math.sin(t * 22) * 0.06
        o.ring.scale.setScalar(1)
        o.ringMat.opacity = 0.55 + Math.sin(t * 6) * 0.3
        o.screen.emissiveIntensity = 0.6 + Math.sin(t * 6) * 0.3
        o.warn.sprite.position.y = 1.85 + Math.abs(Math.sin(t * 5)) * 0.12
      } else if (st === 'warm') {
        o.fig.position.y = 0; o.fig.rotation.z = 0
        o.ring.scale.setScalar(1); o.ringMat.opacity = 0.35
      } else {
        o.fig.position.y = 0; o.fig.rotation.z = Math.sin(t * 0.8 + ph) * 0.012
        o.ringMat.opacity = 0
      }
    }
    for (const [k2, d] of this.deptObjs) {
      const s = this.deptStats.get(k2)
      const want = s && (s.busy || s.bad || s.wait) ? 0.18 + Math.sin(t * (s.wait ? 5 : 3)) * 0.07 : 0
      d.glowMat.opacity += (want - d.glowMat.opacity) * 0.1
    }
    // 歩く人
    for (const w of this.walkers) {
      if (w.pause > 0) { w.pause -= dt; continue }
      const len = Math.hypot(w.seg.x2 - w.seg.x1, w.seg.z2 - w.seg.z1) || 1
      w.t += (w.dir * w.speed * dt) / len
      if (w.t > 1 || w.t < 0) { w.t = Math.min(1, Math.max(0, w.t)); w.dir = (w.dir * -1) as 1 | -1; w.pause = 0.6 + Math.random() * 2 }
      const x = w.seg.x1 + (w.seg.x2 - w.seg.x1) * w.t, z = w.seg.z1 + (w.seg.z2 - w.seg.z1) * w.t
      w.g.position.set(x, -0.12 + Math.abs(Math.sin(t * 9 + w.phase)) * 0.03, z + (w.seg.z1 === w.seg.z2 ? (w.dir > 0 ? 0.2 : -0.2) : 0))
      if (w.seg.z1 !== w.seg.z2) w.g.position.x += w.dir > 0 ? 0.2 : -0.2
      w.g.rotation.y = Math.atan2((w.seg.x2 - w.seg.x1) * w.dir, (w.seg.z2 - w.seg.z1) * w.dir)
    }
    // ふきだし
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i]
      p.age += dt
      p.s.sprite.position.y = 2.5 + p.age * 0.35
      p.s.sprite.material.opacity = Math.max(0, Math.min(1, (5 - p.age) / 1.2))
      if (p.age > 5) { this.texts.delete(p.s); this.root.remove(p.s.sprite); p.s.sprite.material.map?.dispose(); p.s.sprite.material.dispose(); this.pops.splice(i, 1) }
    }
    this.renderer.render(this.scene, this.camera)
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    this.ro.disconnect(); this.io.disconnect()
    const el = this.renderer.domElement
    el.removeEventListener('pointerdown', this.onDown)
    el.removeEventListener('pointermove', this.onMove)
    el.removeEventListener('pointerup', this.onUp)
    el.removeEventListener('pointercancel', this.onCancel)
    el.removeEventListener('pointerleave', this.onLeave)
    el.removeEventListener('wheel', this.onWheel)
    this.clearWorld()
    for (const m of this.mats.values()) m.dispose()
    this.renderer.dispose()
    el.remove()
  }
}
