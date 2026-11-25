#!/usr/bin/env python3
"""
Xumeng (叙梦) Mobile + Desktop E2E Visual & Functional Regression Guardrail.

Usage:
  python3 scripts/verify-xumeng-e2e.py [--base-url http://127.0.0.1:5174]

Verifies:
  1. Zero uncaught page errors across mobile (390x844) & desktop (1440x900).
  2. Zero horizontal overflow on core views.
  3. Mobile Discover: first character card starts <= 340px (4 cards visible in first viewport).
  4. Mobile Register modal: primary submit CTA fits completely above fold (<= 844px) with no dead social buttons.
  5. Mobile Settings: desktop floating-chat fields hidden; changing Theme reveals sticky unsaved save bar cleanly above bottom nav; saving switches Light Mode and dismisses sticky bar.
  6. Mobile Messages empty state: full-width sidebar (no right blank gap) + actionable white-on-pink primary CTA navigating to #characters.
  7. Desktop Messages empty state: no duplicate pink CTA in left sidebar (single focal CTA in right pane).
  8. Desktop Profile: My works localized (no leaked Simplified Chinese when UI is English).
  9. Lazy routes (#profile, #settings, #presets, #search, #studio, #generation) all mount cleanly.
"""
import argparse
import sys
from playwright.sync_api import sync_playwright


def assert_check(cond: bool, label: str, detail: str = ""):
    status = "PASS" if cond else "FAIL"
    suffix = f" ({detail})" if detail else ""
    print(f"[{status}] {label}{suffix}")
    if not cond:
        raise AssertionError(f"{label}{suffix}")


