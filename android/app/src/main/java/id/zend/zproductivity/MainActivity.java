package id.zend.zproductivity;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

/**
 * Z-Productivity — pembungkus WebView untuk Web App Google Apps Script.
 * Lapisan atas: loader animasi 1,01^365 (assets/loading.html).
 * Lapisan bawah: Web App. Loader memudar setelah halaman siap dan animasi selesai.
 */
public class MainActivity extends Activity {

    private static final int NAVY = Color.parseColor("#131A2E");
    private static final long MIN_LOADER_MS = 2600;
    private static final String LOADER_URL = "file:///android_asset/loading.html";
    private static final String OFFLINE_URL = "file:///android_asset/offline.html";

    private final Handler handler = new Handler(Looper.getMainLooper());
    private WebView web;
    private WebView loader;
    private boolean pageReady = false;
    private boolean minTimeDone = false;
    private boolean offline = false;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(NAVY);
        getWindow().setNavigationBarColor(NAVY);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(NAVY);

        web = new WebView(this);
        web.setBackgroundColor(NAVY);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);
        s.setUserAgentString(s.getUserAgentString() + " ZProductivityApp/1.0");

        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(web, true);

        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String host = uri.getHost() == null ? "" : uri.getHost();
                if (host.endsWith("google.com") || host.endsWith("googleusercontent.com")
                        || host.endsWith("gstatic.com") || host.endsWith("googleapis.com")) {
                    return false;
                }
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception ignored) { }
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pageReady = true;
                maybeHideLoader();
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showOffline();
            }
        });

        loader = new WebView(this);
        loader.setBackgroundColor(NAVY);
        loader.getSettings().setJavaScriptEnabled(true);
        loader.addJavascriptInterface(new Bridge(), "ZApp");
        loader.loadUrl(LOADER_URL);

        ViewGroup.LayoutParams full = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
        root.addView(web, full);
        root.addView(loader, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        web.loadUrl(BuildConfig.WEB_APP_URL);
        startMinTimer();
    }

    private void startMinTimer() {
        handler.removeCallbacksAndMessages(null);
        handler.postDelayed(() -> {
            minTimeDone = true;
            maybeHideLoader();
        }, MIN_LOADER_MS);
    }

    private void maybeHideLoader() {
        if (!pageReady || !minTimeDone || offline || loader.getVisibility() != View.VISIBLE) return;
        loader.animate().alpha(0f).setDuration(450)
                .withEndAction(() -> loader.setVisibility(View.GONE)).start();
    }

    private void showOffline() {
        offline = true;
        loader.animate().cancel();
        loader.setAlpha(1f);
        loader.setVisibility(View.VISIBLE);
        loader.loadUrl(OFFLINE_URL);
    }

    private void reload() {
        offline = false;
        pageReady = false;
        minTimeDone = false;
        loader.setAlpha(1f);
        loader.setVisibility(View.VISIBLE);
        loader.loadUrl(LOADER_URL);
        web.loadUrl(BuildConfig.WEB_APP_URL);
        startMinTimer();
    }

    /** Dipanggil dari offline.html lewat tombol "Coba lagi". */
    public class Bridge {
        @JavascriptInterface
        public void retry() {
            handler.post(MainActivity.this::reload);
        }
    }

    @Override
    public void onBackPressed() {
        if (!offline && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        if (web != null) web.destroy();
        if (loader != null) loader.destroy();
        super.onDestroy();
    }
}
