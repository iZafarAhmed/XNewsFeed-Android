package com.example.xnewsfeed;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.os.Bundle;
import android.view.Gravity;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;

import org.json.JSONObject;
import org.json.JSONTokener;

import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLDecoder;
import java.util.HashMap;
import java.util.Map;
import java.util.zip.GZIPInputStream;

public class MainActivity extends Activity {
    private static final String PROXY_BASE = "https://proxy.xnewsfeed.local/";
    private static final String UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

    // Extracts RSS XML or tweet blocks from inside a hidden browser
    private static final String EXTRACT_JS =
            "(function(){" +
            "var root=document.documentElement;" +
            "if(root&&root.nodeName&&root.nodeName.toLowerCase()==='rss'){" +
            "return new XMLSerializer().serializeToString(root);}" +
            "var rssEl=document.querySelector('rss');" +
            "if(rssEl){return new XMLSerializer().serializeToString(rssEl);}" +
            "var n=document.querySelectorAll('.timeline-item');" +
            "if(!n.length){n=document.querySelectorAll('.tweet-body');}" +
            "if(n.length){var out=[];for(var i=0;i<n.length;i++){out.push(n[i].outerHTML);}" +
            "return out.join('\\u0001');}" +
            "return '';})()";

    // Detects when a Cloudflare challenge has been PASSED in the visible verifier
    // Detects when a Cloudflare challenge has been PASSED in the visible verifier
    private static final String VERIFY_JS =
            "(function(){" +
            "if(document.querySelector('#cf-turnstile,#challenge-form,.cf-browser-verification,.g-recaptcha'))return '';" +
            "var t=(document.body&&document.body.innerText)||'';" +
            "if(/Verifying|Just a moment|Checking your browser|Attention required|Verify you are human/i.test(t))return '';" +
            "var root=document.documentElement;" +
            "if(root&&root.nodeName&&root.nodeName.toLowerCase()==='rss')return 'ok';" +
            "if(document.querySelector('rss'))return 'ok';" +
            "if(document.querySelector('.timeline-item,.tweet-body,.tweet-header,.profile-tabs'))return 'ok';" +
            "return '';})()";

    private FrameLayout root;
    private WebView webView;
    private WebView verifyView;
    private Button verifyClose;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // App-wide cookies: once the human passes the check, ALL webviews are unlocked
        CookieManager.getInstance().setAcceptCookie(true);

