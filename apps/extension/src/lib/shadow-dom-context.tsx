import React, { createContext, useContext } from 'react';

interface ShadowDomContextType {
  shadowRoot: ShadowRoot | null;
}

const ShadowDomContext = createContext<ShadowDomContextType>({
  shadowRoot: null,
});

export const useShadowDom = () => useContext(ShadowDomContext);

export const ShadowDomProvider: React.FC<{
  shadowRoot: ShadowRoot;
  children: React.ReactNode;
}> = ({ shadowRoot, children }) => {
  return <ShadowDomContext.Provider value={{ shadowRoot }}>{children}</ShadowDomContext.Provider>;
};
