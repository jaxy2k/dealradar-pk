package com.dealradar.pk;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {
    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;
    private static final int FILE_CHOOSER_REQ = 1001;
    private static final int PERM_REQ = 1002;

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
        webView.setWebChromeClient(new FileChooserChromeClient());
        webView.setBackgroundColor(0xFFF5F6F8);
        webView.addJavascriptInterface(new AndroidBridge(), "AndroidBridge");
        setContentView(webView);
        webView.loadUrl("file:///android_asset/index.html");
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER_REQ) {
            Uri[] results = null;
            if (resultCode == RESULT_OK && data != null) {
                Uri uri = data.getData();
                if (uri != null) results = new Uri[]{uri};
            }
            if (fileCallback != null) {
                fileCallback.onReceiveValue(results);
                fileCallback = null;
            }
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == PERM_REQ && fileCallback != null) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                // Permission granted — launch picker
                launchPicker();
            } else {
                // Denied — cancel the file input
                fileCallback.onReceiveValue(null);
                fileCallback = null;
            }
        }
    }

    private void launchPicker() {
        Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("image/*");
        try {
            startActivityForResult(intent, FILE_CHOOSER_REQ);
        } catch (ActivityNotFoundException e) {
            if (fileCallback != null) { fileCallback.onReceiveValue(null); fileCallback = null; }
        }
    }

    private class FileChooserChromeClient extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                FileChooserParams fileChooserParams) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;

            // Check if we need runtime permission
            String perm = Build.VERSION.SDK_INT >= 33
                ? "android.permission.READ_MEDIA_IMAGES"
                : "android.permission.READ_EXTERNAL_STORAGE";
            if (Build.VERSION.SDK_INT >= 23 && checkSelfPermission(perm) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{perm}, PERM_REQ);
                return true;
            }
            launchPicker();
            return true;
        }
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
