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

// Sole FCM receiver for the customer app (the Capacitor plugin's own messaging
// service is removed in the manifest). Two kinds of message, by data["type"]:
//   • "incoming_call" → ring the phone with NgsCallService (normal ringtone +
//     full-screen call notification), even when the app is closed.
//   • anything else (offers, order status) → a normal heads-up notification.
// Note: server pushes that carry a `notification` block are shown by Android
// itself while the app is backgrounded (onMessageReceived only fires for
// data-only messages or while the app is in the foreground).
public class NgsFcmService extends FirebaseMessagingService {
  static final String INFO_CHANNEL_ID = "ngs_updates";

  @Override
  public void onMessageReceived(@NonNull RemoteMessage msg) {
    String type = null, title = null, body = null, caller = null;
    Map<String, String> data = msg.getData();
    if (data != null) {
      type = data.get("type");
      title = data.get("title");
      body = data.get("body");
      caller = data.get("callerName");
    }
    if (msg.getNotification() != null) {
      if (title == null) title = msg.getNotification().getTitle();
      if (body == null) body = msg.getNotification().getBody();
    }

    if ("incoming_call".equals(type)) {
      Intent i = new Intent(this, NgsCallService.class);
      i.putExtra("caller", caller != null ? caller : "Incoming call");
      try { ContextCompat.startForegroundService(this, i); } catch (Exception e) { /* ignore */ }
      return;
    }

    showInfoNotification(title != null ? title : "NGS Store", body != null ? body : "");
  }

  private void showInfoNotification(String title, String body) {
    NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
    if (nm == null) return;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      NotificationChannel ch = new NotificationChannel(
          INFO_CHANNEL_ID, "Order updates & offers", NotificationManager.IMPORTANCE_HIGH);
      ch.setDescription("Order status and messages from NGS Store");
      nm.createNotificationChannel(ch);
    }
    Intent open = new Intent(this, MainActivity.class);
    open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
    int flags = PendingIntent.FLAG_UPDATE_CURRENT;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
    PendingIntent pi = PendingIntent.getActivity(this, 0, open, flags);

    NotificationCompat.Builder b = new NotificationCompat.Builder(this, INFO_CHANNEL_ID)
        .setSmallIcon(R.mipmap.ic_launcher)
        .setContentTitle(title)
        .setContentText(body)
        .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
        .setPriority(NotificationCompat.PRIORITY_HIGH)
        .setAutoCancel(true)
        .setContentIntent(pi);
    int id = (title != null ? title.hashCode() : 0) & 0x7fffffff;
    nm.notify(id, b.build());
  }
}
