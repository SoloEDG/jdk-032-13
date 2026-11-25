<script setup lang="ts">
import { computed, ref } from 'vue'
import { Crosshair, MousePointer2 } from '@lucide/vue'
import type { DominoDocument, Piece, PieceKind, SimulationRun } from '@/shared/document'
import { analyzeFall, contactEdgeLabel, reachScaleOf, type ContactInfo, type FallSweep } from '../lib/fallSweep'

const props = defineProps<{
  document: DominoDocument; activeTool: PieceKind | null; selectedId: string | null
  run: SimulationRun | null; focusPieceId: string | null
}>()
const emit = defineEmits<{
  place: [PieceKind, number, number]; select: [string | null]; move: [string, number, number]
}>()
const svg = ref<SVGSVGElement | null>(null)
const view = { width: 1040, height: 510, margin: 35 }
const fallen = computed(() => new Set(props.run?.events.filter(event => event.kind === 'fall').map(event => event.pieceId) ?? []))
const failed = computed(() => props.run?.interruptedPieceId ?? null)
const draggingId = ref<string | null>(null)

const dragPreview = computed<FallSweep | null>(() => {
  const id = draggingId.value
  if (!id) return null
  const source = props.document.pieces.find(piece => piece.id === id)
  if (!source || source.kind === 'ramp') return null
  return analyzeFall(source, props.document.pieces.filter(piece => piece.id !== id), {
    reachScale: reachScaleOf(source, props.document.scene.friction),
  })
})

const reachableIds = computed(() => new Set(dragPreview.value?.contacts.map(contact => contact.targetId) ?? []))

const dragPiece = computed(() => props.document.pieces.find(piece => piece.id === draggingId.value) ?? null)

/** 坡道本身不倾倒，预览其沿坡面向前的传递方向 */
const rampAim = computed(() => {
  const piece = dragPiece.value
  if (!piece || piece.kind !== 'ramp') return null
  const a = piece.angle * Math.PI / 180
  const f = { x: Math.cos(a), y: Math.sin(a) }
  return { from: { x: piece.x, y: piece.y }, to: { x: piece.x + f.x * piece.width, y: piece.y + f.y * piece.width } }
})

const hintLines = computed(() => {
  const sweep = dragPreview.value
  const piece = dragPiece.value
  if (!piece) return [] as string[]
  if (piece.kind === 'ramp') return ['坡道元件不倾倒：沿坡面朝向传递，倒下预览仅对骨牌 / 分岔 / 触发器生效。']
  if (!sweep) return []
  const lines: string[] = []
  const tiltDeg = Math.abs(sweep.tilt) * 180 / Math.PI
  if (tiltDeg > 0.5) lines.push(`置于坡面：坡面倾角 ${tiltDeg.toFixed(0)}°，扫掠在坡面上提前着陆`)
  if (sweep.blockedByRampId) {
    const ramp = props.document.pieces.find(item => item.id === sweep.blockedByRampId)
    lines.push(`扫掠被坡道「${ramp?.label ?? sweep.blockedByRampId}」截断，牌将停在坡面上（不会完整触地）。`)
  } else {
    lines.push(`扫掠半径 ${sweep.effectiveHeight.toFixed(2)} m，完全倒下角 ${(sweep.thetaMax * 180 / Math.PI).toFixed(0)}°`)
  }
  for (const contact of sweep.contacts) {
    const target = props.document.pieces.find(item => item.id === contact.targetId)
    if (!target) continue
    const edge = contact.kind === 'ramp-block' ? '坡面' : contactEdgeLabel(contact.edge)
    lines.push(contact.kind === 'ramp-block'
      ? `坡面拦截 →「${target.label}」（接触高度 ${contact.height.toFixed(2)} m）`
      : `可触达「${target.label}」· 命中${edge}（接触角 ${(contact.theta * 180 / Math.PI).toFixed(0)}°，高度 ${contact.height.toFixed(2)} m）`)
  }
  if (!sweep.contacts.length) lines.push('当前扫掠范围内没有可触达的元件，运行时链路会在此中断。')
  return lines
})

