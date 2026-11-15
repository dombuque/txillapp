/**
 * O react-native-webrtc ficou no package.json (o fork da LiveKit, @livekit/react-native-webrtc, substitui-o: é o mesmo
 * código nativo, com.oney.WebRTCModule, e os dois juntos dão classes repetidas no Android e no iPhone). Não se liga.
 * As chamadas (src/lib/calls/webrtc.ts) e a Txillada usam o fork.
 */
module.exports = {
  dependencies: {
    'react-native-webrtc': { platforms: { android: null, ios: null } },
  },
};
