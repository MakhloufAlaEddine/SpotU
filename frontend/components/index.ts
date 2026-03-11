/**
 * components/index.ts
 * Point d'entrée unique pour tous les composants partagés.
 * Usage : import { UserAvatar, ScreenLoader, EmptyState, SpotYouCard } from '../components';
 */
export { UserAvatar } from './UserAvatar';
export type { UserAvatarProps } from './UserAvatar';

export { ScreenLoader } from './ScreenLoader';
export type { ScreenLoaderProps } from './ScreenLoader';

export { EmptyState } from './EmptyState';
export type { EmptyStateProps } from './EmptyState';

export { SpotYouCard } from './SpotYouCard';
export type { SpotYouCardProps } from './SpotYouCard';

export { StaleBanner, OfflineBanner, ErrorNoData } from './OfflineBanner';
