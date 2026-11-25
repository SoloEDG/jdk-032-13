import type { DominoDocument, Piece } from './document'

const domino = (id: string, x: number, y: number, angle: number, label: string): Piece => ({
  id, kind: 'domino', x, y, angle, facing: 'east', label, height: 1.6, width: 0.42,
  fallThreshold: 0.8, friction: 0.55,
})

export function createDefaultDocument(): DominoDocument {
  const pieces: Piece[] = [
    domino('d1', 2, 4.2, 0, '起点'),
    domino('d2', 3.6, 4.2, 0, '03'),
    domino('d3', 5.2, 4.2, 0, '04'),
    domino('d4', 6.8, 4.2, 0, '05'),
    domino('d5', 8.4, 4.2, 0, '06'),
    { ...domino('r1', 10.2, 4.2, 0, '上坡'), kind: 'ramp', width: 1.7, height: 0.45 },
    domino('d6', 12.1, 3.55, -20, '08'),
    { ...domino('s1', 13.7, 3.15, 20, '分岔'), kind: 'splitter', width: 0.75 },
    domino('d7', 15.2, 2.3, 0, '10'),
    domino('d8', 16.8, 2.3, 0, '11'),
    domino('d9', 15.2, 4.05, 0, '12'),
    domino('d10', 16.8, 4.05, 0, '13'),
    { ...domino('t1', 18.4, 2.3, 0, '终点 A'), kind: 'trigger', width: 0.7 },

    // —— 倒下扫掠验证区（底部） ——
    // ① 斜放在坡道上的牌：沿坡面朝向倒下，预览带坡面倾角与提前着陆
    { ...domino('vr', 4.2, 7.35, 0, '坡道牌'), kind: 'domino', height: 1.6, width: 0.42 },
    { ...domino('vrm', 4.2, 7.35, 0, '验证坡道'), kind: 'ramp', width: 1.7, height: 0.45 },
    domino('vrt', 6.0, 7.35, 0, '坡前牌'),
    // ② 间隔很窄的旁排：站立轮廓不重叠，倒下却会扫到侧排（命中侧边）
    domino('vna', 9.2, 7.6, 0, '主排 A'),
    domino('vnb', 10.8, 7.6, 0, '主排 B'),
    domino('vside', 10.25, 7.88, 0, '窄距旁排'),
    // ③ 方向正好背离的近邻：站立脚位不重叠，倒下扫中其朝来源一侧的前边
    domino('vfb', 13.6, 7.4, 0, '朝向牌'),
    domino('vba', 14.7, 7.4, 180, '背离近邻'),
  ]
  return {
    id: 'chainline-starter',
    title: '逆风转角',
    revision: 1,
    updatedAt: Date.now(),
    pieces,
    connections: [
      { id: 'c1', from: 's1', to: 'd7', delay: 0.15, enabled: true },
      { id: 'c2', from: 's1', to: 'd9', delay: 0.15, enabled: true },
    ],
    scene: { gravity: 9.8, friction: 0.62, width: 21, height: 9, showGrid: true },
    startPieceId: 'd1',
  }
}
