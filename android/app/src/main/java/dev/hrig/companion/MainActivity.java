package dev.hrig.companion;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(HrigLinkPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
