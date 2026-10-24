package com.dealradar.pk;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {
    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        WebSettings ws = webView.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setAllowFileAccess(true);
        ws.setAllowContentAccess(true);
        ws.setCacheMode(WebSettings.LOAD_DEFAULT);
        ws.setDatabaseEnabled(true);
        webView.setWebViewClient(new DealRadarWebViewClient());
        webView.setBackgroundColor(0xFFF5F6F8);
        webView.addJavascriptInterface(new AndroidBridge(), "AndroidBridge");
        setContentView(webView);
        webView.loadUrl("file:///android_asset/index.html");
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            webView.evaluateJavascript("if(typeof goBack==='function')goBack();", null);
        }
    }

    private class DealRadarWebViewClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            String url = request.getUrl().toString();
            return handleUrl(url);
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return handleUrl(url);
        }

        private boolean handleUrl(String url) {
            // Local app files — load inside WebView
            if (url.startsWith("file:///android_asset/")) {
                return false;
            }

            // http/https — open in external browser
            if (url.startsWith("http://") || url.startsWith("https://")) {
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                } catch (ActivityNotFoundException e) {
                    // No browser available — do nothing
                }
                return true;
            }

            // whatsapp://, tel:, sms:, mailto:, intent: — open via system
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
            } catch (ActivityNotFoundException e) {
                // App not installed (e.g. no WhatsApp) — try https fallback for whatsapp
                if (url.startsWith("whatsapp://")) {
                    String httpsUrl = url.replace("whatsapp://send/", "https://wa.me/");
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(httpsUrl)));
                    } catch (ActivityNotFoundException e2) {
                        // Nothing we can do
                    }
                }
            }
            return true;
        }
    }

    public class AndroidBridge {
        @JavascriptInterface
        public void exitApp() {
            runOnUiThread(() -> finish());
        }

        @JavascriptInterface
        public void openExternal(String url) {
            runOnUiThread(() -> {
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                } catch (ActivityNotFoundException e) {
                    // App not installed
                }
            });
        }
    }
}
