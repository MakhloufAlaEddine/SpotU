// Mock react-native minimal pour Jest (environnement Node)
export const Platform = {
  OS: 'ios' as 'ios' | 'android' | 'web',
  select: (obj: Record<string, unknown>) => obj.ios ?? obj.default,
};
