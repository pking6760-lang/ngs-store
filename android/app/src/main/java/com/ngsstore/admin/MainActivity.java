package com.ngsstore.admin;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    // Bluetooth permission is asked for by BtPermPlugin at the moment the owner
    // taps Print, not blindly here at launch. A permission dialog with no
    // context on first run gets denied, and a denied Bluetooth permission is
    // exactly what silently kills thermal printing forever.
    registerPlugin(BtPermPlugin.class);
    super.onCreate(savedInstanceState);
  }
}
