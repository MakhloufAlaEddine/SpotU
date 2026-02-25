import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
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
      const saved = await storage.get('winek_token');
      if (saved) {
        setToken(saved);
        const me = await api.get<User>('/auth/me');
        applyUser(me);
      }
    } catch {
      await storage.remove('winek_token');
      setToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // CRITICAL: If returning from OAuth callback, skip the /me check.
    // processGoogleCallback will call setLoading(false) when done.
    if (typeof window !== 'undefined' && window.location.hash?.includes('session_id=')) {
      return; // Keep loading = true until processGoogleCallback finishes
    }
    checkAuth();
  }, [checkAuth]);

  const login = async (email: string, password: string) => {
    const data = await api.post<{ user: User; token: string }>('/auth/login', { email, password });
    await storage.set('winek_token', data.token);
    setToken(data.token);
    applyUser(data.user);
  };

  const register = async (email: string, password: string, name: string, language: Lang = 'fr') => {
    const data = await api.post<{ user: User; token: string }>('/auth/register', { email, password, name, language });
    await storage.set('winek_token', data.token);
    setToken(data.token);
    applyUser(data.user);
  };

  const processGoogleCallback = useCallback(async (sessionId: string) => {
    const data = await api.post<{ user: User; token: string }>('/auth/google', { session_id: sessionId });
    await storage.set('winek_token', data.token);
    setToken(data.token);
    applyUser(data.user);
  }, []);

  const loginWithGoogle = useCallback(async () => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      // Web : utiliser un élément <a> natif — seule méthode sans restriction window.location
      const redirectUrl = window.location.origin + '/(auth)/callback';
      const authUrl = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
      const a = document.createElement('a');
      a.href = authUrl;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } else {
      // Native (iOS/Android Expo Go) : navigateur intégré in-app
      const redirectUrl = 'https://winek-coaching.preview.emergentagent.com/(auth)/callback';
      const authUrl = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);
      if (result.type === 'success') {
        const match = result.url.match(/session_id=([^&]+)/);
        const sessionId = match ? match[1] : null;
        if (sessionId) {
          await processGoogleCallback(sessionId);
        }
      }
    }
  }, [processGoogleCallback]);

  const logout = async () => {
    await storage.remove('winek_token');
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

  const refreshUser = async () => {
    try {
      const me = await api.get<User>('/auth/me');
      applyUser(me);
    } catch {}
  };

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
