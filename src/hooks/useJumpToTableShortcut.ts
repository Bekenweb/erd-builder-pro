import { useEffect } from 'react';
import { useEditorActive } from '@/contexts/FileSessionContext';

export function useJumpToTableShortcut(enabled: boolean, open: () => void) {
  const editorActive = useEditorActive();
  const isMac = typeof navigator !== 'undefined' && /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent);
  useEffect(() => {
    if (!enabled) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!editorActive()) return;
      const modifier = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
      if (!modifier || event.key.toLowerCase() !== 'f' || !event.shiftKey || event.altKey || event.isComposing || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      // Code editors own their local Find; modal dialogs should keep their own keyboard scope.
      if (target?.closest('.cm-editor, [role="dialog"], [role="alertdialog"]')) return;
      event.preventDefault();
      event.stopPropagation();
      open();
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [enabled, isMac, open]);
  return { label: isMac ? '⇧⌘F' : 'Ctrl+Shift+F', ariaKeyShortcuts: isMac ? 'Meta+Shift+F' : 'Control+Shift+F' };
}
