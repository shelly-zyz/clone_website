import type { FigureDesign, FigureModel, FigurePanel } from "./contracts";

const editableKinds = new Set(["trend", "columns", "rank", "horizontal-bars", "composition-columns"]);
export function hasEditableDrawing(model: FigureModel) {
  return model.panels.every(panel => editableKinds.has(panel.kind)) &&
    model.panels.reduce((sum, panel) => sum + panel.series.length * panel.x.length, 0) <= 1_200;
}

const xml = (value: string) => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
  .replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]!);
const format = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2, notation: "compact" });
const position = (n: number) => Math.round(n * 10) / 10;

export function exportDrawio(model: FigureModel, design: FigureDesign, reference: string) {
  const cells = ['<mxCell id="0"/>', '<mxCell id="1" parent="0"/>'];
  let id = 1;
  const shape = (label: string, x: number, y: number, w: number, h: number, style: string) =>
    cells.push('<mxCell id="' + ++id + '" value="' + xml(label) + '" style="' + style + '" vertex="1" parent="1">' +
      '<mxGeometry x="' + position(x) + '" y="' + position(y) + '" width="' + position(Math.max(1, w)) +
      '" height="' + position(Math.max(1, h)) + '" as="geometry"/></mxCell>');
  const line = (x: number, y: number, ex: number, ey: number, color: string, width = 1) =>
    cells.push('<mxCell id="' + ++id + '" style="endArrow=none;strokeWidth=' + width + ';strokeColor=' + color + ';" edge="1" parent="1">' +
      '<mxGeometry relative="1" as="geometry"><mxPoint x="' + position(x) + '" y="' + position(y) +
      '" as="sourcePoint"/><mxPoint x="' + position(ex) + '" y="' + position(ey) + '" as="targetPoint"/></mxGeometry></mxCell>');
  const text = (label: string, x: number, y: number, width: number, align = "left", size = design.font_size) =>
    shape(label, x, y, width, 22, 'text;html=0;whiteSpace=wrap;align=' + align + ';verticalAlign=middle;fontColor=' +
      design.foreground + ';fontFamily=' + design.font + ';fontSize=' + size + ';');
  const columns = Math.max(1, model.columns), width = 590;
  const height = Math.max(380, ...model.panels.map(panel => (panel.kind === "rank" || panel.kind === "horizontal-bars") ? panel.x.length * 18 + 140 : 380));
  text(model.title, 35, 20, columns * width - 45, "left", design.font_size + 8);

  function panelGraph(panel: FigurePanel, originX: number, originY: number, span: number) {
    const horizontal = panel.kind === "rank" || panel.kind === "horizontal-bars";
    const lines = panel.kind === "trend";
    const values = panel.series.flatMap(series => series.data.filter(value => value !== null));
    if (!values.length) return;
    const low = lines ? Math.min(...values) : Math.min(0, ...values);
    const high = lines ? Math.max(...values) : Math.max(0, ...values);
    const range = high - low || 1;
    const left = originX + (horizontal ? 130 : 64), top = originY + 62;
    const w = span - (horizontal ? 152 : 88), h = height - 136;
    const px = (value: number) => left + (value - low) / range * w;
    const py = (value: number) => top + h - (value - low) / range * h;
    const space = (horizontal ? h : w) / Math.max(1, panel.x.length);
    const times = panel.axis === "time" ? panel.x.map(label => Date.parse(label)) : undefined;
    const timeRange = times && times[times.length - 1] - times[0];
    const xAt = (index: number) => times && timeRange
      ? left + space / 2 + (times[index] - times[0]) / timeRange * (w - space) : left + space * (index + .5);
    text(panel.title, originX + 10, originY + 5, span - 20, "left", design.font_size + 3);
    text(panel.series[0].unit, left, top - 24, 100);
    for (let i = 0; i <= 4; i++) {
      const value = low + range * i / 4;
      if (horizontal) {
        line(px(value), top, px(value), top + h, design.grid);
        text(format.format(value), px(value) - 26, top + h + 4, 52, "center");
      } else {
        line(left, py(value), left + w, py(value), design.grid);
        text(format.format(value), originX + 3, py(value) - 11, 54, "right");
      }
    }
    const step = Math.max(1, Math.ceil(panel.x.length / 8));
    panel.x.forEach((label, i) => {
      if (horizontal) text(label, originX + 7, top + space * (i + .5) - 11, 114, "right");
      else if (i % step === 0) text(axisText(panel, label), xAt(i) - 26, top + h + 5, 52, "center");
    });
    panel.series.forEach((series, i) => {
      const color = design.colors[i % design.colors.length];
      let previous: [number, number] | undefined;
      series.data.forEach((value, j) => {
        if (value === null) { previous = undefined; return; }
        const x = xAt(j), y = top + space * (j + .5);
        const label = series.name + " · " + axisText(panel, panel.x[j]) + " = " + value + " " + series.unit;
        const fill = (ink: string) => 'fillColor=' + ink + ';strokeColor=none;fontSize=1;fontColor=' + ink + ';opacity=100;';
        // Values belong to editable object IDs through a tooltip attribute, leaving mark labels visually empty.
        const mark = (style: string, mx: number, my: number, mw: number, mh: number) => {
          shape("", mx, my, mw, mh, style);
          const cell = cells.pop()!;
          cells.push('<object label="" tooltip="' + xml(label) + '" id="' + id + '">' + cell.replace(' id="' + id + '" value=""', "") + '</object>');
        };
        if (horizontal) {
          const rank = panel.kind === "rank";
          mark(fill(color), Math.min(px(0), px(value)), y - (rank ? 1 : 5), Math.abs(px(value) - px(0)), rank ? 2 : 10);
          if (rank) mark("ellipse;" + fill(color), px(value) - 4, y - 4, 8, 8);
        } else if (lines) {
          const point: [number, number] = [x, py(value)];
          if (previous) line(...previous, ...point, color, 2);
          mark("ellipse;" + fill(color), point[0] - 3, point[1] - 3, 6, 6);
          previous = point;
        } else {
          const barWidth = Math.min(26, space * .82 / panel.series.length);
          const shade = panel.kind === "composition-columns" ? design.colors[j % design.colors.length] : color;
          mark(fill(shade), x + (i - panel.series.length / 2) * barWidth, Math.min(py(value), py(0)), barWidth - 1, Math.abs(py(value) - py(0)));
        }
      });
      if (panel.series.length > 1 && design.legend !== "none") {
        const legendWidth = (span - 18) / panel.series.length, x = originX + 10 + legendWidth * i;
        shape("", x, originY + height - 31, 9, 9, 'fillColor=' + color + ';strokeColor=none;');
        text(series.name, x + 13, originY + height - 38, legendWidth - 16);
      }
    });
  }

  model.panels.forEach((panel, index) => {
    const main = model.focus && index === 0;
    const sequence = model.focus ? index - 1 : index;
    const row = main ? 0 : Math.floor(sequence / columns) + Number(model.focus);
    panelGraph(panel, main ? 25 : 25 + sequence % columns * width, 65 + row * height, main ? columns * width : width);
  });
  const rows = model.focus ? 1 + Math.ceil((model.panels.length - 1) / columns) : Math.ceil(model.panels.length / columns);
  text("OpenGridWorks · 原图 " + reference, 34, 70 + rows * height, columns * width - 45, "left", 9);
  return '<?xml version="1.0" encoding="UTF-8"?><mxfile host="OpenGridWorks"><diagram id="figure" name="可编辑图件">' +
    '<mxGraphModel grid="0" page="1" pageScale="1" pageWidth="' + (50 + width * columns) + '" pageHeight="' +
    (115 + rows * height) + '" background="' + design.background + '"><root>' + cells.join("") + '</root></mxGraphModel></diagram></mxfile>';
}

function axisText(panel: FigurePanel, label: string) {
  if (panel.axis !== "time") return label;
  return label.slice(0, panel.time_grain === "year" ? 4 : panel.time_grain === "month" ? 7 : panel.time_grain === "day" ? 10 : 16);
}
