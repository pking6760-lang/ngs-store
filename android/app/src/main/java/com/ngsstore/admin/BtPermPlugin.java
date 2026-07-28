package com.ngsstore.admin;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Runtime Bluetooth permission for the thermal printer.
//
// Why this exists at all: cordova-plugin-bluetooth-serial is from before
// Android 12. Its `list` action calls BluetoothAdapter.getBondedDevices() and
// its `connect` opens an RFCOMM socket, and since API 31 both of those throw
// SecurityException unless BLUETOOTH_CONNECT has been granted AT RUNTIME. The
// plugin only ever knows about ACCESS_COARSE_LOCATION, which was the Android 11
// answer, so on any modern phone printing fails and the plugin reports a bare
// error with no hint of why.
//
// The app used to fire requestPermissions() from MainActivity.onCreate — a
// Bluetooth dialog at launch, before the owner has done anything that could
// explain it. Deny it once and nothing asks again; deny twice and Android marks
// it permanently denied, at which point requestPermissions() returns instantly
// with no dialog. The app then tells him to "allow the permission" while
// offering no way on earth to allow it. That is the bug being fixed.
//
// So: ask at the moment he taps Print, and when Android has stopped asking, say
// so plainly and hand him a button straight to the app's settings page.
@CapacitorPlugin(
  name = "BtPerm",
  permissions = {
    @com.getcapacitor.annotation.Permission(
      alias = "bt",
      strings = {
        Manifest.permission.BLUETOOTH_CONNECT,
        Manifest.permission.BLUETOOTH_SCAN,
      }
    )
  }
)
public class BtPermPlugin extends Plugin {

  private static final String[] PERMS = {
    Manifest.permission.BLUETOOTH_CONNECT,
    Manifest.permission.BLUETOOTH_SCAN,
  };

  private boolean legacy() {
    // Below Android 12 the manifest permissions are install-time. Nothing to ask.
    return Build.VERSION.SDK_INT < 31;
  }

  private boolean granted() {
    if (legacy()) return true;
    return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.BLUETOOTH_CONNECT)
      == PackageManager.PERMISSION_GRANTED;
  }

  // True when Android will still show a dialog. False AND not granted means the
  // user chose "Don't ask again" (or the OS blocks it) — only Settings can fix it.
  private boolean canAsk() {
    if (legacy()) return false;
    return ActivityCompat.shouldShowRequestPermissionRationale(
      getActivity(), Manifest.permission.BLUETOOTH_CONNECT);
  }

  private JSObject state(boolean askedThisTime) {
    JSObject o = new JSObject();
    boolean g = granted();
    o.put("granted", g);
    // Blocked = not granted, and asking produced no dialog we could act on.
    o.put("blocked", !g && !legacy() && askedThisTime && !canAsk());
    o.put("legacy", legacy());
    return o;
  }

  @PluginMethod
  public void status(PluginCall call) {
    call.resolve(state(false));
  }

  @PluginMethod
  public void request(PluginCall call) {
    if (granted()) { call.resolve(state(false)); return; }
    requestPermissionForAlias("bt", call, "onPerm");
  }

  @com.getcapacitor.annotation.PermissionCallback
  private void onPerm(PluginCall call) {
    call.resolve(state(true));
  }

  // Last resort when Android has stopped asking: the app's own settings page,
  // where the permission can still be switched on by hand.
  @PluginMethod
  public void openSettings(PluginCall call) {
    Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
    i.setData(Uri.fromParts("package", getContext().getPackageName(), null));
    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    getContext().startActivity(i);
    call.resolve();
  }
}
