package top.xumeng.app;

import android.annotation.SuppressLint;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ComponentName;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Rect;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewParent;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.view.inputmethod.InputMethodManager;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.JsPromptResult;
import android.webkit.JsResult;
import android.webkit.PermissionRequest;
import android.webkit.SslErrorHandler;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebMessage;
import android.webkit.WebMessagePort;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;

import androidx.activity.ComponentActivity;
import androidx.compose.ui.platform.ComposeView;
import androidx.lifecycle.ViewModelProvider;

import top.xumeng.app.feature.web.WebRoutes;
import top.xumeng.app.shell.ShellHost;
import top.xumeng.app.shell.ShellTab;
import top.xumeng.app.shell.ShellViewModel;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;

/** WebView host for the existing Xumeng site. Production builds add a native shell around it. */
public final class MainActivity extends ComponentActivity {
    private static final int FILE_PICKER = 101;
    private static final int FILE_SAVE = 102;
    private static final long MAX_DOWNLOAD_BYTES = 50L * 1024L * 1024L;
    private static final int BLOB_CHUNK_BYTES = 192 * 1024;
    private static final int BACKGROUND = Color.rgb(17, 16, 24);
    private static final int ACCENT = Color.rgb(255, 71, 126);
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService transfers = Executors.newSingleThreadExecutor();
    private final List<WebView> popupViews = new ArrayList<>();
    private FrameLayout root;
    private FrameLayout fullscreen;
    private LinearLayout errorPanel;
    private TextView errorText;
    private ProgressBar progress;
    private WebView webView;
    private View customView;
    private WebChromeClient.CustomViewCallback customViewCallback;
    private ValueCallback<Uri[]> fileCallback;
    private AlertDialog activeDialog;
    private WebMessagePort controlPort;
    private WebMessagePort streamPort;
    private String bridgeToken;
    private boolean bridgeReady;
    private int pageGeneration;
    private int approvedLeaveGeneration = -1;
    private int installedGeneration = -1;
    private String lastTrustedUrl = BuildConfig.WEB_ORIGIN + "/";
    private volatile PendingSave pendingSave;
    private boolean backPending;
    private boolean destroyed;
    private boolean nativeShell;
    private FrameLayout webSlot;
    private ComposeView shellCompose;
    private String launchUrl;
    private boolean pendingShellEntry;
    private int presentToken;
    private int shellEntryLength = 1;
    private OnBackInvokedCallback backCallback;

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        nativeShell = "https://xumengchat.top".equals(BuildConfig.WEB_ORIGIN);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        getWindow().setStatusBarColor(BACKGROUND);
        getWindow().setNavigationBarColor(BACKGROUND);
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
        }
        if (nativeShell) buildNativeCompose();
        else buildViews();
        if (Build.VERSION.SDK_INT >= 30) {
            // setContentView creates DecorView; PhoneWindow's controller needs it to exist.
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) controller.setSystemBarsAppearance(0,
                    WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                    | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
        }
        if (!nativeShell) configureWebView();
        if (Build.VERSION.SDK_INT >= 33) {
            backCallback = this::handleBack;
            // Overlay priority stays ahead of AndroidX's predictive-back input on the native shell.
            // Fixture builds keep the original default priority so the smoke runner's Back key is unchanged.
            int priority = nativeShell ? OnBackInvokedDispatcher.PRIORITY_OVERLAY : OnBackInvokedDispatcher.PRIORITY_DEFAULT;
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(priority, backCallback);
        }
        if (nativeShell) {
            if (savedInstanceState == null) captureLaunchUrl(getIntent());
            ShellHost.attach(this, shellCompose);
            return;
        }
        String initialUrl = trustedIntentUrl(getIntent());
        boolean restored = false;
        if (savedInstanceState != null && NavigationPolicy.isTrusted(
                savedInstanceState.getString("trustedUrl", ""), BuildConfig.WEB_ORIGIN)) {
            lastTrustedUrl = savedInstanceState.getString("trustedUrl", lastTrustedUrl);
            Bundle webState = savedInstanceState.getBundle("webState");
            if (webState != null) restored = webView.restoreState(webState) != null;
        }
        if (!restored) webView.loadUrl(initialUrl);
    }

    private void buildViews() {
        root = new FrameLayout(this);
        root.setBackgroundColor(BACKGROUND);
        webView = new WebView(this);
        webView.setBackgroundColor(BACKGROUND);
        root.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setMax(100);
        progress.setProgressTintList(android.content.res.ColorStateList.valueOf(ACCENT));
        root.addView(progress, new FrameLayout.LayoutParams(-1, dp(3), Gravity.TOP));

        errorPanel = new LinearLayout(this);
        errorPanel.setOrientation(LinearLayout.VERTICAL);
        errorPanel.setGravity(Gravity.CENTER);
        errorPanel.setPadding(dp(28), dp(28), dp(28), dp(28));
        errorPanel.setBackgroundColor(BACKGROUND);
        TextView title = new TextView(this);
        title.setText("叙梦暂时无法连接");
        title.setTextColor(Color.WHITE);
        title.setTextSize(23);
        errorPanel.addView(title);
        errorText = new TextView(this);
        errorText.setTextColor(Color.rgb(190, 185, 199));
        errorText.setTextSize(15);
        errorText.setGravity(Gravity.CENTER);
        errorText.setPadding(0, dp(15), 0, dp(20));
        errorPanel.addView(errorText, new LinearLayout.LayoutParams(-1, -2));
        Button retry = new Button(this);
        retry.setText("重新连接");
        retry.setTextColor(Color.WHITE);
        retry.setBackgroundTintList(android.content.res.ColorStateList.valueOf(ACCENT));
        retry.setOnClickListener(v -> confirmUnsaved(() -> loadTrusted(lastTrustedUrl)));
        errorPanel.addView(retry, new LinearLayout.LayoutParams(-2, -2));
        errorPanel.setVisibility(View.GONE);
        root.addView(errorPanel, new FrameLayout.LayoutParams(-1, -1));
        fullscreen = new FrameLayout(this);
        fullscreen.setBackgroundColor(Color.BLACK);
        fullscreen.setVisibility(View.GONE);
        root.addView(fullscreen, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        if (Build.VERSION.SDK_INT >= 30) {
            root.setOnApplyWindowInsetsListener((v, insets) -> {
                android.graphics.Insets bars = insets.getInsets(
                        WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                android.graphics.Insets keyboard = insets.getInsets(WindowInsets.Type.ime());
                v.setPadding(bars.left, bars.top, bars.right,
                        Math.max(bars.bottom, keyboard.bottom));
                return WindowInsets.CONSUMED;
            });
            root.requestApplyInsets();
        }
    }

    /** Production is a native client. The WebView host remains only for the local fixture runner. */
    private void buildNativeCompose() {
        root = new FrameLayout(this);
        root.setBackgroundColor(BACKGROUND);
        shellCompose = new ComposeView(this);
        shellCompose.setBackgroundColor(BACKGROUND);
        root.addView(shellCompose, new FrameLayout.LayoutParams(-1, -1));
        fullscreen = new FrameLayout(this);
        fullscreen.setBackgroundColor(Color.BLACK);
        fullscreen.setVisibility(View.GONE);
        root.addView(fullscreen, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
    }

    /** Native shell keeps the same WebView slot, but Compose owns the window around it. */
    private void buildShellViews() {
        root = new FrameLayout(this);
        root.setBackgroundColor(BACKGROUND);
        webSlot = new FrameLayout(this);
        webSlot.setBackgroundColor(BACKGROUND);
        webView = new WebView(this);
        webView.setBackgroundColor(BACKGROUND);
        webSlot.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setMax(100);
        progress.setProgressTintList(android.content.res.ColorStateList.valueOf(ACCENT));
        webSlot.addView(progress, new FrameLayout.LayoutParams(-1, dp(3), Gravity.TOP));

        errorPanel = new LinearLayout(this);
        errorPanel.setOrientation(LinearLayout.VERTICAL);
        errorPanel.setGravity(Gravity.CENTER);
        errorPanel.setPadding(dp(28), dp(28), dp(28), dp(28));
        errorPanel.setBackgroundColor(BACKGROUND);
        TextView title = new TextView(this);
        title.setText("叙梦暂时无法连接");
        title.setTextColor(Color.WHITE);
        title.setTextSize(23);
        errorPanel.addView(title);
        errorText = new TextView(this);
        errorText.setTextColor(Color.rgb(190, 185, 199));
        errorText.setTextSize(15);
        errorText.setGravity(Gravity.CENTER);
        errorText.setPadding(0, dp(15), 0, dp(20));
        errorPanel.addView(errorText, new LinearLayout.LayoutParams(-1, -2));
        Button retry = new Button(this);
        retry.setText("重新连接");
        retry.setTextColor(Color.WHITE);
        retry.setBackgroundTintList(android.content.res.ColorStateList.valueOf(ACCENT));
        retry.setOnClickListener(v -> confirmUnsaved(() -> loadTrusted(lastTrustedUrl)));
        errorPanel.addView(retry, new LinearLayout.LayoutParams(-2, -2));
        errorPanel.setVisibility(View.GONE);
        webSlot.addView(errorPanel, new FrameLayout.LayoutParams(-1, -1));
        fullscreen = new FrameLayout(this);
        fullscreen.setBackgroundColor(Color.BLACK);
        fullscreen.setVisibility(View.GONE);
        shellCompose = new ComposeView(this);
        shellCompose.setBackgroundColor(BACKGROUND);
        root.addView(shellCompose, new FrameLayout.LayoutParams(-1, -1));
        root.addView(fullscreen, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
    }

    @SuppressWarnings("deprecation") private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSafeBrowsingEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setGeolocationEnabled(false);
        settings.setSupportMultipleWindows(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setUserAgentString(settings.getUserAgentString() + " XumengAndroid/" + BuildConfig.VERSION_NAME);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, false);
        webView.setWebViewClient(new HostClient());
        webView.setWebChromeClient(new HostChromeClient());
        webView.setDownloadListener((url, userAgent, disposition, mime, length) -> {
            if (!trustedPage()) { toast("只能从叙梦页面下载文件"); return; }
            if (NavigationPolicy.isTrustedBlob(url, BuildConfig.WEB_ORIGIN)) {
                // The normal path is the synchronous anchor hook; this covers direct blob navigation.
                requestNativeBlob(url);
            } else if (NavigationPolicy.isTrusted(url, BuildConfig.WEB_ORIGIN)) {
                beginHttpDownload(url, userAgent, disposition, mime, length);
            } else if (NavigationPolicy.isSafeExternal(url)) {
                openExternal(url);
            } else toast("此下载地址无法安全打开");
        });
    }

    private final class HostClient extends WebViewClient {
        @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            String url = request.getUrl().toString();
            if (!request.isForMainFrame()) {
                // Sandboxed game iframes may load their own HTTPS assets, but never native privileges.
                return !"https".equalsIgnoreCase(request.getUrl().getScheme())
                        && !NavigationPolicy.isTrusted(url, BuildConfig.WEB_ORIGIN)
                        && !url.startsWith("about:blank")
                        && !NavigationPolicy.isTrustedBlob(url, BuildConfig.WEB_ORIGIN);
            }
            return routeNavigation(url);
        }
        @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return routeNavigation(url);
        }
        @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
            pageGeneration++;
            approvedLeaveGeneration = -1;
            closeBridge(true);
            cancelFileChooser();
            backPending = false;
            if (!NavigationPolicy.isTrusted(url, BuildConfig.WEB_ORIGIN)) {
                view.stopLoading();
                showError("此地址不属于叙梦，请使用系统浏览器打开外部链接。");
                return;
            }
            lastTrustedUrl = url;
            errorPanel.setVisibility(View.GONE);
            progress.setVisibility(View.VISIBLE);
        }
        @Override public void onPageFinished(WebView view, String url) {
            progress.setVisibility(View.GONE);
            CookieManager.getInstance().flush();
            if (trustedPage() && NavigationPolicy.isTrusted(url, BuildConfig.WEB_ORIGIN)
                    && installedGeneration != pageGeneration) installBridge();
            if (nativeShell && view == webView) {
                shellModel().refreshSession();
                if (pendingShellEntry) {
                    pendingShellEntry = false;
                    int token = presentToken;
                    int generation = pageGeneration;
                    // The marker lives in this document. A hash replace on the previous document does not survive a load.
                    view.evaluateJavascript("window.__xumengShellLength=history.length;history.length",
                            value -> applyShellEntry(token, generation, value));
                }
            }
        }
        @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame()) showError("请检查网络后重试。登录状态会保留。");
        }
        @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
            if (request.isForMainFrame() && response.getStatusCode() >= 400)
                showError("服务暂时不可用（" + response.getStatusCode() + "），请稍后重试。");
        }
        @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
            handler.cancel();
            if (error.getUrl() != null && error.getUrl().equals(view.getUrl()))
                showError("安全证书验证未通过。连接已停止，请检查设备时间或稍后重试。");
            else toast("一个资源的安全证书验证未通过，已停止加载");
        }
        @Override public boolean onRenderProcessGone(WebView view, android.webkit.RenderProcessGoneDetail detail) {
            pageGeneration++;
            closeBridge(true);
            cancelFileChooser();
            detach(view);
            webView = null;
            view.destroy();
            // Recreate the Activity rather than reusing a WebView with a dead renderer.
            toast("页面进程已结束，正在恢复叙梦");
            recreate();
            return true;
        }
    }

    private final class HostChromeClient extends WebChromeClient {
        @Override public void onProgressChanged(WebView view, int value) {
            progress.setProgress(value);
            progress.setVisibility(value < 100 && errorPanel.getVisibility() != View.VISIBLE ? View.VISIBLE : View.GONE);
        }
        @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            cancelFileChooser();
            if (!trustedPage()) { callback.onReceiveValue(null); return true; }
            if (params.getMode() == FileChooserParams.MODE_SAVE) {
                callback.onReceiveValue(null);
                toast("请使用页面的导出按钮保存文件");
                return true;
            }
            fileCallback = callback;
            Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            picker.addCategory(Intent.CATEGORY_OPENABLE);
            picker.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            picker.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
            List<String> types = new ArrayList<>();
            for (String accept : params.getAcceptTypes()) {
                if (accept == null) continue;
                for (String raw : accept.split(",")) {
                    String type = raw.trim().toLowerCase(Locale.ROOT);
                    if (type.matches("[a-z0-9!#$&^_.+-]+/(?:[a-z0-9!#$&^_.+-]+|\\*)") && !types.contains(type)) types.add(type);
                    else if (type.startsWith(".")) {
                        String resolved = android.webkit.MimeTypeMap.getSingleton().getMimeTypeFromExtension(type.substring(1));
                        if (resolved != null && !types.contains(resolved)) types.add(resolved);
                    }
                }
            }
            picker.setType(types.size() == 1 ? types.get(0) : "*/*");
            if (types.size() > 1) picker.putExtra(Intent.EXTRA_MIME_TYPES, types.toArray(new String[0]));
            try { startActivityForResult(picker, FILE_PICKER); }
            catch (ActivityNotFoundException e) { cancelFileChooser(); toast("设备没有可用的文件选择器"); }
            return true;
        }
        @Override public void onPermissionRequest(PermissionRequest request) {
            // Current Xumeng calls only receive a character's streams; no local capture is needed.
            request.deny();
            if (trustedPage() && NavigationPolicy.isTrusted(request.getOrigin().toString(), BuildConfig.WEB_ORIGIN))
                toast("当前版本不支持采集本机音视频");
        }
        @Override public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
            callback.invoke(origin, false, false);
        }
        @Override public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
            if (!trustedDialog(url)) { result.cancel(); return true; }
            dismissDialog();
            activeDialog = new AlertDialog.Builder(MainActivity.this).setTitle("叙梦")
                    .setMessage(dialogText(message)).setPositiveButton("知道了", (d, w) -> result.confirm())
                    .setOnCancelListener(d -> result.cancel()).create();
            activeDialog.show();
            return true;
        }
        @Override public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
            return showJsConfirmation(url, message, result);
        }
        @Override public boolean onJsBeforeUnload(WebView view, String url, String message, JsResult result) {
            if (trustedDialog(url) && approvedLeaveGeneration == pageGeneration) {
                approvedLeaveGeneration = -1;
                result.confirm();
                return true;
            }
            return showJsConfirmation(url, "当前内容可能尚未保存，确定离开吗？", result);
        }
        @Override public boolean onJsPrompt(WebView view, String url, String message, String value, JsPromptResult result) {
            if (!trustedDialog(url)) { result.cancel(); return true; }
            dismissDialog();
            EditText input = new EditText(MainActivity.this);
            input.setSingleLine(false);
            input.setText(value == null ? "" : value);
            activeDialog = new AlertDialog.Builder(MainActivity.this).setTitle("叙梦")
                    .setMessage(dialogText(message)).setView(input)
                    .setPositiveButton("确定", (d, w) -> result.confirm(input.getText().toString()))
                    .setNegativeButton("取消", (d, w) -> result.cancel())
                    .setOnCancelListener(d -> result.cancel()).create();
            activeDialog.show();
            return true;
        }
        @Override public void onShowCustomView(View view, CustomViewCallback callback) {
            if (customView != null || !trustedPage()) { callback.onCustomViewHidden(); return; }
            customView = view;
            customViewCallback = callback;
            fullscreen.addView(view, new FrameLayout.LayoutParams(-1, -1));
            fullscreen.setVisibility(View.VISIBLE);
            webView.setVisibility(View.INVISIBLE);
            if (Build.VERSION.SDK_INT >= 30) {
                WindowInsetsController controller = getWindow().getInsetsController();
                if (controller != null) {
                    controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                    controller.hide(WindowInsets.Type.systemBars());
                }
            } else getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        }
        @Override public void onHideCustomView() { hideFullscreen(); }
        @Override public boolean onCreateWindow(WebView view, boolean isDialog, boolean userGesture, android.os.Message result) {
            if (!trustedPage() || !userGesture) return false;
            // This unattached view intercepts its first URL before loading any remote document.
            WebView popup = new WebView(MainActivity.this);
            popupViews.add(popup);
            popup.getSettings().setJavaScriptEnabled(false);
            popup.getSettings().setAllowFileAccess(false);
            popup.getSettings().setAllowContentAccess(false);
            popup.setWebViewClient(new WebViewClient() {
                private boolean handled;
                private boolean dispatch(String url) {
                    if (url == null || url.equals("about:blank")) return false;
                    if (!handled) {
                        handled = true;
                        main.post(() -> { if (!destroyed) routePopup(url); disposePopup(popup); });
                    }
                    return true;
                }
                @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) { return dispatch(r.getUrl().toString()); }
                @Override public boolean shouldOverrideUrlLoading(WebView v, String url) { return dispatch(url); }
                @Override public void onPageStarted(WebView v, String url, android.graphics.Bitmap icon) {
                    if (!"about:blank".equals(url)) { v.stopLoading(); dispatch(url); }
                }
            });
            ((WebView.WebViewTransport) result.obj).setWebView(popup);
            result.sendToTarget();
            main.postDelayed(() -> disposePopup(popup), 30_000);
            return true;
        }
    }

    private boolean routeNavigation(String url) {
        if (NavigationPolicy.isTrusted(url, BuildConfig.WEB_ORIGIN)) return false;
        if (trustedPage() && NavigationPolicy.isTrustedBlob(url, BuildConfig.WEB_ORIGIN)) {
            requestNativeBlob(url);
        } else if (NavigationPolicy.isSafeExternal(url)) openExternal(url);
        else toast("此链接无法安全打开");
        return true;
    }

    private void routePopup(String url) {
        if (!trustedPage()) return;
        if (NavigationPolicy.isTrusted(url, BuildConfig.WEB_ORIGIN)) confirmUnsaved(() -> loadTrusted(url));
        else routeNavigation(url);
    }

    private void openExternal(String url) {
        if (!NavigationPolicy.isSafeExternal(url)) { toast("此链接无法安全打开"); return; }
        Intent browser = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        browser.addCategory(Intent.CATEGORY_BROWSABLE);
        Intent chooser = Intent.createChooser(browser, "使用浏览器或其他应用打开");
        // App links may resolve to our own singleTask Activity; exclude it from the chooser.
        chooser.putExtra(Intent.EXTRA_EXCLUDE_COMPONENTS,
                new ComponentName[]{new ComponentName(this, MainActivity.class)});
        try { startActivity(chooser); }
        catch (ActivityNotFoundException e) { toast("设备没有可用的浏览器或应用"); }
    }

    private void disposePopup(WebView popup) {
        if (popupViews.remove(popup)) { popup.stopLoading(); popup.destroy(); }
    }

    private String trustedIntentUrl(Intent intent) {
        if (intent != null && Intent.ACTION_VIEW.equals(intent.getAction()) && intent.getData() != null) {
            String url = intent.getData().toString();
            if (NavigationPolicy.isTrusted(url, BuildConfig.WEB_ORIGIN)) return url;
        }
        return BuildConfig.WEB_ORIGIN + "/";
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String url = trustedIntentUrl(intent);
        if (intent != null && Intent.ACTION_VIEW.equals(intent.getAction()) && intent.getData() != null
                && NavigationPolicy.isTrusted(intent.getData().toString(), BuildConfig.WEB_ORIGIN)) {
            if (nativeShell) confirmUnsaved(() -> shellModel().applyExternalUrl(url));
            else confirmUnsaved(() -> loadTrusted(url));
        }
    }

    // API 33+ uses the registered OnBackInvokedCallback; this override supports API 26-32.
    // ComponentActivity marks onBackPressed @CallSuper, but super dispatches to AndroidX and can finish
    // the activity before the WebView history check. Back stays in handleBack.
    @SuppressLint({"GestureBackNavigation", "MissingSuperCall"})
    @Override public void onBackPressed() { handleBack(); }

    private void handleBack() {
        if (customView != null) { hideFullscreen(); return; }
        if (keyboardVisible()) { hideKeyboard(); return; }
        if (nativeShell) {
            if (shellModel().getThreadOpen()) {
                top.xumeng.app.feature.chat.ChatViewModel chat = new ViewModelProvider(this).get(top.xumeng.app.feature.chat.ChatViewModel.class);
                if (chat.backFromThread()) return;
            }
            finish();
            return;
        }
        if (webView == null) { finish(); return; }
        confirmUnsaved(this::navigateBackOrFinish);
    }

    private void navigateBackOrFinish() {
        if (nativeShell) { shellBack(); return; }
        if (destroyed || webView == null) return;
        if (webView.canGoBack()) { webView.goBack(); return; }
        if (!trustedPage()) { finish(); return; }
        WebView view = webView;
        int generation = pageGeneration;
        backPending = true;
        // Chromium's same-document history can advance before WebView's native
        // history list catches up. Preserve hash routes through the page's history.
        view.evaluateJavascript("(()=>{try{if(window!==top)return null;const n=window.navigation;"
                + "if(n&&typeof n.canGoBack==='boolean')return n.canGoBack;"
                + "if(location.hash===''||location.hash==='#characters')return false;"
                + "return history.length>1;}catch(_){return null;}})()", answer -> {
            if (destroyed || webView != view || generation != pageGeneration) return;
            if (!trustedPage()) { backPending = false; return; }
            if ("true".equals(answer)) {
                view.evaluateJavascript("history.back()", ignored -> {
                    if (!destroyed && webView == view && generation == pageGeneration && trustedPage())
                        backPending = false;
                });
            } else if ("false".equals(answer)) {
                backPending = false;
                finish();
            } else {
                backPending = false;
                toast("暂时无法读取页面返回状态，请重试");
            }
        });
    }

    private boolean keyboardVisible() {
        if (Build.VERSION.SDK_INT >= 30 && root.getRootWindowInsets() != null)
            return root.getRootWindowInsets().isVisible(WindowInsets.Type.ime());
        Rect visible = new Rect();
        getWindow().getDecorView().getWindowVisibleDisplayFrame(visible);
        return getWindow().getDecorView().getHeight() - visible.bottom > dp(180);
    }

    private void confirmUnsaved(Runnable action) {
        if (destroyed || backPending) return;
        // A paused, detached page cannot answer beforeunload. The visible native screen has no draft of its own.
        if (nativeShell && (webSlot == null || !webSlot.isAttachedToWindow())) { action.run(); return; }
        if (!trustedPage()) { action.run(); return; }
        backPending = true;
        int generation = pageGeneration;
        // Generic Event is constructible on all supported WebViews. returnValue="" is
        // coerced to false, so both existing preventDefault and returnValue guards work.
        webView.evaluateJavascript("(()=>{try{const e=new Event('beforeunload',{cancelable:true});"
                + "window.dispatchEvent(e);return e.defaultPrevented||e.returnValue===false"
                + "||(typeof e.returnValue==='string');}catch(_){return true;}})()", answer -> {
            if (destroyed || generation != pageGeneration) { backPending = false; return; }
            if ("false".equals(answer)) { backPending = false; action.run(); return; }
            dismissDialog();
            activeDialog = new AlertDialog.Builder(this).setTitle("离开当前页面？")
                    .setMessage("当前内容可能尚未保存，或仍在处理中。离开后可能丢失尚未保存的改动。")
                    .setPositiveButton("离开", (d, w) -> {
                        backPending = false;
                        if (generation == pageGeneration) {
                            approvedLeaveGeneration = generation;
                            main.postDelayed(() -> { if (approvedLeaveGeneration == generation) approvedLeaveGeneration = -1; }, 1500);
                            action.run();
                        }
                    })
                    .setNegativeButton("继续编辑", (d, w) -> backPending = false)
                    .setOnCancelListener(d -> backPending = false).create();
            activeDialog.show();
        });
    }

    private boolean showJsConfirmation(String url, String message, JsResult result) {
        if (!trustedDialog(url)) { result.cancel(); return true; }
        dismissDialog();
        activeDialog = new AlertDialog.Builder(this).setTitle("叙梦").setMessage(dialogText(message))
                .setPositiveButton("确定", (d, w) -> result.confirm())
                .setNegativeButton("取消", (d, w) -> result.cancel())
                .setOnCancelListener(d -> result.cancel()).create();
        activeDialog.show();
        return true;
    }

    private boolean trustedDialog(String url) { return trustedPage() && NavigationPolicy.isTrusted(url, BuildConfig.WEB_ORIGIN); }
    private boolean trustedPage() { return !destroyed && webView != null && NavigationPolicy.isTrusted(webView.getUrl(), BuildConfig.WEB_ORIGIN); }
    private String dialogText(String text) { return text == null ? "" : text.substring(0, Math.min(text.length(), 2000)); }
    private void dismissDialog() { if (activeDialog != null) { activeDialog.cancel(); activeDialog = null; } }
    private int dp(int pixels) { return Math.round(pixels * getResources().getDisplayMetrics().density); }
    private void toast(String message) { if (!destroyed) Toast.makeText(this, message, Toast.LENGTH_LONG).show(); }
    private void loadTrusted(String url) { if (!destroyed && webView != null && NavigationPolicy.isTrusted(url, BuildConfig.WEB_ORIGIN)) webView.loadUrl(url); }
    private void showError(String text) { progress.setVisibility(View.GONE); errorText.setText(text); errorPanel.setVisibility(View.VISIBLE); }

    private void hideFullscreen() {
        if (customView == null) return;
        fullscreen.removeAllViews();
        fullscreen.setVisibility(View.GONE);
        customView = null;
        if (webView != null) webView.setVisibility(View.VISIBLE);
        if (customViewCallback != null) { customViewCallback.onCustomViewHidden(); customViewCallback = null; }
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) controller.show(WindowInsets.Type.systemBars());
        } else getWindow().getDecorView().setSystemUiVisibility(0);
        root.requestApplyInsets();
    }

    /** The control channel is delivered only to the exact trusted top-level origin. */
    private void installBridge() {
        if (!trustedPage()) return;
        installedGeneration = pageGeneration;
        bridgeToken = UUID.randomUUID().toString();
        int generation = pageGeneration;
        String token = bridgeToken;
        WebMessagePort[] channel = webView.createWebMessageChannel();
        controlPort = channel[0];
        controlPort.setWebMessageCallback(new WebMessagePort.WebMessageCallback() {
            @Override public void onMessage(WebMessagePort port, WebMessage message) {
                if (generation != pageGeneration || !trustedPage() || port != controlPort) return;
                String data = message.getData();
                if (data == null || data.length() > 8000) return;
                try {
                    JSONObject event = new JSONObject(data);
                    if ("blob".equals(event.optString("type"))) beginBlobDownload(event, generation);
                    else if ("problem".equals(event.optString("type"))) toast("导出读取失败，请重试");
                    else if ("blocked".equals(event.optString("type"))) toast("此链接无法安全打开");
                } catch (JSONException ignored) { /* Reject malformed messages without exposing internals. */ }
            }
        }, main);
        String origin = JSONObject.quote(BuildConfig.WEB_ORIGIN);
        String quotedToken = JSONObject.quote(token);
        String script = """
                (()=>{
                  const ORIGIN=new URL(__ORIGIN__).origin,TOKEN=__TOKEN__,CHUNK=196608,MAX=52428800;
                  if(window!==top||location.origin!==ORIGIN)return false;
                  let control=null,queue=[],serial=0;
                  const blobs=new Map(),pending=new Map();
                  const send=data=>{if(control)control.postMessage(JSON.stringify(data));else queue.push(data)};
                  const originalCreate=URL.createObjectURL.bind(URL),originalRevoke=URL.revokeObjectURL.bind(URL);
                  URL.createObjectURL=function(value){const url=originalCreate(value);if(value instanceof Blob)blobs.set(url,value);return url};
                  URL.revokeObjectURL=function(url){blobs.delete(String(url));return originalRevoke(url)};
                  const exportBlob=(url,name)=>{
                    if(window!==top||location.origin!==ORIGIN||!url.startsWith('blob:'+ORIGIN+'/'))return false;
                    const id=TOKEN+':'+(++serial),known=blobs.get(url);
                    // Start fetch synchronously so an immediate revokeObjectURL cannot win the race.
                    const reading=known?Promise.resolve(known):fetch(url).then(r=>{if(!r.ok)throw Error();return r.blob()});
                    reading.then(blob=>{
                      if(blob.size>MAX){send({type:'blob',id,name:name||'叙梦导出',mime:blob.type,size:blob.size});return}
                      pending.set(id,blob);send({type:'blob',id,name:name||'叙梦导出',mime:blob.type,size:blob.size});
                      setTimeout(()=>pending.delete(id),120000);
                    }).catch(()=>send({type:'problem'}));
                    return true;
                  };
                  window.addEventListener('xumeng-native-blob-'+TOKEN,event=>{
                    const data=event.detail;if(data&&typeof data.url==='string')exportBlob(data.url,'叙梦导出');
                  });
                  const blocked=url=>/^(?:javascript|data|file|content|intent):/i.test(url);
                  const handle=a=>{
                    if(!(a instanceof HTMLAnchorElement))return false;
                    if(blocked(a.href)){send({type:'blocked'});return true}
                    return exportBlob(a.href,a.download);
                  };
                  document.addEventListener('click',event=>{
                    const a=event.composedPath().find(v=>v instanceof HTMLAnchorElement);
                    if(a&&handle(a)){event.preventDefault();event.stopImmediatePropagation()}
                  },true);
                  const originalClick=HTMLAnchorElement.prototype.click;
                  HTMLAnchorElement.prototype.click=function(){if(!handle(this))return originalClick.call(this)};
                  const originalOpen=window.open;
                  window.open=function(url,...args){
                    if(url!=null){try{const resolved=new URL(String(url),location.href).href;if(blocked(resolved)){send({type:'blocked'});return null}if(exportBlob(resolved,'叙梦导出'))return null}catch(_){}}
                    return originalOpen.call(window,url,...args);
                  };
                  const reader=blob=>new Promise((resolve,reject)=>{
                    const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=reject;r.readAsDataURL(blob);
                  });
                  window.addEventListener('message',event=>{
                    if(window!==top||location.origin!==ORIGIN||event.ports.length!==1)return;
                    // Android's native postWebMessage targets the origin; its event origin may be empty.
                    if(event.origin&&event.origin!=='null'&&event.origin!==ORIGIN)return;
                    let data;try{data=JSON.parse(event.data)}catch(_){return}
                    if(data.token!==TOKEN)return;
                    const port=event.ports[0];
                    if(data.type==='bind'&&!control){
                      control=port;control.onmessage=e=>{try{const d=JSON.parse(e.data);if(d.type==='cancel')pending.delete(d.id)}catch(_){}};
                      queue.splice(0).forEach(send);return;
                    }
                    if(data.type!=='stream'||!pending.has(data.id)){port.close();return}
                    const blob=pending.get(data.id);pending.delete(data.id);
                    (async()=>{
                      let index=0,ack=null;
                      port.onmessage=e=>{try{const d=JSON.parse(e.data);if(ack&&d.type==='ack'&&d.index===index)ack()}catch(_){}};
                      for(let offset=0;offset<blob.size;offset+=CHUNK){
                        const payload=await reader(blob.slice(offset,Math.min(offset+CHUNK,blob.size)));
                        await new Promise((resolve,reject)=>{
                          const timeout=setTimeout(()=>reject(Error('timeout')),20000);
                          ack=()=>{clearTimeout(timeout);ack=null;resolve()};
                          port.postMessage(JSON.stringify({type:'chunk',index,data:payload}));
                        });index++;
                      }
                      port.postMessage(JSON.stringify({type:'done',index}));
                    })().catch(()=>{try{port.postMessage(JSON.stringify({type:'error'}))}catch(_){}}).finally(()=>port.close());
                  });
                  return true;
                })()
                """.replace("__ORIGIN__", origin).replace("__TOKEN__", quotedToken);
        webView.evaluateJavascript(script, result -> {
            if (destroyed || generation != pageGeneration || !trustedPage()) { closePort(channel[1]); return; }
            if (!"true".equals(result)) { closeBridge(false); closePort(channel[1]); return; }
            try {
                webView.postWebMessage(new WebMessage("{\"type\":\"bind\",\"token\":" + quotedToken + "}",
                        new WebMessagePort[]{channel[1]}), Uri.parse(BuildConfig.WEB_ORIGIN));
                bridgeReady = true;
            } catch (RuntimeException e) { closeBridge(false); closePort(channel[1]); }
        });
    }

    private void requestNativeBlob(String url) {
        if (!trustedPage() || !bridgeReady || bridgeToken == null) {
            toast("页面仍在准备导出，请加载完成后重试");
            return;
        }
        // Dispatch directly to the closure's export handler; a synthetic anchor could
        // recursively re-enter DownloadListener if a page replaced its click method.
        webView.evaluateJavascript("window.dispatchEvent(new CustomEvent("
                + JSONObject.quote("xumeng-native-blob-" + bridgeToken)
                + ",{detail:{url:" + JSONObject.quote(url) + "}}))", null);
    }

    private void beginBlobDownload(JSONObject event, int generation) {
        String id = event.optString("id", "");
        long size = event.optLong("size", -1);
        if (bridgeToken == null || !id.startsWith(bridgeToken + ":") || id.length() > 100 || size < 0) return;
        if (size > MAX_DOWNLOAD_BYTES) { cancelJsBlob(id); toast("文件超过 50 MiB，请在系统浏览器打开叙梦后导出"); return; }
        if (pendingSave != null) { cancelJsBlob(id); toast("请先完成当前文件的保存"); return; }
        PendingSave save;
        try {
            save = new PendingSave(File.createTempFile("xumeng-export-", ".tmp", getCacheDir()),
                    NavigationPolicy.safeFileName(event.optString("name"), "叙梦导出.json"),
                    cleanMimeType(event.optString("mime")), true, generation);
            save.expectedBytes = size;
            save.output = new FileOutputStream(save.file);
        } catch (IOException e) { cancelJsBlob(id); toast("没有足够的存储空间导出文件"); return; }
        pendingSave = save;
        toast("正在准备导出文件…");
        WebMessagePort[] channel = webView.createWebMessageChannel();
        streamPort = channel[0];
        save.port = streamPort;
        streamPort.setWebMessageCallback(new WebMessagePort.WebMessageCallback() {
            @Override public void onMessage(WebMessagePort port, WebMessage message) {
                if (save != pendingSave || generation != pageGeneration || !trustedPage()) return;
                String data = message.getData();
                if (data == null || data.length() > BLOB_CHUNK_BYTES * 4 / 3 + 512) { failTransfer(save, "导出数据无效，请重试"); return; }
                executeTransfer(() -> acceptBlobChunk(save, data));
            }
        }, main);
        try {
            webView.postWebMessage(new WebMessage("{\"type\":\"stream\",\"token\":" + JSONObject.quote(bridgeToken)
                    + ",\"id\":" + JSONObject.quote(id) + "}", new WebMessagePort[]{channel[1]}), Uri.parse(BuildConfig.WEB_ORIGIN));
        } catch (RuntimeException e) { closePort(channel[1]); failTransfer(save, "导出通道创建失败，请重试"); }
        main.postDelayed(() -> { if (pendingSave == save && !save.ready) failTransfer(save, "导出超时，请重试"); }, 120_000);
    }

    private void acceptBlobChunk(PendingSave save, String payload) {
        if (pendingSave != save || destroyed) return;
        try {
            JSONObject chunk = new JSONObject(payload);
            String type = chunk.optString("type");
            if ("chunk".equals(type)) {
                if (chunk.optInt("index", -1) != save.chunkIndex) throw new IOException();
                String encoded = chunk.getString("data");
                if (!encoded.matches("[A-Za-z0-9+/]*={0,2}")) throw new IOException();
                byte[] data = Base64.decode(encoded, Base64.NO_WRAP);
                if (data.length == 0 || data.length > BLOB_CHUNK_BYTES
                        || save.bytes + data.length > save.expectedBytes || save.bytes + data.length > MAX_DOWNLOAD_BYTES) throw new IOException();
                save.output.write(data);
                save.bytes += data.length;
                int acknowledged = save.chunkIndex++;
                main.post(() -> {
                    if (pendingSave == save && !destroyed && save.generation == pageGeneration && trustedPage()) {
                        try { save.port.postMessage(new WebMessage("{\"type\":\"ack\",\"index\":" + acknowledged + "}")); }
                        catch (RuntimeException e) { failTransfer(save, "导出通道已关闭，请重试"); }
                    }
                });
            } else if ("done".equals(type)) {
                if (chunk.optInt("index", -1) != save.chunkIndex || save.bytes != save.expectedBytes) throw new IOException();
                save.output.close(); save.output = null;
                save.ready = true;
                main.post(() -> { if (pendingSave == save && !destroyed) { closeStreamPort(); chooseSaveDestination(save); } });
            } else throw new IOException();
        } catch (IOException | JSONException | IllegalArgumentException e) {
            main.post(() -> failTransfer(save, "导出未完成，请重试"));
        }
    }

    private void cancelJsBlob(String id) {
        if (controlPort != null) {
            try { controlPort.postMessage(new WebMessage("{\"type\":\"cancel\",\"id\":" + JSONObject.quote(id) + "}")); }
            catch (RuntimeException ignored) { }
        }
    }

    /** Fetch manually: a redirect receives cookies only after its origin was checked. */
    private void beginHttpDownload(String url, String userAgent, String disposition, String mime, long length) {
        if (pendingSave != null) { toast("请先完成当前文件的保存"); return; }
        if (length > MAX_DOWNLOAD_BYTES) { offerLargeDownload(url); return; }
        PendingSave save;
        try {
            save = new PendingSave(File.createTempFile("xumeng-download-", ".tmp", getCacheDir()),
                    NavigationPolicy.safeFileName(URLUtil.guessFileName(url, disposition, mime), "叙梦下载"),
                    cleanMimeType(mime), false, pageGeneration);
        } catch (IOException e) { toast("没有足够的存储空间下载文件"); return; }
        pendingSave = save;
        toast("正在下载，完成后请选择保存位置…");
        String agent = userAgent == null ? webView.getSettings().getUserAgentString() : userAgent;
        executeTransfer(() -> {
            HttpURLConnection connection = null;
            try {
                String current = url;
                for (int redirects = 0; ; redirects++) {
                    if (pendingSave != save || destroyed) throw new IOException();
                    if (!NavigationPolicy.isTrusted(current, BuildConfig.WEB_ORIGIN)) throw new UnsafeRedirectException();
                    connection = (HttpURLConnection) new URL(current).openConnection();
                    connection.setInstanceFollowRedirects(false);
                    connection.setConnectTimeout(20_000);
                    connection.setReadTimeout(30_000);
                    connection.setRequestProperty("User-Agent", agent);
                    connection.setRequestProperty("Accept-Encoding", "identity");
                    connection.setRequestProperty("Referer", BuildConfig.WEB_ORIGIN + "/");
                    String cookies = CookieManager.getInstance().getCookie(current);
                    if (cookies != null && !cookies.isEmpty()) connection.setRequestProperty("Cookie", cookies);
                    int status = connection.getResponseCode();
                    if (status == 301 || status == 302 || status == 303 || status == 307 || status == 308) {
                        String location = connection.getHeaderField("Location");
                        if (location == null || redirects >= 5) throw new IOException();
                        String next = new URL(new URL(current), location).toString();
                        connection.disconnect(); connection = null;
                        if (!NavigationPolicy.isTrusted(next, BuildConfig.WEB_ORIGIN)) throw new UnsafeRedirectException();
                        current = next;
                        continue;
                    }
                    if (status < 200 || status >= 300) throw new IOException();
                    long declared = connection.getContentLengthLong();
                    if (declared > MAX_DOWNLOAD_BYTES) throw new TooLargeException();
                    String responseType = cleanMimeType(connection.getContentType());
                    save.mime = responseType;
                    save.name = NavigationPolicy.safeFileName(URLUtil.guessFileName(current,
                            connection.getHeaderField("Content-Disposition"), responseType), save.name);
                    try (InputStream input = connection.getInputStream(); OutputStream output = new FileOutputStream(save.file)) {
                        byte[] buffer = new byte[32 * 1024];
                        int count;
                        while ((count = input.read(buffer)) != -1) {
                            if (pendingSave != save || destroyed) throw new IOException();
                            save.bytes += count;
                            if (save.bytes > MAX_DOWNLOAD_BYTES) throw new TooLargeException();
                            output.write(buffer, 0, count);
                        }
                    }
                    if (declared >= 0 && save.bytes != declared) throw new IOException();
                    save.ready = true;
                    main.post(() -> { if (!destroyed && pendingSave == save) chooseSaveDestination(save); });
                    break;
                }
            } catch (TooLargeException e) {
                main.post(() -> { failTransfer(save, null); if (!destroyed) offerLargeDownload(url); });
            } catch (UnsafeRedirectException e) {
                main.post(() -> failTransfer(save, "下载跳转到了外部站点，已停止。请使用系统浏览器下载。"));
            } catch (IOException | RuntimeException e) {
                main.post(() -> failTransfer(save, "下载失败，请检查网络或剩余存储空间后重试"));
            } finally { if (connection != null) connection.disconnect(); }
        });
    }

    private void offerLargeDownload(String url) {
        if (destroyed) return;
        dismissDialog();
        activeDialog = new AlertDialog.Builder(this).setTitle("文件超过 50 MiB")
                .setMessage("当前版本支持保存最多 50 MiB 的文件。可使用系统浏览器下载；浏览器可能需要重新登录叙梦。")
                .setPositiveButton("打开浏览器", (d, w) -> openExternal(url))
                .setNegativeButton("取消", null).create();
        activeDialog.show();
    }

    private void chooseSaveDestination(PendingSave save) {
        if (destroyed || pendingSave != save || !save.ready) return;
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(save.mime);
        intent.putExtra(Intent.EXTRA_TITLE, save.name);
        intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        try { startActivityForResult(intent, FILE_SAVE); }
        catch (ActivityNotFoundException e) { failTransfer(save, "设备没有可用的文件保存器"); }
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_PICKER) {
            ValueCallback<Uri[]> callback = fileCallback;
            fileCallback = null;
            if (callback == null) return;
            List<Uri> files = new ArrayList<>();
            if (resultCode == RESULT_OK && data != null && trustedPage()) {
                ClipData clips = data.getClipData();
                if (clips != null) for (int i = 0; i < Math.min(clips.getItemCount(), 100); i++) addContentUri(files, clips.getItemAt(i).getUri());
                else addContentUri(files, data.getData());
            }
            callback.onReceiveValue(files.isEmpty() ? null : files.toArray(new Uri[0]));
        } else if (requestCode == FILE_SAVE) {
            PendingSave save = pendingSave;
            if (save == null || !save.ready) return;
            Uri destination = data == null ? null : data.getData();
            if (resultCode != RESULT_OK || destination == null || !"content".equals(destination.getScheme())) {
                failTransfer(save, "已取消保存"); return;
            }
            executeTransfer(() -> {
                try (InputStream input = new FileInputStream(save.file); OutputStream output = getContentResolver().openOutputStream(destination, "w")) {
                    if (output == null) throw new IOException();
                    byte[] buffer = new byte[32 * 1024];
                    int count;
                    while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                    output.flush();
                    main.post(() -> finishTransfer(save, "已保存：" + save.name));
                } catch (IOException | RuntimeException e) {
                    main.post(() -> failTransfer(save, "保存失败，请检查剩余空间并重新导出"));
                }
            });
        }
    }

    private void addContentUri(List<Uri> files, Uri uri) { if (uri != null && "content".equals(uri.getScheme()) && !files.contains(uri)) files.add(uri); }
    private void cancelFileChooser() { if (fileCallback != null) { fileCallback.onReceiveValue(null); fileCallback = null; } }

    private void finishTransfer(PendingSave save, String message) {
        if (pendingSave != save) return;
        pendingSave = null;
        if (save.blob) closeStreamPort();
        executeTransfer(() -> cleanupSave(save));
        if (message != null) toast(message);
    }

    private void failTransfer(PendingSave save, String message) { finishTransfer(save, message); }
    private void cleanupSave(PendingSave save) {
        if (save.output != null) { try { save.output.close(); } catch (IOException ignored) { } save.output = null; }
        save.file.delete();
    }
    private void executeTransfer(Runnable work) { try { transfers.execute(work); } catch (RejectedExecutionException ignored) { } }
    private void closePort(WebMessagePort port) { if (port != null) try { port.close(); } catch (RuntimeException ignored) { } }
    private void closeStreamPort() { closePort(streamPort); streamPort = null; }
    private void closeBridge(boolean cancelIncompleteBlob) {
        closePort(controlPort); controlPort = null;
        closeStreamPort();
        bridgeToken = null;
        bridgeReady = false;
        PendingSave save = pendingSave;
        if (cancelIncompleteBlob && save != null && save.blob && !save.ready) finishTransfer(save, null);
    }

    private String cleanMimeType(String input) {
        return NavigationPolicy.safeMimeType(input == null ? null : input.split(";", 2)[0].trim());
    }

    @Override protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        if (trustedPage()) {
            out.putString("trustedUrl", webView.getUrl());
            Bundle state = new Bundle();
            webView.saveState(state);
            out.putBundle("webState", state);
        }
    }
    @Override protected void onPause() {
        super.onPause();
        if (webView != null) webView.onPause();
        CookieManager.getInstance().flush();
    }
    @Override protected void onResume() {
        super.onResume();
        if (webView != null && webSlotVisible()) webView.onResume();
    }
    @Override protected void onDestroy() {
        destroyed = true;
        dismissDialog();
        cancelFileChooser();
        closeBridge(true);
        PendingSave save = pendingSave;
        if (save != null) { pendingSave = null; executeTransfer(() -> cleanupSave(save)); }
        if (Build.VERSION.SDK_INT >= 33 && backCallback != null)
            getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(backCallback);
        if (webView != null) { detach(webView); webView.stopLoading(); webView.destroy(); }
        for (WebView popup : new ArrayList<>(popupViews)) disposePopup(popup);
        main.removeCallbacksAndMessages(null);
        transfers.shutdown();
        super.onDestroy();
    }

    public View acquireWebSlot() {
        detach(webSlot);
        main.post(this::syncWebVisibility);
        return webSlot;
    }

    public void releaseWebSlot(View slot) {
        detach(slot);
        main.post(this::syncWebVisibility);
    }

    /** Tab changes can release and reattach the slot in one frame. Decide after both have run. */
    private void syncWebVisibility() {
        if (destroyed || webView == null) return;
        if (webSlot != null && webSlot.isAttachedToWindow()) webView.onResume();
        else webView.onPause();
    }

    public void requestLeave(Runnable action) { confirmUnsaved(action); }

    public String consumeLaunchUrl() {
        String url = launchUrl;
        launchUrl = null;
        return url;
    }

    /** Opens a trusted site URL without stacking a different tab underneath it. */
    public void presentWeb(String url) {
        if (destroyed || webView == null || !nativeShell) return;
        if (!NavigationPolicy.isTrusted(url, BuildConfig.WEB_ORIGIN)) return;
        if (!isCurrentWebTarget(url)) return;
        webView.onResume();
        String current = webView.getUrl();
        if (current != null && WebRoutes.INSTANCE.shouldKeepCurrent(current, url)) return;
        int token = ++presentToken;
        if (current == null || "about:blank".equals(current) || !NavigationPolicy.isTrusted(current, BuildConfig.WEB_ORIGIN)) {
            pendingShellEntry = true;
            loadTrusted(url);
            return;
        }
        if (sameWebTarget(current, url)) {
            captureShellEntry(token, pageGeneration);
            return;
        }
        pendingShellEntry = true;
        int seen = pageGeneration;
        String script = "(()=>{const target=" + JSONObject.quote(url) + ";try{if(location.href!==target)location.replace(target)}catch(e){}"
                + "const ready=location.href===target;if(ready)window.__xumengShellLength=history.length;return [history.length,ready];})()";
        webView.evaluateJavascript(script, value -> applyReplaceResult(token, seen, value));
    }

    private void shellBack() {
        ShellViewModel model = shellModel();
        if (destroyed) return;
        if (webView == null || !trustedPage()) {
            if (model.getOverlayUrl() != null) model.closeOverlay();
            else finish();
            return;
        }
        WebView view = webView;
        int generation = pageGeneration;
        backPending = true;
        view.evaluateJavascript("(()=>{try{const mark=window.__xumengShellLength;const length=history.length;"
                + "if(typeof mark==='number'&&length>mark)return 'back';"
                + "if(typeof mark!=='number'&&length>" + shellEntryLength + ")return 'back';"
                + "return 'leave';}catch(e){return 'unknown';}})()", answer -> {
            if (destroyed || webView != view || generation != pageGeneration) return;
            if ("\"back\"".equals(answer)) {
                view.evaluateJavascript("history.back()", ignored -> {
                    if (!destroyed && webView == view && generation == pageGeneration) backPending = false;
                });
                return;
            }
            if (!"\"leave\"".equals(answer)) {
                backPending = false;
                toast("暂时无法读取页面返回状态，请重试");
                return;
            }
            backPending = false;
            if (model.getOverlayUrl() != null) model.closeOverlay();
            else finish();
        });
    }

    private boolean shellShowsWeb() {
        ShellViewModel model = shellModel();
        return model.getOverlayUrl() != null || model.getTab() == ShellTab.CHAT || model.getTab() == ShellTab.PROFILE;
    }

    private boolean isCurrentWebTarget(String url) {
        ShellViewModel model = shellModel();
        String overlay = model.getOverlayUrl();
        if (overlay != null) return overlay.equals(url);
        if (model.getTab() == ShellTab.CHAT) return url.equals(model.getChatUrl());
        if (model.getTab() == ShellTab.PROFILE) return url.equals(model.getProfileUrl());
        return false;
    }

    private void captureShellEntry(int token, int generation) {
        if (webView == null) return;
        webView.evaluateJavascript("window.__xumengShellLength=history.length;history.length",
                value -> applyShellEntry(token, generation, value));
    }

    private void applyReplaceResult(int token, int seen, String value) {
        if (destroyed || token != presentToken || seen != pageGeneration) return;
        // [length,false] means replace started a real load. The new document marks itself in onPageFinished.
        if (value == null || !value.endsWith("true]")) return;
        int comma = value.indexOf(',');
        if (comma < 2) return;
        pendingShellEntry = false;
        applyShellEntry(token, seen, value.substring(1, comma));
    }

    private void applyShellEntry(int token, int generation, String value) {
        if (destroyed || token != presentToken || generation != pageGeneration) return;
        int parsed = parseJsInt(value, -1);
        if (parsed >= 1) shellEntryLength = parsed;
    }

    private int parseJsInt(String value, int fallback) {
        if (value == null) return fallback;
        try { return Integer.parseInt(value.trim()); }
        catch (NumberFormatException error) { return fallback; }
    }

    private boolean sameWebTarget(String current, String target) {
        try {
            java.net.URI left = new java.net.URI(current);
            java.net.URI right = new java.net.URI(target);
            String leftPath = left.getPath() == null || left.getPath().isEmpty() ? "/" : left.getPath();
            String rightPath = right.getPath() == null || right.getPath().isEmpty() ? "/" : right.getPath();
            String leftFragment = left.getRawFragment() == null ? "" : left.getRawFragment();
            String rightFragment = right.getRawFragment() == null ? "" : right.getRawFragment();
            return left.getScheme() != null && left.getScheme().equalsIgnoreCase(right.getScheme())
                    && left.getHost() != null && left.getHost().equalsIgnoreCase(right.getHost())
                    && leftPath.equals(rightPath) && leftFragment.equals(rightFragment);
        } catch (java.net.URISyntaxException error) {
            return current.equals(target);
        }
    }

    private void captureLaunchUrl(Intent intent) {
        launchUrl = null;
        if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction()) || intent.getData() == null) return;
        String url = intent.getData().toString();
        if (NavigationPolicy.isTrusted(url, BuildConfig.WEB_ORIGIN)) launchUrl = url;
    }

    private void hideKeyboard() {
        View target = webView != null && webView.getWindowToken() != null ? webView : root;
        if (target == null || target.getWindowToken() == null) return;
        InputMethodManager manager = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
        if (manager != null) manager.hideSoftInputFromWindow(target.getWindowToken(), 0);
    }

    private boolean webSlotVisible() {
        return !nativeShell || (webSlot != null && webSlot.isAttachedToWindow());
    }

    private ShellViewModel shellModel() {
        return new ViewModelProvider(this).get(ShellViewModel.class);
    }

    private void detach(View view) {
        if (view == null) return;
        ViewParent parent = view.getParent();
        if (parent instanceof ViewGroup) ((ViewGroup) parent).removeView(view);
    }

    private static final class PendingSave {
        final File file;
        final boolean blob;
        final int generation;
        volatile String name;
        volatile String mime;
        volatile boolean ready;
        long expectedBytes;
        long bytes;
        int chunkIndex;
        OutputStream output;
        WebMessagePort port;
        PendingSave(File file, String name, String mime, boolean blob, int generation) {
            this.file = file; this.name = name; this.mime = mime; this.blob = blob; this.generation = generation;
        }
    }
    private static final class TooLargeException extends IOException { }
    private static final class UnsafeRedirectException extends IOException { }
}
