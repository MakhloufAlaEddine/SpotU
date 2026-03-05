/**
 * [SEC-02] Tests de migration AsyncStorage → expo-secure-store
 * =============================================================
 * Vérifie :
 *  1. L'API publique (set/get/remove) fonctionne avec expo-secure-store (natif).
 *  2. Fallback localStorage sur Web.
 *  3. Aucun import direct AsyncStorage dans les fichiers JWT-sensibles.
 *
 * Les modules natifs (expo-secure-store, react-native) sont mockés via
 * tests/__mocks__/ + moduleNameMapper dans package.json.
 */

import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import * as fs from 'fs';
import * as path from 'path';

// Importer le module storage APRÈS les mocks (moduleNameMapper appliqué)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { storage } = require('../lib/storage');

// Helper pour accéder au store interne du mock
const { _reset } = require('../tests/__mocks__/expo-secure-store');

// ── 1. Tests unitaires — natif (iOS / Android) ───────────────────────────────

describe('[SEC-02] storage — natif (Platform.OS = ios)', () => {
  beforeEach(() => {
    _reset();
    jest.clearAllMocks();
    // Garantir que Platform.OS = 'ios' (mock par défaut)
    (Platform as any).OS = 'ios';
  });

  test('set() délègue à SecureStore.setItemAsync', async () => {
    await storage.set('spotu_token', 'tok_AAA');
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('spotu_token', 'tok_AAA');
  });

  test('get() lit depuis SecureStore.getItemAsync', async () => {
    await storage.set('spotu_token', 'tok_BBB');
    const val = await storage.get('spotu_token');
    expect(SecureStore.getItemAsync).toHaveBeenCalledWith('spotu_token');
    expect(val).toBe('tok_BBB');
  });

  test('get() renvoie null si clé absente', async () => {
    const val = await storage.get('spotu_token');
    expect(val).toBeNull();
  });

  test('remove() supprime via SecureStore.deleteItemAsync', async () => {
    await storage.set('spotu_token', 'tok_CCC');
    await storage.remove('spotu_token');
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('spotu_token');
    expect(await storage.get('spotu_token')).toBeNull();
  });

  test('cycle complet set → get → remove', async () => {
    await storage.set('spotu_token', 'tok_cycle');
    expect(await storage.get('spotu_token')).toBe('tok_cycle');
    await storage.remove('spotu_token');
    expect(await storage.get('spotu_token')).toBeNull();
  });

  test('plusieurs clés coexistent sans interférence', async () => {
    await storage.set('spotu_token', 'tok_user');
    await storage.set('spotu_refresh', 'ref_user');
    expect(await storage.get('spotu_token')).toBe('tok_user');
    expect(await storage.get('spotu_refresh')).toBe('ref_user');
    await storage.remove('spotu_token');
    expect(await storage.get('spotu_token')).toBeNull();
    expect(await storage.get('spotu_refresh')).toBe('ref_user');
  });
});

// ── 2. Tests — Web (localStorage fallback) ───────────────────────────────────

describe('[SEC-02] storage — Web (Platform.OS = web)', () => {
  const mockStorage: Record<string, string> = {};
  const localStorageMock = {
    getItem: jest.fn((k: string) => mockStorage[k] ?? null),
    setItem: jest.fn((k: string, v: string) => { mockStorage[k] = v; }),
    removeItem: jest.fn((k: string) => { delete mockStorage[k]; }),
  };

  beforeEach(() => {
    (Platform as any).OS = 'web';
    Object.keys(mockStorage).forEach(k => delete mockStorage[k]);
    jest.clearAllMocks();
    Object.defineProperty(global, 'localStorage', { value: localStorageMock, writable: true });
  });

  afterEach(() => {
    (Platform as any).OS = 'ios';
  });

  test('set() utilise localStorage sur web', async () => {
    await storage.set('spotu_token', 'web_tok');
    expect(localStorageMock.setItem).toHaveBeenCalledWith('spotu_token', 'web_tok');
  });

  test('get() lit localStorage sur web', async () => {
    mockStorage['spotu_token'] = 'web_tok_get';
    const val = await storage.get('spotu_token');
    expect(localStorageMock.getItem).toHaveBeenCalledWith('spotu_token');
    expect(val).toBe('web_tok_get');
  });

  test('remove() supprime depuis localStorage sur web', async () => {
    mockStorage['spotu_token'] = 'web_tok_del';
    await storage.remove('spotu_token');
    expect(localStorageMock.removeItem).toHaveBeenCalledWith('spotu_token');
  });

  test('SecureStore N\'est PAS appelé sur web', async () => {
    await storage.set('spotu_token', 'web_only');
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });
});

// ── 3. Audit statique — aucun import AsyncStorage direct ─────────────────────

describe('[SEC-02] Audit statique — aucun import AsyncStorage dans les fichiers sensibles', () => {
  const sensitiveFiles = [
    path.resolve(__dirname, '../lib/storage.ts'),
    path.resolve(__dirname, '../lib/api.ts'),
    path.resolve(__dirname, '../lib/chat.ts'),
    path.resolve(__dirname, '../context/AuthContext.tsx'),
  ];

  sensitiveFiles.forEach(filePath => {
    const label = path.relative(path.resolve(__dirname, '..'), filePath);
    test(`${label} n'importe pas @react-native-async-storage/async-storage`, () => {
      if (!fs.existsSync(filePath)) return; // fichier optionnel
      const content = fs.readFileSync(filePath, 'utf-8');
      // Ignorer les lignes de commentaires
      const codeOnly = content
        .split('\n')
        .filter(l => !/^\s*(\/\/|\*)/.test(l))
        .join('\n');
      expect(codeOnly).not.toMatch(/from ['"]@react-native-async-storage\/async-storage['"]/);
      expect(codeOnly).not.toMatch(/import AsyncStorage/);
    });
  });

  test('storage.ts importe bien expo-secure-store', () => {
    const filePath = path.resolve(__dirname, '../lib/storage.ts');
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain("from 'expo-secure-store'");
    expect(content).toContain('SecureStore.setItemAsync');
    expect(content).toContain('SecureStore.getItemAsync');
    expect(content).toContain('SecureStore.deleteItemAsync');
  });

  test("api.ts utilise storage.get('spotu_token') pour l'auth header", () => {
    const filePath = path.resolve(__dirname, '../lib/api.ts');
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain("storage.get('spotu_token')");
  });

  test("AuthContext.tsx utilise storage.set/remove('spotu_token')", () => {
    const filePath = path.resolve(__dirname, '../context/AuthContext.tsx');
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain("storage.set('spotu_token'");
    expect(content).toContain("storage.remove('spotu_token')");
  });
});
