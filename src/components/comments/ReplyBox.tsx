import { useEffect, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CommentAvatar } from '@/components/comments/CommentThreadView';

/** Notion-style reply row: a quiet "Reply…" line that opens into an input with cancel (X) and send (check). */
export function ReplyBox({ userName, value, onChange, onSubmit, disabled = false, placeholder = 'Reply…', submitLabel = 'Send reply' }: {
  userName: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  placeholder?: string;
  submitLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const expanded = open || value.length > 0;

  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  useEffect(() => {
    const element = input.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 128)}px`;
  }, [value, expanded]);

  const cancel = () => { onChange(''); setOpen(false); };
  const submit = () => {
    if (!value.trim() || disabled) return;
    onSubmit();
    setOpen(false); // stays expanded while the draft is kept after a failed send
  };

  if (!expanded) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="flex w-full shrink-0 items-center gap-2.5 border-t border-border px-4 py-2.5 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/50">
        <CommentAvatar name={userName} className="size-7" />
        {placeholder}
      </button>
    );
  }

  return (
    <form onSubmit={(event) => { event.preventDefault(); submit(); }} className="shrink-0 border-t border-border p-3">
      <div className="flex items-end gap-1.5 rounded-lg border border-primary/60 bg-background px-2.5 py-1.5 ring-2 ring-primary/20">
        <textarea data-comment-draft
          ref={input}
          rows={1}
          maxLength={4000}
          value={value}
          disabled={disabled}
          aria-label={submitLabel}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); }
          }}
          className="min-h-6 max-h-32 flex-1 resize-none bg-transparent py-0.5 text-sm outline-none placeholder:text-muted-foreground"
        />
        <Button type="button" variant="secondary" size="icon-xs" className="rounded-full" aria-label="Cancel reply" onClick={cancel} disabled={disabled}>
          <X aria-hidden="true" className="size-3.5" />
        </Button>
        <Button type="submit" size="icon-xs" className="rounded-full" aria-label={submitLabel} disabled={!value.trim() || disabled}>
          <Check aria-hidden="true" className="size-3.5" />
        </Button>
      </div>
    </form>
  );
}
