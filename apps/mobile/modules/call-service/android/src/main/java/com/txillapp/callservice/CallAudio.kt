package com.txillapp.callservice

import android.content.Context
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log

/**
 * A saída do som das chamadas (viva-voz) no Android. O som do WebRTC é de comunicação (USAGE_VOICE_COMMUNICATION):
 * - Android 12+ (API 31): `setCommunicationDevice` com o altifalante, ou com os auscultadores (Bluetooth, com fio, USB)
 *   ou o auscultador do telemóvel; `clearCommunicationDevice` no fim.
 * - Abaixo disso: `MODE_IN_COMMUNICATION` com `isSpeakerphoneOn`; o Bluetooth vai por SCO (`startBluetoothSco`).
 * - No fim da chamada repõe tudo: sem dispositivo escolhido, altifalante desligado, SCO parado e `MODE_NORMAL`.
 *
 * Permissões: `MODIFY_AUDIO_SETTINGS` (no manifesto deste módulo e no app.json) chega para o modo, o altifalante e o
 * SCO. Escolher o Bluetooth pelo AudioManager não pede `BLUETOOTH_CONNECT` (essa só faz falta a quem fala com o
 * BluetoothAdapter), por isso não se pede nada à pessoa.
 *
 * Quando se ligam ou tiram auscultadores (AudioDeviceCallback), avisa quem estiver a ouvir com a rota nova; o JS decide
 * (src/lib/calls/speaker.ts) e volta a chamar `setSpeaker`.
 */
class CallAudio(private val context: Context, private val onRoute: (route: String, headset: String) -> Unit) {
  private val am = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
  private val main = Handler(Looper.getMainLooper())
  private var callback: AudioDeviceCallback? = null
  private var scoStarted = false

