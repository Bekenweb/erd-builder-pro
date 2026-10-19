import { createContext, useContext } from 'react';
import type { PaneFile } from '@/lib/file-panes';

export const FilePanesContext = createContext<{
  files: PaneFile[];
  focused: string;
  desktop: boolean;
  open: (file: PaneFile) => void;
  select: (file: PaneFile) => void;
  close: (file: PaneFile) => void;
} | null>(null);
export const useFilePanes = () => useContext(FilePanesContext);
