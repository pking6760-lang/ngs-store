package com.ngsstore.admin;

import android.os.Build;
import android.os.Bundle;
import androidx.core.app.ActivityCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    // Android 12+ needs the new Bluetooth permissions granted at runtime so the
    // app can connect to a paired thermal printer.
    if (Build.VERSION.SDK_INT >= 31) {
      ActivityCompat.requestPermissions(
        this,
        new String[] {
          "android.permission.BLUETOOTH_CONNECT",
          "android.permission.BLUETOOTH_SCAN"
        },
        1001
      );
    }
  }
}
