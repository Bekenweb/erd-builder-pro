import { createContext, useContext, type MutableRefObject } from 'react';

export type FileSessionScope = { active: MutableRefObject<boolean>; host: MutableRefObject<HTMLDivElement | null> };
export const FileSessionContext = createContext<FileSessionScope | null>(null);
export const useFileSession = () => useContext(FileSessionContext);
export function useEditorActive() {
  const scope = useFileSession();
  return () => scope ? scope.active.current : !document.querySelector('[data-file-session]');
}
