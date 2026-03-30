import React, { createContext, useContext } from 'react';
import { ScrollView } from 'react-native';

export const FlowScrollCtx = createContext<React.RefObject<ScrollView> | null>(null);
export const useFlowScroll = () => useContext(FlowScrollCtx);
