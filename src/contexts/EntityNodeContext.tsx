import { createContext, useContext } from 'react';

/**
 * The few workspace values a table node needs. WorkspaceContext is large and changes with many unrelated
 * updates; every table reading this small, stable context skips those re-renders.
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
