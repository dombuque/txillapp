package com.txillapp.callservice

import android.util.Log
import com.google.firebase.messaging.RemoteMessage
import expo.modules.notifications.service.ExpoFirebaseMessagingService
import java.net.HttpURLConnection
import java.net.URL

/**
 * O serviço das mensagens FCM da app. Fica no lugar do do expo-notifications (prioridade 1 no manifesto deste módulo,
 * contra -1 do Expo), que continua a fazer tudo o que fazia: `super.onMessageReceived` mostra a notificação.
 *
 * A mais, só para as chamadas: quando chega o aviso de uma chamada a tocar, diz ao servidor que chegou a este telemóvel
 * (POST ao `ackUrl` do aviso), mesmo com a app fechada, para quem liga passar de «A chamar…» a «A tocar…». Não usa a
 * sessão: o endereço traz o código «chegou» desta chamada, que só serve para isto e caduca quando a chamada deixa de
 * tocar. Corre depois de a notificação estar mostrada e nunca a impede (qualquer falha fica só no registo).
 *
 * O FCM chama onMessageReceived numa thread de trabalho (não na principal): dá para o pedido de rede ser síncrono.
 */
class TxMessagingService : ExpoFirebaseMessagingService() {
  override fun onMessageReceived(remoteMessage: RemoteMessage) {
    super.onMessageReceived(remoteMessage)
    val data = remoteMessage.data
    if (data["kind"] != "call") return
    val url = ackUrlOf(data["ackUrl"]) ?: return
    try {
      val c = URL(url).openConnection() as HttpURLConnection
      try {
        c.requestMethod = "POST"
        c.connectTimeout = TIMEOUT_MS
        c.readTimeout = TIMEOUT_MS
        c.doOutput = true
        c.setRequestProperty("X-Requested-With", "txillapp")
        c.setRequestProperty("X-Client", "txillapp-mobile")
        c.setFixedLengthStreamingMode(0)
        c.outputStream.close()
        val code = c.responseCode
        if (code !in 200..299 && code != 404 && code != 409) Log.w(TAG, "«chegou» da chamada: resposta $code")
      } finally {
        c.disconnect()
      }
    } catch (e: Exception) {
      Log.w(TAG, "«chegou» da chamada falhou: ${e.message}")
    }
  }

  companion object {
    private const val TAG = "TxMessagingService"
    private const val TIMEOUT_MS = 6_000
    private val ACK_URL = Regex("^https?://[A-Za-z0-9.:\\[\\]-]+/api/v1/calls/[0-9a-fA-F-]{36}/ringing\\?ack=[A-Za-z0-9._~%-]{1,200}$")

    /** Só endereços do «chegou» de uma chamada (o aviso vem do nosso servidor, mas não se segue um endereço qualquer). */
    fun ackUrlOf(raw: String?): String? = raw?.takeIf { ACK_URL.matches(it) }
  }
}
