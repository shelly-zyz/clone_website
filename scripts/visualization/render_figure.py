"""Render an OpenGridWorks figure recipe with Matplotlib 3.11.2."""
import datetime as dt
import json
import os
from pathlib import Path
import sys
import warnings

import matplotlib
matplotlib.use("Agg")
import matplotlib.dates as dates
import matplotlib.font_manager as fonts
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap
import numpy as np


def numeric(series):
    return np.array(series, dtype=float)


def setup_fonts(design):
    families = {font.name for font in fonts.fontManager.ttflist}
    candidates = [design["font"], "Arial", "Microsoft YaHei", "PingFang SC",
                  "Noto Sans CJK SC", "Noto Sans CJK JP", "WenQuanYi Micro Hei", "DejaVu Sans"]
    if configured := os.getenv("OGW_VIZ_FONT_FILE"):
        fonts.fontManager.addfont(configured)
        family = fonts.FontProperties(fname=configured).get_name()
        candidates.insert(1, family)
        families.add(family)
    return list(dict.fromkeys(font for font in candidates if font in families))


def axis_values(panel):
    if panel["axis"] == "time":
        return [dt.datetime.fromisoformat(value.replace("Z", "+00:00")) for value in panel["x"]]
    return np.arange(len(panel["x"]))


