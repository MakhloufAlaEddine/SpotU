import React, { createContext, useContext, useState, ReactNode, useEffect } from 'react';
import { t as translate, setLang, getLang, Lang } from '../lib/i18n';
import { storage } from '../lib/storage';

interface LanguageContextType {
  lang: Lang;
  setLanguage: (lang: Lang) => void;
  t: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextType>({
  lang: 'fr',
  setLanguage: () => {},
  t: (key) => key,
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('fr');

  useEffect(() => {
    storage.get('spotu_lang').then((saved) => {
      if (saved === 'fr' || saved === 'en') {
        setLangState(saved);
        setLang(saved);
      }
    });
  }, []);

  const setLanguage = (l: Lang) => {
    setLangState(l);
    setLang(l);
    storage.set('spotu_lang', l);
  };

  const tFn = (key: string) => translate(key, lang);

  return (
    <LanguageContext.Provider value={{ lang, setLanguage, t: tFn }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLang() {
  return useContext(LanguageContext);
}