  /** Liga ou desliga o altifalante. Devolve a rota em que ficou ("speaker", "earpiece", "wired", "bluetooth"). */
  @Suppress("DEPRECATION")
  fun setSpeaker(on: Boolean): String {
    watch()
    try {
      if (am.mode != AudioManager.MODE_IN_COMMUNICATION) am.mode = AudioManager.MODE_IN_COMMUNICATION
    } catch (e: Exception) {
      Log.w(TAG, "Não deu para pôr o modo de comunicação: ${e.message}")
    }
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        val devices = am.availableCommunicationDevices
        val target = if (on) devices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER } else pickHeadset(devices) ?: devices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE }
        if (target != null) {
          if (am.communicationDevice?.id != target.id && !am.setCommunicationDevice(target)) Log.w(TAG, "setCommunicationDevice recusado (${target.type})")
        } else {
          am.clearCommunicationDevice()
        }
      } else {
        val bt = !on && hasOutput(AudioDeviceInfo.TYPE_BLUETOOTH_SCO)
        if (bt) {
          am.isSpeakerphoneOn = false
          if (!scoStarted) {
            am.startBluetoothSco()
            scoStarted = true
          }
          am.isBluetoothScoOn = true
        } else {
          if (scoStarted) {
            am.isBluetoothScoOn = false
            am.stopBluetoothSco()
            scoStarted = false
          }
          // Com auscultadores com fio ligados e o altifalante desligado, o sistema manda o som para eles sozinho.
          am.isSpeakerphoneOn = on
        }
      }
    } catch (e: Exception) {
      Log.w(TAG, "Não deu para trocar a saída do som: ${e.message}")
    }
    val r = route()
    report()
    return r
  }

  /** Por onde está a sair o som agora. */
  @Suppress("DEPRECATION")
  fun route(): String {
    return try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        typeName(am.communicationDevice?.type)
      } else when {
        am.isSpeakerphoneOn -> "speaker"
        am.isBluetoothScoOn -> "bluetooth"
        hasOutput(AudioDeviceInfo.TYPE_WIRED_HEADSET) || hasOutput(AudioDeviceInfo.TYPE_WIRED_HEADPHONES) || hasOutput(AudioDeviceInfo.TYPE_USB_HEADSET) -> "wired"
        else -> "earpiece"
      }
    } catch (_: Exception) {
      "unknown"
    }
  }

  /** Os auscultadores ligados ("bluetooth", "wired") ou "none". */
  fun headset(): String {
    val outs = try { am.getDevices(AudioManager.GET_DEVICES_OUTPUTS).toList() } catch (_: Exception) { emptyList() }
    return when {
      outs.any { it.type in BLUETOOTH } -> "bluetooth"
      outs.any { it.type in WIRED } -> "wired"
      else -> "none"
    }
  }

  /** Fim da chamada: repõe o áudio normal do telemóvel. */
  @Suppress("DEPRECATION")
  fun reset() {
    unwatch()
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) am.clearCommunicationDevice()
      if (scoStarted) {
        am.isBluetoothScoOn = false
        am.stopBluetoothSco()
        scoStarted = false
      }
      am.isSpeakerphoneOn = false
      am.mode = AudioManager.MODE_NORMAL
    } catch (e: Exception) {
      Log.w(TAG, "Não deu para repor o áudio: ${e.message}")
    }
  }

  private fun report() {
    try { onRoute(route(), headset()) } catch (_: Exception) { }
  }

  private fun pickHeadset(devices: List<AudioDeviceInfo>): AudioDeviceInfo? =
    devices.firstOrNull { it.type in BLUETOOTH } ?: devices.firstOrNull { it.type in WIRED }

  private fun hasOutput(type: Int) = try {
    am.getDevices(AudioManager.GET_DEVICES_OUTPUTS).any { it.type == type }
  } catch (_: Exception) {
    false
  }

  /** Ouve os auscultadores a entrar e a sair enquanto a chamada dura. */
  private fun watch() {
    if (callback != null) return
    val cb = object : AudioDeviceCallback() {
      // O registo chama logo onAudioDevicesAdded com o que já está ligado: o JS percebe que é o primeiro aviso.
      override fun onAudioDevicesAdded(added: Array<out AudioDeviceInfo>) = changed(added)
      override fun onAudioDevicesRemoved(removed: Array<out AudioDeviceInfo>) = changed(removed)
    }
    callback = cb
    am.registerAudioDeviceCallback(cb, main)
  }

  private fun changed(devices: Array<out AudioDeviceInfo>) {
    if (devices.any { it.isSink && (it.type in BLUETOOTH || it.type in WIRED) }) {
      // O Bluetooth SCO demora um instante a aparecer nos dispositivos de comunicação: avisa já e outra vez daqui a pouco.
      report()
      main.postDelayed({ if (callback != null) report() }, 600)
    }
  }

  private fun unwatch() {
    callback?.let { try { am.unregisterAudioDeviceCallback(it) } catch (_: Exception) { } }
    callback = null
    main.removeCallbacksAndMessages(null)
  }

  companion object {
    private const val TAG = "TxCallAudio"
    private val BLUETOOTH: Set<Int> = buildSet {
      add(AudioDeviceInfo.TYPE_BLUETOOTH_SCO)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        add(AudioDeviceInfo.TYPE_BLE_HEADSET)
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) add(AudioDeviceInfo.TYPE_HEARING_AID)
    }
    private val WIRED: Set<Int> = buildSet {
      add(AudioDeviceInfo.TYPE_WIRED_HEADSET)
      add(AudioDeviceInfo.TYPE_WIRED_HEADPHONES)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) add(AudioDeviceInfo.TYPE_USB_HEADSET)
    }

    fun typeName(type: Int?): String = when {
      type == null -> "unknown" // sem dispositivo escolhido: o sistema decide (o JS fica com o que pediu)
      type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> "speaker"
      type == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE -> "earpiece"
      type in BLUETOOTH -> "bluetooth"
      type in WIRED -> "wired"
      else -> "unknown"
    }
  }
}
