package com.ngsstore.admin;

import android.content.Intent;
import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

// Receives every FCM push for this app (we remove the Capacitor plugin's own
// messaging service in the manifest so this is the sole receiver). The server
// sends DATA-ONLY high-priority messages, so this fires even when the app is in
// the background or fully closed — which lets us launch a real, ringing,
// full-screen "incoming call"-style alarm for a new order instead of a single
// quiet notification beep.
public class NgsFcmService extends FirebaseMessagingService {
  @Override
  public void onMessageReceived(@NonNull RemoteMessage msg) {
    String title = null, body = null;
    Map<String, String> data = msg.getData();
    if (data != null) {
      title = data.get("title");
      body = data.get("body");
    }
    // Fall back to a notification payload if one is ever present.
    if (msg.getNotification() != null) {
      if (title == null) title = msg.getNotification().getTitle();
      if (body == null) body = msg.getNotification().getBody();
    }
    if (title == null) title = "New order";
    if (body == null) body = "Open NGS to accept";

    Intent i = new Intent(this, NgsAlarmService.class);
    i.putExtra("title", title);
    i.putExtra("body", body);
    try {
      ContextCompat.startForegroundService(this, i);
    } catch (Exception e) {
      // Best-effort: if the OS blocks a background service start, nothing rings,
      // but we never crash the messaging service.
    }
  }
}
