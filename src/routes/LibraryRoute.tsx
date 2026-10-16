import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, FileImage, RefreshCw, Trash2, Undo2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import ConfirmModal from "@/components/ConfirmModal";
import { formatBytes } from "@/components/settings/UsageTab";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiFetch, getApiBaseUrl } from "@/lib/api";

type LibraryItem = {
  key: string;
  feature: string;
  mime_type: string;
  bytes: number;
  status: "committed" | "deleted";
  unused: boolean;
  uploaded_by_name: string | null;
  created_at: string;
  deleted_at: string | null;
  can_delete: boolean;
};

type LibraryPage = { scope: "team" | "user"; page: number; page_size: number; total: number; can_bulk_delete: boolean; items: LibraryItem[] };
type Pending = { items: LibraryItem[]; message: string } | null;

/** Days a deleted asset stays recoverable before background cleanup removes it (CLD-010 Q17). */
const GRACE_DAYS = 30;
const FILTER_LABELS = { all: "All files", unused: "Unused only" } as const;
const SORT_LABELS = { size: "Largest first", date: "Newest first" } as const;

/**
 * Library of the active workspace (CLD-010 Q15): every asset the Team (or the Personal Workspace) uploaded, never
 * another workspace's. The server decides the scope from the active Team header, not from this page.
 */
