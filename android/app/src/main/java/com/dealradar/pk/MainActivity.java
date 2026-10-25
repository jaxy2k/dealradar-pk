package com.dealradar.pk;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

public class MainActivity extends Activity {
    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;
    private static final int FILE_CHOOSER_REQ = 1001;
    private static final int PERM_REQ = 1002;
    private static final int OCR_TIMEOUT_MS = 10000;
    private static final int MAX_IMAGE_DIMENSION = 2048;

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
                launchPicker();
            } else {
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
            return handleUrl(request.getUrl().toString());
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return handleUrl(url);
        }

        private boolean handleUrl(String url) {
            if (url.startsWith("file:///android_asset/")) return false;
            if (url.startsWith("http://") || url.startsWith("https://")) {
                try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); }
                catch (ActivityNotFoundException e) { }
                return true;
            }
            try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); }
            catch (ActivityNotFoundException e) {
                if (url.startsWith("whatsapp://")) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url.replace("whatsapp://send/", "https://wa.me/")))); }
                    catch (ActivityNotFoundException e2) { }
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
                try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); }
                catch (ActivityNotFoundException e) { }
            });
        }

        /**
         * Native OCR via ML Kit Text Recognition (bundled, offline).
         * Accepts a base64-encoded image (data URL prefix stripped by caller).
         * Returns JSON: { text, confidence, words: [{text, confidence}], error? }
         * Thread-safe: runs on a background thread with timeout.
         */
        @JavascriptInterface
        public String ocrBase64(String base64Image) {
            try {
                // Strip data URL prefix if present
                String b64 = base64Image;
                if (b64.contains(",")) b64 = b64.substring(b64.indexOf(",") + 1);

                byte[] decoded = Base64.decode(b64, Base64.DEFAULT);
                if (decoded == null || decoded.length == 0) {
                    return "{\"error\":\"empty_image\",\"text\":\"\",\"confidence\":0,\"words\":[]}";
                }

                // Decode and resize if too large (memory safety)
                BitmapFactory.Options opts = new BitmapFactory.Options();
                opts.inJustDecodeBounds = true;
                BitmapFactory.decodeByteArray(decoded, 0, decoded.length, opts);
                int sampleSize = 1;
                while (opts.outWidth / sampleSize > MAX_IMAGE_DIMENSION || opts.outHeight / sampleSize > MAX_IMAGE_DIMENSION) {
                    sampleSize *= 2;
                }
                opts.inJustDecodeBounds = false;
                opts.inSampleSize = sampleSize;
                Bitmap bitmap = BitmapFactory.decodeByteArray(decoded, 0, decoded.length, opts);
                if (bitmap == null) {
                    return "{\"error\":\"decode_failed\",\"text\":\"\",\"confidence\":0,\"words\":[]}";
                }

                // Run ML Kit OCR with timeout
                final CountDownLatch latch = new CountDownLatch(1);
                final String[] result = new String[1];
                final Exception[] error = new Exception[1];

                InputImage image = InputImage.fromBitmap(bitmap, 0);
                TextRecognizer recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
                recognizer.process(image)
                    .addOnSuccessListener(visionText -> {
                        try {
                            JSONObject json = new JSONObject();
                            json.put("text", visionText.getText());

                            // Compute average confidence from text blocks
                            double totalConf = 0;
                            int wordCount = 0;
                            JSONArray words = new JSONArray();
                            for (Text.TextBlock block : visionText.getTextBlocks()) {
                                for (Text.Line line : block.getLines()) {
                                    for (Text.Element element : line.getElements()) {
                                        Float conf = element.getConfidence();
                                        double c = conf != null ? conf : 0.5;
                                        totalConf += c;
                                        wordCount++;
                                        JSONObject w = new JSONObject();
                                        w.put("text", element.getText());
                                        w.put("confidence", Math.round(c * 100) / 100.0);
                                        words.put(w);
                                    }
                                }
                            }
                            double avgConf = wordCount > 0 ? totalConf / wordCount : 0;
                            json.put("confidence", Math.round(avgConf * 100) / 100.0);
                            json.put("words", words);
                            result[0] = json.toString();
                        } catch (Exception e) {
                            error[0] = e;
                        } finally {
                            latch.countDown();
                        }
                    })
                    .addOnFailureListener(e -> {
                        error[0] = e;
                        latch.countDown();
                    });

                boolean completed = latch.await(OCR_TIMEOUT_MS, TimeUnit.MILLISECONDS);
                bitmap.recycle();

                if (!completed) {
                    return "{\"error\":\"timeout\",\"text\":\"\",\"confidence\":0,\"words\":[]}";
                }
                if (error[0] != null) {
                    return "{\"error\":\"" + error[0].getMessage().replace("\"", "'") + "\",\"text\":\"\",\"confidence\":0,\"words\":[]}";
                }
                return result[0] != null ? result[0] : "{\"error\":\"no_result\",\"text\":\"\",\"confidence\":0,\"words\":[]}";

            } catch (Exception e) {
                return "{\"error\":\"" + e.getMessage().replace("\"", "'") + "\",\"text\":\"\",\"confidence\":0,\"words\":[]}";
            }
        }
    }
}
