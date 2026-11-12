Pod::Spec.new do |s|
  s.name           = 'TxCallService'
  s.version        = '1.0.0'
  s.summary        = 'Viva-voz (altifalante) das chamadas do Txillapp no iPhone.'
  s.description    = 'Escolhe a saída do som das chamadas WebRTC (altifalante ou auscultador) com o AVAudioSession. Ver CallServiceModule.swift.'
  s.license        = { :type => 'UNLICENSED' }
  s.author         = 'Txillapp'
  s.homepage       = 'https://txillapp.com'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES'
  }

  s.source_files = '**/*.{h,m,swift}'
end
