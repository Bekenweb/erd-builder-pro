import { prisma } from "../../lib/prisma.js";
import { isDesktopMode } from "../../lib/config.js";
import { deleteEntityRevisions } from "../../lib/entity-history.js";
import { trashRetentionDays } from "../../lib/storage-maintenance.js";
import { fileScopeWhere, projectScopeWhere } from "../../lib/team-scope.js";

export async function fetchTrashItems(userId: string) {
  const [diagrams, dbClients, notes, drawings, flowcharts, projects] = await Promise.all([
    prisma?.diagram.findMany({
      where: { isDeleted: true, ...fileScopeWhere(userId), sourceType: { not: "production_db" } },
      include: { project: { select: { name: true } } },
      orderBy: { deletedAt: "desc" },
    }),
    isDesktopMode() ? (prisma as any)?.dbClient.findMany({
      where: { isDeleted: true, ...fileScopeWhere(userId) },
      include: { project: { select: { name: true } } },
      orderBy: { deletedAt: "desc" },
    }) : Promise.resolve([]),
    prisma?.note.findMany({
      where: { isDeleted: true, ...fileScopeWhere(userId) },
      include: { project: { select: { name: true } } },
      orderBy: { deletedAt: "desc" },
    }),
    prisma?.drawing.findMany({
      where: { isDeleted: true, ...fileScopeWhere(userId) },
      include: { project: { select: { name: true } } },
      orderBy: { deletedAt: "desc" },
    }),
    prisma?.flowchart.findMany({
      where: { isDeleted: true, ...fileScopeWhere(userId) },
      include: { project: { select: { name: true } } },
      orderBy: { deletedAt: "desc" },
    }),
    prisma?.project.findMany({
      where: { isDeleted: true, ...projectScopeWhere(userId) },
      orderBy: { deletedAt: "desc" },
    }),
  ]);

  return {
    diagrams: diagrams || [],
    dbClients: dbClients || [],
    notes: notes || [],
    drawings: drawings || [],
    flowcharts: flowcharts || [],
    projects: projects || [],
    // Days before Trash is purged automatically; 0 means never (Self-host default). The Cloud notice reads it (Q19).
    retention_days: trashRetentionDays(),
  };
}

/** Permanently deletes every Trash item the caller created in the active workspace (Cloud "Empty Trash", Q19). */
export async function emptyTrash(userId: string): Promise<number> {
  const db = prisma as any;
  const mine = { isDeleted: true, userId, ...fileScopeWhere(userId) };
  const [notes, drawings, flowcharts, diagrams, projects] = await Promise.all([
    db.note.findMany({ where: mine, select: { id: true } }),
    db.drawing.findMany({ where: mine, select: { id: true } }),
    db.flowchart.findMany({ where: mine, select: { id: true } }),
    db.diagram.findMany({ where: { ...mine, sourceType: { not: "production_db" } }, select: { id: true } }),
    db.project.findMany({ where: { isDeleted: true, userId, ...projectScopeWhere(userId) }, select: { id: true } }),
  ]);
  const ids = (rows: Array<{ id: number }>) => rows.map((row) => row.id);
  await db.note.deleteMany({ where: { id: { in: ids(notes) } } });
  await db.drawing.deleteMany({ where: { id: { in: ids(drawings) } } });
  await db.flowchart.deleteMany({ where: { id: { in: ids(flowcharts) } } });
  await Promise.all([
    deleteEntityRevisions("notes", ids(notes)),
    deleteEntityRevisions("drawings", ids(drawings)),
    deleteEntityRevisions("flowcharts", ids(flowcharts)),
  ]);
  const { permanentDeleteDiagram } = await import("../diagrams/service.js");
  for (const diagram of diagrams) await permanentDeleteDiagram(diagram.id);
  const { permanentDeleteProject } = await import("../projects/service.js");
  for (const project of projects) await permanentDeleteProject(project.id, userId);
  return notes.length + drawings.length + flowcharts.length + diagrams.length + projects.length;
}
