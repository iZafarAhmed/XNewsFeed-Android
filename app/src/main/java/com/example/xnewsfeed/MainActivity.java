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
        webView.getSettings().setDomStorageEnabled(true);          // localStorage
        webView.getSettings().setAllowFileAccess(true);
        webView.getSettings().setMediaPlaybackRequiresUserGesture(false); // video autoplay
        webView.setWebViewClient(new WebViewClient());
        webView.addJavascriptInterface(new Bridge(), "Android");   // CORS-free fetch bridge
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
                    c.setRequestProperty("User-Agent", "XNewsFeedApp/1.0");
                    c.setConnectTimeout(15000);
                    c.setReadTimeout(20000);
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
                    // FIX: Wrap the error JSON creation in its own try-catch 
                    // so the compiler knows we are handling potential JSONExceptions here too.
                    try {
                        JSONObject res = new JSONObject();
                        res.put("ok", false);
                        res.put("error", e.getMessage() != null ? e.getMessage() : "Unknown error");
                        payload = JSONObject.quote(res.toString());
                    } catch (Exception jsonEx) {
                        // Absolute fallback if JSON creation itself somehow fails
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
