export const Colors = {
  // SpotU Dark Theme - Based on mockups
  primary: '#00BFA5', // Teal/cyan accent
  primaryLight: 'rgba(0, 191, 165, 0.15)',
  primaryDark: '#00A896',
  accent: '#00BFA5',
  
  // Background colors
  background: '#000000', // Pure black
  backgroundSecondary: '#0D1F1F', // Dark teal header
  foreground: '#FFFFFF', // White text
  
  // Secondary/Muted
  secondary: '#1C1C1E', // Dark gray for cards
  muted: '#8E8E93', // Gray text
  mutedLight: '#636366',
  
  // Borders & Cards
  border: '#2C2C2E', // Dark border
  borderLight: '#3A3A3C',
  card: '#1C1C1E', // Dark card background
  cardElevated: '#2C2C2E',
  
  // Status colors
  destructive: '#FF3B30',
  warning: '#FF9500',
  social: '#FF3B30',
  success: '#34C759',
  
  // Star rating
  star: '#FFD700',
  starEmpty: '#3A3A3C',
  
  // Domain colors (adjusted for dark theme)
  sport: '#00BFA5',
  coaching: '#00BCD4',
  service: '#FF9500',
  socialDomain: '#FF3B30',
  
  // Header specific
  header: '#0D3B3B', // Dark teal for headers
  headerText: '#00BFA5',
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const Radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  full: 9999,
};

export const Shadow = {
  soft: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  floating: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 8,
  },
};