export function LibraryRoute() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<"all" | "unused">("all");
  const [sort, setSort] = useState<"size" | "date">("size");
  const [data, setData] = useState<LibraryPage | null>(null);
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<Pending>(null);

  const [page, setPage] = useState(1);

  const load = useCallback(async (page: number) => {
    setLoading(true);
    try {
      const response = await apiFetch(`/api/library?filter=${filter}&sort=${sort}&page=${page}`);
      if (!response.ok) throw new Error();
      const body: LibraryPage = await response.json();
      setData(body);
      // Deleting the last file of a page moves back one page instead of showing an empty one.
      if (body.items.length === 0 && page > 1) { setPage(page - 1); return; }
      setItems(body.items);
    } catch {
      toast.error("The Library could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [filter, sort]);

  useEffect(() => { void load(page); }, [load, page]);

  const askDelete = async (selected: LibraryItem[]) => {
    if (selected.length === 1) {
      const response = await apiFetch(`/api/library/usage?key=${encodeURIComponent(selected[0].key)}`);
      const body = await response.json().catch(() => ({ documents: [] }));
      if (body.documents?.length) {
        const names = body.documents.map((doc: { title: string; isDeleted: boolean }) => doc.title + (doc.isDeleted ? " (in Trash)" : "")).join(", ");
        toast.error(`This image is still used by: ${names}. Remove it from those documents first.`);
        return;
      }
    }
    setPending({
      items: selected,
      message: `${selected.length === 1 ? "This image" : `${selected.length} unused images`} will stop counting toward storage now and be removed for good after ${GRACE_DAYS} days. You can undo until then.`,
    });
  };

  const confirmDelete = async () => {
    const selected = pending?.items ?? [];
    setPending(null);
    let failed = 0;
    for (const item of selected) {
      const response = await apiFetch("/api/library", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: item.key }) });
      if (!response.ok) failed++;
    }
    if (failed) toast.error(`${failed} image${failed === 1 ? " is" : "s are"} still in use and ${failed === 1 ? "was" : "were"} kept.`);
    else toast.success(selected.length === 1 ? "Image deleted" : "Unused images deleted");
    void load(page);
  };

  const undo = async (item: LibraryItem) => {
    const response = await apiFetch("/api/library/restore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: item.key }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) { toast.error(body.error || "The image could not be restored."); return; }
    toast.success("Image restored");
    void load(page);
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  const unusedDeletable = items.filter((item) => item.unused && item.status === "committed" && item.can_delete);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-background">
      <div className="shrink-0 border-b p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Button variant="ghost" size="sm" className="-ml-2 mb-2" onClick={() => navigate(-1)}>
              <ArrowLeft className="mr-1 size-4" /> Back
            </Button>
            <h2 className="flex items-center gap-2 text-2xl font-bold"><FileImage className="size-6 text-muted-foreground" /> Library</h2>
            <p className="text-sm text-muted-foreground">
              Files uploaded to {data?.scope === "user" ? "your Personal Workspace" : "this Team workspace by all members"}. Unused files still count toward storage until deleted.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Select value={filter} onValueChange={(value) => { if (value) { setFilter(value as "all" | "unused"); setPage(1); } }}>
              <SelectTrigger size="sm" aria-label="Filter" className="w-32">
                <SelectValue>{FILTER_LABELS[filter]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{FILTER_LABELS.all}</SelectItem>
                <SelectItem value="unused">{FILTER_LABELS.unused}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sort} onValueChange={(value) => { if (value) { setSort(value as "size" | "date"); setPage(1); } }}>
              <SelectTrigger size="sm" aria-label="Sort" className="w-36">
                <SelectValue>{SORT_LABELS[sort]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="size">{SORT_LABELS.size}</SelectItem>
                <SelectItem value="date">{SORT_LABELS.date}</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => void load(page)} disabled={loading}>
              <RefreshCw className={`mr-1 size-4 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
            {data?.can_bulk_delete && unusedDeletable.length > 0 && (
              <Button variant="destructive" size="sm" onClick={() => void askDelete(unusedDeletable)}>
                <Trash2 className="mr-1 size-4" /> Delete unused ({unusedDeletable.length})
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-6 custom-scrollbar">
        {!loading && items.length === 0 ? (
          <div className="rounded-lg border border-dashed py-12 text-center text-muted-foreground">
            {filter === "unused" ? "No unused files." : "No files uploaded yet."}
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">Preview</TableHead>
                  <TableHead>File</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Uploaded</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.key}>
                    <TableCell>
                      {item.mime_type.startsWith("image/") && item.status === "committed" ? (
                        <img src={`${getApiBaseUrl()}/api/serve/${item.key}`} alt="" loading="lazy" decoding="async" className="h-12 w-16 rounded border object-cover" />
                      ) : (
                        <div className="flex h-12 w-16 items-center justify-center rounded border text-muted-foreground"><FileImage className="size-5" /></div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{item.key.split("/").pop()}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Badge variant="outline" className="capitalize">{item.feature}</Badge>
                        {item.status === "deleted" ? (
                          <Badge variant="destructive">Deleted · removed {new Date(new Date(item.deleted_at || item.created_at).getTime() + GRACE_DAYS * 86_400_000).toLocaleDateString()}</Badge>
                        ) : item.unused ? <Badge variant="secondary">Unused</Badge> : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{formatBytes(item.bytes)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(item.created_at).toLocaleString()}
                      {item.uploaded_by_name && <span className="block">{item.uploaded_by_name}</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      {!item.can_delete ? (
                        <span className="text-xs text-muted-foreground">Uploader or Manager only</span>
                      ) : item.status === "deleted" ? (
                        <Button variant="outline" size="sm" onClick={() => void undo(item)}><Undo2 className="mr-1 size-4" /> Undo</Button>
                      ) : (
                        <Button variant="destructive" size="sm" onClick={() => void askDelete([item])}><Trash2 className="mr-1 size-4" /> Delete</Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {data && totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Page {page} of {totalPages} · {data.total} files</span>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon-xs" aria-label="Previous page" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 2)
                .reduce<(number | "ellipsis")[]>((acc, p, idx, arr) => {
                  if (idx > 0 && p - arr[idx - 1] > 1) acc.push("ellipsis");
                  acc.push(p);
                  return acc;
                }, [])
                .map((item, index) =>
                  item === "ellipsis" ? (
                    <span key={`e-${index}`} className="px-1 text-xs text-muted-foreground">...</span>
                  ) : (
                    <Button
                      key={item}
                      variant={item === page ? "default" : "outline"}
                      size="icon-xs"
                      aria-current={item === page ? "page" : undefined}
                      disabled={loading}
                      onClick={() => setPage(item)}
                      className={item === page ? "" : "text-muted-foreground"}
                    >
                      {item}
                    </Button>
                  ),
                )}
              <Button variant="outline" size="icon-xs" aria-label="Next page" disabled={page >= totalPages || loading} onClick={() => setPage(page + 1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      <ConfirmModal
        isOpen={pending !== null}
        title="Delete from Library?"
        message={pending?.message ?? ""}
        confirmText="Delete"
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}
