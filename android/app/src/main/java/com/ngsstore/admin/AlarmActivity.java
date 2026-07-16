package com.ngsstore.admin;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import android.widget.TextView;

// The full-screen "incoming call" screen. Launched by NgsAlarmService's
// full-screen intent, it wakes and unlocks the screen and shows the order with
// big Open / Dismiss buttons. The ringing itself is owned by the service, so
// both buttons just tell the service to stop.
public class AlarmActivity extends Activity {
  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

    // Show over the lock screen and turn the screen on, like a phone call.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true);
      setTurnScreenOn(true);
      KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
      if (km != null) km.requestDismissKeyguard(this, null);
    } else {
      getWindow().addFlags(
          WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
              | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
              | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD);
    }
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

    setContentView(R.layout.activity_alarm);

    String title = getIntent().getStringExtra("title");
    String body = getIntent().getStringExtra("body");
    ((TextView) findViewById(R.id.alarm_title)).setText(title != null ? title : "New order");
    ((TextView) findViewById(R.id.alarm_body)).setText(body != null ? body : "");

    findViewById(R.id.btn_accept).setOnClickListener(v -> {
      stopAlarm();
      Intent i = new Intent(this, MainActivity.class);
      i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
      startActivity(i);
      finish();
    });
  }

  private void stopAlarm() {
    try {
      Intent stop = new Intent(this, NgsAlarmService.class).setAction(NgsAlarmService.ACTION_STOP);
      startService(stop);
    } catch (Exception ignored) {}
  }

  @Override
  public void onBackPressed() {
    // Force a deliberate Open/Dismiss choice; back shouldn't silently leave it ringing.
  }
}
