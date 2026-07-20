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
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import androidx.core.app.NotificationCompat;

// Rings a NORMAL phone ringtone for an incoming in-app voice call and posts a
// full-screen, call-style notification (Answer / Decline) that opens the app.
// This is a calm ring — the system default ringtone on a loop — NOT the loud
// order siren. It stops when the app comes to the foreground (MainActivity.
// onResume), when Answer / Decline is tapped, or after 45s (the caller times
// out ~40s).
public class NgsCallService extends Service {
  static final String CHANNEL_ID = "ngs_calls_v1";
  static final int NOTIF_ID = 5120;
  public static final String ACTION_STOP = "com.ngsstore.admin.STOP_CALL";

  private MediaPlayer player;
  private Vibrator vibrator;
  private final Handler handler = new Handler(Looper.getMainLooper());
  private Runnable timeout;

  @Override public IBinder onBind(Intent intent) { return null; }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    if (intent != null && ACTION_STOP.equals(intent.getAction())) { stopEverything(); return START_NOT_STICKY; }
    String caller = intent != null ? intent.getStringExtra("caller") : null;
    if (caller == null || caller.isEmpty()) caller = "Incoming call";
    createChannel();
    try {
      startForeground(NOTIF_ID, buildNotification(caller));
    } catch (Exception e) {
      NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
      if (nm != null) nm.notify(NOTIF_ID, buildNotification(caller));
    }
    startRinging();
    if (timeout != null) handler.removeCallbacks(timeout);
    timeout = this::stopEverything;
    handler.postDelayed(timeout, 45000);
    return START_STICKY;
  }

  private Uri ringUri() {
    Uri u = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
    if (u == null) u = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
    return u;
  }

  private void createChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
      if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;
      NotificationChannel ch = new NotificationChannel(
          CHANNEL_ID, "Incoming calls", NotificationManager.IMPORTANCE_HIGH);
      ch.setDescription("Rings when someone calls you in the app");
      ch.enableVibration(true);
      ch.setVibrationPattern(new long[]{0, 1000, 1000});
      ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
      AudioAttributes aa = new AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
          .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
          .build();
      ch.setSound(ringUri(), aa);
      nm.createNotificationChannel(ch);
    }
  }

  private int piFlags() {
    int f = PendingIntent.FLAG_UPDATE_CURRENT;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) f |= PendingIntent.FLAG_IMMUTABLE;
    return f;
  }

  private Notification buildNotification(String caller) {
    Intent open = new Intent(this, MainActivity.class);
    open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    PendingIntent openPi = PendingIntent.getActivity(this, 0, open, piFlags());

    Intent stop = new Intent(this, NgsCallService.class).setAction(ACTION_STOP);
    PendingIntent stopPi = PendingIntent.getService(this, 1, stop, piFlags());

    return new NotificationCompat.Builder(this, CHANNEL_ID)
        .setSmallIcon(R.mipmap.ic_launcher)
        .setContentTitle("📞 " + caller)
        .setContentText("Incoming call — tap to answer")
        .setPriority(NotificationCompat.PRIORITY_MAX)
        .setCategory(NotificationCompat.CATEGORY_CALL)
        .setOngoing(true)
        .setAutoCancel(false)
        .setFullScreenIntent(openPi, true)
        .setContentIntent(openPi)
        .addAction(0, "Answer", openPi)
        .addAction(0, "Decline", stopPi)
        .build();
  }

  private void startRinging() {
    try {
      if (player == null) {
        player = new MediaPlayer();
        AudioAttributes aa = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
        player.setAudioAttributes(aa);
        player.setDataSource(this, ringUri());
        player.setLooping(true);
        player.prepare();
        player.start();
      }
    } catch (Exception e) { /* sound is best-effort */ }
    try {
      vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
      long[] pattern = {0, 1000, 1000};
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
    if (timeout != null) { handler.removeCallbacks(timeout); timeout = null; }
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
