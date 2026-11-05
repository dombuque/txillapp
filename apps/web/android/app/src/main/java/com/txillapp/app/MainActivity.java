package com.txillapp.app;

import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

/**
 * A app abre os ficheiros do Txillapp que vão dentro dela (sem esperar pelo site) com o endereço txillapp.com.
 * Só os pedidos à API (/api/...) saem para a rede, como no site: o mesmo endereço, as mesmas sessões, sem CORS.
 */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Bridge bridge = getBridge();
        WebView web = bridge.getWebView();
        web.setWebViewClient(new BridgeWebViewClient(bridge) {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                String path = request.getUrl().getPath();
                if (path != null && path.startsWith("/api/")) return null; // rede
                return super.shouldInterceptRequest(view, request);
            }
        });
        web.setOverScrollMode(WebView.OVER_SCROLL_NEVER);
        web.setLongClickable(false);
    }
}
