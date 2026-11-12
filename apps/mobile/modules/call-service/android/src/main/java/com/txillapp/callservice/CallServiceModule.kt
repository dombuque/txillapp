package com.txillapp.callservice

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.util.Log
import androidx.core.content.ContextCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Ponte JS ↔ CallService (ver src/lib/calls/callService.ts).
 * - start(name, video): põe o serviço em primeiro plano, ou atualiza o tipo se a câmara ligou ou desligou a meio.
 * - stop(): tira-o.
 * - evento onHangUp: tocaram em «Desligar» na notificação.
 */
class CallServiceModule : Module() {
  private val context get() = requireNotNull(appContext.reactContext) { "Sem contexto Android" }

  override fun definition() = ModuleDefinition {
    Name("TxCallService")

    Events("onHangUp")

    OnCreate {
      CallService.onHangUp = { sendEvent("onHangUp", mapOf<String, Any>()) }
    }

    OnDestroy {
      CallService.onHangUp = null
    }

    Function("start") { name: String, video: Boolean ->
      // Sem a licença do microfone o Android 14 recusa o tipo microphone (e rebentava depois do startForegroundService).
      if (!granted(Manifest.permission.RECORD_AUDIO)) return@Function false
      try {
        if (!CallService.running) CallService.startedAt = System.currentTimeMillis()
        val intent = Intent(context, CallService::class.java)
          .setAction(CallService.ACTION_START)
          .putExtra(CallService.EXTRA_NAME, name)
          .putExtra(CallService.EXTRA_VIDEO, video && granted(Manifest.permission.CAMERA))
        ContextCompat.startForegroundService(context, intent)
        true
      } catch (e: Exception) {
        // ForegroundServiceStartNotAllowedException (Android 12+): a app não está à vista.
        Log.w("TxCallService", "Não deu para arrancar o serviço da chamada: ${e.message}")
        false
      }
    }

    Function("stop") {
      // stopService funciona também com a app em segundo plano; o onDestroy do serviço tira a notificação.
      context.stopService(Intent(context, CallService::class.java))
      CallService.running = false
    }
  }

  private fun granted(permission: String) =
    ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED
}