function worldPoint(event: PointerEvent) {
  if (!svg.value) return { x: 0, y: 0 }
  const bounds = svg.value.getBoundingClientRect()
  const svgX = (event.clientX - bounds.left) / bounds.width * view.width
  const svgY = (event.clientY - bounds.top) / bounds.height * view.height
  return {
    x: Math.max(0, Math.min(props.document.scene.width,
      (svgX - view.margin) / (view.width - view.margin * 2) * props.document.scene.width)),
    y: Math.max(0, Math.min(props.document.scene.height,
      (svgY - view.margin) / (view.height - view.margin * 2) * props.document.scene.height)),
  }
}

function down(event: PointerEvent, piece: Piece) {
  event.stopPropagation()
  draggingId.value = piece.id
  emit('select', piece.id)
  ;(event.currentTarget as SVGGElement).setPointerCapture(event.pointerId)
}
function move(event: PointerEvent) {
  if (!draggingId.value) return
  const point = worldPoint(event)
  emit('move', draggingId.value, point.x, point.y)
}
function up() { draggingId.value = null }
function boardClick(event: PointerEvent) {
  if (draggingId.value) return
  const point = worldPoint(event)
  if (props.activeTool) emit('place', props.activeTool, point.x, point.y)
  else emit('select', null)
}
function pxX(x: number) { return view.margin + x / props.document.scene.width * (view.width - view.margin * 2) }
function pxY(y: number) { return view.margin + y / props.document.scene.height * (view.height - view.margin * 2) }
function polyPoints(points: { x: number; y: number }[]) {
  return points.map(p => `${pxX(p.x).toFixed(1)},${pxY(p.y).toFixed(1)}`).join(' ')
}
function pieceColor(piece: Piece) {
  if (piece.id === failed.value) return '#e88b69'
  if (fallen.value.has(piece.id)) return '#89c5a5'
  if (piece.kind === 'ramp') return '#8ca6a0'
  if (piece.kind === 'splitter') return '#e6bd68'
  if (piece.kind === 'trigger') return '#df8d70'
  return '#ead8b5'
}
function eventTime(pieceId: string) {
  const event = props.run?.events.find(item => item.pieceId === pieceId)
  return event ? event.time.toFixed(2) : ''
}
function contactColor(contact: ContactInfo) {
  return contact.kind === 'ramp-block' ? '#7fb3c9'
    : contact.edge === 'front' ? '#f2b366'
      : contact.edge === 'back' ? '#e88b69'
        : contact.edge === 'left' ? '#c9a7e8' : '#8fd0c0'
}
</script>

