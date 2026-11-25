import type { Piece, Vec2 } from '@/shared/document'

/**
 * 倒下扫掠分析（预览与运行模拟共用同一套碰撞判断）。
 *
 * 世界坐标：f = (cos angle, sin angle) 为元件朝向（与 forwardVector 一致），
 * s = (−sin angle, cos angle) 为面宽方向。骨牌绕前底边（转轴）向 +f 倒下，
 * 放在坡道上的元件额外带坡面倾角 β，坡面会提前承接或直接截断扫掠。
 */

export type ContactEdge = 'front' | 'back' | 'left' | 'right'
export type ContactKind = 'piece' | 'ramp-block'

export interface ContactInfo {
  targetId: string
  kind: ContactKind
  /** 首次接触时的倾倒角（弧度，0 = 直立） */
  theta: number
  /** 接触点世界坐标（桌面平面） */
  point: Vec2
  /** 接触点离地高度 */
  height: number
  /** 命中目标的接触边（坡道拦截为 null） */
  edge: ContactEdge | null
}

export interface FallSweep {
  pivot: Vec2
  tilt: number
  thetaMax: number
  effectiveHeight: number
  blockedByRampId: string | null
  contacts: ContactInfo[]
  firstContact: ContactInfo | null
  /** 扫掠扇面多边形（转轴 + 顶点弧线） */
  sector: Vec2[]
  /** 完全倒下后的板面投影四边形 */
  fallenQuad: Vec2[]
  arc: Vec2[]
}

const RAD = Math.PI / 180
const RAMP_THICKNESS = 0.08
/** 站立厚度沿倒下方向的占面宽比例（模型未单独存储厚度） */
const THICKNESS_RATIO = 0.36
const EPS = 0.012

function basis(angleDeg: number) {
  const a = angleDeg * RAD
  const f: Vec2 = { x: Math.cos(a), y: Math.sin(a) }
  // s 为 f 逆时针 90° 的面宽方向（与画布 rotate 一致：局部 +x 对应世界 s）
  const s: Vec2 = { x: -Math.sin(a), y: Math.cos(a) }
  return { f, s }
}

function dot(a: Vec2, b: Vec2) { return a.x * b.x + a.y * b.y }
function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)) }

/** 站立厚度（沿倒下方向的尺寸，模型未单独存储，按面宽比例取值） */
function standingThickness(piece: Piece) {
  if (piece.kind === 'trigger') return piece.width
  return Math.max(piece.width * THICKNESS_RATIO, 0.04)
}
function halfThickness(piece: Piece) {
  return standingThickness(piece) / 2
}

/** 目标元件脚位的面宽半轴（s 方向） */
function targetHalfWidth(piece: Piece) {
  return piece.kind === 'ramp' ? RAMP_THICKNESS / 2 : Math.max(piece.width / 2, 0.02)
}
/** 目标元件脚位的厚度半轴（f 方向） */
function targetHalfLength(piece: Piece) {
  return piece.kind === 'trigger' ? piece.width / 2 : halfThickness(piece)
}

/** 与 propagate 中完全相同的摩擦/门槛增益，保证预览与运行一致 */
export function reachScaleOf(source: Piece, sceneFriction: number) {
  const grip = (sceneFriction + source.friction) / 2
  return (0.94 + grip * 0.35) * (1.25 - source.fallThreshold * 0.25)
}

interface RampSupport { ramp: Piece; beta: number }

function rampFrame(ramp: Piece) {
  const { f, s } = basis(ramp.angle)
  const halfLength = ramp.width / 2
  const halfThick = RAMP_THICKNESS / 2
  return { f, s, halfLength, halfThick }
}

