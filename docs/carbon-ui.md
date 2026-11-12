# 能碳 UI 组件库

运行 `npm run dev`，打开 [组件预览](/ui-library)。预览用固定示例展示年度与核算范围筛选、排放趋势、台账及核算说明。组件由业务页面传入数据。

## 使用方式

从 `@/components/carbon-ui` 导入组件，使用 `CarbonTheme` 包裹对应工作区。通过 `theme="dark"` 或 `theme="light"` 选择主题。使用图表时也将当前主题传给 `CarbonTrend`，主题切换后它会重新读取图表配色。

```tsx
import { CarbonMetric, CarbonPanel, CarbonTheme, CarbonTrend } from "@/components/carbon-ui";

export function EmissionsSummary() {
  return (
    <CarbonTheme>
      <CarbonMetric label="碳排放量" value={123} unit="tCO₂e" tone="carbon" />
      <CarbonPanel title="月度趋势" appearance="dashboard">
        <CarbonTrend
          label="碳排放量"
          unit="tCO₂e"
          points={[{ label: "1月", value: 123 }, { label: "2月", value: null }]}
        />
      </CarbonPanel>
    </CarbonTheme>
  );
}
```

| 组件 | 用法 |
| --- | --- |
| `CarbonTheme` | 为工作区提供作用域内的颜色、文字及交互主题 |
| `CarbonPanel` | 通过 `title`、`description`、`action` 组合面板头部，`appearance="dashboard"` 使用驾驶舱样式 |
| `CarbonMetric`、`CarbonBadge` | 展示指标、单位及数据状态，使用 `tone` 指定语义色，指标可用 `null` 表示缺失 |
| `CarbonButton`、`CarbonSelect` | 操作按钮和带标签的原生下拉框，接受常规事件和表单属性 |
| `CarbonTrend` | 通过 `points` 接收时间序列，使用 `null` 保留缺测间隔 |
| `CarbonBreakdown` | 通过 `items` 接收各类别的非负有限数值及语义色，并计算占比 |
| `CarbonTable<Row>` | 通过 `columns` 定义列渲染函数，`rowKey` 返回稳定键，移动端可横向滚动 |
| `CarbonEvidence` | 通过内容插槽呈现可展开的核算说明和来源 |
| `CarbonState` | 展示 `loading`、`empty`、`error` 状态，可传入操作按钮 |

## 设计参考

- 信阳园区平台的深色圆角表面、荧光绿操作色及能源和碳排语义色。 [园区主题源码](https://github.com/shellyzhou888-lgtm/xinyang-carbon-platform/blob/fe5051b6985bd5240c1f6b4e5ef2a69fb646bc66/apps/web/app/globals.css)
- 武汉理工低碳校园平台的青蓝驾驶舱面板、角标、核算明细和可展开来源。 [驾驶舱样式](https://github.com/shellyzhou888-lgtm/campus-carbon-accounting/blob/33cfbb496cca5e966d3eebb6b15a9aa04d114e08/app/src/styles/dashboard.css) · [核算组件](https://github.com/shellyzhou888-lgtm/campus-carbon-accounting/blob/33cfbb496cca5e966d3eebb6b15a9aa04d114e08/app/src/components/accounting/Shared.tsx)
