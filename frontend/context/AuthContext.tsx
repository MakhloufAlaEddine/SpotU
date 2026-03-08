import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { storage } from '../lib/storage';
import { api } from '../lib/api';
import { setLang, Lang } from '../lib/i18n';

interface User {
  user_id: string;
  email: string;
  name: string;
  picture?: string | null;
  role: 'user' | 'coach' | 'admin';
  language: Lang;
  bio?: string;
  phone?: string;
  is_coach_verified?: boolean;
  coach_tags?: string[];
  hourly_rate?: number | null;
  show_phone?: boolean;
  show_reviews?: boolean;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string, language?: Lang) => Promise<void>;
  loginWithGoogle: () => void;
  processGoogleCallback: (sessionId: string) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (data: Partial<User>) => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const applyUser = (u: User) => {
    setUser(u);
    if (u.language) setLang(u.language as Lang);
  };

  const checkAuth = useCallback(async () => {
    try {
      const saved = await storage.get('spotu_token');
      if (saved) {
        setToken(saved);
        const me = await api.get<User>('/auth/me');
        applyUser(me);
      }
    } catch {
      await storage.remove('spotu_token');
      setToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // CRITICAL: If returning from OAuth callback, skip the /me check.
    // AuthCallback will exchange the session_id and establish the session first.
    // REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
    if (typeof window !== 'undefined') {
      const inHash = window.location.hash?.includes('session_id=');
      const inSearch = window.location.search?.includes('session_id=');
      // Only skip auth check on the OAuth callback page, not on other pages
      // (e.g. /payment-success also uses session_id but needs normal auth check)
      const isCallbackPage = window.location.pathname?.includes('/callback');
      if ((inHash || inSearch) && isCallbackPage) {
        setLoading(false);
        return;
      }
    }
    checkAuth();
  }, [checkAuth]);

  const login = async (email: string, password: string) => {
    const data = await api.post<{ user: User; token: string }>('/auth/login', { email, password });
    await storage.set('spotu_token', data.token);
    setToken(data.token);
    applyUser(data.user);
  };

  const register = async (email: string, password: string, name: string, language: Lang = 'fr') => {
    const data = await api.post<{ user: User; token: string }>('/auth/register', { email, password, name, language });
    await storage.set('spotu_token', data.token);
    setToken(data.token);
    applyUser(data.user);
  };

  const processGoogleCallback = useCallback(async (sessionId: string) => {
    setLoading(true);
    try {
      const data = await api.post<{ user: User; token: string }>('/auth/google', { session_id: sessionId });
      await storage.set('spotu_token', data.token);
      setToken(data.token);
      applyUser(data.user);
    } finally {
      setLoading(false);
    }
  }, []);

  const loginWithGoogle = useCallback(async () => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      // Web : utiliser un élément <a> natif
      // REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
      const redirectUrl = window.location.origin + '/(auth)/callback';
      const authUrl = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
      const a = document.createElement('a');
      a.href = authUrl;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } else {
      // Native (iOS/Android Expo Go)
      //
      // POURQUOI CETTE APPROCHE :
      // - openAuthSessionAsync avec https:// → utilise SFSafariViewController (pas ASWebAuthenticationSession)
      //   car iOS ne peut intercepter https:// qu'avec des Universal Links (non configurés ici)
      // - SFSafariViewController ne ferme PAS automatiquement le navigateur → app bloquée sur login
      //
      // SOLUTION : Utiliser openBrowserAsync + deep link
      // 1. Le callback web (?native=1) redirige vers exp://...?session_id=...
      // 2. SFSafariViewController se FERME automatiquement quand il rencontre exp://
      // 3. iOS ouvre Expo Go avec le deep link
      // 4. Linking.addEventListener reçoit le session_id → auth complète
      //
      const expHost = 'geo-coaching-app.preview.emergentagent.com';
      const redirectUrl = `https://${expHost}/(auth)/callback?native=1`;
      const authUrl = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;

      // Préparer la promesse qui se résout avec le session_id via deep link
      let resolveDeepLink: ((sid: string | null) => void) | null = null;
      const deepLinkPromise = new Promise<string | null>(resolve => {
        resolveDeepLink = resolve;
      });

      // Écouter le deep link AVANT d'ouvrir le navigateur
      const subscription = Linking.addEventListener('url', ({ url }) => {
        const match = url.match(/session_id=([^&#]+)/);
        if (match?.[1]) {
          subscription.remove();
          resolveDeepLink?.(decodeURIComponent(match[1]));
          resolveDeepLink = null;
        }
      });

      // Ouvrir le navigateur in-app (SFSafariViewController)
      WebBrowser.openBrowserAsync(authUrl).then(() => {
        // Le navigateur s'est fermé — attendre 2s que le deep link arrive
        // (SFSafariViewController se ferme AVANT que Linking ne reçoive le deep link)
        setTimeout(() => {
          subscription.remove();
          resolveDeepLink?.(null);
          resolveDeepLink = null;
        }, 2000);
      });

      // Attendre le session_id via deep link
      const sessionId = await deepLinkPromise;
      if (sessionId) {
        await processGoogleCallback(sessionId);
      }
    }
  }, [processGoogleCallback]);

  const logout = async () => {
    await storage.remove('spotu_token');
    setToken(null);
    setUser(null);
  };

  const updateUser = (data: Partial<User>) => {
    if (user) {
      const updated = { ...user, ...data };
      setUser(updated);
      if (data.language) setLang(data.language as Lang);
    }
  };

  const refreshUser = useCallback(async () => {
    try {
      const me = await api.get<User>('/auth/me');
      applyUser(me);
    } catch {}
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, loginWithGoogle, processGoogleCallback, logout, updateUser, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
