package com.example.xnewsfeed;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;

public class MainActivity extends Activity {
    private WebView webView;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setAllowFileAccess(true);
        webView.getSettings().setMediaPlaybackRequiresUserGesture(false);
        webView.setWebViewClient(new WebViewClient());
        webView.addJavascriptInterface(new Bridge(), "Android");
        setContentView(webView);
        webView.loadUrl("file:///android_asset/index.html");
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    private class Bridge {
        @JavascriptInterface
        public void fetch(final String url, final String id) {
            new Thread(() -> {
                String payload;
                try {
                    HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                    
                    // FIX: Add real browser headers so Twitter/Nitter doesn't block the request
                    c.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36");
                    c.setRequestProperty("Accept", "*/*");
                    c.setRequestProperty("Referer", "https://nitter.net/");
                    
                    c.setConnectTimeout(15000);
                    c.setReadTimeout(20000);
                    c.setInstanceFollowRedirects(true); // Ensure we follow 302 redirects
                    
                    StringBuilder sb = new StringBuilder();
                    try (BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream()))) {
                        String line;
                        while ((line = r.readLine()) != null) sb.append(line).append('\n');
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
                        payload = "\"{\\\"ok\\\":false,\\\"error\\\":\\\"JSON creation failed\\\"}\"";
                    }
                }
                
                final String finalPayload = payload;
                webView.post(() -> webView.evaluateJavascript(
                        "window.__onFetch && window.__onFetch(" + JSONObject.quote(id) + ", " + finalPayload + ")", null));
            }).start();
        }
    }
}
