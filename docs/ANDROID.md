# Txillapp para Android

A app Android é um projeto Capacitor em `apps/web/android`. Abre o Txillapp de produção (`https://txillapp.com`) dentro de um WebView
(ver `apps/web/capacitor.config.ts`): as atualizações do site chegam logo à app, sem passar pela loja, e a sessão e a API são as mesmas da web.

## Ferramentas (já instaladas neste computador)

- JDK 21 (Temurin) em `C:\Program Files\Eclipse Adoptium\jdk-21.0.13.9-hotspot`
- Android SDK em `C:\Android\Sdk` (plataforma 36, build-tools 36.0.0, platform-tools)
- `apps/web/android/local.properties` (não vai para o git): `sdk.dir=C:/Android/Sdk`

## Compilar uma versão de teste (APK)

```
cd apps/web
set JAVA_HOME=C:\Program Files\Eclipse Adoptium\jdk-21.0.13.9-hotspot
npm run android:debug
```

O APK fica em `apps/web/android/app/build/outputs/apk/debug/app-debug.apk`. Para instalar num telemóvel: ativar "Depuração USB" e `adb install -r app-debug.apk`.

## Versão para a Google Play

Falta (precisa de ti, por serem segredos e contas):
1. Conta de programador da Google Play (25 USD, uma só vez).
2. Chave de assinatura (keystore) criada por ti, com a senha só tua. Guarda uma cópia segura: sem ela não há atualizações.
3. `./gradlew bundleRelease` assinado com essa chave gera o `.aab` que se envia à Play Console.
4. Notificações push: precisam de um projeto Firebase (ficheiro `google-services.json`) e do plugin `@capacitor/push-notifications`.

Antes de enviar: aumentar `versionCode`/`versionName` em `apps/web/android/app/build.gradle` a cada versão.
