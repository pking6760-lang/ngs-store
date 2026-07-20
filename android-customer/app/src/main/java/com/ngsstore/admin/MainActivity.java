package com.ngsstore.admin;

import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import androidx.core.app.ActivityCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onResume() {
    super.onResume();
    // The app is now in front — silence any incoming-call ringtone; the in-app
    // call screen (web) takes over from here.
    try {
      startService(new Intent(this, NgsCallService.class).setAction(NgsCallService.ACTION_STOP));
    } catch (Exception ignored) { /* service may not be running */ }
  }

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
