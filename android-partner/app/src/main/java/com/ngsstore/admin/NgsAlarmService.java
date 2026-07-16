package com.ngsstore.admin;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;
import android.os.VibrationEffect;
import android.os.Vibrator;
import androidx.core.app.NotificationCompat;

// Foreground service that turns a new-order push into a loud, CONTINUOUS,
// incoming-call-style alarm: it plays the 24s siren on a loop with ALARM audio
// usage (so it rings over silent/normal profiles), vibrates in a pattern, and
// posts a full-screen notification that throws up AlarmActivity over the lock
// screen. The ring keeps going until the owner taps Open or Dismiss — it is not
// a one-shot beep. Owning the sound here (not in the Activity) means it keeps
// ringing even if the full-screen UI can't launch on a locked-down phone.
public class NgsAlarmService extends Service {
  static final String CHANNEL_ID = "orders_call_v1";
  static final int NOTIF_ID = 4711;
  public static final String ACTION_STOP = "com.ngsstore.admin.STOP_ALARM";

  private MediaPlayer player;
  private Vibrator vibrator;

  @Override
  public IBinder onBind(Intent intent) { return null; }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    if (intent != null && ACTION_STOP.equals(intent.getAction())) {
      stopEverything();
      return START_NOT_STICKY;
    }

    String title = intent != null ? intent.getStringExtra("title") : null;
    String body = intent != null ? intent.getStringExtra("body") : null;
    if (title == null) title = "New order";
    if (body == null) body = "Open NGS to accept";

    createChannel();
    try {
      startForeground(NOTIF_ID, buildNotification(title, body));
    } catch (Exception e) {
      // If we can't promote to a foreground service, fall back to a plain
      // heads-up notification so at least something shows and beeps.
      NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
      if (nm != null) nm.notify(NOTIF_ID, buildNotification(title, body));
    }
    startRinging();
    return START_STICKY;
  }

  private Uri alarmUri() {
    return Uri.parse("android.resource://" + getPackageName() + "/" + R.raw.alarm);
  }

  private void createChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
      if (nm == null) return;
      if (nm.getNotificationChannel(CHANNEL_ID) != null) return;
      NotificationChannel ch = new NotificationChannel(
          CHANNEL_ID, "Incoming order call", NotificationManager.IMPORTANCE_HIGH);
      ch.setDescription("Full-screen ringing alarm when a new order arrives");
      ch.enableVibration(true);
      ch.setVibrationPattern(new long[]{0, 800, 600, 800, 600});
      ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
      try { ch.setBypassDnd(true); } catch (Exception ignored) {}
      AudioAttributes aa = new AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_ALARM)
          .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
          .build();
      ch.setSound(alarmUri(), aa);
      nm.createNotificationChannel(ch);
    }
  }

  private int piFlags() {
    int f = PendingIntent.FLAG_UPDATE_CURRENT;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) f |= PendingIntent.FLAG_IMMUTABLE;
    return f;
  }

  private Notification buildNotification(String title, String body) {
    Intent full = new Intent(this, AlarmActivity.class);
    full.putExtra("title", title);
    full.putExtra("body", body);
    full.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
    PendingIntent fullPi = PendingIntent.getActivity(this, 0, full, piFlags());

    Intent stop = new Intent(this, NgsAlarmService.class).setAction(ACTION_STOP);
    PendingIntent stopPi = PendingIntent.getService(this, 1, stop, piFlags());

    return new NotificationCompat.Builder(this, CHANNEL_ID)
        .setSmallIcon(R.mipmap.ic_launcher)
        .setContentTitle(title)
        .setContentText(body)
        .setPriority(NotificationCompat.PRIORITY_MAX)
        .setCategory(NotificationCompat.CATEGORY_CALL)
        .setOngoing(true)
        .setAutoCancel(false)
        .setFullScreenIntent(fullPi, true)
        .setContentIntent(fullPi)
        .addAction(0, "Dismiss", stopPi)
        .build();
  }

  private void startRinging() {
    try {
      if (player == null) {
        player = new MediaPlayer();
        AudioAttributes aa = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
        player.setAudioAttributes(aa);
        player.setDataSource(this, alarmUri());
        player.setLooping(true);
        player.prepare();
        player.start();
      }
    } catch (Exception e) { /* sound is best-effort */ }

    try {
      vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
      long[] pattern = {0, 800, 600};
      if (vibrator != null) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0));
        } else {
          vibrator.vibrate(pattern, 0);
        }
      }
    } catch (Exception e) { /* vibration is best-effort */ }
  }

  private void stopEverything() {
    try { if (player != null) { player.stop(); player.release(); player = null; } } catch (Exception ignored) {}
    try { if (vibrator != null) { vibrator.cancel(); vibrator = null; } } catch (Exception ignored) {}
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      stopForeground(Service.STOP_FOREGROUND_REMOVE);
    } else {
      stopForeground(true);
    }
    stopSelf();
  }

  @Override
  public void onDestroy() {
    try { if (player != null) { player.release(); player = null; } } catch (Exception ignored) {}
    try { if (vibrator != null) { vibrator.cancel(); } } catch (Exception ignored) {}
    super.onDestroy();
  }
}
