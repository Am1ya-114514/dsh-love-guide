/**
 * ECharts 6 的极薄封装。
 *
 * 不引 echarts-for-react：它停更在 3.0.6，且把 setOption 的语义（是否 notMerge、
 * 是否 lazyUpdate）挡在外面，而 K 线这种"同一个实例反复换数据集"的用法恰恰需要它。
 *
 * 按需注册是必须的：`import * as echarts from 'echarts'` 会把整个 echarts 塞进产物，
 * 而这里只用到 candlestick / line / bar / pie / heatmap / radar 这几类。
 */

import { useEffect, useMemo, useRef } from 'react'
import * as echarts from 'echarts/core'
import { BarChart, CandlestickChart, HeatmapChart, LineChart, PieChart, RadarChart } from 'echarts/charts'
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  MarkPointComponent,
  RadarComponent,
  TitleComponent,
  TooltipComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsCoreOption } from 'echarts/core'

echarts.use([
  CandlestickChart,
  LineChart,
  BarChart,
  PieChart,
  HeatmapChart,
  RadarChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  DataZoomComponent,
  MarkLineComponent,
  MarkAreaComponent,
  MarkPointComponent,
  RadarComponent,
  CanvasRenderer,
])

export interface EChartProps {
  option: EChartsCoreOption
  height?: number | string
  className?: string
  /** 数据结构整体替换时置 true，避免残留上一次的 series。 */
  notMerge?: boolean
  onEvents?: Record<string, (params: unknown) => void>
}

export function EChart({ option, height = 320, className, notMerge = true, onEvents }: EChartProps) {
  const holder = useRef<HTMLDivElement>(null)
  const chart = useRef<echarts.ECharts | null>(null)
  const handlers = useRef(onEvents)

  // 事件回调放在 ref 里，这样 option 更新不会因为回调是新函数而重建图表。
  // 必须在 effect 里写 ref：渲染期间写 ref 会在并发渲染下读到"还没提交"的值。
  useEffect(() => {
    handlers.current = onEvents
  }, [onEvents])

  useEffect(() => {
    if (!holder.current) return
    const instance = echarts.init(holder.current, undefined, { renderer: 'canvas' })
    chart.current = instance
    // 容器尺寸变化（侧栏折叠、窗口缩放）时重排，否则画布会糊。
    const ro = new ResizeObserver(() => instance.resize())
    ro.observe(holder.current)
    return () => {
      ro.disconnect()
      instance.dispose()
      chart.current = null
    }
  }, [])

  useEffect(() => {
    const instance = chart.current
    if (!instance) return
    instance.setOption(option, { notMerge })
    if (handlers.current) {
      // 先解绑所有旧监听，避免 HMR 累积
      instance.off('click')
      instance.on('click', (params) => handlers.current?.click?.(params))
    }
  }, [option, notMerge])

  const style = useMemo(
    () => ({ width: '100%', height: typeof height === 'number' ? `${height}px` : height }),
    [height],
  )

  return <div ref={holder} className={className} style={style} />
}

export { echarts }
export type { EChartsCoreOption }
