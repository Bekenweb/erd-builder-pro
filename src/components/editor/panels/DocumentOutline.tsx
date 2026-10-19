import { useState } from 'react';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';

export interface HeadingInfo {
  text: string;
  level: number;
  pos: number;
}

export function DocumentOutline({ headings, scrollToHeading }: {
  headings: HeadingInfo[];
  scrollToHeading: (pos: number) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!headings.length) return null;
  return <div className="absolute left-2 top-1/2 z-40 max-h-[60%] -translate-y-1/2 sm:left-3">
    <HoverCard open={open} onOpenChange={setOpen} openDelay={100} closeDelay={250}>
      <HoverCardTrigger asChild>
        <button type="button" aria-label={`Document Outline: ${headings.length} headings`} aria-expanded={open}
          onClick={() => setOpen(true)} onFocus={() => setOpen(true)}
          onKeyDown={event => { if (event.key === 'Escape') setOpen(false); }}
          className="flex max-h-[50dvh] w-8 flex-col items-start gap-2 overflow-y-auto rounded-md px-1 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {headings.map(heading => <span key={heading.pos} aria-hidden="true" className="h-0.5 shrink-0 rounded-full bg-muted-foreground/40" style={{ width: Math.max(6, 20 - (heading.level - 1) * 3) }} />)}
        </button>
      </HoverCardTrigger>
      <HoverCardContent side="right" align="center" sideOffset={4} collisionPadding={8}
        className="w-64 max-w-[calc(100vw-4rem)] p-2" onKeyDown={event => { if (event.key === 'Escape') setOpen(false); }}>
        <nav aria-label="Note headings" className="flex max-h-[60dvh] min-w-0 flex-col gap-0.5 overflow-y-auto">
          {headings.map(heading => <button key={heading.pos} type="button" title={heading.text}
            className="w-full rounded-md py-1.5 pr-2 text-left text-xs text-popover-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            style={{ paddingLeft: 8 + (heading.level - 1) * 12 }}
            onClick={() => { scrollToHeading(heading.pos); setOpen(false); }}>
            <span className="block truncate">{heading.text || 'Untitled heading'}</span>
          </button>)}
        </nav>
      </HoverCardContent>
    </HoverCard>
  </div>;
}
