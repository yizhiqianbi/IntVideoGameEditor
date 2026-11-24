package top.xumeng.app;

import android.accessibilityservice.AccessibilityServiceInfo;
import android.app.Activity;
import android.app.Instrumentation;
import android.app.UiAutomation;
import android.content.Intent;
import android.graphics.Rect;
import android.os.Bundle;
import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import android.view.InputDevice;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.accessibility.AccessibilityNodeInfo;
import android.webkit.WebBackForwardList;
import android.webkit.WebView;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/** Platform-only native integration tests. Every web mutation is gated to the local fixture. */
public final class SmokeInstrumentation extends Instrumentation {
    private static final String FIXTURE_ORIGIN = "http://10.0.2.2:18765";
    private Activity activity;
    private WebView web;
    private UiAutomation automation;
    private int assertions;
    private String stage = "bootstrap";
    private String savedFixtureName;
    private Bundle hashBeforeBack;
    private String hashBackDiagnostics;
    private Integer rootBeforeBackHistoryLength;
    private volatile String lastTouchDiagnostics;
    private final List<String> passedStages = new ArrayList<>();
    private final List<String> skippedChecks = new ArrayList<>();

    @Override public void onCreate(Bundle arguments) { super.onCreate(arguments); start(); }

    @Override public void onStart() {
        Bundle result = new Bundle();
        boolean passed = false;
        String failure = null;
        try {
            // A production build may be inspected elsewhere, but this runner never acts on it.
            if (!getTargetContext().getPackageName().endsWith(".debug")) {
                throw new AssertionError("Runner requires the debug package and local fixture build");
            }
            Intent intent = getTargetContext().getPackageManager()
                    .getLaunchIntentForPackage(getTargetContext().getPackageName());
            if (intent == null) throw new AssertionError("No launcher activity");
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
            activity = startActivitySync(intent);
            runOnMainSync(() -> web = findWeb(activity.getWindow().getDecorView()));
            if (web == null) throw new AssertionError("Missing WebView");
            waitFor("document.readyState === 'complete' && !!document.querySelector('#blob-download')", 30);
            check("location.origin === '" + FIXTURE_ORIGIN + "'", "explicit fixture origin");
            automation = getUiAutomation();
            if (automation == null) throw new AssertionError("UiAutomation unavailable; native interactions cannot be verified");
            AccessibilityServiceInfo info = automation.getServiceInfo();
            if (info != null) {
                info.flags |= AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS;
                automation.setServiceInfo(info);
            }
            completeStage();

            stage = "viewport and hash back";
            check("window.innerWidth >= 300 && window.innerWidth <= 700", "phone viewport");
            check("document.documentElement.scrollWidth <= window.innerWidth", "no horizontal overflow");
            assertFixture();
            // The fixture's existing real link is #internal-link -> #detail.
            // Wait for the rendered route, rather than assuming a JS hash assignment is a committed navigation.
            tapWeb("#internal-link");
            waitFor("location.hash === '#detail' && document.querySelector('#route-state').textContent === 'detail'"
                    + " && !document.querySelector('#detail-panel').hidden", 5);
            captureHashBackDiagnostics();
            stage = "viewport and hash back [" + hashBackDiagnostics + "]";
            sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);
            waitFor("location.hash === ''", 5);
            check("location.hash === ''", "native back traverses hash history");
            check("document.querySelector('#blob-download') !== null", "back keeps page alive");
            check("typeof window.fetch === 'function'", "fetch available");
            check("typeof URL.createObjectURL === 'function'", "blob available");
            completeStage();

            stage = "JavaScript confirm cancellation";
            tapWeb("#confirm-button");
            clickNative(new String[]{"android:id/button2"}, new String[]{"取消", "Cancel", "CANCEL"}, 5);
            waitFor("document.querySelector('#confirm-result').textContent === 'canceled'", 5);
            check("document.querySelector('#confirm-result').textContent === 'canceled'", "native Cancel resolves confirm(false)");
            completeStage();

            stage = "JavaScript confirm acceptance";
            tapWeb("#confirm-button");
            clickNative(new String[]{"android:id/button1"}, new String[]{"确定", "OK", "Ok"}, 5);
            waitFor("document.querySelector('#confirm-result').textContent === 'confirmed'", 5);
            check("document.querySelector('#confirm-result').textContent === 'confirmed'", "native OK resolves confirm(true)");
            completeStage();

            stage = "file chooser cancellation and recovery";
            assertFixture();
            js("window.__fixtureFileCancels=0; document.querySelector('#file-input').addEventListener('cancel',()=>window.__fixtureFileCancels++); true");
            boolean reportsFileCancel = "true".equals(js("'oncancel' in document.querySelector('#file-input')"));
            tapWeb("#file-input");
            awaitDocumentsUi(10);
            assertions++;
            sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);
            awaitTargetUi(10);
            check("document.querySelector('#file-count').textContent === '0'", "cancel does not select a file");
            if (reportsFileCancel) {
                waitFor("window.__fixtureFileCancels === 1", 5);
                check("window.__fixtureFileCancels === 1", "file chooser cancellation reaches the web input");
            } else {
                skippedChecks.add("file input cancel event: embedded WebView lacks oncancel; chooser reopen is still verified");
            }
            tapWeb("#file-input");
            awaitDocumentsUi(10);
            assertions++;
            sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);
            awaitTargetUi(10);
            check("document.querySelector('#file-count').textContent === '0'", "file chooser opens again after cancellation");
            completeStage();

            stage = "Blob download: immediate revoke reaches SAF";
            tapWeb("#blob-download");
            awaitDocumentsUi(20);
            waitForEditableFileName("fixture-blob.json", 5);
            assertions++;
            check("document.querySelector('#blob-result').textContent === 'requested-and-revoked'", "fixture revoked Blob URL immediately");
            completeStage();

            stage = "Blob download: actual SAF save and JSON payload";
            selectDownloadsDirectory();
            // Assert the supplied default first, then use a unique test-owned name to avoid overwrites.
            savedFixtureName = "fixture-blob-smoke-" + SystemClock.uptimeMillis() + ".json";
            AccessibilityNodeInfo filename = waitForEditableFileName("fixture-blob.json", 5);
            Bundle text = new Bundle();
            text.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, savedFixtureName);
            if (!filename.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, text)) {
                throw new AssertionError("DocumentsUI filename field does not support ACTION_SET_TEXT");
            }
            clickNative(new String[]{"com.android.documentsui:id/action_menu_save", "com.google.android.documentsui:id/action_menu_save"},
                    new String[]{"保存", "Save", "SAVE"}, 5);
            awaitTargetUi(10);
            JSONObject saved = waitForSavedJson(15);
            require("xumeng-android".equals(saved.optString("fixture"))
                    && "blob".equals(saved.optString("source")) && saved.optBoolean("harmless"),
                    "saved file contains the fixture's Blob JSON, not just an opened chooser");
            completeStage();

            stage = "actual file selection and WebView File API read";
            tapWeb("#file-input");
            awaitDocumentsUi(10);
            selectDownloadsDirectory();
            // Only select the unique harmless JSON generated and verified by this run.
            clickNative(new String[]{}, new String[]{savedFixtureName}, 10);
            try {
                awaitTargetUi(3);
            } catch (AssertionError stillChoosing) {
                // Some multi-select DocumentsUI versions require a final Open/Select action.
                awaitDocumentsUi(1);
                clickNative(new String[]{"com.android.documentsui:id/action_menu_select", "com.google.android.documentsui:id/action_menu_select"},
                        new String[]{"打开", "选择", "Open", "OPEN", "Select", "SELECT"}, 5);
                awaitTargetUi(10);
            }
            waitFor("document.querySelector('#file-count').textContent === '1'", 10);
            String ownName = JSONObject.quote(savedFixtureName);
            check("document.querySelector('#file-result').textContent === " + ownName,
                    "native chooser returns this run's single fixture file");
            check("document.querySelector('#file-input').files[0]?.name === " + ownName,
                    "WebView File API exposes only the selected fixture filename");
            assertFixture();
            js("window.__fixtureFileReadOK=false; window.__fixtureFileReadDone=false;"
                    + "document.querySelector('#file-input').files[0].text().then(raw=>{"
                    + "const value=JSON.parse(raw);window.__fixtureFileReadOK=value.fixture==='xumeng-android'"
                    + "&&value.source==='blob'&&value.harmless===true;"
                    + "}).catch(()=>{window.__fixtureFileReadOK=false})"
                    + ".finally(()=>{window.__fixtureFileReadDone=true});true");
            waitFor("window.__fixtureFileReadDone === true", 10);
            check("window.__fixtureFileReadOK === true", "WebView actually reads the chosen content URI via File.text()");
            completeStage();

            stage = "HTTP attachment download: SAF cancellation";
            tapWeb("#http-download");
            awaitDocumentsUi(20);
            waitForEditableFileName("fixture-http.json", 5);
            assertions++;
            sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);
            awaitTargetUi(10);
            check("document.querySelector('#http-download') !== null", "HTTP save cancellation keeps the fixture alive");
            // Reopening also exercises cleanup of the cancelled native transfer.
            tapWeb("#http-download");
            awaitDocumentsUi(20);
            waitForEditableFileName("fixture-http.json", 5);
            assertions++;
            sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);
            awaitTargetUi(10);
            completeStage();

            stage = "HttpOnly cookie survives reload";
            tapWeb("#set-cookie-button");
            waitFor("document.querySelector('#cookie-status').textContent === 'checked' && document.querySelector('#cookie-state').textContent === 'true'", 10);
            check("document.querySelector('#cookie-state').textContent === 'true'", "server sees the fixture cookie");
            check("!document.cookie.includes('xumeng_android_fixture=')", "fixture cookie is HttpOnly");
            String beforeReload = js("performance.timeOrigin");
            tapWeb("#reload-button");
            waitFor("performance.timeOrigin !== " + beforeReload + " && document.readyState === 'complete'"
                    + " && document.querySelector('#cookie-status')?.textContent === 'checked'", 15);
            assertFixture();
            check("document.querySelector('#cookie-state').textContent === 'true'", "server still sees cookie after reload");
            completeStage();

            stage = "fullscreen with a native touch gesture";
            if ("true".equals(js("document.fullscreenEnabled && typeof document.querySelector('#fullscreen-target').requestFullscreen === 'function'"))) {
                tapWeb("#fullscreen-button");
                waitFor("['fullscreen','unavailable'].includes(document.querySelector('#fullscreen-state').textContent)", 10);
                check("document.querySelector('#fullscreen-state').textContent === 'fullscreen'", "real touch enters fullscreen");
                sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);
                waitFor("document.querySelector('#fullscreen-state').textContent === 'windowed'", 10);
                check("document.querySelector('#fullscreen-state').textContent === 'windowed'", "native Back exits fullscreen");
                check("document.querySelector('#blob-download') !== null", "fullscreen exit restores the page");
                completeStage();
            } else {
                skippedChecks.add("fullscreen: embedded WebView does not advertise Fullscreen API support; no fullscreen pass is claimed");
            }

            stage = "root page native Back exits";
            assertFixture();
            check("location.hash === ''", "root exit begins at the fixture home route");
            rootBeforeBackHistoryLength = Integer.parseInt(js("history.length"));
            stage += " [history.length=" + rootBeforeBackHistoryLength + "]";
            boolean[] alreadyExiting = new boolean[1];
            runOnMainSync(() -> alreadyExiting[0] = activity.isFinishing() || activity.isDestroyed());
            require(!alreadyExiting[0], "activity is alive before the final root Back");
            sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);
            waitForActivityExit(10);
            assertions++;
            completeStage();
            passed = true;
        } catch (Throwable error) {
            failure = error.toString();
        } finally {
            if (savedFixtureName != null && automation != null) {
                try { shell("rm -f /sdcard/Download/" + savedFixtureName); }
                catch (Exception error) { skippedChecks.add("cleanup of unique fixture file failed: " + error.getClass().getSimpleName()); }
            }
        }
        result.putInt("assertions", assertions);
        result.putString("stage", stage);
        if (lastTouchDiagnostics != null) result.putString("lastTouchDiagnostics", lastTouchDiagnostics);
        if (hashBeforeBack != null) {
            result.putBundle("hashBeforeBack", hashBeforeBack);
            result.putString("hashBackDiagnostics", hashBackDiagnostics);
            result.putInt("hashBeforeBackHistoryLength", hashBeforeBack.getInt("historyLength"));
            result.putBoolean("hashBeforeBackCanGoBack", hashBeforeBack.getBoolean("canGoBack"));
            result.putInt("hashBeforeBackNativeHistorySize", hashBeforeBack.getInt("nativeHistorySize"));
            result.putInt("hashBeforeBackNativeCurrentIndex", hashBeforeBack.getInt("nativeCurrentIndex"));
            result.putBoolean("hashBeforeBackNavigationCanGoBackExposed", hashBeforeBack.getBoolean("navigationCanGoBackExposed"));
            if (hashBeforeBack.getBoolean("navigationCanGoBackExposed")) {
                result.putBoolean("hashBeforeBackNavigationCanGoBack", hashBeforeBack.getBoolean("navigationCanGoBack"));
            }
        }
        if (rootBeforeBackHistoryLength != null) result.putInt("rootBeforeBackHistoryLength", rootBeforeBackHistoryLength);
        result.putStringArrayList("passedStages", new ArrayList<>(passedStages));
        result.putStringArrayList("skippedChecks", new ArrayList<>(skippedChecks));
        String details = "Stages: " + String.join("; ", passedStages) + "\n";
        if (hashBackDiagnostics != null) details += "Before native KEYCODE_BACK: " + hashBackDiagnostics + "\n";
        if (!passed && lastTouchDiagnostics != null) details += "Last web activation: " + lastTouchDiagnostics + "\n";
        if (!skippedChecks.isEmpty()) details += "SKIPPED: " + String.join("; ", skippedChecks) + "\n";
        result.putString("stream", (passed ? "PASS " + assertions + " Android native assertions\n"
                : "FAIL at [" + stage + "] after " + assertions + " assertions: " + failure + "\n") + details);
        finish(passed ? Activity.RESULT_OK : Activity.RESULT_CANCELED, result);
    }

    private void completeStage() { passedStages.add(stage); }

    private void captureHashBackDiagnostics() throws Exception {
        int historyLength = Integer.parseInt(js("history.length"));
        JSONArray navigation = new JSONArray(js("(()=>{const n=window.navigation;"
                + "const exposed=!!n&&typeof n.canGoBack==='boolean';return [exposed,exposed?n.canGoBack:null]})()"));
        boolean navigationExposed = navigation.getBoolean(0);
        boolean navigationCanGoBack = navigationExposed && navigation.getBoolean(1);
        int[] nativeState = new int[3];
        runOnMainSync(() -> {
            WebBackForwardList history = web.copyBackForwardList();
            nativeState[0] = web.canGoBack() ? 1 : 0;
            nativeState[1] = history.getSize();
            nativeState[2] = history.getCurrentIndex();
        });
        hashBeforeBack = new Bundle();
        hashBeforeBack.putInt("historyLength", historyLength);
        hashBeforeBack.putBoolean("canGoBack", nativeState[0] == 1);
        hashBeforeBack.putInt("nativeHistorySize", nativeState[1]);
        hashBeforeBack.putInt("nativeCurrentIndex", nativeState[2]);
        hashBeforeBack.putBoolean("navigationCanGoBackExposed", navigationExposed);
        if (navigationExposed) hashBeforeBack.putBoolean("navigationCanGoBack", navigationCanGoBack);
        hashBackDiagnostics = "history.length=" + historyLength + ", canGoBack=" + (nativeState[0] == 1)
                + ", nativeHistorySize=" + nativeState[1] + ", nativeCurrentIndex=" + nativeState[2]
                + ", navigation.canGoBack=" + (navigationExposed ? String.valueOf(navigationCanGoBack) : "unavailable");
    }

    private void waitForActivityExit(int seconds) throws Exception {
        long deadline = SystemClock.uptimeMillis() + seconds * 1000L;
        boolean[] exiting = new boolean[1];
        while (SystemClock.uptimeMillis() < deadline) {
            runOnMainSync(() -> exiting[0] = activity.isFinishing() || activity.isDestroyed());
            if (exiting[0]) return;
            Thread.sleep(100);
        }
        throw new AssertionError("Final native Back did not finish/destroy the root-page Activity within " + seconds + " seconds");
    }

    private void assertFixture() throws Exception {
        if (!"true".equals(js("location.origin === '" + FIXTURE_ORIGIN + "' && !!document.querySelector('#fixture-main')"))) {
            throw new AssertionError("Refusing interaction outside the isolated fixture");
        }
    }

    private void require(boolean condition, String name) {
        if (!condition) throw new AssertionError(name);
        assertions++;
    }

    private void check(String expression, String name) throws Exception {
        require("true".equals(js(expression)), name);
    }

    private void waitFor(String expression, int seconds) throws Exception {
        long deadline = SystemClock.uptimeMillis() + seconds * 1000L;
        while (SystemClock.uptimeMillis() < deadline) {
            if ("true".equals(js(expression))) return;
            Thread.sleep(100);
        }
        throw new AssertionError("Timeout: " + expression);
    }

    private String js(String expression) throws Exception {
        CountDownLatch latch = new CountDownLatch(1);
        AtomicReference<String> value = new AtomicReference<>();
        runOnMainSync(() -> web.evaluateJavascript(expression, response -> {
            value.set(response); latch.countDown();
        }));
        if (!latch.await(5, TimeUnit.SECONDS)) throw new AssertionError("JS callback timed out");
        return value.get();
    }

    /** Native accessibility activates ordinary controls; fullscreen always uses a real touchscreen gesture. */
    private void tapWeb(String selector) throws Exception {
        assertFixture();
        String quoted = JSONObject.quote(selector);
        js("window.__fixtureClickedId=null;if(!window.__fixtureClickProbe){"
                + "document.addEventListener('click',event=>{const target=event.target instanceof Element"
                + "?event.target.closest('a,button,input'):null;window.__fixtureClickedId=target?target.id:null},true);"
                + "window.__fixtureClickProbe=true}document.querySelector(" + quoted
                + ").scrollIntoView({block:'center',behavior:'instant'});true");
        JSONObject geometry = new JSONObject(js("(()=>{const el=document.querySelector(" + quoted
                + "),r=el.getBoundingClientRect();return {rectLeft:r.left,rectTop:r.top,rectWidth:r.width,rectHeight:r.height,"
                + "viewportWidth:innerWidth,viewportHeight:innerHeight,documentScrollY:scrollY,"
                + "label:(el.getAttribute('aria-label')||el.innerText||el.labels?.[0]?.innerText||'').trim()}})()"));
        double x = geometry.getDouble("rectLeft") + geometry.getDouble("rectWidth") / 2;
        double y = geometry.getDouble("rectTop") + geometry.getDouble("rectHeight") / 2;
        double cssWidth = geometry.getDouble("viewportWidth"), cssHeight = geometry.getDouble("viewportHeight");
        int[] screen = new int[2];
        int[] nativeView = new int[4];
        boolean[] viewState = new boolean[2];
        runOnMainSync(() -> {
            web.getLocationOnScreen(screen);
            nativeView[0] = web.getWidth(); nativeView[1] = web.getHeight();
            nativeView[2] = web.getScrollX(); nativeView[3] = web.getScrollY();
            viewState[0] = web.hasWindowFocus(); viewState[1] = web.isShown();
        });
        geometry.put("selector", selector);
        geometry.put("webScreenX", screen[0]); geometry.put("webScreenY", screen[1]);
        geometry.put("webWidth", nativeView[0]); geometry.put("webHeight", nativeView[1]);
        geometry.put("webScrollX", nativeView[2]); geometry.put("webScrollY", nativeView[3]);
        geometry.put("webHasWindowFocus", viewState[0]); geometry.put("webShown", viewState[1]);
        AccessibilityNodeInfo activeRoot = automation.getRootInActiveWindow();
        geometry.put("activeWindowPackage", activeRoot == null || activeRoot.getPackageName() == null
                ? "unavailable" : activeRoot.getPackageName().toString());
        geometry.put("clickedId", "not-attempted");
        lastTouchDiagnostics = geometry.toString();
        if (x < 0 || y < 0 || x >= cssWidth || y >= cssHeight) {
            throw new AssertionError("Web control is outside the visible viewport: " + selector);
        }
        waitForTargetFocus(5);
        // Exact fixture label matching stays inside the target application's accessibility tree.
        String label = geometry.optString("label");
        String targetPackage = getTargetContext().getPackageName();
        AccessibilityNodeInfo clickable = "#fullscreen-button".equals(selector) || label.isEmpty() ? null
                : findNode(automation.getRootInActiveWindow(), node -> node.isClickable() && node.isEnabled()
                && node.getPackageName() != null && targetPackage.contentEquals(node.getPackageName())
                && (label.contentEquals(node.getText() == null ? "" : node.getText())
                    || label.contentEquals(node.getContentDescription() == null ? "" : node.getContentDescription())));
        boolean accessibilityClicked = clickable != null && clickable.performAction(AccessibilityNodeInfo.ACTION_CLICK);
        geometry.put("activation", accessibilityClicked ? "native-accessibility-click" : "native-touch");
        if (!accessibilityClicked) {
            double scale = nativeView[0] / cssWidth;
            float screenX = (float) (screen[0] + x * scale), screenY = (float) (screen[1] + y * scale);
            geometry.put("injectedX", screenX); geometry.put("injectedY", screenY);
            lastTouchDiagnostics = geometry.toString();
            tapScreen(screenX, screenY);
        }
        geometry.put("clickedId", "pending-event-probe");
        lastTouchDiagnostics = geometry.toString();
        // Do not block on JS while a native confirm dialog is open. Its probe resolves after dismissal.
        runOnMainSync(() -> web.evaluateJavascript("window.__fixtureClickedId", clicked -> {
            try {
                geometry.put("clickedId", clicked == null ? "unavailable" : clicked);
                lastTouchDiagnostics = geometry.toString();
            } catch (org.json.JSONException ignored) { }
        }));
    }

    private void waitForTargetFocus(int seconds) throws Exception {
        long deadline = SystemClock.uptimeMillis() + seconds * 1000L;
        String targetPackage = getTargetContext().getPackageName();
        boolean[] focused = new boolean[1];
        while (SystemClock.uptimeMillis() < deadline) {
            AccessibilityNodeInfo root = automation.getRootInActiveWindow();
            boolean targetWindow = root != null && root.getPackageName() != null
                    && targetPackage.contentEquals(root.getPackageName());
            runOnMainSync(() -> focused[0] = web.hasWindowFocus() && web.isShown());
            if (targetWindow && focused[0]) return;
            Thread.sleep(100);
        }
        throw new AssertionError("Target WebView is not the focused foreground window; native gesture was not sent");
    }

    private void tapScreen(float x, float y) {
        long time = SystemClock.uptimeMillis();
        MotionEvent down = MotionEvent.obtain(time, time, MotionEvent.ACTION_DOWN, x, y, 0);
        MotionEvent up = null;
        down.setSource(InputDevice.SOURCE_TOUCHSCREEN);
        try {
            if (!automation.injectInputEvent(down, true)) throw new AssertionError("Native touch DOWN injection failed");
            // This duration is the physical press itself, not a wait for application state.
            SystemClock.sleep(50);
            up = MotionEvent.obtain(time, SystemClock.uptimeMillis(), MotionEvent.ACTION_UP, x, y, 0);
            up.setSource(InputDevice.SOURCE_TOUCHSCREEN);
            if (!automation.injectInputEvent(up, true)) throw new AssertionError("Native touch UP injection failed");
        } finally { down.recycle(); if (up != null) up.recycle(); }
    }

    private interface NodeMatch { boolean matches(AccessibilityNodeInfo node); }

    private AccessibilityNodeInfo findNode(AccessibilityNodeInfo node, NodeMatch match) {
        if (node == null) return null;
        if (node.isVisibleToUser() && match.matches(node)) return node;
        for (int index = 0; index < node.getChildCount(); index++) {
            AccessibilityNodeInfo found = findNode(node.getChild(index), match);
            if (found != null) return found;
        }
        return null;
    }

    private AccessibilityNodeInfo waitForNode(NodeMatch match, int seconds, String description) throws Exception {
        long deadline = SystemClock.uptimeMillis() + seconds * 1000L;
        while (SystemClock.uptimeMillis() < deadline) {
            AccessibilityNodeInfo found = findNode(automation.getRootInActiveWindow(), match);
            if (found != null) return found;
            Thread.sleep(100);
        }
        throw new AssertionError("Native UI unavailable: " + description);
    }

    private boolean equalsAny(CharSequence value, String[] candidates) {
        if (value == null) return false;
        for (String candidate : candidates) if (candidate.equals(value.toString())) return true;
        return false;
    }

    private void clickNative(String[] ids, String[] labels, int seconds) throws Exception {
        AccessibilityNodeInfo node = waitForNode(candidate -> candidate.isEnabled()
                && (equalsAny(candidate.getViewIdResourceName(), ids)
                    || equalsAny(candidate.getText(), labels) || equalsAny(candidate.getContentDescription(), labels)),
                seconds, String.join("/", labels));
        if (node.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return;
        Rect bounds = new Rect(); node.getBoundsInScreen(bounds);
        if (bounds.isEmpty()) throw new AssertionError("Native control has no touch bounds");
        tapScreen(bounds.centerX(), bounds.centerY());
    }

    private AccessibilityNodeInfo awaitDocumentsUi(int seconds) throws Exception {
        return waitForNode(node -> node.getPackageName() != null
                && node.getPackageName().toString().endsWith(".documentsui"), seconds, "system DocumentsUI chooser");
    }

    private void awaitTargetUi(int seconds) throws Exception {
        String target = getTargetContext().getPackageName();
        waitForNode(node -> target.contentEquals(node.getPackageName() == null ? "" : node.getPackageName()),
                seconds, "return to debug app");
        assertFixture();
    }

    private AccessibilityNodeInfo waitForEditableFileName(String expectedName, int seconds) throws Exception {
        return waitForNode(node -> node.isEditable() && expectedName.contentEquals(node.getText() == null ? "" : node.getText()),
                seconds, "SAF default filename " + expectedName);
    }

    private void selectDownloadsDirectory() throws Exception {
        String[] downloads = {"Downloads", "Download", "下载", "下载内容"};
        AccessibilityNodeInfo root = automation.getRootInActiveWindow();
        if (findNode(root, node -> equalsAny(node.getText(), downloads)) != null) return;
        clickNative(new String[]{"android:id/home"},
                new String[]{"Show roots", "Open navigation drawer", "Show navigation drawer", "显示根目录", "打开导航抽屉", "显示导航栏"}, 5);
        clickNative(new String[]{}, downloads, 5);
        waitForNode(node -> equalsAny(node.getText(), downloads), 5, "Downloads save directory");
    }

    private JSONObject waitForSavedJson(int seconds) throws Exception {
        long deadline = SystemClock.uptimeMillis() + seconds * 1000L;
        while (SystemClock.uptimeMillis() < deadline) {
            try {
                JSONObject saved = new JSONObject(shell("cat /sdcard/Download/" + savedFixtureName));
                assertions++;
                return saved;
            } catch (org.json.JSONException ignored) { /* File may not exist until asynchronous copy finishes. */ }
            Thread.sleep(150);
        }
        throw new AssertionError("SAF returned to the app but the test JSON was not saved in Downloads");
    }

    private String shell(String command) throws Exception {
        // Only hard-coded operations on this run's generated harmless fixture filename are passed here.
        ParcelFileDescriptor descriptor = automation.executeShellCommand(command);
        if (descriptor == null) throw new AssertionError("UiAutomation shell is unavailable; saved bytes cannot be verified");
        try (InputStream input = new ParcelFileDescriptor.AutoCloseInputStream(descriptor);
                ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[1024];
            int count;
            while ((count = input.read(buffer)) != -1) {
                if (output.size() + count > 4096) throw new AssertionError("Unexpected fixture payload size");
                output.write(buffer, 0, count);
            }
            return output.toString(StandardCharsets.UTF_8.name());
        }
    }

    private WebView findWeb(View view) {
        if (view instanceof WebView) return (WebView) view;
        if (view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) view;
            for (int index = 0; index < group.getChildCount(); index++) {
                WebView candidate = findWeb(group.getChildAt(index));
                if (candidate != null) return candidate;
            }
        }
        return null;
    }
}