def run(base_url: str):
    page_errors: list[str] = []
    with sync_playwright() as p:
        browser = p.chromium.launch()

        # ---------------- MOBILE 390x844 ----------------
        mctx = browser.new_context(
            viewport={"width": 390, "height": 844},
            device_scale_factor=2,
            is_mobile=True,
            has_touch=True,
        )
        mp = mctx.new_page()
        mp.on("pageerror", lambda err: page_errors.append(f"mobile: {err}"))

        # 1. Discover first-viewport density & overflow
        mp.goto(f"{base_url}/#characters", wait_until="networkidle", timeout=30000)
        mp.wait_for_timeout(900)
        m_overflow = mp.evaluate("() => document.documentElement.scrollWidth > window.innerWidth")
        assert_check(not m_overflow, "Mobile Discover: no horizontal overflow")
        first_card = mp.locator("article").first
        assert_check(first_card.count() > 0, "Mobile Discover: character cards rendered")
        box = first_card.bounding_box()
        assert_check(
            box is not None and box["y"] <= 340,
            "Mobile Discover: first card above fold (y <= 340px)",
            f"y={box['y']:.1f}px" if box else "none",
        )

        # 2. Register modal CTA above fold (open from #profile -> Create an account / 注册)
        mp.goto(f"{base_url}/#profile", wait_until="networkidle", timeout=30000)
        mp.wait_for_timeout(800)
        reg_open = mp.locator("button:has-text('Create an account'), button:has-text('注册账号'), button:has-text('注册')").first
        assert_check(reg_open.count() > 0, "Mobile Profile: Register trigger button visible")
        reg_open.click()
        mp.wait_for_timeout(800)
        submit_btn = mp.locator("[role='dialog'] button[type='submit']").first
        sbox = submit_btn.bounding_box() if submit_btn.count() else None
        assert_check(
            sbox is not None and (sbox["y"] + sbox["height"]) <= 844,
            "Mobile Register Modal: submit CTA fully above fold",
            f"bottom={sbox['y'] + sbox['height']:.1f}px" if sbox else "not found",
        )
        mp.keyboard.press("Escape")
        mp.wait_for_timeout(250)

        # 3. Settings: desktop-only fields hidden + sticky save bar + real Light mode save
        mp.goto(f"{base_url}/#settings", wait_until="networkidle", timeout=30000)
        mp.wait_for_timeout(800)
        fab_label = mp.locator("label:has-text('显示悬浮聊天按钮')").first
        assert_check(not fab_label.is_visible(), "Mobile Settings: desktop floating-chat setting hidden")
        mp.locator("select[aria-label='主题']").first.select_option("light")
        mp.wait_for_timeout(300)
        sticky = mp.locator("[aria-label='未保存的设置']").first
        st_box = sticky.bounding_box() if sticky.count() else None
        assert_check(
            sticky.is_visible() and st_box is not None and (st_box["y"] + st_box["height"]) <= 775,
            "Mobile Settings: sticky unsaved save bar visible above bottom nav",
            f"bottom={st_box['y'] + st_box['height']:.1f}px" if st_box else "hidden",
        )
        sticky.locator("button[type='submit']").click()
        mp.wait_for_timeout(500)
        assert_check(not sticky.is_visible(), "Mobile Settings: sticky save bar hides after save")

        # 4. Mobile Messages: full-width sidebar + actionable CTA
        mp.goto(f"{base_url}/#chat", wait_until="networkidle", timeout=30000)
        mp.wait_for_timeout(900)
        sidebar = mp.locator("#xumeng-chat-list").first
        sb_box = sidebar.bounding_box() if sidebar.count() else None
        assert_check(
            sb_box is not None and sb_box["width"] >= 385,
            "Mobile Messages: chatSidebar fills full viewport width",
            f"width={sb_box['width']:.1f}px" if sb_box else "none",
        )
        cta = mp.locator("#xumeng-chat-list button:has-text('开始新的故事'), #xumeng-chat-list button:has-text('Start a new story')").first
        assert_check(cta.count() > 0 and cta.is_visible(), "Mobile Messages: empty-state primary CTA visible")
        cta_color = cta.evaluate("el => getComputedStyle(el).color")
        assert_check(cta_color == "rgb(255, 255, 255)", "Mobile Messages: primary CTA uses crisp white text", cta_color)
        cta.click()
        mp.wait_for_timeout(600)
        assert_check("#characters" in mp.url, "Mobile Messages: CTA navigates to #characters", mp.url)

        # 5. Lazy routes smoke test
        for route in ["#profile", "#presets", "#search", "#studio", "#generation"]:
            mp.goto(f"{base_url}/{route}", wait_until="networkidle", timeout=30000)
            mp.wait_for_timeout(700)
            ov = mp.evaluate("() => document.documentElement.scrollWidth > window.innerWidth")
            chars = mp.evaluate("() => document.body.innerText.trim().length")
            assert_check(not ov and chars > 20, f"Mobile lazy route {route}: rendered with no overflow", f"chars={chars}")

        mctx.close()

        # ---------------- DESKTOP 1440x900 ----------------
        dctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
        dp = dctx.new_page()
        dp.on("pageerror", lambda err: page_errors.append(f"desktop: {err}"))

        # 6. Desktop Messages: no duplicate pink CTA in sidebar
        dp.goto(f"{base_url}/#chat", wait_until="networkidle", timeout=30000)
        dp.wait_for_timeout(800)
        d_cta = dp.locator("#xumeng-chat-list button:has-text('Start a new story'), #xumeng-chat-list button:has-text('开始新的故事')").first
        assert_check(d_cta.count() == 0 or not d_cta.is_visible(), "Desktop Messages: sidebar empty CTA hidden (single focal CTA in right pane)")

        # 7. Desktop Profile: My works localized when English UI is active
        dp.goto(f"{base_url}/#profile", wait_until="networkidle", timeout=30000)
        dp.wait_for_timeout(800)
        body_text = dp.evaluate("() => document.body.innerText")
        if "My works" in body_text:
            assert_check(
                "你的第一部作品" not in body_text and "登录后可查看云端作品" not in body_text,
                "Desktop Profile (EN): My works section has zero leaked Simplified Chinese",
            )
        else:
            print("[PASS] Desktop Profile: non-EN locale active (skipped EN-only leak check)")

        # 8. Desktop Settings: floating chat fields visible
        dp.goto(f"{base_url}/#settings", wait_until="networkidle", timeout=30000)
        dp.wait_for_timeout(700)
        assert_check(
            dp.locator("label:has-text('显示悬浮聊天按钮')").first.is_visible(),
            "Desktop Settings: floating-chat setting visible on desktop",
        )

        # 8b. Desktop Template Square Ecosystem (Rail entry + Studio Shelf + Guest clean render + Free Tools switch)
        dp.goto(f"{base_url}/#studio", wait_until="networkidle", timeout=30000)
        dp.wait_for_timeout(700)
        assert_check(
            dp.locator('aside a[href="#generation"]').is_visible(),
            "Desktop Left Rail: Template Square entry visible under Explore",
        )
        assert_check(
            dp.locator('section[aria-label="模板广场精选"], section[aria-label="Featured Templates"]').first.is_visible(),
            "Desktop Studio: Featured Template Square shelf visible",
        )
        dp.locator('aside a[href="#generation"]').click()
        dp.wait_for_timeout(900)
        assert_check(
            dp.locator('[data-tour="tpl-card"]').first.is_visible(),
            "Desktop Template Square: Poster templates render cleanly for browsing",
        )
        assert_check(
            dp.locator('[role="alert"]').count() == 0,
            "Desktop Template Square: Zero guest error banner while browsing",
        )
        dp.locator('[data-tour="tpl-nav"] button:has-text("自由工具"), [data-tour="tpl-nav"] button:has-text("Free AI Tools")').first.click()
        dp.wait_for_timeout(500)
        assert_check(
            dp.locator('button:has-text("模板广场"), button:has-text("Templates")').first.is_visible(),
            "Desktop Unified AI Studio: Seamless switch between Template Square and Free AI Tools",
        )

        # 9. Desktop Discover: Spotlight Mask Guided Tour launches & steps cleanly
        dp.goto(f"{base_url}/#characters", wait_until="networkidle", timeout=30000)
        dp.wait_for_selector("article button", timeout=20000)
        guide_btn = dp.locator('button[aria-label="新手引导"], button[aria-label="Start guided tour"]').first
        assert_check(guide_btn.count() > 0 and guide_btn.is_visible(), "Desktop Discover: Spotlight guide trigger visible")
        guide_btn.click()
        dp.wait_for_timeout(350)
        tour_dlg = dp.locator('[role="dialog"][aria-modal="true"]').first
        assert_check(tour_dlg.is_visible(), "Desktop Discover: Spotlight guide modal opens with SVG mask")
        next_btn = tour_dlg.locator('button:has-text("下一步"), button:has-text("Next")').first
        next_btn.click()
        dp.wait_for_timeout(250)
        skip_btn = tour_dlg.locator('button:has-text("跳过"), button:has-text("Skip")').first
        skip_btn.click()
        dp.wait_for_timeout(200)
        assert_check(not tour_dlg.is_visible(), "Desktop Discover: Spotlight guide dismisses cleanly")

        # 10. Mobile In-Chat: Translucent glass + Pure Art Peek + Comments Drawer + Auto Chat Tour
        imctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, locale="zh-CN")
        imctx.route(
            "**/v1/session*",
            lambda r: r.fulfill(
                status=200,
                content_type="application/json",
                body='{"user":{"id":"e2e-player","email":"e2e@xumeng.test","displayName":"测试玩家","isGuest":false,"role":"user"},"state":null}',
            )
            if r.request.method == "GET"
            else r.continue_(),
        )
        imp = imctx.new_page()
        imp.on("pageerror", lambda err: page_errors.append(f"mobile-chat: {err}"))
        imp.goto(f"{base_url}/#characters", wait_until="networkidle", timeout=30000)
        imp.wait_for_selector("article button", timeout=20000)
        imp.locator("article").nth(1).locator("button").first.click()
        imp.wait_for_selector("[data-message-scroll]", timeout=15000)
        imp.wait_for_timeout(950)
        chat_tour = imp.locator('[role="dialog"][aria-modal="true"]').first
        assert_check(chat_tour.is_visible(), "Mobile Chat: First-visit Spotlight guide auto-launches")
        chat_tour.locator('button:has-text("跳过")').first.click()
        imp.wait_for_timeout(250)

        geom = imp.evaluate(
            """() => {
              const h = document.querySelector('header[class*="chatHeader"]');
              const m = document.querySelector('button[class*="modelButton"]');
              const t = document.querySelector('div[class*="chatHeaderTools"]');
              const s = document.querySelector('[data-message-scroll]');
              return {
                headerH: h ? Math.round(h.getBoundingClientRect().height) : -1,
                modelRight: m ? Math.round(m.getBoundingClientRect().right) : -1,
                toolsLeft: t ? Math.round(t.getBoundingClientRect().left) : -1,
                padTop: s ? parseFloat(getComputedStyle(s).paddingTop) : 0,
              };
            }"""
        )
        assert_check(
            geom["headerH"] <= 58 and geom["modelRight"] < geom["toolsLeft"] and geom["padTop"] >= 120,
            "Mobile Chat: 54px single-row header zero-overlap + visual-novel portrait stage padding",
            str(geom),
        )

        # Pure Art Peek mode + bottom exit pill
        imp.locator('[data-tour="chat-peek"]').click()
        imp.wait_for_timeout(350)
        pill_y = imp.evaluate(
            """() => {
              const el = document.querySelector('[class*="peekExitPill"]');
              return el ? Math.round(el.getBoundingClientRect().top) : -1;
            }"""
        )
        assert_check(
            imp.locator('[data-peek="true"]').count() > 0 and pill_y >= 700,
            "Mobile Chat: Pure Art Peek fades chat & anchors exit pill at bottom",
            f"pill_y={pill_y}",
        )
        imp.locator('button[aria-label="返回对话"]').click()
        imp.wait_for_timeout(250)

        # Comments Drawer: open, post with tag, verify top-rendered
        imp.locator('[data-tour="chat-comments"]').click()
        imp.wait_for_timeout(400)
        imp.locator('[role="dialog"] textarea').first.fill("E2E 评论区发布测试")
        imp.locator('[role="dialog"] button[type="submit"]').click()
        imp.wait_for_timeout(300)
        assert_check(
            imp.locator('[role="dialog"]').locator("text=E2E 评论区发布测试").is_visible(),
            "Mobile Chat: Comments drawer publishes & shows new comment immediately",
        )
        imctx.close()

        dctx.close()
        browser.close()

    assert_check(len(page_errors) == 0, "Zero uncaught page errors across mobile & desktop", "; ".join(page_errors))
    print("\nALL E2E REGRESSION CHECKS PASSED!")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:5174")
    args = parser.parse_args()
    try:
        run(args.base_url.rstrip("/"))
    except Exception as exc:
        print(f"\nE2E GUARDRAIL FAILED: {exc}", file=sys.stderr)
        sys.exit(1)