        webView = new WebView(this);
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setAllowFileAccess(true);
        webView.getSettings().setMediaPlaybackRequiresUserGesture(false);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (url.startsWith(PROXY_BASE)) {
                    try {
                        String target = URLDecoder.decode(url.substring(PROXY_BASE.length()), "UTF-8");
                        HttpURLConnection c = (HttpURLConnection) new URL(target).openConnection();
                        boolean isRss = target.contains("/rss");
                        c.setRequestProperty("User-Agent", isRss ? "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 RSSReader/1.0" : UA);
                        c.setRequestProperty("Accept", isRss ? "application/rss+xml, application/xml, text/xml, */*" : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
                        c.setRequestProperty("Accept-Encoding", "gzip");
                        c.setConnectTimeout(15000);
                        c.setReadTimeout(20000);
                        c.setInstanceFollowRedirects(true);

                        InputStream is = c.getInputStream();
                        if ("gzip".equalsIgnoreCase(c.getContentEncoding())) {
                            is = new GZIPInputStream(is);
                        }

                        Map<String, String> headers = new HashMap<>();
                        headers.put("Access-Control-Allow-Origin", "*");
                        String mime = target.contains("rss") ? "application/xml" : "text/html";
                        return new WebResourceResponse(mime, "UTF-8", c.getResponseCode(), "OK", headers, is);
                    } catch (Exception e) {
                        String msg = String.valueOf(e.getMessage());
                        ByteArrayInputStream errBody = new ByteArrayInputStream(msg.getBytes());
                        return new WebResourceResponse("text/plain", "UTF-8", 502, "Bad Gateway", null, errBody);
                    }
                }
                return super.shouldInterceptRequest(view, request);
            }
        });

        webView.addJavascriptInterface(new Bridge(), "Android");

        root = new FrameLayout(this);
        root.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);
        webView.loadUrl("file:///android_asset/index.html");
    }

    @Override
    public void onBackPressed() {
        if (verifyView != null) { finishVerifier(false); return; }
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    /* ========== 🛡️ VISIBLE VERIFIER (human solves the check once) ========== */
    @SuppressLint("SetJavaScriptEnabled")
    private void showVerifier(final String url) {
        webView.post(() -> {
            if (verifyView != null) return; // already showing

            verifyView = new WebView(this);
            verifyView.getSettings().setJavaScriptEnabled(true);
            verifyView.getSettings().setDomStorageEnabled(true);
            verifyView.getSettings().setUserAgentString(UA);
            root.addView(verifyView, new FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

            verifyClose = new Button(this);
            verifyClose.setText("✕ Close");
            FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT);
            lp.gravity = Gravity.TOP | Gravity.END;
            lp.setMargins(24, 24, 24, 24);
            root.addView(verifyClose, lp);
            verifyClose.bringToFront();
            verifyClose.setOnClickListener(v -> finishVerifier(false));

            final boolean[] done = {false};
            final Runnable[] poll = new Runnable[1];
            poll[0] = new Runnable() {
                int attempts = 0;

                @Override
                public void run() {
                    if (done[0] || verifyView == null) return;
                    attempts++;
                    verifyView.evaluateJavascript(VERIFY_JS, value -> {
                        if (done[0]) return;
                        boolean ok = false;
                        try {
                            Object o = new JSONTokener(value).nextValue();
                            ok = "ok".equals(o);
                        } catch (Exception ignored) {}
                        if (ok) {
                            done[0] = true;
                            finishVerifier(true);
                        } else if (attempts < 90) {
                            verifyView.postDelayed(poll[0], 1000);
                        } else {
                            done[0] = true;
                            finishVerifier(false);
                        }
                    });
                }
            };

            verifyView.setWebViewClient(new WebViewClient() {
                @Override
                public void onPageFinished(WebView view, String finishedUrl) {
                    view.postDelayed(poll[0], 800);
                }
            });

            verifyView.loadUrl(url);
        });
    }

    private void finishVerifier(final boolean ok) {
        webView.post(() -> {
            if (verifyView != null) {
                root.removeView(verifyView);
                verifyView.destroy();
                verifyView = null;
            }
            if (verifyClose != null) {
                root.removeView(verifyClose);
                verifyClose = null;
            }
            webView.evaluateJavascript(
                    "window.__onVerify && window.__onVerify(" + (ok ? "true" : "false") + ")", null);
        });
    }

    private void destroyHw(final WebView hw) {
        try { root.removeView(hw); } catch (Exception ignored) {}
        try { hw.destroy(); } catch (Exception ignored) {}
    }

    private void deliver(final String id, final String body) {
        String tempPayload;
        try {
            JSONObject res = new JSONObject();
            res.put("ok", true);
            res.put("body", body);
            tempPayload = JSONObject.quote(res.toString());
        } catch (Exception e) {
            tempPayload = "\"{\\\"ok\\\":false,\\\"error\\\":\\\"parse error\\\"}\"";
        }
        final String finalPayload = tempPayload;
        webView.post(() -> webView.evaluateJavascript(
                "window.__onFetch && window.__onFetch(" + JSONObject.quote(id) + ", " + finalPayload + ")", null));
    }

    private class Bridge {

        // ✅ JS asks the app to show the human-verification overlay
        @JavascriptInterface
        public void openVerifier(final String url) {
            showVerifier(url);
        }

        // Hidden attached Chromium WebView for silent fetches (uses saved cookies)
        @JavascriptInterface
        public void fetchPage(final String url, final String id) {
            webView.post(() -> {
                final WebView hw = new WebView(getApplicationContext());
                hw.getSettings().setJavaScriptEnabled(true);
                hw.getSettings().setDomStorageEnabled(true);
                hw.getSettings().setUserAgentString(UA);

                root.addView(hw, new FrameLayout.LayoutParams(
                        FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
                hw.setVisibility(android.view.View.INVISIBLE);

                final boolean[] done = {false};
                final Runnable[] poll = new Runnable[1];
                poll[0] = new Runnable() {
                    int attempts = 0;

                    @Override
                    public void run() {
                        if (done[0]) return;
                        attempts++;
                        hw.evaluateJavascript(EXTRACT_JS, value -> {
                            if (done[0]) return;
                            String html = "";
                            try {
                                Object o = new JSONTokener(value).nextValue();
                                if (o instanceof String) html = (String) o;
                            } catch (Exception ignored) {}

                            if (!html.isEmpty()) {
                                done[0] = true;
                                deliver(id, html);
                                destroyHw(hw);
                            } else if (attempts < 12) {
                                hw.postDelayed(poll[0], 1200);
                            } else {
                                done[0] = true;
                                deliver(id, "");
                                destroyHw(hw);
                            }
                        });
                    }
                };

                hw.setWebViewClient(new WebViewClient() {
                    @Override
                    public void onPageFinished(WebView view, String finishedUrl) {
                        hw.postDelayed(poll[0], 800);
                    }
                });

                hw.postDelayed(() -> {
                    if (!done[0]) {
                        done[0] = true;
                        deliver(id, "");
                        destroyHw(hw);
                    }
                }, 16000);

                hw.loadUrl(url);
            });
        }

        // Plain native fetch (fallback path)
        @JavascriptInterface
        public void fetch(final String url, final String id) {
            new Thread(() -> {
                String tempPayload;
                try {
                    HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                    boolean isRss = url.contains("/rss");
                    c.setRequestProperty("User-Agent", isRss ? "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 RSSReader/1.0" : UA);
                    c.setRequestProperty("Accept", isRss ? "application/rss+xml, application/xml, text/xml, */*" : "*/*");
                    c.setRequestProperty("Accept-Encoding", "gzip");
                    c.setConnectTimeout(15000);
                    c.setReadTimeout(20000);
                    c.setInstanceFollowRedirects(true);

                    InputStream is = c.getInputStream();
                    if ("gzip".equalsIgnoreCase(c.getContentEncoding())) {
                        is = new GZIPInputStream(is);
                    }
                    StringBuilder sb = new StringBuilder();
                    try (BufferedReader r = new BufferedReader(new InputStreamReader(is, "UTF-8"))) {
                        String line;
                        while ((line = r.readLine()) != null) {
                            sb.append(line).append('\n');
                        }
                    }

                    JSONObject res = new JSONObject();
                    res.put("ok", true);
                    res.put("body", sb.toString());
                    tempPayload = JSONObject.quote(res.toString());
                } catch (Exception e) {
                    try {
                        JSONObject res = new JSONObject();
                        res.put("ok", false);
                        res.put("error", e.getMessage() != null ? e.getMessage() : "Unknown error");
                        tempPayload = JSONObject.quote(res.toString());
                    } catch (Exception jsonEx) {
                        tempPayload = "\"{\\\"ok\\\":false,\\\"error\\\":\\\"Unknown error\\\"}\"";
                    }
                }

                final String finalPayload = tempPayload;
                webView.post(() -> webView.evaluateJavascript(
                        "window.__onFetch && window.__onFetch(" + JSONObject.quote(id) + ", " + finalPayload + ")", null));
            }).start();
        }
    }
}
