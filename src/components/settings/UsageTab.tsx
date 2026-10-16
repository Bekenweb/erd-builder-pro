import { useCallback, useEffect, useState } from "react";
import { HardDrive, RefreshCw, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";

type Usage = {
  scope: "team" | "user";
  upgrade_url: string | null;
  storage: {
    used_bytes: number;
    limit_bytes: number | null;
    remaining_bytes: number | null;
    document_bytes: number;
    asset_bytes: number;
    unused_bytes: number;
    unused_count: number;
    documents_recomputed_at: string | null;
  };
  ai: { included: false } | { included: true; used_credits: number; limit_credits: number; remaining_credits: number; period_end: string | null };
};

/** Binary units, so 1 GB here is 1024 MB, the definition the pricing page uses (CLD-010). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

function Meter({ used, limit }: { used: number; limit: number }) {
  const percent = Math.min(100, Math.round((used / Math.max(1, limit)) * 100));
  const tone = percent >= 100 ? "bg-destructive" : percent >= 80 ? "bg-amber-500" : "bg-primary";
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted" role="meter" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={`${percent}% used`}>
      <div className={`h-full ${tone}`} style={{ width: `${percent}%` }} />
    </div>
  );
}

/** Remaining storage and AI credits of the active workspace (CLD-010 Tahap U); numbers come from the server only. */
export function UsageTab({ onClose }: { onClose?: () => void }) {
  const navigate = useNavigate();
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const response = await apiFetch("/api/cloud/usage");
      if (!response.ok) throw new Error("usage unavailable");
      setUsage(await response.json());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const storage = usage?.storage;
  const percent = storage?.limit_bytes ? (storage.used_bytes / storage.limit_bytes) * 100 : 0;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Usage</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {usage?.scope === "user" ? "Your Personal Workspace." : "The active Team workspace, shared by all members."}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`mr-1 size-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">Usage could not be loaded. Try again later.</p>}

      {storage && (
        <section className="space-y-3 rounded-lg border p-4" aria-labelledby="usage-storage">
          <h3 id="usage-storage" className="flex items-center gap-2 font-medium"><HardDrive className="size-4" /> Storage</h3>
          {storage.limit_bytes !== null ? (
            <>
              <Meter used={storage.used_bytes} limit={storage.limit_bytes} />
              <p className="text-sm">
                <span className="font-semibold">{formatBytes(storage.used_bytes)}</span> of {formatBytes(storage.limit_bytes)} used ·{" "}
                {formatBytes(storage.remaining_bytes ?? 0)} left
              </p>
            </>
          ) : (
            <p className="text-sm"><span className="font-semibold">{formatBytes(storage.used_bytes)}</span> used · no storage limit</p>
          )}
          <p className="text-xs text-muted-foreground">
            Documents {formatBytes(storage.document_bytes)} · Images {formatBytes(storage.asset_bytes)}. Files in the Trash count until they are deleted.
          </p>
          {percent >= 80 && (
            <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
              {percent >= 100 ? "Storage is full: new files and uploads are refused. Existing files stay editable." : "Storage is almost full."}
            </p>
          )}
          {storage.unused_count > 0 && (
            <p className="text-sm">{storage.unused_count} unused image{storage.unused_count === 1 ? "" : "s"} ({formatBytes(storage.unused_bytes)}) can be cleaned up.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => { onClose?.(); navigate("/library"); }}>Open Library</Button>
            {usage?.upgrade_url && percent >= 80 && (
              <Button size="sm" onClick={() => window.location.assign(usage.upgrade_url!)}>Upgrade plan</Button>
            )}
          </div>
        </section>
      )}

      {usage && (
        <section className="space-y-3 rounded-lg border p-4" aria-labelledby="usage-ai">
          <h3 id="usage-ai" className="flex items-center gap-2 font-medium"><Sparkles className="size-4" /> AI credits</h3>
          {usage.ai.included ? (
            <>
              <Meter used={usage.ai.used_credits} limit={usage.ai.limit_credits} />
              <p className="text-sm">
                <span className="font-semibold">{usage.ai.remaining_credits}</span> of {usage.ai.limit_credits} credits left
                {usage.ai.period_end ? ` · resets ${new Date(usage.ai.period_end).toLocaleDateString()}` : ""}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Not included in this plan.</p>
          )}
        </section>
      )}
    </div>
  );
}
