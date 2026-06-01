/**
 * Config Expo dynamique :
 * - dev local / profil EAS "development" → expo-dev-client (Metro, hot reload)
 * - profils "preview" / "production" → app autonome sans écran « Enter URL »
 */
const HETZNER_API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || 'http://178.105.95.184:8080';

/** @param {import('expo/config').ConfigContext} ctx */
module.exports = ({ config }) => {
  const profile = process.env.EAS_BUILD_PROFILE;
  const useDevClient = !profile || profile === 'development';
  const isStandalone = profile === 'preview' || profile === 'production';
  const allowHttp = profile !== 'production';
  const projectId = config.extra?.eas?.projectId;

  const plugins = (config.plugins ?? []).filter((entry) => {
    if (useDevClient) return true;
    if (entry === 'expo-dev-client') return false;
    if (Array.isArray(entry) && entry[0] === 'expo-dev-client') return false;
    return true;
  });

  /** Builds preview/production : ne pas lier expo-dev-client (sinon crash sans Metro). */
  const autolinking = isStandalone
    ? { ...(config.autolinking ?? {}), exclude: [...new Set([...(config.autolinking?.exclude ?? []), 'expo-dev-client'])] }
    : config.autolinking;

  return {
    ...config,
    plugins,
    autolinking,
    android: {
      ...config.android,
      // Requis pour appeler l'API Hetzner en HTTP depuis un APK preview.
      usesCleartextTraffic: allowHttp,
    },
    // OTA : fallbackToCacheTimeout 0 = démarrage immédiat avec le bundle embarqué,
    // téléchargement en arrière-plan, application au prochain lancement.
    updates: projectId
      ? {
          enabled: true,
          url: `https://u.expo.dev/${projectId}`,
          checkAutomatically: 'ON_LOAD',
          fallbackToCacheTimeout: 0,
        }
      : undefined,
    // Bare workflow (dossiers android/ + ios/) : chaîne obligatoire, pas { policy: "appVersion" }.
    runtimeVersion: config.version || '1.0.0',
    extra: {
      ...config.extra,
      environment: process.env.ENVIRONMENT || profile || 'local',
      backendUrl: HETZNER_API_URL,
    },
  };
};
