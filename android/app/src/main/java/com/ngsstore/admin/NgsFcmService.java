package com.ngsstore.admin;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

// Receives every FCM push for this app (we remove the Capacitor plugin's own
// messaging service in the manifest so this is the sole receiver). The server
// sends DATA-ONLY high-priority messages, so this fires even when the app is in
// the background or fully closed.
//
// Two kinds of message, told apart by data["type"]:
//   • "new_order"  → launch the loud, ringing, full-screen incoming-call alarm.
//   • anything else (e.g. "owner_alert" for the nightly summary / low-stock) →
//     post a normal, quiet heads-up notification. These are FYI, not alarms —
//     they must never ring the siren.
public class NgsFcmService extends FirebaseMessagingService {
  static final String INFO_CHANNEL_ID = "owner_info_v1";

  @Override
  public void onMessageReceived(@NonNull RemoteMessage msg) {
    String title = null, body = null, type = null;
    Map<String, String> data = msg.getData();
    if (data != null) {
      title = data.get("title");
      body = data.get("body");
      type = data.get("type");
    }
    // Fall back to a notification payload if one is ever present.
    if (msg.getNotification() != null) {
      if (title == null) title = msg.getNotification().getTitle();
      if (body == null) body = msg.getNotification().getBody();
    }

    // Quiet informational push (business summary, low-stock, etc.).
    if (type != null && !"new_order".equals(type)) {
      showInfoNotification(
        title != null ? title : "NGS",
        body != null ? body : "");
      return;
    }

    // Default: a new order — ring the alarm.
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

  // A plain notification on a low-importance channel — shows, makes at most a
  // soft sound, and is swipe-away. Tapping it opens the app.
  private void showInfoNotification(String title, String body) {
    NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
    if (nm == null) return;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      NotificationChannel ch = new NotificationChannel(
        INFO_CHANNEL_ID, "Business updates", NotificationManager.IMPORTANCE_DEFAULT);
      ch.setDescription("Daily summary and stock alerts");
      nm.createNotificationChannel(ch);
    }
    Intent open = new Intent(this, MainActivity.class);
    open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
    int flags = PendingIntent.FLAG_UPDATE_CURRENT;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
    PendingIntent pi = PendingIntent.getActivity(this, 0, open, flags);

    NotificationCompat.Builder b = new NotificationCompat.Builder(this, INFO_CHANNEL_ID)
      .setSmallIcon(android.R.drawable.ic_dialog_info)
      .setContentTitle(title)
      .setContentText(body)
      .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
      .setPriority(NotificationCompat.PRIORITY_DEFAULT)
      .setAutoCancel(true)
      .setContentIntent(pi);
    // Distinct id per message class so a summary doesn't replace a stock alert.
    int id = (title != null ? title.hashCode() : 0) & 0x7fffffff;
    nm.notify(id, b.build());
  }
}