def line_panel(ax, panel, design):
    x = axis_values(panel)
    items = panel["series"]
    patterns = {"solid": "-", "dash": "--", "dot": ":"}
    unit = items[0]["unit"]
    values = [numeric(item["data"]) for item in items]
    styles = [design["colors"][i % len(design["colors"])] for i in range(len(items))]
    if panel["kind"] == "stack":
        ax.stackplot(x, values, labels=[item["name"] for item in items], colors=styles, alpha=.7)
    elif panel["kind"] in ("columns", "rank", "waterfall"):
        if panel["kind"] == "rank":
            ax.barh(x, values[0], color=styles[0], height=.55)
            ax.set_yticks(x, panel["x"])
            ax.invert_yaxis()
            ax.set_xlabel(unit)
            return
        if panel["kind"] == "waterfall":
            start = np.r_[0, np.nancumsum(values[0][:-1])]
            ax.bar(x, values[0], bottom=start, width=.58,
                   color=[design["colors"][int(value < 0)] for value in values[0]])
        else:
            if len(x) > 1 and panel["axis"] == "time":
                width = min((b - a).total_seconds() / 86400 for a, b in zip(x, x[1:])) * .62
            else:
                width = .62
            order = np.arange(len(items)) - (len(items) - 1) / 2
            bar_width = width / len(items)
            for i, item in enumerate(items):
                distance = bar_width * order[i]
                shift = dt.timedelta(days=distance) if panel["axis"] == "time" else distance
                ax.bar([value + shift for value in x], values[i], width=bar_width,
                       color=styles[i], alpha=.86, label=item["name"])
    else:
        for i, item in enumerate(items):
            linestyle = "--" if item.get("forecast") else patterns[design["line_patterns"][i % 6]]
            if item.get("interval"):
                bounds = np.array([pair or [np.nan, np.nan] for pair in item["interval"]], dtype=float)
                ax.fill_between(x, bounds[:, 0], bounds[:, 1], color=styles[i], alpha=.17)
            markers = ("o", "D", "^", "s", "v", "x")
            ax.plot(x, values[i], linestyle, marker=markers[i % len(markers)] if len(x) <= 20 else None,
                    markersize=2.6, linewidth=1.1, color=styles[i], label=item["name"])
    if panel["axis"] == "time":
        locator = dates.AutoDateLocator(minticks=3, maxticks=6)
        ax.xaxis.set_major_locator(locator)
        ax.xaxis.set_major_formatter(dates.ConciseDateFormatter(locator))
        ax.set_xlabel({"year": "Year", "month": "Month", "day": "Date"}.get(panel.get("time_grain"), "UTC"))
    elif len(x):
        step = max(1, (len(x) + 7) // 8)
        ax.set_xticks(x[::step], panel["x"][::step], rotation=18, ha="right")
    ax.set_ylabel(unit)


def density(ax, panel, design):
    for i, item in enumerate(panel["series"]):
        sample = numeric(item["data"])
        bandwidth = np.std(sample, ddof=1) * len(sample) ** (-.2)
        if bandwidth <= 0 or not np.isfinite(bandwidth):
            raise ValueError("Density has invalid bandwidth")
        x = np.linspace(np.min(sample) - 3 * bandwidth, np.max(sample) + 3 * bandwidth, 192)
        score = np.exp(-.5 * ((x[:, None] - sample[None, :]) / bandwidth) ** 2)
        y = np.mean(score, axis=1) / (bandwidth * np.sqrt(2 * np.pi))
        color = design["colors"][i % len(design["colors"])]
        ax.plot(x, y, color=color, linewidth=1.1, label=item["name"])
        ax.fill_between(x, y, color=color, alpha=.14)
    ax.set_xlabel(panel["series"][0]["unit"])
    ax.set_ylabel("Density")


def draw_panel(fig, ax, panel, design):
    kind = panel["kind"]
    items = panel["series"]
    unit = items[0]["unit"]
    color = design["colors"][0]
    if kind in ("grid", "correlation"):
        values = np.full((len(panel["row_labels"]), len(panel["x"])), np.nan)
        for x, y, value in panel["cells"]:
            values[y, x] = value
        diverging = kind == "correlation"
        cmap = LinearSegmentedColormap.from_list("ogw", design["diverging"] if diverging else design["continuous"])
        cmap.set_bad(design["grid"])
        image = ax.imshow(values, aspect="auto", interpolation="nearest", cmap=cmap,
                          vmin=-1 if diverging else None, vmax=1 if diverging else None)
        fig.colorbar(
            image, ax=ax, location="left", shrink=.58, pad=.12,
            anchor=(1, 1), panchor=(0, 1), label=unit,
        )
        for axis, values in ((ax.set_xticks, panel["x"]), (ax.set_yticks, panel["row_labels"])):
            step = max(1, (len(values) + 5) // 6)
            axis(range(0, len(values), step), values[::step])
        if not diverging:
            ax.set_xlabel("Longitude (°)")
            ax.set_ylabel("Latitude (°)")
        return
    if kind in ("box", "violin"):
        data = [numeric(item["data"]) for item in items]
        if kind == "box":
            line = {"color": design["foreground"]}
            result = ax.boxplot(data, patch_artist=True, whis=1.5, tick_labels=panel["x"],
                                medianprops={**line, "linewidth": 1.1}, whiskerprops=line, capprops=line,
                                flierprops={"marker": ".", "markersize": 4, "markeredgecolor": design["colors"][1]})
            for i, artist in enumerate(result["boxes"]):
                artist.set(facecolor=design["colors"][i % len(design["colors"])], edgecolor=design["muted"], alpha=.37)
        else:
            result = ax.violinplot(data, showmedians=True, showextrema=True, bw_method="scott", points=120)
            for i, artist in enumerate(result["bodies"]):
                artist.set_facecolor(design["colors"][i % len(design["colors"])])
                artist.set_alpha(.62)
            for part in ("cmedians", "cmins", "cmaxes", "cbars"):
                result[part].set_color(design["foreground"])
            ax.set_xticks(np.arange(1, len(data) + 1), panel["x"])
        ax.set_ylabel(unit)
        return
    if kind == "density":
        density(ax, panel, design)
        return
    if kind == "scatter":
        a, b = zip(*panel["points"])
        ax.scatter(a, b, color=color, s=14, alpha=.65, linewidths=0)
        ax.set_xlabel(panel["x_unit"])
        ax.set_ylabel(items[0]["name"] + " (" + unit + ")")
        return
    if kind == "dumbbell":
        left, right = [numeric(item["data"]) for item in items]
        y = np.arange(len(panel["x"]))
        ax.hlines(y, left, right, colors=design["grid"], linewidth=1.4)
        for i, values in enumerate((left, right)):
            ax.scatter(values, y, color=design["colors"][i], s=15, marker="o" if i == 0 else "D", label=items[i]["name"])
        ax.set_yticks(y, panel["x"])
        ax.set_xlabel(unit)
        ax.invert_yaxis()
        return
    if kind == "rose":
        labels = panel["x"]
        angle = np.linspace(0, 2 * np.pi, len(labels), endpoint=False)
        ax.set_theta_zero_location("N")
        ax.set_theta_direction(-1)
        ax.bar(angle, numeric(items[0]["data"]), width=2 * np.pi / len(angle) * .83, color=color, alpha=.72)
        ax.set_xticks(angle, labels)
        ax.set_ylabel(unit)
        return
    line_panel(ax, panel, design)


def draw(payload, output):
    if matplotlib.__version__ != "3.11.2":
        raise RuntimeError("Expected Matplotlib 3.11.2")
    model, design = payload["model"], payload["design"]
    panels = model["panels"]
    if not 1 <= len(panels) <= 6 or not 70 <= design["width_mm"] <= 245 or not 48 <= design["height_mm"] <= 230:
        raise ValueError("Figure exceeds the render budget")
    columns = model["columns"]
    focus = model["focus"]
    rows = (len(panels) - int(focus) + columns - 1) // columns + int(focus)
    face, fore = design["background"], design["foreground"]
    options = {"font.family": setup_fonts(design), "font.size": design["font_size"],
               "axes.unicode_minus": False, "svg.fonttype": "none", "svg.hashsalt": "opengridworks-v1",
               "pdf.fonttype": 42, "text.color": fore, "axes.labelcolor": fore,
               "axes.edgecolor": design["muted"], "figure.facecolor": face,
               "xtick.color": design["muted"], "ytick.color": design["muted"], "text.usetex": False,
               "text.parse_math": False}
    with matplotlib.rc_context(options):
        fig = plt.figure(figsize=(design["width_mm"] / 25.4, design["height_mm"] / 25.4), layout="constrained")
        try:
            grid = fig.add_gridspec(rows, columns)
            fig.suptitle(model["title"], fontweight="semibold", fontsize=design["font_size"] + 2)
            for i, panel in enumerate(panels):
                if focus and i == 0:
                    slot = grid[0, :]
                else:
                    index = i - int(focus)
                    slot = grid[index // columns + int(focus), index % columns]
                ax = fig.add_subplot(slot, projection="polar" if panel["kind"] == "rose" else None)
                ax.set_facecolor(face)
                for name in ("top", "right"):
                    if name in ax.spines:
                        ax.spines[name].set_visible(False)
                ax.set_axisbelow(True)
                if panel["kind"] not in ("grid", "correlation"):
                    ax.grid(axis="y", color=design["grid"], linewidth=.55)
                if len(panels) > 1:
                    ax.set_title(f"({chr(ord('a') + i)})  {panel['title']}", loc="left", fontsize=design["font_size"] + 1)
                draw_panel(fig, ax, panel, design)
                handles, names = ax.get_legend_handles_labels()
                if len(handles) > 1 and design["legend"] != "none":
                    placement = {"top": ("lower center", (.5, 1.13)), "right": ("center left", (1.04, .5)),
                                 "bottom": ("upper center", (.5, -.13))}
                    place, anchor = placement[design["legend"]]
                    cols = 2 if design["legend"] != "right" and sum(len(name) for name in names[:2]) <= 28 else 1
                    ax.legend(handles, names, loc=place, bbox_to_anchor=anchor, ncols=cols,
                              fontsize=design["font_size"] - 1, frameon=False)
            extension = Path(output).suffix.lower()
            if extension not in (".svg", ".pdf", ".png"):
                raise ValueError("Unsupported figure format")
            metadata = {"Creator": "OpenGridWorks Matplotlib " + matplotlib.__version__}
            if extension == ".pdf":
                metadata["CreationDate"] = None
            elif extension == ".svg":
                metadata["Date"] = None
            with warnings.catch_warnings():
                warnings.filterwarnings("error", message="Glyph.*missing from font")
                warnings.filterwarnings("error", message="constrained_layout not applied.*")
                fig.savefig(output, dpi=300, metadata=metadata)
        finally:
            plt.close(fig)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("render_figure.py INPUT.json OUTPUT.svg")
    with open(sys.argv[1], encoding="utf-8") as handle:
        draw(json.load(handle), sys.argv[2])
