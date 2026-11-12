package com.txillapp.callservice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

/**
 * Serviço em primeiro plano enquanto há uma chamada do Txillapp (voz ou vídeo) a decorrer.
 *
 * Desde o Android 14, uma app que sai do ecrã perde o microfone e a câmara, a não ser que tenha um foreground service
 * desse tipo. Este serviço é do tipo `microphone` e, nas videochamadas com a câmara ligada, também `camera`. Não é
 * `phoneCall`: esse tipo obriga a ser a app de telefone ou a usar o Telecom (ConnectionService/MANAGE_OWN_CALLS).
 *
 * Arranca pelo JS quando a chamada liga, com a app à vista: é o que o Android 14 exige para estes tipos. Pára em todos
 * os fins da chamada e também quando se tira a app dos recentes (stopWithTask no manifesto).
 *
 * A notificação é contínua e de importância baixa, no canal «Chamadas em curso». Tocar nela volta à app e «Desligar»
 * avisa o JS, que desliga a chamada. Sem licença de notificações, o serviço arranca na mesma; o sistema só não mostra a
 * notificação.
 */
class CallService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_HANGUP -> {
        val listener = onHangUp
        if (listener != null) listener() else stopNow()
      }
      ACTION_STOP -> stopNow()
      else -> {
        val name = intent?.getStringExtra(EXTRA_NAME) ?: "Txillapp"
        val video = intent?.getBooleanExtra(EXTRA_VIDEO, false) ?: false
        if (!goForeground(name, video)) stopNow()
      }
    }
    // Se o sistema matar o processo, não se recria sozinho: a chamada já não existe.
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    running = false
    super.onDestroy()
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    stopNow()
    super.onTaskRemoved(rootIntent)
  }

  /** Põe (ou atualiza) o serviço em primeiro plano com o tipo certo. Devolve false se o sistema não deixou. */
  private fun goForeground(name: String, video: Boolean): Boolean {
    val notification = buildNotification(name, video)
    val mic = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE else 0
    val cam = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA else 0
    val attempts = if (video) listOf(mic or cam, mic) else listOf(mic)
    for (type in attempts) {
      try {
        ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, type)
        running = true
        return true
      } catch (e: Exception) {
        // SecurityException: sem a licença do microfone/câmara, ou a app não está à vista (Android 14+).
        Log.w(TAG, "startForeground recusado (tipo $type): ${e.message}")
      }
    }
    return false
  }

  private fun stopNow() {
    running = false
    try { ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE) } catch (_: Exception) { }
    stopSelf()
  }

  private fun buildNotification(name: String, video: Boolean): Notification {
    ensureChannel(this)
    val open = packageManager.getLaunchIntentForPackage(packageName)?.apply {
      addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
    }
    val openPending = open?.let { PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT) }
    val hangUp = PendingIntent.getService(
      this, 1, Intent(this, CallService::class.java).setAction(ACTION_HANGUP),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.sym_action_call)
      .setContentTitle("Chamada com $name")
      .setContentText(if (video) "Videochamada em curso. Toca para voltar." else "Chamada em curso. Toca para voltar.")
      .setOngoing(true)
      .setSilent(true)
      .setOnlyAlertOnce(true)
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setUsesChronometer(true)
      .setWhen(startedAt)
      .setShowWhen(true)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .apply { if (openPending != null) setContentIntent(openPending) }
      .addAction(0, "Desligar", hangUp)
      .build()
  }

  companion object {
    private const val TAG = "TxCallService"
    const val CHANNEL_ID = "txillapp_calls_ongoing"
    private const val NOTIFICATION_ID = 7341
    const val ACTION_START = "com.txillapp.callservice.START"
    const val ACTION_STOP = "com.txillapp.callservice.STOP"
    const val ACTION_HANGUP = "com.txillapp.callservice.HANGUP"
    const val EXTRA_NAME = "name"
    const val EXTRA_VIDEO = "video"

    /** O que fazer quando se toca em «Desligar» (o módulo liga isto ao JS). */
    @Volatile var onHangUp: (() -> Unit)? = null
    @Volatile var running = false
    /** Quando a chamada começou (para o cronómetro da notificação). */
    @Volatile var startedAt = System.currentTimeMillis()

    fun ensureChannel(context: Context) {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
      val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (nm.getNotificationChannel(CHANNEL_ID) != null) return
      val channel = NotificationChannel(CHANNEL_ID, "Chamadas em curso", NotificationManager.IMPORTANCE_LOW).apply {
        description = "Aparece enquanto estás numa chamada, para voltares a ela ou desligares."
        setShowBadge(false)
        enableVibration(false)
        setSound(null, null)
      }
      nm.createNotificationChannel(channel)
    }
  }
}
