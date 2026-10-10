import { createContext, useContext } from 'react';

/**
 * The few workspace values a table node needs. WorkspaceContext also carries `nodes` and `edges`, so any
 * consumer of it re-renders on every drag frame; every table reading this small, stable context does not.
 */
export interface EntityNodeContextValue {
  /** Public link, or a Team file owned by someone else. */
  isReadOnly: boolean;
  sourceType: string | undefined;
  duplicateEntity: (id: string) => void;
  setSelectedNodeId: (id: string | null) => void;
}

const EntityNodeContext = createContext<EntityNodeContextValue | null>(null);

export const EntityNodeProvider = EntityNodeContext.Provider;

export function useEntityNodeContext(): EntityNodeContextValue {
  const value = useContext(EntityNodeContext);
  if (!value) throw new Error('useEntityNodeContext must be used within WorkspaceProvider');
  return value;
}