/** 坡道坡面在世界点处的高度（低端在局部 -f，高端在 +f）；点不在坡面投影内返回 null */
function rampSurfaceHeight(ramp: Piece, world: Vec2) {
  const { f, s, halfLength, halfThick } = rampFrame(ramp)
  const delta = { x: world.x - ramp.x, y: world.y - ramp.y }
  const v = dot(delta, f)
  const u = dot(delta, s)
  if (Math.abs(v) > halfLength + EPS || Math.abs(u) > halfThick + EPS) return null
  const ratio = (v + halfLength) / (halfLength * 2)
  return clamp(ramp.height * ratio, 0, ramp.height)
}

function findSupportRamp(source: Piece, ramps: Piece[]): RampSupport | null {
  const { f: sf } = basis(source.angle)
  const sourceHalfThick = halfThickness(source)
  for (const ramp of ramps) {
    const { f, s, halfLength, halfThick } = rampFrame(ramp)
    const delta = { x: source.x - ramp.x, y: source.y - ramp.y }
    const v = dot(delta, f)
    const u = dot(delta, s)
    // 只有转轴真正落在坡面投影内，才视为“放在坡道上”；远处坡道是障碍而非支撑
    if (Math.abs(v) <= halfLength - 0.05 && Math.abs(u) <= halfThick + sourceHalfThick + 0.06) {
      const beta = Math.atan(ramp.height / ramp.width) * dot(sf, f)
      return { ramp, beta }
    }
  }
  return null
}

interface BoardPoint { xy: Vec2; z: number }

/**
 * 板面局部点 (x, y, z) 在倾倒角 θ 处的三维位置（z 为离地高度）。
 * 局部坐标：x 沿面宽(s)；y 自转轴沿板面向上（直立时竖直，顶部 y=height）；
 * z 沿板厚方向（直立时即 +f），底面 z=0 贴支撑面。
 * 牌绕前底边转轴向 +f 倾倒，φ = β + θ（坡面倾角 β + 倾倒角 θ），令 α = π/2 − φ：
 *   沿 f 位移 = y·cosα + z·sinα
 *   离地高度  = y·sinα − z·cosα
 * 校验（β=0）：θ=0 顶部 (y=H) 高度 H、f 位移 0；θ=90° 顶部高度 0、落到前方 +H。
 */
function boardPoint(
  pivot: Vec2, pivotHeight: number, s: Vec2, f: Vec2, beta: number,
  theta: number, x: number, y: number, z: number,
): BoardPoint {
  const alpha = Math.PI / 2 - (beta + theta)
  const along = y * Math.cos(alpha) + z * Math.sin(alpha)
  const height = pivotHeight + y * Math.sin(alpha) - z * Math.cos(alpha)
  return { xy: { x: pivot.x + s.x * x + f.x * along, y: pivot.y + s.y * x + f.y * along }, z: height }
}

const EDGE_LABEL: Record<ContactEdge, string> = {
  front: '前边', back: '后边', left: '左边', right: '右边',
}
export function contactEdgeLabel(edge: ContactEdge | null) { return edge ? EDGE_LABEL[edge] : '坡面' }

function classifyEdge(localU: number, localV: number, hs: number, hf: number): ContactEdge {
  // 首次接触点必落在目标某个面的近旁。用归一化贴边度比较：
  // 更贴近 s 向极限（|u|/hs 大）→ 左/右边；更贴近 f 向极限 → 前/后边。
  if (Math.abs(localU) / hs >= Math.abs(localV) / hf) {
    return localU >= 0 ? 'right' : 'left'
  }
  return localV >= 0 ? 'front' : 'back'
}

export interface AnalyzeOptions { reachScale?: number }

/**
 * 计算一枚可倾倒元件（骨牌/分岔/触发器）的倒下扫掠与全部接触。
 * 预览层与 propagate 运行时都调用本函数，判定结果天然一致。
 */
