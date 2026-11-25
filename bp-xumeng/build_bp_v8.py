#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
叙梦 XUMENG（xumengchat.top）天使轮商业计划书（400万人民币 · 海外团队 · 先成人后女性向 · 一年冲刺3000万年化）
输出：/home/fangzhixue/hubin/IntVideoGameEditor/bp-xumeng/xumeng-bp-v8-400w.pptx
"""

import os
import math
from PIL import Image, ImageDraw, ImageFilter
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager
import numpy as np

from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE
from pptx.oxml.xmlchemy import OxmlElement

BASE_DIR = "/home/fangzhixue/hubin/IntVideoGameEditor"
BP_DIR = os.path.join(BASE_DIR, "bp-xumeng")
ASSETS_DIR = os.path.join(BP_DIR, "assets")
SHOT_DIR = "/home/fangzhixue/hubin/screenshots"
BRAND_LOGO = os.path.join(BASE_DIR, "public/dzmm/brand/xumeng-icon-512.png")
GEN_DIR = os.path.join(BP_DIR, "assets-v8-400w")
OUT_PPTX = os.path.join(BP_DIR, "xumeng-bp-v8-400w.pptx")

os.makedirs(GEN_DIR, exist_ok=True)

# 字体配置
ZH_FONT_PATH = "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc"
if os.path.exists(ZH_FONT_PATH):
    font_manager.fontManager.addfont(ZH_FONT_PATH)
    ZH_MPL_FONT = font_manager.FontProperties(fname=ZH_FONT_PATH).get_name()
else:
    ZH_MPL_FONT = "sans-serif"

plt.rcParams["font.sans-serif"] = [ZH_MPL_FONT, "DejaVu Sans"]
plt.rcParams["axes.unicode_minus"] = False

PPT_FONT = "微软雅黑"

# 品牌色板（Velvet Rose Dark）
C_BG       = RGBColor(0x12, 0x09, 0x11)
C_SURFACE  = RGBColor(0x1D, 0x11, 0x1C)
C_SURFACE2 = RGBColor(0x28, 0x17, 0x26)
C_BORDER   = RGBColor(0x45, 0x27, 0x40)
C_ROSE     = RGBColor(0xE8, 0x43, 0x7C)
C_PINK     = RGBColor(0xFF, 0x85, 0xB3)
C_GOLD     = RGBColor(0xF5, 0xB9, 0x71)
C_TEAL     = RGBColor(0x4D, 0xD0, 0xB8)
C_PURPLE   = RGBColor(0xA6, 0x78, 0xE8)
C_TEXT     = RGBColor(0xFA, 0xF2, 0xEE)
C_SUBTEXT  = RGBColor(0xCC, 0xB7, 0xC6)
C_MUTED    = RGBColor(0x8F, 0x76, 0x88)
C_ROW_ALT  = RGBColor(0x22, 0x14, 0x21)
C_HEADER   = RGBColor(0x3A, 0x1A, 0x33)
C_HIGHLIGHT_ROW = RGBColor(0x45, 0x18, 0x34)

HEX_BG     = "#120911"
HEX_CARD   = "#1D111C"
HEX_ROSE   = "#E8437C"
HEX_PINK   = "#FF85B3"
HEX_GOLD   = "#F5B971"
HEX_TEAL   = "#4DD0B8"
HEX_PURPLE = "#A678E8"
HEX_TEXT   = "#FAF2EE"
HEX_SUB    = "#CCB7C6"
HEX_GRID   = "#352032"


# ---------------------------------------------------------------------------
# 1. 预处理图像资源（背景渐变 + 最新版产品截图脱敏柔焦拼图 + 4 张高清图表）
# ---------------------------------------------------------------------------
def make_overlay_bg(src_path, dst_path, mode="left"):
    im = Image.open(src_path).convert("RGBA")
    w, h = im.size
    overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    px = overlay.load()
    for y in range(h):
        for x in range(w):
            nx = x / w
            ny = y / h
            if mode == "left":
                if nx < 0.45:
                    alpha = 232
                elif nx < 0.78:
                    t = (nx - 0.45) / 0.33
                    alpha = int(232 * (1 - t) + 115 * t)
                else:
                    alpha = 115
                edge_boost = int(45 * (abs(ny - 0.5) * 2) ** 2)
                alpha = min(245, alpha + edge_boost)
            else:
                dist = math.sqrt(((nx - 0.5) * 1.1) ** 2 + ((ny - 0.5) * 1.4) ** 2)
                alpha = int(min(238, 178 + 55 * (1 - min(1.0, dist))))
            px[x, y] = (18, 9, 17, alpha)
    out = Image.alpha_composite(im, overlay).convert("RGB")
    out.save(dst_path, quality=92)


def blur_regions(src_path, dst_path, rel_boxes, radius=24):
    """对图片中指定相对坐标区域 (x1, y1, x2, y2) 做柔和的高斯模糊，完整保留文字和 UI 边框"""
    im = Image.open(src_path).convert("RGB")
    w, h = im.size
    for (rx1, ry1, rx2, ry2) in rel_boxes:
        box = (int(w * rx1), int(h * ry1), int(w * rx2), int(h * ry2))
        crop = im.crop(box).filter(ImageFilter.GaussianBlur(radius=radius))
        im.paste(crop, box)
    im.save(dst_path, quality=92)


def make_latest_mobile_triptych(dst_path):
    """拼接最新 3 张手机端界面：首页游玩 / 新版创作中心 / 新版生图与视频模板广场（敏感画面脱敏柔焦）"""
    p_play = os.path.join(GEN_DIR, "m_play_safe.png")
    p_create = os.path.join(GEN_DIR, "m_create_safe.png")
    p_gen = os.path.join(GEN_DIR, "m_gen_safe.png")

    # 1. 最新手机首页：只模糊下半排露骨卡片图区，完整保留顶栏、Banner、热榜标题、底栏
    blur_regions(
        os.path.join(SHOT_DIR, "mobile_xumeng_after/01_play_dark_after.png"),
        p_play,
        [(0.03, 0.64, 0.97, 0.89)],
        radius=26,
    )
    # 2. 最新手机创作中心：精准避开文字胶囊，只模糊人物裸露区域
    blur_regions(
        os.path.join(SHOT_DIR, "mobile_xumeng_after/06_creator_center_after.png"),
        p_create,
        [
            (0.68, 0.06, 0.94, 0.205),  # AI 生成卡片右侧人物（避开左侧“AI生成”标题）
            (0.18, 0.23, 0.46, 0.295),  # 小说与故事人物（避开底部“小说与故事”胶囊）
            (0.62, 0.23, 0.94, 0.295),  # 新建女友人物（避开底部“新建女友”胶囊）
            (0.42, 0.425, 0.94, 0.495), # 多人同场右侧人物身体（避开左侧“多人同场”文字）
            (0.44, 0.60, 0.78, 0.745),  # 会员 Banner 身体（避开左侧“叙梦会员”文字）
        ],
        radius=26,
    )
    # 3. 最新手机「生图与视频」模板广场：完整覆盖缩略图区，保留顶部标题、搜索、标签和底栏
    blur_regions(
        os.path.join(SHOT_DIR, "mobile_xumeng_after/08_generation_after.png"),
        p_gen,
        [(0.03, 0.48, 0.97, 0.915)],
        radius=26,
    )

    imgs = [Image.open(p).convert("RGB") for p in [p_play, p_create, p_gen]]
    target_h = 1120
    resized = []
    for im in imgs:
        w, h = im.size
        nw = int(w * (target_h / h))
        resized.append(im.resize((nw, target_h), Image.Resampling.LANCZOS))

    gap = 28
    pad = 20
    total_w = sum(im.size[0] for im in resized) + gap * 2 + pad * 2
    canvas = Image.new("RGB", (total_w, target_h + pad * 2), (29, 17, 28))
    x = pad
    for im in resized:
        canvas.paste(im, (x, pad))
        x += im.size[0] + gap
    canvas.save(dst_path, quality=92)


def make_latest_desktop_creator(dst_path):
    """最新版桌面创作中心（精准避开全部文字标题，仅对敏感图像区域做柔焦）"""
    blur_regions(
        os.path.join(SHOT_DIR, "p0_after/05_creator_center.png"),
        dst_path,
        [
            (0.75, 0.05, 0.94, 0.225),  # AI 生成卡片右侧人物
            (0.25, 0.27, 0.42, 0.445),  # 小说与故事人物（完整露出底部“小说与故事”）
            (0.51, 0.27, 0.69, 0.445),  # 新建女友人物（完整露出底部“新建女友”）
            (0.76, 0.34, 0.97, 0.445),  # 多人同场人物身体（完整露出底部“多人同场”）
            (0.45, 0.56, 0.78, 0.765),  # 会员 Banner 身体（完整露出左侧“叙梦会员”）
        ],
        radius=28,
    )


def make_chart_market(dst_path):
    fig, ax = plt.subplots(figsize=(6.4, 4.3), dpi=260)
    fig.patch.set_facecolor(HEX_CARD)
    ax.set_facecolor(HEX_CARD)

    labels = [
        "全球短剧内购\n(2025 实绩)",
        "全球互动影游\n(2026E 预测)",
        "AI陪伴 Top10\n(年化估算)",
        "中国AI剧/漫剧\n(2026E 预测)",
    ]
    values_rmb = [201.6, 165.6, 50.0, 400.0]
    display_labels = ["$28亿\n(≈202亿¥)", "$23亿+\n(≈166亿¥)", "50亿+¥\n(月4.17亿)", "400亿¥\n(+138%)"]
    growth_tags = ["同比 +116%", "付费转化 2-3x", "3款26年新品进前8", "用户超 6 亿"]
    colors = [HEX_ROSE, HEX_GOLD, HEX_PINK, HEX_PURPLE]

    x = np.arange(len(labels))
    bars = ax.bar(x, values_rmb, width=0.52, color=colors, edgecolor="none", zorder=3)

    ax.set_ylim(0, 485)
    ax.set_xticks(x)
    ax.set_xticklabels(labels, color=HEX_TEXT, fontsize=9.5)
    ax.set_ylabel("市场体量（统一折合亿元人民币）", color=HEX_SUB, fontsize=9)
    ax.tick_params(axis="y", colors=HEX_SUB, labelsize=8.5)
    ax.tick_params(axis="x", length=0, pad=8)
    ax.yaxis.grid(True, color=HEX_GRID, linestyle="--", linewidth=0.7, zorder=0)
    for spine in ["top", "right"]:
        ax.spines[spine].set_visible(False)
    for spine in ["left", "bottom"]:
        ax.spines[spine].set_color(HEX_GRID)

    for bar, dlab, gtag in zip(bars, display_labels, growth_tags):
        h = bar.get_height()
        ax.text(bar.get_x() + bar.get_width() / 2, h + 12, dlab,
                ha="center", va="bottom", color=HEX_TEXT, fontsize=9.5, fontweight="bold")
        ax.text(bar.get_x() + bar.get_width() / 2, max(h * 0.48, 18), gtag,
                ha="center", va="center", color="#120911" if h > 90 else HEX_TEXT,
                fontsize=8.2, fontweight="bold",
                bbox=dict(boxstyle="round,pad=0.25", facecolor="#FAF2EE" if h > 90 else "#2E1A2B", alpha=0.88, edgecolor="none"))

    ax.set_title("短剧 × 互动影游 × AI陪伴：全球多条百亿赛道交汇", color=HEX_TEXT, fontsize=11.5, fontweight="bold", pad=14)
    plt.tight_layout(pad=1.0)
    plt.savefig(dst_path, facecolor=HEX_CARD)
    plt.close(fig)


def make_chart_ue(dst_path):
    """海外成人线单付费用户月 ARPPU ¥200（≈$28）成本与毛利拆解"""
    fig, ax = plt.subplots(figsize=(5.6, 3.6), dpi=260)
    fig.patch.set_facecolor(HEX_CARD)
    ax.set_facecolor(HEX_CARD)

    cats = ["月贡献毛利\n(净留存贡献)", "AI推理与多模态\n(生图/视频/剧集)", "支付与云基建\n(海外通道+容器)", "创作者/渠道分成\n(综合摊销规划)"]
    vals = [96, 56, 24, 24]
    pcts = [48, 28, 12, 12]
    colors = [HEX_TEAL, HEX_ROSE, HEX_PURPLE, HEX_GOLD]

    y = np.arange(len(cats))[::-1]
    bars = ax.barh(y, vals, height=0.52, color=colors, zorder=3)

    ax.set_xlim(0, 132)
    ax.set_yticks(y)
    ax.set_yticklabels(cats, color=HEX_TEXT, fontsize=9.3)
    ax.tick_params(axis="x", colors=HEX_SUB, labelsize=8.5)
    ax.tick_params(axis="y", length=0, pad=6)
    ax.xaxis.grid(True, color=HEX_GRID, linestyle="--", linewidth=0.7, zorder=0)
    for spine in ["top", "right"]:
        ax.spines[spine].set_visible(False)
    for spine in ["left", "bottom"]:
        ax.spines[spine].set_color(HEX_GRID)

    for bar, v, p in zip(bars, vals, pcts):
        ax.text(v + 3.0, bar.get_y() + bar.get_height() / 2, f"¥{v}  ({p}%)",
                va="center", ha="left", color=HEX_TEXT, fontsize=10, fontweight="bold")

    ax.set_title("海外成人线：月 ARPPU $28（≈¥200）成本与毛利结构", color=HEX_TEXT, fontsize=10.8, fontweight="bold", pad=12)
    plt.tight_layout(pad=1.0)
    plt.savefig(dst_path, facecolor=HEX_CARD)
    plt.close(fig)


def make_chart_12m_ramp(dst_path):
    """12 个月（Q1–Q4）冲刺年化 3,000 万跑速爬坡图"""
    fig, ax1 = plt.subplots(figsize=(6.8, 4.35), dpi=260)
    fig.patch.set_facecolor(HEX_CARD)
    ax1.set_facecolor(HEX_CARD)

    quarters = ["Q1 (M1-M3)\n成人闭环验证", "Q2 (M4-M6)\nROI 滚动放量", "Q3 (M7-M9)\n多语+女性向内测", "Q4 (M10-M12)\n双线冲刺 Pre-A"]
    monthly_rev = [25, 80, 160, 255]      # 季度末月流水（万元）
    arr_runrate = [300, 960, 1920, 3060]  # 年化跑速 ARR（万元）
    mau = [2.0, 6.0, 12.0, 18.5]          # 季度末 MAU（万人）

    x = np.arange(len(quarters))
    w = 0.36
    b1 = ax1.bar(x - w/2, arr_runrate, width=w, color=HEX_ROSE, alpha=0.92, label="季度末年化跑速 ARR（万元）", zorder=3)

    ax1.set_ylim(0, 3750)
    ax1.set_xticks(x)
    ax1.set_xticklabels(quarters, color=HEX_TEXT, fontsize=9.2)
    ax1.set_ylabel("年化流水跑速 ARR（万元人民币）", color=HEX_SUB, fontsize=9.2)
    ax1.tick_params(axis="y", colors=HEX_SUB, labelsize=8.5)
    ax1.tick_params(axis="x", length=0, pad=8)
    ax1.yaxis.grid(True, color=HEX_GRID, linestyle="--", linewidth=0.7, zorder=0)
    for spine in ["top"]:
        ax1.spines[spine].set_visible(False)
    for spine in ["left", "bottom", "right"]:
        ax1.spines[spine].set_color(HEX_GRID)

    for bar, mr, ar in zip(b1, monthly_rev, arr_runrate):
        ax1.text(bar.get_x() + bar.get_width()/2, ar + 75, f"年化 ¥{ar}万\n(月 ¥{mr}万)",
                 ha="center", va="bottom", color=HEX_GOLD if ar >= 3000 else HEX_PINK, fontsize=8.8, fontweight="bold")

    ax2 = ax1.twinx()
    ax2.plot(x + 0.16, mau, color=HEX_TEAL, marker="o", linewidth=2.6, markersize=8.5, label="季度末 MAU（万人）", zorder=5)
    ax2.set_ylim(0, 26)
    ax2.set_ylabel("季度末 MAU（万人）", color=HEX_TEAL, fontsize=9.2)
    ax2.tick_params(axis="y", colors=HEX_TEAL, labelsize=8.5)
    ax2.spines["top"].set_visible(False)
    ax2.spines["right"].set_color(HEX_TEAL)

    y_offs = [2.1, 2.0, 2.0, 1.9]
    x_offs = [0.24, 0.28, 0.28, 0.18]
    for xi, m, dx, dy in zip(x, mau, x_offs, y_offs):
        ax2.text(xi + dx, m + dy, f"{m:g}万 MAU",
                 ha="center", va="bottom", color=HEX_TEAL, fontsize=8.5, fontweight="bold",
                 bbox=dict(boxstyle="round,pad=0.22", facecolor="#120911", edgecolor=HEX_TEAL, linewidth=0.8, alpha=0.92),
                 zorder=6)

    # 3000万目标参考虚线（文字放在中段空白处，绝不与图例重叠）
    ax1.axhline(3000, color=HEX_GOLD, linestyle=":", linewidth=1.2, alpha=0.85, zorder=2)
    ax1.text(1.55, 3090, "Y1 目标线：年化 ¥3,000 万（月流水 ¥250 万+）",
             ha="center", va="bottom", color=HEX_GOLD, fontsize=8.6, fontweight="bold")

    lines1, labels1 = ax1.get_legend_handles_labels()
    lines2, labels2 = ax2.get_legend_handles_labels()
    ax1.legend(lines1 + lines2, labels1 + labels2, loc="upper left", bbox_to_anchor=(0.0, 0.99), frameon=True, facecolor="#281726", edgecolor=HEX_GRID, labelcolor=HEX_TEXT, fontsize=8.4)

    ax1.set_title("12 个月冲刺节奏：一年内跑出年化 ¥3,000 万+ 跑速", color=HEX_TEXT, fontsize=11.3, fontweight="bold", pad=12)
    plt.tight_layout(pad=1.0)
    plt.savefig(dst_path, facecolor=HEX_CARD)
    plt.close(fig)


def make_chart_funding(dst_path):
    fig, ax = plt.subplots(figsize=(6.4, 4.6), dpi=260)
    fig.patch.set_facecolor(HEX_CARD)
    ax.set_facecolor(HEX_CARD)

    labels = [
        "核心产品与研发\n30% · 120万",
        "海外买量与滚投\n35% · 140万",
        "成人/女性向内容供给\n25% · 100万",
        "合规基建与预备\n10% · 40万",
    ]
    sizes = [30, 35, 25, 10]
    colors = [HEX_ROSE, HEX_TEAL, HEX_GOLD, HEX_PURPLE]

    ax.pie(
        sizes,
        labels=labels,
        colors=colors,
        radius=0.82,
        startangle=132,
        counterclock=False,
        wedgeprops=dict(width=0.31, edgecolor=HEX_CARD, linewidth=3),
        textprops=dict(color=HEX_TEXT, fontsize=9.6, fontweight="bold"),
        labeldistance=1.18,
    )
    ax.text(0, 0.08, "¥400万", ha="center", va="center", color=HEX_GOLD, fontsize=20, fontweight="bold")
    ax.text(0, -0.14, "天使轮计划分配", ha="center", va="center", color=HEX_SUB, fontsize=9.5)
    ax.set_xlim(-1.68, 1.68)
    ax.set_ylim(-1.25, 1.25)
    ax.set_aspect("equal")
    plt.subplots_adjust(left=0.04, right=0.96, top=0.95, bottom=0.05)
    plt.savefig(dst_path, facecolor=HEX_CARD)
    plt.close(fig)


# ---------------------------------------------------------------------------
# 2. PPTX 绘图辅助函数
# ---------------------------------------------------------------------------
def set_slide_bg(slide, color=C_BG):
    bg = slide.background
    fill = bg.fill
    fill.solid()
    fill.fore_color.rgb = color


def add_rect(slide, left, top, width, height, fill_color=C_SURFACE, border_color=C_BORDER, border_pt=1.0, rounded=True):
    shape_type = MSO_SHAPE.ROUNDED_RECTANGLE if rounded else MSO_SHAPE.RECTANGLE
    shp = slide.shapes.add_shape(shape_type, Inches(left), Inches(top), Inches(width), Inches(height))
    if rounded:
        try:
            shp.adjustments[0] = 0.06
        except Exception:
            pass
    shp.fill.solid()
    shp.fill.fore_color.rgb = fill_color
    if border_color is not None and border_pt > 0:
        shp.line.color.rgb = border_color
        shp.line.width = Pt(border_pt)
    else:
        shp.line.fill.background()
    return shp


def add_pill(slide, left, top, width, height, text, fill_color=C_ROSE, text_color=C_TEXT, font_size=10):
    shp = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(left), Inches(top), Inches(width), Inches(height))
    try:
        shp.adjustments[0] = 0.5
    except Exception:
        pass
    shp.fill.solid()
    shp.fill.fore_color.rgb = fill_color
    shp.line.fill.background()
    tf = shp.text_frame
    tf.word_wrap = False
    tf.margin_left = Inches(0.08)
    tf.margin_right = Inches(0.08)
    tf.margin_top = Inches(0.02)
    tf.margin_bottom = Inches(0.02)
    tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    p = tf.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    run = p.add_run()
    run.text = text
    run.font.name = PPT_FONT
    run.font.size = Pt(font_size)
    run.font.bold = True
    run.font.color.rgb = text_color
    return shp


def add_textbox(slide, left, top, width, height, text, font_size=14, color=C_TEXT, bold=False, align=PP_ALIGN.LEFT, line_spacing=1.22):
    tb = slide.shapes.add_textbox(Inches(left), Inches(top), Inches(width), Inches(height))
    tf = tb.text_frame
    tf.word_wrap = True
    tf.margin_left = Inches(0.04)
    tf.margin_right = Inches(0.04)
    tf.margin_top = Inches(0.02)
    tf.margin_bottom = Inches(0.02)
    p = tf.paragraphs[0]
    p.alignment = align
    p.line_spacing = line_spacing
    run = p.add_run()
    run.text = text
    run.font.name = PPT_FONT
    run.font.size = Pt(font_size)
    run.font.bold = bold
    run.font.color.rgb = color
    return tb


def add_bullets(slide, left, top, width, height, items, font_size=13, color=C_TEXT, accent_color=C_PINK, space_after=8, line_spacing=1.25):
    tb = slide.shapes.add_textbox(Inches(left), Inches(top), Inches(width), Inches(height))
    tf = tb.text_frame
    tf.word_wrap = True
    tf.margin_left = Inches(0.04)
    tf.margin_right = Inches(0.04)
    tf.margin_top = Inches(0.02)
    tf.margin_bottom = Inches(0.02)
    for idx, item in enumerate(items):
        p = tf.paragraphs[0] if idx == 0 else tf.add_paragraph()
        p.space_after = Pt(space_after)
        p.line_spacing = line_spacing
        r_dot = p.add_run()
        r_dot.text = "▸ "
        r_dot.font.name = PPT_FONT
        r_dot.font.size = Pt(font_size)
        r_dot.font.bold = True
        r_dot.font.color.rgb = accent_color
        if isinstance(item, tuple):
            head, body = item
            r1 = p.add_run()
            r1.text = head
            r1.font.name = PPT_FONT
            r1.font.size = Pt(font_size)
            r1.font.bold = True
            r1.font.color.rgb = C_TEXT
            r2 = p.add_run()
            r2.text = body
            r2.font.name = PPT_FONT
            r2.font.size = Pt(font_size)
            r2.font.color.rgb = color
        else:
            r1 = p.add_run()
            r1.text = item
            r1.font.name = PPT_FONT
            r1.font.size = Pt(font_size)
            r1.font.color.rgb = color
    return tb


def add_picture_fit(slide, img_path, box_left, box_top, box_w, box_h, border=True):
    im = Image.open(img_path)
    iw, ih = im.size
    ratio = iw / ih
    box_ratio = box_w / box_h
    if ratio > box_ratio:
        w = box_w
        h = box_w / ratio
    else:
        h = box_h
        w = box_h * ratio
    x = box_left + (box_w - w) / 2
    y = box_top + (box_h - h) / 2
    if border:
        add_rect(slide, x - 0.05, y - 0.05, w + 0.10, h + 0.10, fill_color=C_SURFACE2, border_color=C_BORDER, border_pt=1.0, rounded=True)
    pic = slide.shapes.add_picture(img_path, Inches(x), Inches(y), width=Inches(w), height=Inches(h))
    return pic


def set_cell_border(cell, color_hex="3C2238", width_emu="12700"):
    tcPr = cell._tc.get_or_add_tcPr()
    for edge in ("lnL", "lnR", "lnT", "lnB"):
        ln = OxmlElement(f"a:{edge}")
        ln.set("w", width_emu)
        ln.set("cap", "flat")
        ln.set("cmpd", "sng")
        ln.set("algn", "ctr")
        solidFill = OxmlElement("a:solidFill")
        srgbClr = OxmlElement("a:srgbClr")
        srgbClr.set("val", color_hex)
        solidFill.append(srgbClr)
        ln.append(solidFill)
        tcPr.append(ln)


def add_styled_table(slide, left, top, width, height, rows, col_widths=None, font_size=11.5, highlight_last=False):
    n_rows = len(rows)
    n_cols = len(rows[0])
    table_shape = slide.shapes.add_table(n_rows, n_cols, Inches(left), Inches(top), Inches(width), Inches(height))
    table = table_shape.table
    if col_widths:
        for i, cw in enumerate(col_widths):
            table.columns[i].width = Inches(cw)
    for r_idx, row in enumerate(rows):
        for c_idx, val in enumerate(row):
            cell = table.cell(r_idx, c_idx)
            cell.vertical_anchor = MSO_ANCHOR.MIDDLE
            cell.margin_left = Inches(0.10)
            cell.margin_right = Inches(0.10)
            cell.margin_top = Inches(0.06)
            cell.margin_bottom = Inches(0.06)
            cell.fill.solid()
            if r_idx == 0:
                cell.fill.fore_color.rgb = C_HEADER
            elif highlight_last and r_idx == n_rows - 1:
                cell.fill.fore_color.rgb = C_HIGHLIGHT_ROW
            elif r_idx % 2 == 1:
                cell.fill.fore_color.rgb = C_SURFACE
            else:
                cell.fill.fore_color.rgb = C_ROW_ALT
            set_cell_border(cell, "452740" if r_idx == 0 else "331D30")
            tf = cell.text_frame
            tf.word_wrap = True
            p = tf.paragraphs[0]
            p.alignment = PP_ALIGN.LEFT
            p.line_spacing = 1.15
            run = p.add_run()
            run.text = str(val)
            run.font.name = PPT_FONT
            run.font.size = Pt(font_size if r_idx > 0 else font_size + 0.5)
            if r_idx == 0:
                run.font.bold = True
                run.font.color.rgb = C_PINK
            elif highlight_last and r_idx == n_rows - 1:
                run.font.bold = True
                run.font.color.rgb = C_GOLD if c_idx == 0 else C_TEXT
            elif c_idx == 0:
                run.font.bold = True
                run.font.color.rgb = C_TEXT
            else:
                run.font.color.rgb = C_SUBTEXT
    return table_shape


def add_chrome(slide, section_tag, title, subtitle=None, page_num=1, total_pages=18):
    set_slide_bg(slide, C_BG)
    add_rect(slide, 0, 0, 13.333, 0.06, fill_color=C_ROSE, border_color=None, rounded=False)
    add_pill(slide, 10.65, 0.28, 2.15, 0.30, section_tag, fill_color=C_SURFACE2, text_color=C_PINK, font_size=10)
    add_textbox(slide, 0.60, 0.27, 5.2, 0.30, "叙梦 XUMENG  ·  xumengchat.top  ·  Global Team", font_size=10, color=C_MUTED, bold=True)
    add_textbox(slide, 0.60, 0.62, 11.9, 0.56, title, font_size=25, color=C_TEXT, bold=True)
    if subtitle:
        add_textbox(slide, 0.60, 1.18, 12.1, 0.38, subtitle, font_size=12.5, color=C_SUBTEXT)
        line_y = 1.62
    else:
        line_y = 1.26
    add_rect(slide, 0.60, line_y, 12.13, 0.015, fill_color=C_BORDER, border_color=None, rounded=False)
    add_rect(slide, 0.60, 7.05, 12.13, 0.01, fill_color=C_BORDER, border_color=None, rounded=False)
    add_textbox(slide, 0.60, 7.11, 8.8, 0.28, "叙梦 XUMENG（海外团队） |  天使轮商业计划书（400 万人民币） |  机密资料 · 仅供投资沟通", font_size=9, color=C_MUTED)
    add_textbox(slide, 11.40, 7.11, 1.33, 0.28, f"{page_num:02d} / {total_pages:02d}", font_size=9.5, color=C_PINK, bold=True, align=PP_ALIGN.RIGHT)


def set_notes(slide, text):
    notes_slide = slide.notes_slide
    tf = notes_slide.notes_text_frame
    tf.text = text


# ---------------------------------------------------------------------------
# 3. 逐页构建 18 页最新 BP
# ---------------------------------------------------------------------------
def build_deck():
    cover_bg = os.path.join(GEN_DIR, "cover_bg.jpg")
    closing_bg = os.path.join(GEN_DIR, "closing_bg.jpg")
    mobile_triptych = os.path.join(GEN_DIR, "latest_mobile_triptych.png")
    desktop_creator = os.path.join(GEN_DIR, "latest_desktop_creator.png")
    chart_market = os.path.join(GEN_DIR, "chart_market.png")
    chart_ue = os.path.join(GEN_DIR, "chart_ue.png")
    chart_12m = os.path.join(GEN_DIR, "chart_12m_ramp.png")
    chart_funding = os.path.join(GEN_DIR, "chart_funding.png")

    make_overlay_bg(os.path.join(ASSETS_DIR, "hero.png"), cover_bg, mode="left")
    make_overlay_bg(os.path.join(ASSETS_DIR, "memory.png"), closing_bg, mode="center")
    make_latest_mobile_triptych(mobile_triptych)
    make_latest_desktop_creator(desktop_creator)
    make_chart_market(chart_market)
    make_chart_ue(chart_ue)
    make_chart_12m_ramp(chart_12m)
    make_chart_funding(chart_funding)

    prs = Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)
    blank_layout = prs.slide_layouts[6]
    TOTAL = 18

    # =========================================================================
    # SLIDE 1: 封面页
    # =========================================================================
    s1 = prs.slides.add_slide(blank_layout)
    set_slide_bg(s1, C_BG)
    s1.shapes.add_picture(cover_bg, Inches(0), Inches(0), width=Inches(13.333), height=Inches(7.5))
    add_rect(s1, 0, 0, 13.333, 0.08, fill_color=C_ROSE, border_color=None, rounded=False)

    if os.path.exists(BRAND_LOGO):
        s1.shapes.add_picture(BRAND_LOGO, Inches(0.85), Inches(1.12), width=Inches(0.82), height=Inches(0.82))
    add_pill(s1, 1.85, 1.32, 4.15, 0.36, "海外团队 · 天使轮商业计划书 · 2026 年 11 月", fill_color=C_SURFACE2, text_color=C_PINK, font_size=11)

    add_textbox(s1, 0.85, 2.20, 8.2, 0.95, "叙梦  XUMENG", font_size=48, color=C_TEXT, bold=True)
    add_textbox(s1, 0.85, 3.25, 8.1, 0.90, "先切海外 18+ 成人互动内容极速造血\n再边打磨引擎边拓女性向大盘 · 12 个月冲刺 3,000 万年化", font_size=20, color=C_PINK, bold=True, line_spacing=1.35)

    add_rect(s1, 0.85, 4.46, 2.2, 0.05, fill_color=C_ROSE, border_color=None, rounded=False)

    cover_badges = [
        ("本轮融资", "400 万人民币", "天使轮 · 建议出让 10%–15%"),
        ("12 个月目标", "年化 ¥3,000 万+", "年末月流水 ¥250 万+ · 直达 Pre-A"),
        ("两步路径", "先成人 → 拓女性向", "xumengchat.top 全栈已上线"),
    ]
    for i, (k, v, sub) in enumerate(cover_badges):
        bx = 0.85 + i * 3.85
        add_rect(s1, bx, 5.02, 3.60, 1.38, fill_color=C_SURFACE, border_color=C_BORDER, border_pt=1.2)
        add_textbox(s1, bx + 0.22, 5.18, 3.1, 0.28, k, font_size=10.5, color=C_MUTED, bold=True)
        add_textbox(s1, bx + 0.22, 5.46, 3.2, 0.42, v, font_size=18, color=C_GOLD if i < 2 else C_TEAL, bold=True)
        add_textbox(s1, bx + 0.22, 5.95, 3.2, 0.32, sub, font_size=10, color=C_SUBTEXT)

    set_notes(s1, "各位老师好，我们是原生海外团队打造的叙梦 XUMENG（xumengchat.top）。我们的打法非常直接：先切全球付费最强、回本最快的海外 18+ 成人互动内容（短剧强钩子 × 深度角色卡 × 多模态陪伴）快速造血，同时边打磨底层引擎边孵化女性向产品扩盘。本轮融资 400 万人民币，目标一年内跑到年化 3,000 万流水量级。")

    # =========================================================================
    # SLIDE 2: 执行摘要
    # =========================================================================
    s2 = prs.slides.add_slide(blank_layout)
    add_chrome(s2, "01 · 执行摘要", "一页看懂叙梦：海外原生团队 × 两阶段双曲线爆发", "先用高 ARPPU 成人互动内容一年打出 3,000 万年化现金流，再同步沉淀出高留存女性向大盘", 2, TOTAL)

    exec_cards = [
        ("01 超级赛道", C_ROSE, "海外高变现，黑马半年破亿",
         "• 全球 AI 陪伴 Top10 月入 4.17 亿元（2026.10–11）\n• 2026 新上线 Tizz 仅 15 万 MAU 月入 2,000 万+\n• 2025 全球短剧内购 $28 亿（+116%），互动转化高 2–3x"),
        ("02 两阶段战略", C_GOLD, "先成人极速造血 → 边打磨边拓女性向",
         "• 阶段一（成人 NSFW）：刚需最强、月 ARPPU $28（≈¥200），\n  2 个月内回本，快速打出强劲现金流并实战打磨引擎\n• 阶段二（女性向）：引擎复用至独立线「晴屿」，进主流商店扩估值"),
        ("03 核心闭环", C_PINK, "短剧钩子 → 角色卡 → 多模态陪伴",
         "• 30–60 秒高张力短剧切片低成本拉新，解决陪伴获客贵\n• 每集关键女主「游玩点」一键切入无阉割深度角色卡\n• 原生容器长期记忆 + 82+ 模板生图生视频拉满付费"),
        ("04 全栈已上线", C_TEAL, "新版创作中心与全链路生产就绪",
         "• 五语言 Web + Android + 女性向独立站「晴屿」\n• 新版创作中心（角色/AI生成/小说/女友/多人同场）已迭代上线\n• 6 模型路由 + 3×成本 Credit 账本 + 14 模块 /ops 中台"),
        ("05 12 个月冲刺", C_PURPLE, "一年内跑出年化 ¥3,000 万+",
         "• 海外成人高客单价 + 60 天内回本滚动复投\n• Q1 月入 25 万 → Q2 80 万 → Q3 160 万 → Q4 250 万+\n• Y1 年末 MAU 18 万，年化跑速 ¥3,000 万+"),
        ("06 本轮融资", C_GOLD, "海外团队 · 天使轮 400 万 RMB",
         "• 建议出让 10%–15% 股权，海外主体与支付天然合规\n• 海外买量滚投 35% · 研发 30% · 内容 25% · 合规预备 10%\n• 12 个月直达年化 3,000 万，强势启动 Pre-A"),
    ]
    for i, (tag, accent, head, body) in enumerate(exec_cards):
        col = i % 3
        row = i // 3
        x = 0.60 + col * 4.12
        y = 1.85 + row * 2.52
        add_rect(s2, x, y, 3.88, 2.30, fill_color=C_SURFACE, border_color=C_BORDER, border_pt=1.0)
        add_rect(s2, x, y, 3.88, 0.06, fill_color=accent, border_color=None, rounded=False)
        add_textbox(s2, x + 0.20, y + 0.16, 3.4, 0.28, tag, font_size=10.5, color=accent, bold=True)
        add_textbox(s2, x + 0.20, y + 0.44, 3.55, 0.36, head, font_size=14.5, color=C_TEXT, bold=True)
        add_textbox(s2, x + 0.20, y + 0.88, 3.55, 1.32, body, font_size=11.0, color=C_SUBTEXT, line_spacing=1.30)

    set_notes(s2, "一页看懂我们的节奏：不是慢悠悠烧三年，海外成人互动赛道 15 万月活就能撑起千万级月流水。我们作为原生海外团队，先切成人内容极速造血、边打磨产品边把底层能力复用到女性向产品，目标 12 个月内跑到年化 3,000 万。")

    # =========================================================================
    # SLIDE 3: 市场爆发
    # =========================================================================
    s3 = prs.slides.add_slide(blank_layout)
    add_chrome(s3, "02 · 市场机会", "百亿级双赛道合流：短剧解决买量，成人陪伴拉满变现", "海外 18+ 互动与情感陪伴正处爆发窗口，高 ARPPU 支撑一年内高速起量", 3, TOTAL)

    add_picture_fit(s3, chart_market, 0.60, 1.85, 6.75, 4.85, border=True)

    insights = [
        ("海外成人陪伴：单用户变现效率极高", C_ROSE,
         "AI 陪伴 Top10 单月流水 4.17 亿，且 80%+ 收入来自欧美日韩。2026 年新上线黑马（OOC 5000w+/月、Heyyyy 3000w+/月、Tizz 15 万 MAU 即 2000w+/月）证明极速起量完全可行。"),
        ("短剧与互动影游：付费转化高出 2–3 倍", C_GOLD,
         "2025 全球短剧内购 $28 亿（+116%），2026E 全球互动影游超 $23 亿。用 30–60 秒成人/情感强钩子做入口，能显著拉低海外买量 CPI 并提升首日破冰转化。"),
        ("从成人切入到女性向扩盘的商业闭环", C_TEAL,
         "成人内容打穿早期现金流与多模态/记忆引擎；同步沉淀的高情商叙事与沉浸体验，可无缝平移到高留存、长生命周期、能进主流应用商店的女性向/乙女向大盘。"),
    ]
    for idx, (t, col, desc) in enumerate(insights):
        y = 1.88 + idx * 1.63
        add_rect(s3, 7.60, y, 5.13, 1.46, fill_color=C_SURFACE, border_color=C_BORDER)
        add_rect(s3, 7.60, y, 0.08, 1.46, fill_color=col, border_color=None, rounded=False)
        add_textbox(s3, 7.85, y + 0.14, 4.65, 0.34, t, font_size=14, color=col, bold=True)
        add_textbox(s3, 7.85, y + 0.50, 4.70, 0.88, desc, font_size=11.2, color=C_SUBTEXT, line_spacing=1.28)

    set_notes(s3, "为什么我们有底气定一年 3,000 万年化？看市场基准就明白：Tizz 今年 5 月才上线，15 万月活就能月入 2,000 万；OOC 和 Heyyyy 今年 4 月上线，半年就冲到月入 3,000 万到 5,000 万。海外高付费市场叠加短剧强钩子，起量速度非常快。")

    # =========================================================================
    # SLIDE 4: 市面上产品拆解（一）：AI 陪伴月入 4.17 亿榜单
    # =========================================================================
    s4 = prs.slides.add_slide(blank_layout)
    add_chrome(s4, "03 · 竞品格局", "市面上产品拆解（一）：全球 AI 陪伴 Top10 月入 4.17 亿", "数据来源：SensorTower 全球收入榜（2026.10.14–11.12，游戏新知制图），2026 年新品半年即可破千万月流水", 4, TOTAL)

    rows_s4 = [
        ["排名", "产品", "厂商 / 背景", "近 30 天收入（RMB）", "月活（MAU）", "上线时间", "主市场"],
        ["1", "Tipsy", "星河觉醒", "1.3 亿+", "300 万+", "2024.08", "美国 / 德国"],
        ["2", "Zeta", "Scatter Lab", "7,000 万+", "700 万+", "2022.05", "日 / 韩 / 美"],
        ["3", "OOC", "Wrtn", "5,000 万+", "100 万+", "2026.04 ★新品", "美国"],
        ["4", "Heyyyy", "海外华人参与", "3,000 万+", "100 万+", "2026.04 ★新品", "美国"],
        ["5", "PolyBuzz", "作业帮", "3,000 万+", "1,600 万+", "2023", "美国"],
        ["6", "Chai", "Chai Research", "2,800 万+", "300 万+", "2021", "美国"],
        ["8", "Tizz", "华人出海团队", "2,000 万+", "15 万+", "2026.05 ★新品", "美国"],
    ]
    add_styled_table(s4, 0.60, 1.82, 12.13, 3.65, rows_s4,
                     col_widths=[0.75, 1.55, 2.35, 2.15, 1.55, 1.85, 1.93], font_size=11)

    takeaways = [
        ("6 个月冲榜", "2026 三款新品半年即月入 2,000w–5,000w", "OOC、Heyyyy、Tizz 均为 2026 年春季上线，半年内即杀入全球前八，验证了只要切口准、投放快，12 个月跑出年化 3,000 万完全合理。", C_ROSE),
        ("¥133+ ARPU", "Tizz 仅 15 万 MAU 月入 2,000 万+", "说明垂类/成人向产品的单活跃用户价值极高，叙梦 Y1 年末 18 万 MAU 仅需月入 250 万即可达年化 3,000 万，留足安全边际。", C_GOLD),
        ("美/日/韩主导", "海外原生团队具备天然合规与本地化优势", "Top10 中 8 款主战场在美国，我们作为海外团队，在海外主体、成人合规支付、社媒买量与英语/多语运营上零历史包袱。", C_TEAL),
    ]
    for i, (num, title_k, desc_k, c) in enumerate(takeaways):
        x = 0.60 + i * 4.12
        add_rect(s4, x, 5.65, 3.88, 1.25, fill_color=C_SURFACE, border_color=C_BORDER)
        add_textbox(s4, x + 0.18, 5.72, 1.55, 0.42, num, font_size=18, color=c, bold=True)
        add_textbox(s4, x + 1.65, 5.76, 2.15, 0.38, title_k, font_size=10.8, color=C_TEXT, bold=True)
        add_textbox(s4, x + 0.18, 6.18, 3.55, 0.68, desc_k, font_size=10.1, color=C_SUBTEXT, line_spacing=1.22)

    set_notes(s4, "重点看下方的 Tizz、OOC 和 Heyyyy：它们都是今年 4–5 月才上线的新品，半年时间就干到月入 2,000 万到 5,000 万。相比之下，我们设定 12 个月做到月流水 250 万（年化 3,000 万），既有高速成长性，又比行业黑马保守得多。")

    # =========================================================================
    # SLIDE 5: 市面上产品拆解（二）：四大阵营对比
    # =========================================================================
    s5 = prs.slides.add_slide(blank_layout)
    add_chrome(s5, "03 · 竞品格局", "市面上产品拆解（二）：四大阵营短板与叙梦破局位", "先在海外 NSFW 多模态互动赛道降维打击，再同步把产品力溢出至女性向市场", 5, TOTAL)

    rows_s5 = [
        ["产品阵营", "代表产品", "核心优势", "结构性短板（痛点）", "叙梦的破局点"],
        ["海外 NSFW\n多模态陪伴", "Candy.ai / Kindroid\nCrushOn / SpicyChat", "高 ARPPU、生图/生视频\n付费意愿极强、现金流好", "订阅硬墙劝退早期用户；叙事浅\n缺世界书与状态机，创作生态薄弱", "前 3 集免费+首单半价破冰\n82+ 模板生图视频 + 酒馆深度引擎"],
        ["买量派\nAI 陪伴", "Tipsy / Zeta / OOC\nTizz / PolyBuzz / Chai", "投流凶猛、本地化强\n已验证欧美日韩大盘", "纯聊天素材同质化、买量变贵\n缺强视觉剧情钩子，聊完易流失", "用 AI 成人短剧强钩子低成本拉新\n一剧一女主无缝衔接陪聊"],
        ["角色社区 &\n极客酒馆", "Character.AI / DZMM\nJanitorAI / SillyTavern", "角色卡/世界书玩法天花板\n社区二创粘性极高", "C.AI 审核严阉割体验；SillyTavern\n门槛极高，普通用户配不起来", "无阉割 NSFW 体验 + 兼容 ST 卡\n新版 5 步创作向导零门槛上手"],
        ["竖屏短剧 &\n传统影游", "ReelShort / DramaBox\n盛世天下 / DRAMAGO", "极致 30–60 秒情绪钩子\n验证“为选择付费”逻辑", "短剧看完即走无关系复访\n真人影游单部百万、难高频周更", "片尾/游玩点一键「和她玩」\nAI 管线周更 + 长期容器陪伴"],
        ["叙梦 XUMENG\n（双阶段路径）", "xumengchat.top（成人先）\n+ 晴屿（女性向扩盘）", "短剧钩子 + 深度角色卡\n+ 原生陪伴 + 82+ 视频模板", "海外原生团队，轻包袱快迭代", "先成人 12 个月冲刺 3,000 万年化\n边打磨底层引擎边拓女性向大盘"],
    ]
    add_styled_table(s5, 0.60, 1.82, 12.13, 5.05, rows_s5,
                     col_widths=[1.50, 2.25, 2.48, 2.95, 2.95], font_size=10.4, highlight_last=True)

    set_notes(s5, "在海外成人线我们直接对标 Candy.ai、SpicyChat、Tipsy 等高赚钱产品，但我们多了三样武器：第一是 AI 短剧强钩子拉新，第二是 SillyTavern 级别的深度世界书/记忆引擎，第三是 82+ 动作模板生图视频与新版创作中心。同时我们不像纯 NSFW 站点那样有天花板，边打磨边切女性向扩盘。")

    # =========================================================================
    # SLIDE 6: 两阶段产品与业务闭环
    # =========================================================================
    s6 = prs.slides.add_slide(blank_layout)
    add_chrome(s6, "04 · 核心闭环", "产品逻辑：钩子 → 入戏 → 陪聊 → 创作 → 双曲线扩盘", "成人线验证强变现闭环并打透底层引擎，女性向线承接高留存泛情感大盘", 6, TOTAL)

    steps = [
        ("STEP 1", "强钩子拉新", C_ROSE, "30–60 秒短剧/漫剧",
         "• 前 3 集免费拉满张力\n• 进度条高亮「游玩点」\n• 悬念处弹出女主卡片\n• 彻底打破买量同质化"),
        ("STEP 2", "无阉割入戏", C_PINK, "深度角色卡 & 多人同场",
         "• 一键「和她玩」直入剧情\n• 3 条分支开场 + 行动建议\n• 世界书 + 状态机长程推进\n• 支持多人同场群像玩法"),
        ("STEP 3", "高客单陪伴", C_GOLD, "原生容器 + 82+ 视觉模板",
         "• 独立容器长期记忆不失忆\n• 主动消息 + AI 日常自拍\n• 82+ 动作模板生图生视频\n• 语音朗读与实时语音电话"),
        ("STEP 4", "新版创作反哺", C_TEAL, "新版 5 步创作中心",
         "• 创建角色/AI生成/小说/女友\n• 实时卡片预览与一键生封面\n• 玩家二创分支沉淀进剧情库\n• 原作+二创 20–30% 分成"),
        ("STEP 5", "双曲线扩盘", C_PURPLE, "引擎复用 → 女性向产品",
         "• 成人线跑通现金流与引擎\n• 同底座孵化女性向「晴屿」\n• 情绪发现+日常瞬间+高审美\n• 切入主流商店放大估值"),
    ]
    for i, (st, title_s, col, sub_s, desc_s) in enumerate(steps):
        x = 0.60 + i * 2.47
        add_rect(s6, x, 1.92, 2.26, 3.35, fill_color=C_SURFACE, border_color=col, border_pt=1.3)
        add_pill(s6, x + 0.16, 2.08, 0.95, 0.28, st, fill_color=col, text_color=C_BG, font_size=9.5)
        add_textbox(s6, x + 0.16, 2.45, 1.95, 0.36, title_s, font_size=15, color=C_TEXT, bold=True)
        add_textbox(s6, x + 0.16, 2.82, 1.98, 0.32, sub_s, font_size=10.3, color=col, bold=True)
        add_rect(s6, x + 0.16, 3.18, 1.94, 0.015, fill_color=C_BORDER, border_color=None, rounded=False)
        add_textbox(s6, x + 0.16, 3.28, 1.96, 1.88, desc_s, font_size=10.5, color=C_SUBTEXT, line_spacing=1.32)
        if i < 4:
            add_textbox(s6, x + 2.25, 3.35, 0.24, 0.40, "→", font_size=18, color=C_GOLD, bold=True, align=PP_ALIGN.CENTER)

    # 底部两阶段演进对比条
    add_rect(s6, 0.60, 5.48, 5.95, 1.35, fill_color=C_SURFACE2, border_color=C_ROSE, border_pt=1.2)
    add_textbox(s6, 0.82, 5.60, 5.5, 0.32, "第一曲线（当下核心）：海外 18+ 成人互动（先造血）", font_size=13, color=C_ROSE, bold=True)
    add_textbox(s6, 0.82, 5.96, 5.5, 0.78, "痛点最直白、付费率 6%–8%+、月 ARPPU $28（≈¥200），2 个月内回本；负责 12 个月内冲出年化 ¥3,000 万现金流，并在高压实战中把底层引擎打磨到极致。", font_size=10.8, color=C_TEXT, line_spacing=1.28)

    add_rect(s6, 6.78, 5.48, 5.95, 1.35, fill_color=C_SURFACE2, border_color=C_TEAL, border_pt=1.2)
    add_textbox(s6, 7.00, 5.60, 5.5, 0.32, "第二曲线（边打磨边拓）：女性向 / 乙女向产品（扩盘升维）", font_size=13, color=C_TEAL, bold=True)
    add_textbox(s6, 7.00, 5.96, 5.5, 0.78, "复用同一套记忆、状态机、声优与多模态底座，独立运营女性向产品（如「晴屿」），主打情绪陪伴、细腻文笔与高审美角色，切入主流应用商店、拉长留存与公司估值倍数。", font_size=10.8, color=C_TEXT, line_spacing=1.28)

    set_notes(s6, "为什么先做成人再边打磨边做女性向？因为创业公司最怕早期没现金流又没打磨好产品。成人线需求刚、客单价高、回本快，能让我们在一年内自我造血并把记忆和多模态引擎磨到行业一流；随后无缝切女性向，打开十倍主流大盘。")

    # =========================================================================
    # SLIDE 7: 产品介绍（一）：最新版产品矩阵（最新三屏截图）
    # =========================================================================
    s7 = prs.slides.add_slide(blank_layout)
    add_chrome(s7, "05 · 产品介绍", "产品介绍（一）：最新版移动全栈已上线（真实界面）", "全新首页分频道广场 + 改版创作中心 + 82+ 动作模板「生图与视频」工作台全面迭代", 7, TOTAL)

    # 左侧：最新手机端三屏拼图 + 解锁条
    add_picture_fit(s7, mobile_triptych, 0.60, 1.85, 6.55, 3.80, border=True)
    add_textbox(s7, 0.60, 5.68, 6.55, 0.25, "最新版手机端实拍（左：游玩广场 · 中：新版创作中心 · 右：82+模板生图视频｜敏感画面已脱敏柔焦）", font_size=9.2, color=C_MUTED, align=PP_ALIGN.CENTER)
    add_picture_fit(s7, os.path.join(ASSETS_DIR, "shot-unlock-mosaic.png"), 0.60, 5.98, 6.55, 0.90, border=True)

    prod_items = [
        ("分频道沉浸广场与短剧游玩点（最新迭代）", C_ROSE,
         "顶部直达「男性 / 女性 / 动漫 / 短剧」四频道，热榜/推荐实时刷新；短剧前 3 集免费 + 单集解锁/周卡，每集关键女主游玩点一键跳转角色开聊。"),
        ("全新改版创作中心（5 大创作入口）", C_GOLD,
         "全面升级为「创建角色（人设/开场/世界书） · AI 生成（图片/视频/快速出片） · 小说与故事 · 新建女友 · 多人同场（多角色分支）」+ 会员权益入口。"),
        ("82+ 动作模板「生图与视频」工坊（高 ARPU 引擎）", C_PINK,
         "支持参考图一键套用 82+ 成人/情绪视觉模板快速出视频，叠加自由出图（写实/电影光/柔光/胶片/动漫）与超清放大，直击海外用户核心付费点。"),
        ("边打磨边布局女性向独立产品线", C_TEAL,
         "已在同底座独立部署女性向/乙女向预览与独立站「晴屿」，支持情绪化发现、日常剧情瞬间与高审美角色档案，与成人线共享技术红利、隔离品牌调性。"),
    ]
    for i, (h, c, b) in enumerate(prod_items):
        y = 1.85 + i * 1.26
        add_rect(s7, 7.35, y, 5.38, 1.14, fill_color=C_SURFACE, border_color=C_BORDER)
        add_rect(s7, 7.35, y, 0.07, 1.14, fill_color=c, border_color=None, rounded=False)
        add_textbox(s7, 7.55, y + 0.09, 5.05, 0.30, h, font_size=12.6, color=c, bold=True)
        add_textbox(s7, 7.55, y + 0.41, 5.05, 0.68, b, font_size=10.4, color=C_SUBTEXT, line_spacing=1.22)

    set_notes(s7, "左边是我们最新改版上线的手机端三屏实拍：新版首页分频道广场、全新升级的 5 入口创作中心，以及带 82 个动作模板的生图与视频工作台。为方便会议室投屏，敏感画面做了局部柔焦，真实体验可以直接访问 xumengchat.top。")

    # =========================================================================
    # SLIDE 8: 产品介绍（二）：深度酒馆叙事 + 原生陪伴 + 多模态
    # =========================================================================
    s8 = prs.slides.add_slide(blank_layout)
    add_chrome(s8, "05 · 产品介绍", "产品介绍（二）：酒馆深度叙事 + 原生容器陪伴 + 全栈多模态", "先在成人高频交互中把“记忆、人设鲜活度、多模态沉浸”打磨到极致，形成两线通用壁垒", 8, TOTAL)

    add_picture_fit(s8, os.path.join(ASSETS_DIR, "companion-ui.png"), 0.60, 1.85, 4.45, 3.60, border=True)
    add_picture_fit(s8, os.path.join(SHOT_DIR, "after/11_companion_chat_1440.png"), 0.60, 5.55, 4.45, 1.32, border=True)

    engines = [
        ("1. 自研酒馆深度叙事内核（告别复读与 OOC）", C_ROSE, [
            ("兼容行业全部深度资产：", "支持 chara_card_v2/v3、@depth 世界书、多人同场群聊与多候选 Swipe。"),
            ("结构化记忆 + 隐藏世界状态：", "长对话自动沉淀剧情记忆，实时维护时间双时钟、地点、关系与关键事件。"),
            ("本地回合导演（Turn Director）：", "零额外算力成本精准控制剧情推进节奏，既适合成人强张力，也适配女性向细腻情感。"),
        ]),
        ("2. 原生 MaiBot 隔离容器陪伴（拉满 30/90 天留存）", C_GOLD, [
            ("每账号独立容器 + 私有 R2 备份：", "有状态长期记忆物理级隔离，绝对保护海外用户隐私边界。"),
            ("主动情感连接：", "角色记住你的偏好与失联天数，主动发消息追问近况并发送专属 AI 生活照。"),
        ]),
        ("3. 多模态沉浸体验（海外高 ARPPU 核心引擎）", C_TEAL, [
            ("连续剧情锚定生图：", "始终锚定上一张剧情图或封面，锁死五官、服装、场景连贯性。"),
            ("语音、实时电话与数字人：", "多音色声优朗读、MiniCPM-o 实时语音电话、Vidu S2 实时数字人直播（内测）。"),
        ]),
    ]
    y_cursor = 1.85
    heights = [1.84, 1.44, 1.68]
    for (title_e, col, blist), bh in zip(engines, heights):
        add_rect(s8, 5.30, y_cursor, 7.43, bh, fill_color=C_SURFACE, border_color=C_BORDER)
        add_rect(s8, 5.30, y_cursor, 7.43, 0.05, fill_color=col, border_color=None, rounded=False)
        add_textbox(s8, 5.50, y_cursor + 0.12, 7.05, 0.32, title_e, font_size=13.4, color=col, bold=True)
        add_bullets(s8, 5.50, y_cursor + 0.46, 7.05, bh - 0.52, blist, font_size=10.8, color=C_SUBTEXT, accent_color=col, space_after=4, line_spacing=1.22)
        y_cursor += bh + 0.12

    set_notes(s8, "这套记忆、世界状态机、原生隔离容器和多模态能力，既是成人线高客单价的核心发动机，也是我们后续做女性向产品降维打击的底层武器——女性向最看重的就是不失忆、文笔细腻、有声优和主动陪伴。")

    # =========================================================================
    # SLIDE 9: 技术壁垒与商业级工程底座
    # =========================================================================
    s9 = prs.slides.add_slide(blank_layout)
    add_chrome(s9, "06 · 技术底座", "技术壁垒：多模型路由、精准算力账本与混合视频推理管线", "全球边缘全栈已跑在生产环境，支持一年内用户量 10 倍扩容且严守单笔毛利底线", 9, TOTAL)

    tech_cards = [
        ("01 多模型动态路由", C_ROSE, "6 款主力大模型分钟级调度",
         [
             ("规避内容与供应商风险：", "已接入 6 款大模型（含无阉割高表现力角色模型），按场景与付费档位路由。"),
             ("弹性切流防断供：", "任意模型限流、涨价或审核收紧时分钟级切流，保障 7×24 小时高可用。"),
             ("专业调教评测库：", "沉淀去 AI 味、成人强张力与女性向细腻文笔双套提示词与采样参数体系。"),
         ]),
        ("02 精细化 Credit 账本", C_GOLD, "上游真实美元成本 ×3 定点结算",
         [
             ("原子预留-结算防亏穿：", "调用前按可用余额计算上限并原子预留，完成后按真实费用 ×3 精准结算并返还差额。"),
             ("BigInt 定点与 RPC 隔离：", "独立 BillingService 写权限隔离，彻底防并发刷单、浮点误差与算力坏账。"),
             ("模型口径毛利 66.7%：", "确保用户聊得越久、生图生视频越多，平台净毛利越厚。"),
         ]),
        ("03 自有 GPU + 商用 API 混合管线", C_TEAL, "把视频与换脸/模板成本打下来",
         [
             ("多路线实测优选：", "已完成 H3 Turbo LoRA/INT8、Wan3.0、WAND、Flux、超清放大等多供应商实测与路由。"),
             ("自动化制卡管线：", "离线抽帧 → VLM 定位女主与高能节点 → Grok 出卡 → Flux 出海报，生产提效 10x。"),
             ("R2 缓存复用：", "高频语音与剧情图自动私有 R2 缓存，重复查看零额外算力成本。"),
         ]),
        ("04 全球边缘部署 + 隔离与运营中台", C_PURPLE, "低延迟、强隔离、极低固定成本",
         [
             ("Cloudflare 全球边缘：", "Workers + D1 + 私有 R2 + Durable Objects，北美/欧洲/日韩毫秒级响应。"),
             ("独立 /ops 运营中台：", "已内置 14 模块运营后台（数据看板/资金/套餐/审核/模型单价/审计/群反馈）。"),
             ("海外合规多通道支付：", "适配海外卡支付、Waffo、Crypto（USDT）等通道，确保成人与泛娱乐收款稳定。"),
         ]),
    ]
    for i, (t, col, sub, blist) in enumerate(tech_cards):
        col_i = i % 2
        row_i = i // 2
        x = 0.60 + col_i * 6.22
        y = 1.85 + row_i * 2.55
        add_rect(s9, x, y, 5.91, 2.36, fill_color=C_SURFACE, border_color=C_BORDER)
        add_rect(s9, x, y, 5.91, 0.06, fill_color=col, border_color=None, rounded=False)
        add_textbox(s9, x + 0.22, y + 0.16, 2.65, 0.30, t, font_size=13.5, color=col, bold=True)
        add_textbox(s9, x + 2.85, y + 0.18, 2.90, 0.28, sub, font_size=10.3, color=C_MUTED, bold=True, align=PP_ALIGN.RIGHT)
        add_bullets(s9, x + 0.22, y + 0.56, 5.48, 1.72, blist, font_size=10.6, color=C_SUBTEXT, accent_color=col, space_after=5, line_spacing=1.24)

    set_notes(s9, "能撑起一年 3,000 万年化放量，靠的是已经打通的商业级底座：6 大模型防封控断供、真实成本 ×3 账本防算力亏穿、自有 GPU 混合视频管线压低成本，以及 Cloudflare 全球边缘和海外多支付通道。")

    # =========================================================================
    # SLIDE 10: 我们的打法（一）：五大核心增长打法
    # =========================================================================
    s10 = prs.slides.add_slide(blank_layout)
    add_chrome(s10, "07 · 我们的打法", "我们的打法（一）：先成人快打快收，再双线放大估值", "海外原生团队节奏：不磨洋工，12 个月围绕“高转化流量、极速回本滚投、双曲线复用”打穿", 10, TOTAL)

    plays = [
        ("01", "先攻海外 18+ 成人赛道：高刚需、高 ARPPU、60 天内回本", C_ROSE,
         "成人互动是 AI 应用付费最强切口（海外月 ARPPU $25–$35）。先集中火力打穿欧美英语市场，用「短剧强钩子 + 无阉割深聊 + 82+ 动作模板生视频」在 60 天内收回买量成本，实现流水滚投。"),
        ("02", "以剧带聊 + 多模态变现：把单次流量榨出 3–8 个月 LTV", C_PINK,
         "每条投放素材都指向具体短剧或女主游玩点：前 3 集免费拉满情绪 → 冲动用户买单集/周卡即时回本，深度用户进入角色卡、原生陪聊与生图/视频模板，把一次获客吃出多重收入。"),
        ("03", "边打磨引擎，边孵化女性向产品（第二增长曲线）", C_GOLD,
         "成人线高压迭代出的记忆、状态机、声优、新版创作中心和计费中台，同步沉淀到独立女性向/乙女向产品线（如「晴屿」）；M7 起启动女性向测试与发行，切入主流 App Store 与长留存大盘。"),
        ("04", "快节奏买量滚投 + 成人站/社媒/SEO 立体流量矩阵", C_TEAL,
         "不押注单一渠道：同步跑海外信息流（X / Reddit / 成人联盟流量 / TikTok & Reels 擦边强钩子切片）+ 程序化 SEO（Candy/SpicyChat 替代词矩阵）+ 分享卡裂变，压低混合 CAC。"),
        ("05", "硬数据门禁 + 周级迭代：跑正一个题材立刻复制十个", C_PURPLE,
         "坚持“周测 30–50 条钩子素材 → 严卡首月回本率与 D7 留存 → 达标题材立刻加大滚投预算”的增长纪律，确保 400 万融资撬动数倍滚投体量，12 个月冲刺年化 3,000 万。"),
    ]
    for i, (num, head, col, desc) in enumerate(plays):
        y = 1.82 + i * 1.02
        add_rect(s10, 0.60, y, 12.13, 0.90, fill_color=C_SURFACE, border_color=C_BORDER)
        add_rect(s10, 0.60, y, 0.85, 0.90, fill_color=C_SURFACE2, border_color=col, border_pt=1.0)
        add_textbox(s10, 0.60, y + 0.22, 0.85, 0.45, num, font_size=20, color=col, bold=True, align=PP_ALIGN.CENTER)
        add_textbox(s10, 1.65, y + 0.12, 3.85, 0.66, head, font_size=13.0, color=C_TEXT, bold=True)
        add_rect(s10, 5.58, y + 0.16, 0.02, 0.58, fill_color=C_BORDER, border_color=None, rounded=False)
        add_textbox(s10, 5.76, y + 0.12, 6.80, 0.68, desc, font_size=10.6, color=C_SUBTEXT, line_spacing=1.22)

    set_notes(s10, "我们的打法核心就两点：第一是“先成人快打快收”，通过 60 天内回本把 400 万融资变成可滚动的买量杠杆，12 个月干到年化 3,000 万；第二是“边打磨边做女性向”，让公司既有短期极强现金流，又有长期主流大盘估值。")

    # =========================================================================
    # SLIDE 11: 我们的打法（二）：新版创作中心 + AI 工业化供给
    # =========================================================================
    s11 = prs.slides.add_slide(blank_layout)
    add_chrome(s11, "07 · 我们的打法", "我们的打法（二）：新版创作工坊 + AI 工业化供给飞轮", "全新改版创作页与 5 步专业角色编辑器已上线，官方 AI 管线冷启 + 创作者分成放大供给", 11, TOTAL)

    # 左侧上下两张最新版桌面创作截图（完全替换掉旧版 shot-studio.png）
    add_picture_fit(s11, desktop_creator, 0.60, 1.85, 5.35, 2.55, border=True)
    add_textbox(s11, 0.60, 4.43, 5.35, 0.22, "新版桌面创作中心（5 大创作入口 + 会员权益｜敏感图已柔焦）", font_size=9.0, color=C_MUTED, align=PP_ALIGN.CENTER)
    add_picture_fit(s11, os.path.join(SHOT_DIR, "p0_after/02_character_studio_pro.png"), 0.60, 4.70, 5.35, 2.20, border=True)

    # 右上：新版创作生态与 AI 管线说明
    add_rect(s11, 6.18, 1.85, 6.55, 2.35, fill_color=C_SURFACE, border_color=C_BORDER)
    add_rect(s11, 6.18, 1.85, 6.55, 0.05, fill_color=C_ROSE, border_color=None, rounded=False)
    add_textbox(s11, 6.38, 1.98, 6.15, 0.34, "新版创作页 + AI 工业化生产管线（全面升级）", font_size=13.5, color=C_ROSE, bold=True)
    add_bullets(s11, 6.38, 2.36, 6.15, 1.78, [
        ("新版 5 步专业角色工坊：", "核心身份 → 开场对话 → 世界书 → 声优设置 → 预览发布，支持 50 金币 AI 一键生封面与实时卡片预览，大幅提升创作者产出效率。"),
        ("自由出图 + 82+ 视频模板：", "创作者与玩家均可用参考图自定义风格（写实/电影光/动漫）一键出图出片，直接反哺角色画廊与短剧素材。"),
        ("严守版权与原创红线：", "彻底隔离真人换脸/明星侵权，官方 AI 管线周更原创成人与情感安全资产。"),
    ], font_size=10.5, color=C_SUBTEXT, accent_color=C_PINK, space_after=5)

    # 右下：三层供给协同表
    rows_s11 = [
        ["供给层", "核心产出", "机制与节奏", "状态"],
        ["官方 AI 制片线", "英语原创成人短剧 + 女主游玩点卡", "VLM 抽帧+Grok 制卡+GPU 出片，周更爆款", "已跑通"],
        ["签约种子作者", "高热度 NSFW / 女性向原创角色卡", "保底工具额度 + 首页流量 + 20–30% 净回款分成", "招募中"],
        ["玩家二创 UGC", "多人同场剧情、小说故事与分支结局", "新版创作中心一键发布 + 审核入库分账", "新版已上线"],
    ]
    add_styled_table(s11, 6.18, 4.38, 6.55, 2.52, rows_s11,
                     col_widths=[1.42, 1.95, 2.28, 0.90], font_size=9.9)

    set_notes(s11, "左边展示的是我们最新改版上线的创作中心和 5 步专业角色编辑器：支持创建角色、AI 生成、小说与故事、新建女友和多人同场，还有实时预览和一键 AI 生封面。这让官方冷启和外部作者供卡效率都提升了数倍。")

    # =========================================================================
    # SLIDE 12: 精细化运营体系
    # =========================================================================
    s12 = prs.slides.add_slide(blank_layout)
    add_chrome(s12, "08 · 运营体系", "精细化运营：海外多渠道流量矩阵 + 14 模块 /ops 中台", "用高转化成人流量打穿获客，用任务/签到/主动消息吃透复访，并用独立中台支撑高速放量", 12, TOTAL)

    ops_pillars = [
        ("海外全渠道获客矩阵（付费 + 联盟 + 自然 SEO）", C_ROSE,
         "成人联盟与垂类流量（ExoClick / TrafficJunky 等）直接承接 NSFW 转化；X / Reddit / TikTok / Reels 强悬念切片导流；同步铺设英语/多语种 SEO 矩阵（Candy/SpicyChat/JanitorAI 替代词），压低混合 CAC。"),
        ("30 秒首体验 + 阶梯破冰变现", C_GOLD,
         "游客免配置一键试聊，前 3 集免费试看 → 注册赠点体验 → 首单半价极速破冰 → 周卡/VIP 订阅 + 82+ 模板生图生视频 Credit 高频复购。"),
        ("高粘性留存与召回体系", C_TEAL,
         "原生容器主动发消息 + 长期记忆回调；搭配已上线的新手任务、每日签到领 500 Credit、角色相册与多人同场活动，在看剧、深聊、生图/视频间循环留存。"),
        ("双产品线分级与创作者运营", C_PINK,
         "成人线（xumengchat.top）强化爽点与多模态产出，女性向（晴屿）独立运营高审美社区与同人作者激励；创作者享有实时点赞、清晰审核反馈与透明分账。"),
        ("/ops 独立运营中台（14 模块已上线）", C_PURPLE,
         "覆盖数据看板、用户管理、充值/套餐/VIP、Banner、角色审核、标签/声优、模型单价动态调价、审计日志与 Telegram 群反馈，极小运营团队即可撬动千万级流水。"),
    ]
    for i, (h, c, b) in enumerate(ops_pillars):
        y = 1.82 + i * 1.02
        add_rect(s12, 0.60, y, 7.65, 0.90, fill_color=C_SURFACE, border_color=C_BORDER)
        add_rect(s12, 0.60, y, 0.08, 0.90, fill_color=c, border_color=None, rounded=False)
        add_textbox(s12, 0.84, y + 0.07, 7.25, 0.28, h, font_size=12.4, color=c, bold=True)
        add_textbox(s12, 0.84, y + 0.36, 7.25, 0.50, b, font_size=10.2, color=C_SUBTEXT, line_spacing=1.18)

    add_picture_fit(s12, os.path.join(SHOT_DIR, "p0_after/04_generation_studio.png"), 8.50, 1.82, 4.23, 2.38, border=True)
    add_textbox(s12, 8.50, 4.22, 4.23, 0.24, "新版自由出图与多模态高频消费工作台（50 金币/次）", font_size=9.1, color=C_MUTED, align=PP_ALIGN.CENTER)
    add_picture_fit(s12, os.path.join(ASSETS_DIR, "shot-tasks.png"), 8.50, 4.52, 4.23, 2.33, border=True)

    set_notes(s12, "在海外做成人内容，运营最讲究渠道组合和首日破冰：除了社媒切片和 SEO，海外垂类成人联盟流量非常成熟且精准；进站后通过首单半价、50 金币自由出图、82+ 模板生视频和每日签到拉高复购。所有运营配置都已收进我们的 14 模块 /ops 中台。")

    # =========================================================================
    # SLIDE 13: 商业模式与海外高客单价 UE
    # =========================================================================
    s13 = prs.slides.add_slide(blank_layout)
    add_chrome(s13, "09 · 商业与财务", "商业模式与海外成人 UE：月 ARPPU $28，2 个月内回本", "高客单价多模态消耗 + 订阅组合，支撑 48% 贡献毛利与极速滚动放量", 13, TOTAL)

    rows_s13 = [
        ["变现模块", "海外主力定价", "折合 RMB", "变现角色"],
        ["单集解锁 / 首单", "$0.99–1.99 / 集", "¥7–14 / 集", "前 3 集免费，首单半价破冰"],
        ["短剧/体验周卡", "$4.99–$6.99 / 7天", "¥35–50 / 周", "高频冲动转化主力"],
        ["VIP 会员订阅", "$12.99–$19.99 / 月", "¥95–145 / 月", "日签领点 + 语音/生图配额"],
        ["82+ 模板生图/视频", "50–200 Credit / 次", "¥3.5–14 / 次", "高毛利多模态核心消耗池"],
        ["Credit 大额充值包", "$9.99 / $29.99 / $59.99", "¥72–430", "深聊、实时电话与大 R 变现"],
    ]
    add_styled_table(s13, 0.60, 1.85, 6.25, 3.25, rows_s13,
                     col_widths=[1.50, 1.65, 1.15, 1.95], font_size=10.1)

    kpis = [
        ("$28 (¥200)", "海外目标月 ARPPU", C_GOLD),
        ("48% (¥96)", "月贡献毛利", C_TEAL),
        ("3.1–3.8x", "目标 LTV / CAC", C_ROSE),
        ("2.0–2.3 月", "预计回本周期", C_PINK),
    ]
    for i, (val, lab, c) in enumerate(kpis):
        kx = 0.60 + (i % 2) * 3.18
        ky = 5.28 + (i // 2) * 0.84
        add_rect(s13, kx, ky, 3.05, 0.74, fill_color=C_SURFACE, border_color=C_BORDER)
        add_textbox(s13, kx + 0.14, ky + 0.14, 1.55, 0.45, val, font_size=16.5, color=c, bold=True)
        add_textbox(s13, kx + 1.65, ky + 0.22, 1.32, 0.34, lab, font_size=10.2, color=C_SUBTEXT, align=PP_ALIGN.RIGHT)

    add_picture_fit(s13, chart_ue, 7.08, 1.85, 5.65, 3.85, border=True)
    add_rect(s13, 7.08, 5.82, 5.65, 1.04, fill_color=C_SURFACE2, border_color=C_BORDER)
    add_textbox(s13, 7.28, 5.90, 5.25, 0.90,
                "UE 假设口径（海外成人线基准）：月付费率 6%–8%，月 ARPPU $28（≈¥200，对标 Candy.ai / SpicyChat / Tizz 处于稳健中位）；月贡献毛利 ¥96（48%）；混合 CAC ¥180–220（$25–30），约 2.1 个月回本，7–8 月生命周期 LTV ≈ ¥672–768。",
                font_size=10.0, color=C_SUBTEXT, line_spacing=1.26)

    set_notes(s13, "海外成人用户的付费能力远高于国内泛娱乐：订阅加上自由生图、82 个视频模板和深度陪聊，月 ARPPU 做到 28 美元（约 200 元人民币）是很扎实的行业中位水平。48% 贡献毛利下 2 个月就能回本，这是我们能一年冲到年化 3,000 万的核心财务前提。")

    # =========================================================================
    # SLIDE 14: 12 个月冲刺 3,000 万年化 + 三年展望
    # =========================================================================
    s14 = prs.slides.add_slide(blank_layout)
    add_chrome(s14, "09 · 商业与财务", "12 个月冲刺测算：一年内跑出年化 ¥3,000 万+ 跑速", "先靠海外成人线 60 天回本滚动放量，Q3–Q4 叠加多语与女性向第二曲线，三年剑指 2 亿+ 年化", 14, TOTAL)

    add_picture_fit(s14, chart_12m, 0.60, 1.85, 7.05, 4.70, border=True)
    add_textbox(s14, 0.60, 6.62, 7.05, 0.28, "注：Y1 全年累计流水估算 ¥1,200 万+，Q4 年末月流水达 ¥255 万（年化 ¥3,060 万）；均为管理层测算目标，非承诺。", font_size=9.2, color=C_MUTED)

    # 右上：三年阶梯展望表
    rows_s14 = [
        ["核心指标", "Y1 (一年冲刺)", "Y2 (双线放量)", "Y3 (冲击Top10)"],
        ["年末 MAU", "18.5 万", "55 万", "120 万"],
        ["综合付费率", "6.9%", "7.2%", "7.5%"],
        ["月 ARPPU", "¥200 ($28)", "¥200", "¥200"],
        ["年末月流水", "¥255 万", "¥800 万", "¥1,800 万+"],
        ["全年总流水", "¥1,200 万+", "¥6,000 万", "¥1.5 亿+"],
        ["年末年化 ARR", "¥3,060 万", "¥9,600 万", "¥2.16 亿"],
    ]
    add_styled_table(s14, 7.90, 1.85, 4.83, 3.25, rows_s14,
                     col_widths=[1.43, 1.15, 1.12, 1.13], font_size=9.9, highlight_last=True)

    add_rect(s14, 7.90, 5.24, 4.83, 1.62, fill_color=C_SURFACE, border_color=C_BORDER)
    add_textbox(s14, 8.10, 5.34, 4.45, 0.30, "为什么一年内跑到 3,000 万年化完全可行？", font_size=11.8, color=C_GOLD, bold=True)
    add_bullets(s14, 8.10, 5.66, 4.45, 1.15, [
        ("对标黑马仍留 8 倍余地：", "Tizz 上线半年 15 万 MAU 月入 2,000 万+；我们 18.5 万 MAU 仅按月入 255 万测算。"),
        ("60 天回本滚动放大：", "400 万融资做启动弹药，回款持续复投高 ROI 渠道。"),
    ], font_size=10.0, color=C_SUBTEXT, accent_color=C_TEAL, space_after=4)

    set_notes(s14, "看这张 12 个月爬坡图：Q1 跑通成人闭环月入 25 万，Q2 ROI 跑正滚投破 80 万，Q3 扩日韩德并启动女性向内测到 160 万，Q4 双线发力月流水破 250 万、年化 3,060 万！全年累计流水 1,200 万+，Y2 剑指近亿级，Y3 冲击全球 Top10。")

    # =========================================================================
    # SLIDE 15: 我们的团队（海外原生团队）
    # =========================================================================
    s15 = prs.slides.add_slide(blank_layout)
    add_chrome(s15, "10 · 核心团队", "我们的团队：清北航 × 顶级大厂/可灵 × 二次元游戏复合基因", "既懂 AI 视频生成与大模型工程，又懂二次元游戏与千人社区；拿融资前已独立交付全栈生产平台", 15, TOTAL)

    founders = [
        ("创始人 / CEO", "PEN", C_ROSE,
         "北航本科 · 清华大学硕士 · 全职创业",
         "• 学术与竞赛：Google Scholar 三位数引用；2 项游戏国家级一等奖及多项学科竞赛大奖\n"
         "• 大厂与 AI 实战：鹰角、百度、阿里、腾讯、可灵（Kling）及具身智能初创人才计划核心实习\n"
         "• 社区与产业资源：千人社团创社社长，与米哈游、腾讯、网易等大厂建立深度合作\n"
         "• 核心交付：主导 xumengchat.top 全栈落地及「先成人→后女性向」双线战略"),
        ("联合创始人", "归墟", C_GOLD,
         "核心技术 / 产品联合操盘",
         "• [核心履历暂留空，尽调/定稿前补充]\n\n"
         "• 深度参与叙梦 XUMENG 产品架构、底层能力打磨与海外业务推进"),
        ("海外全栈执行底座", "极高交付密度", C_TEAL,
         "海外原生主体 · 已独立跑通全链路",
         "• 产品线：完成新版 5 入口创作中心、82+ 动作模板生图视频、短剧游玩点与女性向「晴屿」\n"
         "• 技术线：独立跑通 6 模型路由、原生 MaiBot 容器、自有 GPU 视频加速与 3× 精准 Credit 账本\n"
         "• 合规与运营：海外主体与多支付通道隔离 + 14 模块 /ops 独立运营中台生产就绪"),
    ]
    for i, (role, name, col, duty, bio) in enumerate(founders):
        x = 0.60 + i * 4.12
        add_rect(s15, x, 1.85, 3.88, 2.92, fill_color=C_SURFACE, border_color=C_BORDER)
        add_rect(s15, x, 1.85, 3.88, 0.06, fill_color=col, border_color=None, rounded=False)
        add_pill(s15, x + 0.18, 2.02, 1.68, 0.28, role, fill_color=C_SURFACE2, text_color=col, font_size=9.5)
        add_textbox(s15, x + 1.92, 1.99, 1.80, 0.36, name, font_size=16, color=C_GOLD if i < 2 else C_TEAL, bold=True, align=PP_ALIGN.RIGHT)
        add_textbox(s15, x + 0.18, 2.38, 3.54, 0.28, duty, font_size=10.5, color=C_TEXT, bold=True)
        add_rect(s15, x + 0.18, 2.71, 3.54, 0.012, fill_color=C_BORDER, border_color=None, rounded=False)
        add_textbox(s15, x + 0.18, 2.80, 3.54, 1.90, bio, font_size=9.8, color=C_SUBTEXT, line_spacing=1.24)

    add_rect(s15, 0.60, 4.96, 12.13, 1.92, fill_color=C_SURFACE2, border_color=C_BORDER)
    add_textbox(s15, 0.85, 5.07, 11.6, 0.32, "海外团队天然优势 + 400 万融资后精准补齐 4 个直接打粮食岗位（严控 8–10 人高人效）", font_size=12.2, color=C_PINK, bold=True)

    hires = [
        ("海外投放与联盟增长 (1人)", "精通海外成人联盟、X/Reddit/Meta/TikTok 买量归因，主导 60 天回本滚投。", C_ROSE),
        ("英语内容制片与编剧 (1–2人)", "操盘英语成人互动短剧强钩子剧本、官方女主卡及后续女性向内容筹备。", C_GOLD),
        ("创作者与社区运营 (1人)", "招募海外/多语种头部 NSFW 与女性向作者，跑通新版创作中心分账飞轮。", C_TEAL),
        ("资深前端 / 移动端工程 (1人)", "打磨全球 Web/Android/iOS 流畅体验、支付转化漏斗与女性向独立客户端。", C_PURPLE),
    ]
    for i, (ht, hb, col) in enumerate(hires):
        hx = 0.85 + i * 2.95
        add_rect(s15, hx, 5.50, 2.78, 1.22, fill_color=C_SURFACE, border_color=col, border_pt=0.9)
        add_textbox(s15, hx + 0.14, 5.59, 2.50, 0.34, ht, font_size=10.8, color=col, bold=True)
        add_textbox(s15, hx + 0.14, 5.95, 2.50, 0.70, hb, font_size=9.7, color=C_SUBTEXT, line_spacing=1.22)

    set_notes(s15, "团队最大的壁垒是极度稀缺的复合背景：创始人 PEN 北航本科、清华硕士，谷歌学术三位数引用、2 项游戏国一，曾在鹰角、腾讯、阿里、百度、快手可灵和具身智能初创核心实习，既是千人社团创社社长又长期和米哈游、腾讯、网易合作——同时打通了 AI 视频大模型、二次元游戏与社区生态三条线。联合创始人归墟履历后续可按需补充。400 万融资后严控人头，只补海外投放、英语制片、创作者运营和移动端 4 个核心位。")

    # =========================================================================
    # SLIDE 16: 融资计划（400 万人民币）与 12 个月里程碑
    # =========================================================================
    s16 = prs.slides.add_slide(blank_layout)
    add_chrome(s16, "11 · 融资计划", "本轮融资：天使轮 400 万人民币，12 个月冲刺 3,000 万年化", "重仓海外买量滚投（35%）与产品内容打磨（55%），一年内直达高估值 Pre-A 节点", 16, TOTAL)

    add_picture_fit(s16, chart_funding, 0.60, 1.85, 5.25, 4.25, border=True)

    add_rect(s16, 0.60, 6.22, 5.25, 0.68, fill_color=C_SURFACE2, border_color=C_GOLD, border_pt=1.2)
    add_textbox(s16, 0.78, 6.34, 4.90, 0.44,
                "融资金额：¥400 万  ｜  建议出让：10%–15%（可议）  ｜  目标：12 个月达 Pre-A",
                font_size=10.5, color=C_GOLD, bold=True, align=PP_ALIGN.CENTER)

    rows_fund = [
        ["资金模块", "金额 / 占比", "具体投入方向与杠杆作用"],
        ["海外买量与滚投", "140 万 (35%)", "海外垂类流量/社媒钩子测试 + 60 天内回本滚动复投、SEO 基建"],
        ["核心产品与研发", "120 万 (30%)", "补齐关键岗位；记忆/多模态体验打磨、容器扩容与女性向产品线研发"],
        ["成人/女性向内容", "100 万 (25%)", "标杆英语成人短剧 + 200+ 女主卡 + GPU 算力 + 种子作者保底与女性向筹备"],
        ["海外合规与预备", "40 万 (10%)", "海外多通道支付风控、云资源弹性扩容与现金安全垫"],
    ]
    add_styled_table(s16, 6.10, 1.85, 6.63, 2.38, rows_fund,
                     col_widths=[1.62, 1.35, 3.66], font_size=10.0)

    add_textbox(s16, 6.10, 4.36, 6.63, 0.30, "12 个月冲刺年化 3,000 万核心里程碑（四季度验收）", font_size=12.8, color=C_PINK, bold=True)
    rows_ms = [
        ["阶段", "周期", "核心交付与业务动作", "量化验收目标"],
        ["Q1 验证", "M1–M3", "英语成人标杆剧+50联动卡；50+素材测投", "MAU 2万 · 月流水 ¥25万+ · 回本<60天"],
        ["Q2 滚投", "M4–M6", "扩至 5–8 爆款成人题材；多模态提 ARPPU", "MAU 6万 · 月流水 ¥80万+ (年化近千万)"],
        ["Q3 扩盘", "M7–M9", "英语放量 + 日韩德复制；女性向产品启动内测", "MAU 12万 · 月流水 ¥160万+"],
        ["Q4 冲刺", "M10–M12", "成人全球放量 + 女性向正式上线双引擎驱动", "MAU 18.5万 · 月流水 ¥255万 (年化3,060万)"],
    ]
    add_styled_table(s16, 6.10, 4.70, 6.63, 2.22, rows_ms,
                     col_widths=[0.98, 0.90, 2.38, 2.37], font_size=9.5, highlight_last=True)

    set_notes(s16, "为了支持 12 个月冲到年化 3,000 万，这 400 万的分配更加聚焦增长：35%（140 万）直接作为海外买量启动与滚投弹药，30% 打磨核心引擎并同步研发女性向产品，25% 投入标杆内容与算力，10% 做海外合规与预备金。每个季度都有清晰的月流水验收点。")

    # =========================================================================
    # SLIDE 17: 风险控制与海外合规纪律
    # =========================================================================
    s17 = prs.slides.add_slide(blank_layout)
    add_chrome(s17, "12 · 风险与风控", "核心风险与海外合规纪律：高速冲刺下的硬熔断防线", "海外团队天然按欧美合规标准运作：严守成人红线、双品牌隔离、多支付容灾与回本熔断", 17, TOTAL)

    rows_risk = [
        ["风险维度", "提前预警信号（触发红线）", "应对方案与硬止损动作", "当前防线状态"],
        ["1. 海外成人合规与支付", "出现真人肖像侵权争议、违禁内容\n或单一支付通道触发风控审核", "100% 排除真人换脸/未成年/非自愿红线；严格\n18+ 门禁；海外高风控多支付通道 + USDT 并行。", "海外主体 + 社区公约\n+ 多支付通道隔离"],
        ["2. 成人与女性向品牌隔离", "成人调性影响女性向产品上主流\nApp Store / Google Play 审核", "双产品线独立域名、独立品牌与独立分级目录\n（仅底层技术共享），女性向走 100% 商店合规。", "晴屿独立站点已验证\n物理与品牌双隔离"],
        ["3. 买量回本不及预期", "单渠道/题材测试 30 天回本率\n低于预期或 CPI 连续超标", "立即熔断该题材放量，切换前 3 秒短剧钩子\n或调优首单破冰页，只对跑正渠道做滚投。", "分渠道归因与\n周级素材迭代机制"],
        ["4. 算力与模型成本波动", "单用户推理/视频成本超 30%\n或上游大模型限流/收紧政策", "6 大模型分钟级切流；自有 GPU ComfyUI 承接\n视频推理；真实成本 ×3 定点计费 + R2 缓存。", "6 模型路由与自有 GPU\n管线已生产跑通"],
    ]
    add_styled_table(s17, 0.60, 1.88, 12.13, 4.95, rows_risk,
                     col_widths=[2.15, 2.85, 4.78, 2.35], font_size=10.8)

    set_notes(s17, "高速冲刺同时，我们把风控防线扎得很牢：作为海外团队，我们严格遵循欧美成人合规底线、零真人侵权、多支付通道容灾；同时成人线和女性向线做彻底的品牌与域隔离，确保女性向可以顺利进入主流应用商店。")

    # =========================================================================
    # SLIDE 18: 封底页
    # =========================================================================
    s18 = prs.slides.add_slide(blank_layout)
    set_slide_bg(s18, C_BG)
    s18.shapes.add_picture(closing_bg, Inches(0), Inches(0), width=Inches(13.333), height=Inches(7.5))
    add_rect(s18, 0, 0, 13.333, 0.08, fill_color=C_ROSE, border_color=None, rounded=False)

    if os.path.exists(BRAND_LOGO):
        s18.shapes.add_picture(BRAND_LOGO, Inches(6.22), Inches(1.05), width=Inches(0.90), height=Inches(0.90))

    add_textbox(s18, 1.0, 2.15, 11.333, 0.85, "先用成人互动极速造血，再用引擎定义下一代陪伴", font_size=36, color=C_TEXT, bold=True, align=PP_ALIGN.CENTER)
    add_textbox(s18, 1.0, 3.08, 11.333, 0.50, "叙梦 XUMENG（海外团队） ·  12 个月冲刺年化 ¥3,000 万+  ·  边打磨边拓女性向大盘", font_size=17, color=C_PINK, bold=True, align=PP_ALIGN.CENTER)

    add_rect(s18, 2.15, 3.92, 9.03, 1.25, fill_color=C_SURFACE, border_color=C_ROSE, border_pt=1.4)
    add_textbox(s18, 2.35, 4.08, 8.63, 0.44, "天使轮拟融资：400 万人民币  ｜  立即体验：https://xumengchat.top", font_size=17, color=C_GOLD, bold=True, align=PP_ALIGN.CENTER)
    add_textbox(s18, 2.35, 4.60, 8.63, 0.42, "欢迎预约现场演示（新版创作中心 · 82+ 模板生视频 · 短剧游玩点 · 原生容器陪聊） ｜  联系人：PEN（创始人）", font_size=11.2, color=C_TEXT, align=PP_ALIGN.CENTER)

    add_rect(s18, 0.85, 5.65, 11.63, 1.30, fill_color=C_SURFACE, border_color=C_BORDER, border_pt=0.8)
    add_textbox(s18, 1.10, 5.75, 11.1, 0.28, "数据来源与声明", font_size=10.5, color=C_PINK, bold=True)
    add_textbox(s18, 1.10, 6.04, 11.1, 0.82,
                "1. 全球 AI 陪伴收入榜：SensorTower（2026.10.14–11.12，游戏新知制图）；  2. 2025 全球短剧内购 $28 亿（+116%）：Sensor Tower / 新华财经（2026-01-14）；\n"
                "3. 2026E 全球互动影游 >$23 亿 & 互动转化 2–3 倍：DataEye / 证券日报（2026-09-28）；  4. 2026E 中国 AI 剧 ¥400 亿（+138%）：DataEye / 财经网（2026-11-13）。\n"
                "注：本计划书中未来财务预测与单位经济指标为管理层基于公开市场基准的测算情景，不构成业绩承诺；核心成员详细履历与后台数据可在尽调阶段提供。",
                font_size=9.2, color=C_MUTED, line_spacing=1.28)

    set_notes(s18, "感谢各位老师！欢迎直接打开 xumengchat.top 体验我们最新迭代的产品，也随时欢迎约一次 15 分钟产品实机演示和深入交流。")

    prs.save(OUT_PPTX)
    print(f"SUCCESS: Updated {OUT_PPTX} ({len(prs.slides)} slides, {os.path.getsize(OUT_PPTX)/1024/1024:.2f} MB)")


if __name__ == "__main__":
    build_deck()
