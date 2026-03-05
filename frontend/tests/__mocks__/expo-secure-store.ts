// Mock expo-secure-store pour Jest (environnement Node)
const store: Record<string, string> = {};

export const setItemAsync = jest.fn(async (key: string, value: string): Promise<void> => {
  store[key] = value;
});

export const getItemAsync = jest.fn(async (key: string): Promise<string | null> => {
  return store[key] ?? null;
});

export const deleteItemAsync = jest.fn(async (key: string): Promise<void> => {
  delete store[key];
});

export const _reset = () => {
  Object.keys(store).forEach(k => delete store[k]);
};