export function analyzeFall(source: Piece, others: readonly Piece[], options: AnalyzeOptions = {}): FallSweep {
  const ramps = others.filter(piece => piece.kind === 'ramp')
  const targets = others.filter(piece => piece.id !== source.id && piece.kind !== 'ramp')
  const { f, s } = basis(source.angle)
  const t = halfThickness(source)
  const w = Math.max(source.width / 2, 0.04)
  const reachScale = clamp(options.reachScale ?? 1, 0.85, 1.25)
  const height = source.height * reachScale

  const support = findSupportRamp(source, ramps)
  const supportRampId = support?.ramp.id ?? null
  const obstacleRamps = ramps.filter(ramp => ramp.id !== supportRampId)
  const beta = support?.beta ?? 0
  // 转轴取元件中心的前底边；牌底贴支撑面，转轴局部高度为 0
  const pivot: Vec2 = { x: source.x, y: source.y }
  const pivotHeight = 0

  // 顶点（y=height,z=0）高度 = H·sinα = H·cos(β+θ)；
  // 触地条件 cos(β+θ)=0 ⇒ β+θ=π/2，平面 β=0 即 90°，坡面提前着陆
  const thetaLand = clamp(Math.PI / 2 - Math.max(beta, 0), 0, Math.PI / 2)

  // 1) 坡面拦截扫描：将板体采样点与坡道楔形实体（坡面下方的占据体积）比较。
  // 地面触地由解析角 thetaLand 限定，不在离散扫描里判定。
  let thetaMax = thetaLand
  let blockedByRampId: string | null = null
  let blockContact: ContactInfo | null = null
  const solidSamples: [number, number, number][] = []
  for (const y of [0, height * 0.25, height * 0.5, height * 0.75, height]) {
    for (const x of [-w, 0, w]) {
      solidSamples.push([x, y, 0], [x, y, 2 * t])
    }
  }
  const obstacleSteps = 36
  scan:
  for (let i = 0; i <= obstacleSteps; i += 1) {
    const theta = thetaLand * i / obstacleSteps
    for (const [x, y, z] of solidSamples) {
      const p = boardPoint(pivot, pivotHeight, s, f, beta, theta, x, y, z)
      for (const ramp of obstacleRamps) {
        const surface = rampSurfaceHeight(ramp, p.xy)
        if (surface !== null && p.z < surface - EPS) {
          thetaMax = theta
          blockedByRampId = ramp.id
          blockContact = {
            targetId: ramp.id, kind: 'ramp-block', theta,
            point: p.xy, height: Math.max(p.z, surface), edge: null,
          }
          break scan
        }
      }
    }
  }

  // 2) 对每枚直立元件求首次接触（板面网格采样 + 二分细化），并判定实际穿过的接触边
  const faceSamples: [number, number, number][] = []
  for (const y of [height, height * 0.78, height * 0.55, height * 0.32, height * 0.12]) {
    for (const x of [-w, -w / 2, 0, w / 2, w]) {
      faceSamples.push([x, y, 0], [x, y, 2 * t])
    }
  }

  const targetBase = (target: Piece) => {
    const supportRamp = findSupportRamp(target, ramps)
    return supportRamp ? rampSurfaceHeight(supportRamp.ramp, { x: target.x, y: target.y }) ?? 0 : 0
  }

  const contacts: ContactInfo[] = []

  for (const target of targets) {
    const tb = basis(target.angle)
    const hs = targetHalfWidth(target)
    // 直立元件的水平脚位 = 面宽(s) × 厚度(f)，高度方向由 z 区间判断
    const hf = targetHalfLength(target)
    const baseHeight = targetBase(target)
    const sampleLocal = (theta: number) => faceSamples.map(([x, y, z]) => {
      const p = boardPoint(pivot, pivotHeight, s, f, beta, theta, x, y, z)
      const delta = { x: p.xy.x - target.x, y: p.xy.y - target.y }
      return {
        p,
        u: dot(delta, tb.s),
        v: dot(delta, tb.f),
        insideXY: target.kind === 'trigger'
          ? Math.hypot(delta.x, delta.y) <= hs + EPS
          : Math.abs(dot(delta, tb.s)) <= hs + EPS && Math.abs(dot(delta, tb.f)) <= hf + EPS,
        insideZ: p.z >= baseHeight - EPS && p.z <= baseHeight + target.height + EPS,
      }
    })
    const isHit = (theta: number) => sampleLocal(theta).some(item => item.insideXY && item.insideZ)

    const steps = 40
    let hitTheta = -1
    let prev = 0
    for (let i = 0; i <= steps; i += 1) {
      const theta = thetaMax * i / steps
      if (isHit(theta)) { hitTheta = theta; break }
      prev = theta
    }
    if (hitTheta < 0) continue
    // 二分细化首次接触角
    let lo = prev
    let hi = hitTheta
    for (let i = 0; i < 9; i += 1) {
      const mid = (lo + hi) / 2
      if (isHit(mid)) hi = mid
      else lo = mid
    }
    hitTheta = hi

    // 在首次接触角处取进入目标脚位的采样点；接触边由该点在目标局部框上的
    // 归一化贴边度判定（更贴近 s 向极限为左/右边，否则为前/后边）
    const allAtHit = sampleLocal(hitTheta)
    const entry = allAtHit
      .filter(item => item.insideXY && item.insideZ)
      // 选取穿透最浅的采样点，使其最接近真实“刚进入”的面
      .sort((a, b) => {
        const gapA = Math.min(hs - Math.abs(a.u), hf - Math.abs(a.v))
        const gapB = Math.min(hs - Math.abs(b.u), hf - Math.abs(b.v))
        return gapB - gapA
      })[0] ?? allAtHit[0]
    const edge = classifyEdge(entry.u, entry.v, hs, hf)
    contacts.push({
      targetId: target.id, kind: 'piece', theta: hitTheta,
      point: entry.p.xy, height: entry.p.z, edge,
    })
  }

  if (blockContact) contacts.push(blockContact)
  contacts.sort((a, b) => a.theta - b.theta || a.targetId.localeCompare(b.targetId))
  const pieceContacts = contacts.filter(contact => contact.kind === 'piece')
  const firstContact = pieceContacts[0] ?? null

  // 3) 渲染几何：顶点弧线（顶部自转轴正上方向前扫到地面）、扇面、完全倒下投影
  const arc: Vec2[] = []
  const arcSteps = 26
  for (let i = 0; i <= arcSteps; i += 1) {
    const theta = thetaMax * i / arcSteps
    const along = height * Math.cos(Math.PI / 2 - (beta + theta))
    arc.push({ x: pivot.x + f.x * along, y: pivot.y + f.y * along })
  }
  const quad = [
    boardPoint(pivot, pivotHeight, s, f, beta, thetaMax, -w, 0, 0),
    boardPoint(pivot, pivotHeight, s, f, beta, thetaMax, w, 0, 0),
    boardPoint(pivot, pivotHeight, s, f, beta, thetaMax, w, height, 0),
    boardPoint(pivot, pivotHeight, s, f, beta, thetaMax, -w, height, 0),
  ].map(p => p.xy)
  const sector = [pivot, ...arc, quad[3], quad[2]]

  return {
    pivot, tilt: beta, thetaMax, effectiveHeight: height,
    blockedByRampId, contacts, firstContact, sector, fallenQuad: quad, arc,
  }
}

/**
 * 运行模拟专用：返回模拟链路会实际击倒的下一枚元件。
 * 骨牌接触另一坡道时按坡面传递处理；被坡道截断且无骨牌接触时同样以该坡道为下一环节，
 * 与预览使用完全相同的扫掠结果。
 */
export function simulateNextContact(source: Piece, others: readonly Piece[], sceneFriction: number) {
  const sweep = analyzeFall(source, others, { reachScale: reachScaleOf(source, sceneFriction) })
  const first = sweep.firstContact
    ?? (sweep.blockedByRampId ? sweep.contacts.find(contact => contact.kind === 'ramp-block') ?? null : null)
  if (!first) return { piece: null as Piece | null, sweep }
  return { piece: others.find(item => item.id === first.targetId) ?? null, sweep }
}
