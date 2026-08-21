package com.example.xnewsfeed;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;

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
    private static final String RSS_ACCEPT = "application/rss+xml, application/xml, text/xml, */*";
    private static final String EXTRACT_JS =
            "(function(){var n=document.querySelectorAll('.timeline-item');" +
            "if(!n.length){n=document.querySelectorAll('.tweet-body');}" +
            "var out=[];for(var i=0;i<n.length;i++){out.push(n[i].outerHTML);}" +
            "return out.join('\\u0001');})()";

    private WebView webView;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
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
                        c.setRequestProperty("User-Agent", isRss ? "Feeder/2.9.11 (Android)" : UA);
                        c.setRequestProperty("Accept", isRss ? RSS_ACCEPT : "*/*");
                        c.setConnectTimeout(15000);
                        c.setReadTimeout(20000);
                        c.setInstanceFollowRedirects(true);
                        InputStream is = c.getInputStream();
                        if ("gzip".equalsIgnoreCase(c.getContentEncoding())) {
                            is = new GZIPInputStream(is);
                        }
                        Map<String, String> headers = new HashMap<>();
                        headers.put("Access-Control-Allow-Origin", "*");
                        String mime = isRss ? "application/xml" : "text/html";
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
        setContentView(webView);
        webView.loadUrl("file:///android_asset/index.html");
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    private void deliver(final String id, final String body) {
        String payload;
        try {
            JSONObject res = new JSONObject();
            res.put("ok", true);
            res.put("body", body);
            payload = JSONObject.quote(res.toString());
        } catch (Exception e) {
            payload = "\"{\\\"ok\\\":false,\\\"error\\\":\\\"parse error\\\"}\"";
        }
        webView.post(() -> webView.evaluateJavascript(
                "window.__onFetch && window.__onFetch(" + JSONObject.quote(id) + ", " + payload + ")", null));
    }

    private void doFetch(final String url, final String id, final String customUa) {
        new Thread(() -> {
            String payload;
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                boolean isRss = url.contains("/rss");
                c.setRequestProperty("User-Agent", customUa != null ? customUa : (isRss ? "Feeder/2.9.11 (Android)" : UA));
                c.setRequestProperty("Accept", isRss ? RSS_ACCEPT : "*/*");
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
                payload = JSONObject.quote(res.toString());
            } catch (Exception e) {
                try {
                    JSONObject res = new JSONObject();
                    res.put("ok", false);
                    res.put("error", e.getMessage() != null ? e.getMessage() : "Unknown error");
                    payload = JSONObject.quote(res.toString());
                } catch (Exception jsonEx) {
                    payload = "\"{\\\"ok\\\":false,\\\"error\\\":\\\"Unknown error\\\"}\"";
                }
            }
            final String finalPayload = payload;
            webView.post(() -> webView.evaluateJavascript(
                    "window.__onFetch && window.__onFetch(" + JSONObject.quote(id) + ", " + finalPayload + ")", null));
        }).start();
    }

    private class Bridge {
        @JavascriptInterface
        public void fetch(final String url, final String id) {
            doFetch(url, id, null);
        }

        // ✅ NEW: fetch with a chosen RSS-reader identity
        @JavascriptInterface
        public void fetchUA(final String url, final String id, final String ua) {
            doFetch(url, id, ua);
        }

        @JavascriptInterface
        public void fetchPage(final String url, final String id) {
            webView.post(() -> {
                final WebView hw = new WebView(getApplicationContext());
                hw.getSettings().setJavaScriptEnabled(true);
                hw.getSettings().setDomStorageEnabled(true);
                hw.getSettings().setUserAgentString(UA);
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
                                hw.destroy();
                            } else if (attempts < 15) {
                                hw.postDelayed(poll[0], 1500);
                            } else {
                                done[0] = true;
                                deliver(id, "");
                                hw.destroy();
                            }
                        });
                    }
                };

                hw.setWebViewClient(new WebViewClient() {
                    @Override
                    public void onPageFinished(WebView view, String finishedUrl) {
                        hw.postDelayed(poll[0], 1000);
                    }
                });

                hw.postDelayed(() -> {
                    if (!done[0]) {
                        done[0] = true;
                        deliver(id, "");
                        hw.destroy();
                    }
                }, 25000);

                hw.loadUrl(url);
            });
        }
    }
}