<template>
  <section class="stage-panel" aria-label="骨牌构筑场景">
    <div class="stage-toolbar">
      <div class="stage-mode"><MousePointer2 :size="15" /><span>{{ activeTool ? '点击空位添加元件' : '编辑场景' }}</span></div>
      <div class="stage-readout"><span class="readout-dot"></span>{{ document.pieces.length }} 件元件 <span class="readout-sep">·</span> {{ document.scene.width }} × {{ document.scene.height }} 桌面</div>
    </div>
    <svg ref="svg" class="stage-svg" :viewBox="`0 0 ${view.width} ${view.height}`" role="img"
      aria-label="可编辑的多米诺场景。使用鼠标拖动或方向键微调选中元件。" @pointerup="up" @pointercancel="up"
      @pointermove="move" @pointerdown="boardClick">
      <defs>
        <pattern id="draft-grid" width="24" height="24" patternUnits="userSpaceOnUse">
          <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#3c5048" stroke-width=".65" opacity=".6" />
          <circle cx="0" cy="0" r="1" fill="#b9c3a5" opacity=".3" />
        </pattern>
        <pattern id="draft-fine" width="6" height="6" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r=".65" fill="#758376" opacity=".35" />
        </pattern>
        <filter id="piece-shadow" x="-30%" y="-30%" width="160%" height="180%">
          <feDropShadow dx="1" dy="3" stdDeviation="2" flood-color="#101a17" flood-opacity=".38" />
        </filter>
      </defs>
      <rect x="0" y="0" :width="view.width" :height="view.height" rx="12" class="board-bg" />
      <rect :x="view.margin" :y="view.margin" :width="view.width-view.margin*2" :height="view.height-view.margin*2" rx="7" class="board-surface" />
      <rect :x="view.margin" :y="view.margin" :width="view.width-view.margin*2" :height="view.height-view.margin*2" rx="7" fill="url(#draft-fine)" pointer-events="none" />
      <path v-if="document.scene.showGrid" :d="`M ${view.margin} ${view.height/2} H ${view.width-view.margin} M ${view.width/2} ${view.margin} V ${view.height-view.margin}`" class="center-guide" pointer-events="none" />

      <g v-for="connection in document.connections.filter(link => link.enabled)" :key="connection.id" class="mechanism-link" pointer-events="none">
        <path :d="`M ${pxX(document.pieces.find(piece => piece.id === connection.from)?.x ?? 0)} ${pxY(document.pieces.find(piece => piece.id === connection.from)?.y ?? 0)} Q ${(pxX(document.pieces.find(piece => piece.id === connection.from)?.x ?? 0)+pxX(document.pieces.find(piece => piece.id === connection.to)?.x ?? 0))/2} ${(pxY(document.pieces.find(piece => piece.id === connection.from)?.y ?? 0)+pxY(document.pieces.find(piece => piece.id === connection.to)?.y ?? 0))/2-36} ${pxX(document.pieces.find(piece => piece.id === connection.to)?.x ?? 0)} ${pxY(document.pieces.find(piece => piece.id === connection.to)?.y ?? 0)}`" />
        <circle :cx="pxX(document.pieces.find(piece => piece.id === connection.from)?.x ?? 0)" :cy="pxY(document.pieces.find(piece => piece.id === connection.from)?.y ?? 0)" r="3" />
      </g>

      <!-- 拖动时的倒下扫掠预览（基于实际朝向 / 坡面倾角 / 坡面位置，与运行模拟同判断） -->
      <g v-if="dragPreview" class="sweep-layer" pointer-events="none">
        <polygon :points="polyPoints(dragPreview.sector)" class="sweep-sector" />
        <polygon :points="polyPoints(dragPreview.fallenQuad)" class="sweep-fallen" />
        <polyline :points="polyPoints(dragPreview.arc)" class="sweep-arc" />
        <line :x1="pxX(dragPreview.pivot.x)" :y1="pxY(dragPreview.pivot.y)"
          :x2="pxX(dragPreview.arc.at(-1)!.x)" :y2="pxY(dragPreview.arc.at(-1)!.y)" class="sweep-tip-line" />
        <circle :cx="pxX(dragPreview.pivot.x)" :cy="pxY(dragPreview.pivot.y)" r="3.2" class="sweep-pivot" />
      </g>
      <g v-else-if="rampAim" class="sweep-layer" pointer-events="none">
        <line :x1="pxX(rampAim.from.x)" :y1="pxY(rampAim.from.y)" :x2="pxX(rampAim.to.x)" :y2="pxY(rampAim.to.y)" class="ramp-aim" />
      </g>

      <g v-for="piece in document.pieces" :key="piece.id" class="scene-piece"
        :class="{ selected: selectedId === piece.id, focused: focusPieceId === piece.id, fallen: fallen.has(piece.id), dragging: draggingId === piece.id, reachable: reachableIds.has(piece.id) }"
        :transform="`translate(${pxX(piece.x)} ${pxY(piece.y)}) rotate(${piece.angle})`"
        :tabindex="0" role="button" :aria-label="`${piece.label}，${piece.x.toFixed(1)}，${piece.y.toFixed(1)}`" :aria-pressed="selectedId === piece.id"
        @pointerdown="down($event, piece)" @keydown.enter.stop="emit('select', piece.id)" @keydown.space.stop.prevent="emit('select', piece.id)">
        <ellipse v-if="piece.kind === 'domino'" cx="0" cy="7" rx="15" ry="8" class="piece-ground-shadow" />
        <rect v-if="piece.kind === 'domino'" x="-9" y="-20" width="18" height="39" rx="4" :fill="pieceColor(piece)" class="domino-body" filter="url(#piece-shadow)" />
        <path v-else-if="piece.kind === 'ramp'" d="M-24 10 L22 10 L22 -10 Z" :fill="pieceColor(piece)" class="ramp-body" filter="url(#piece-shadow)" />
        <path v-else-if="piece.kind === 'splitter'" d="M0-13 L13 0 L0 13 L-13 0 Z" :fill="pieceColor(piece)" class="splitter-body" filter="url(#piece-shadow)" />
        <circle v-else r="11" :fill="pieceColor(piece)" class="trigger-body" filter="url(#piece-shadow)" />
        <line v-if="piece.kind === 'domino'" x1="0" y1="-15" x2="0" y2="14" class="domino-mark" />
        <circle v-if="piece.id === document.startPieceId" cy="-28" r="4" class="start-marker" />
        <circle v-if="piece.id === failed" cy="-34" r="7" class="failure-marker" />
        <text y="32" text-anchor="middle" class="piece-label">{{ piece.label }}</text>
        <text v-if="eventTime(piece.id)" y="44" text-anchor="middle" class="piece-time">{{ eventTime(piece.id) }}s</text>
        <rect v-if="selectedId === piece.id || focusPieceId === piece.id" x="-18" y="-28" width="36" height="55" rx="8" class="selection-ring" />
      </g>

      <!-- 可触达目标的高亮描边与各自命中的接触边 -->
      <g v-if="dragPreview" class="contact-layer" pointer-events="none">
        <g v-for="contact in dragPreview.contacts" :key="contact.targetId" class="contact-marker">
          <circle :cx="pxX(contact.point.x)" :cy="pxY(contact.point.y)" r="5.5" :stroke="contactColor(contact)" class="contact-dot" />
          <circle :cx="pxX(contact.point.x)" :cy="pxY(contact.point.y)" r="2" :fill="contactColor(contact)" />
          <g :transform="`translate(${pxX(contact.point.x)} ${pxY(contact.point.y) - 11})`">
            <rect x="-22" y="-9" width="44" height="13" rx="3" :stroke="contactColor(contact)" class="contact-tag" />
            <text text-anchor="middle" y="0.5" class="contact-tag-text" :fill="contactColor(contact)">
              {{ contact.kind === 'ramp-block' ? '坡面拦截' : contactEdgeLabel(contact.edge) }}
            </text>
          </g>
        </g>
      </g>

      <g v-if="focusPieceId" class="focus-reticle" pointer-events="none">
        <circle :cx="pxX(document.pieces.find(piece => piece.id === focusPieceId)?.x ?? 0)" :cy="pxY(document.pieces.find(piece => piece.id === focusPieceId)?.y ?? 0)" r="25" />
        <circle :cx="pxX(document.pieces.find(piece => piece.id === focusPieceId)?.x ?? 0)" :cy="pxY(document.pieces.find(piece => piece.id === focusPieceId)?.y ?? 0)" r="32" />
      </g>
      <g class="board-scale" pointer-events="none"><path d="M 0 0 H 80 M 0 0 V -5 M 80 0 V -5" /><text x="40" y="15" text-anchor="middle">2 M</text></g>
    </svg>
    <div class="sweep-hint" :class="{ active: draggingId }" aria-live="polite">
      <template v-if="draggingId">
        <span v-for="(line, index) in hintLines" :key="index" class="sweep-hint-line">
          <i :class="line.includes('拦截') ? 'warn' : line.includes('没有') ? 'muted' : 'ok'"></i>{{ line }}
        </span>
        <span v-if="!hintLines.length" class="sweep-hint-line"><i class="muted"></i>拖动中，松开后采用与运行模拟相同的碰撞判断。</span>
      </template>
      <template v-else><Crosshair :size="13" /> 桌面定位</template>
    </div>
    <div class="stage-footer"><span>拖动骨牌查看倒下扫掠预览</span><span>摆放 <kbd>↑ ↓ ← →</kbd> 微调 <kbd>Shift</kbd> 加速</span></div>
  </section>
</template>
