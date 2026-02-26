import React, { createContext, useContext, useState, useCallback } from 'react';

interface RefreshContextType {
  profileKey: number;
  triggerProfileRefresh: () => void;
}

const RefreshContext = createContext<RefreshContextType>({
  profileKey: 0,
  triggerProfileRefresh: () => {},
});

export function RefreshProvider({ children }: { children: React.ReactNode }) {
  const [profileKey, setProfileKey] = useState(0);
  const triggerProfileRefresh = useCallback(() => setProfileKey(k => k + 1), []);
  return (
    <RefreshContext.Provider value={{ profileKey, triggerProfileRefresh }}>
      {children}
    </RefreshContext.Provider>
  );
}

export const useRefresh = () => useContext(RefreshContext);
