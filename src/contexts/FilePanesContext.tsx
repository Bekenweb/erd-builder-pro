import { createContext, useContext } from 'react';
import type { PaneFile } from '@/lib/file-panes';

export const FilePanesContext = createContext<{
  files: PaneFile[];
  focused: string;
  desktop: boolean;
  /** False on hosts without a pane-capable file (e.g. DB Client), where open() has no base file to pair with. */
  canSplit: boolean;
  open: (file: PaneFile) => void;
  select: (file: PaneFile) => void;
  close: (file: PaneFile) => void;
} | null>(null);
export const useFilePanes = () => useContext(FilePanesContext);
