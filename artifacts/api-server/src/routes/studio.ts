import { getAuth } from "@clerk/express";
import { and, desc, eq, inArray } from "drizzle-orm";
import { Router, type Request } from "express";
import { db, instrumentPackagesTable, referenceLayersTable, songProjectsTable, studioObjectsTable } from "@workspace/db";
import { requireOwner } from "./owner";

const router = Router();

function userId(req: Request) {
  return getAuth(req).userId;
}

async function hasOwnedObjects(owner: string, paths: unknown[]) {
  const uniquePaths = [...new Set(paths.filter((path): path is string => typeof path === "string" && path.startsWith("/objects/")))];
  if (!uniquePaths.length) return true;
  const owned = await db.select({ objectPath: studioObjectsTable.objectPath }).from(studioObjectsTable).where(and(
    eq(studioObjectsTable.userId, owner),
    inArray(studioObjectsTable.objectPath, uniquePaths),
  ));
  return owned.length === uniquePaths.length;
}

function projectObjectPaths(body: Record<string, unknown>) {
  const assets = body.assets && typeof body.assets === "object" && !Array.isArray(body.assets) ? Object.values(body.assets as Record<string, unknown>).flatMap((layers) =>
    Array.isArray(layers) ? layers.map((layer) => (layer && typeof layer === "object" ? (layer as { objectPath?: unknown }).objectPath : undefined)) : [],
  ) : [];
  const history = Array.isArray(body.renderHistory) ? body.renderHistory : [];
  const renders = history.flatMap((render) => {
    if (!render || typeof render !== "object") return [];
    const item = render as { masterObjectPath?: unknown; stems?: unknown };
    return [item.masterObjectPath, ...(item.stems && typeof item.stems === "object" ? Object.values(item.stems as Record<string, unknown>) : [])];
  });
  return [...assets, ...renders];
}

router.get("/studio/library", async (req, res): Promise<void> => {
  const owner = userId(req);
  if (!owner) { res.status(401).json({ error: "Unauthorized" }); return; }
  const [projects, packages, references] = await Promise.all([
    db.select().from(songProjectsTable).where(eq(songProjectsTable.userId, owner)).orderBy(desc(songProjectsTable.updatedAt)),
    db.select().from(instrumentPackagesTable).where(eq(instrumentPackagesTable.userId, owner)).orderBy(desc(instrumentPackagesTable.updatedAt)),
    db.select().from(referenceLayersTable).where(eq(referenceLayersTable.userId, owner)).orderBy(desc(referenceLayersTable.createdAt)),
  ]);
  res.json({ projects, packages, references });
});

router.post("/studio/references/:instrumentId", async (req, res): Promise<void> => {
  if (!await requireOwner(req, res)) return;
  const owner = userId(req);
  if (!owner) { res.status(401).json({ error: "Unauthorized" }); return; }
  const layers = req.body?.layers;
  if (!Array.isArray(layers) || !layers.length || layers.length > 100 || layers.some((layer) => !layer || typeof layer.objectPath !== "string" || !layer.metadata || typeof layer.metadata !== "object")) {
    res.status(400).json({ error: "Reference layers are required" }); return;
  }
  if (!await hasOwnedObjects(owner, layers.map((layer) => layer.objectPath))) {
    res.status(403).json({ error: "A reference layer is not owned by this account" }); return;
  }
  const inserted = await db.insert(referenceLayersTable).values(layers.map((layer) => ({
    userId: owner, instrumentId: req.params.instrumentId, objectPath: layer.objectPath, metadata: layer.metadata,
  }))).onConflictDoNothing().returning();
  res.status(201).json(inserted);
});

router.get("/studio/projects/:id", async (req, res): Promise<void> => {
  const owner = userId(req);
  if (!owner) { res.status(401).json({ error: "Unauthorized" }); return; }
  const [project] = await db.select().from(songProjectsTable).where(and(eq(songProjectsTable.id, req.params.id), eq(songProjectsTable.userId, owner)));
  if (!project) { res.status(404).json({ error: "Song project not found" }); return; }
  res.json(project);
});

router.put("/studio/projects/:id", async (req, res): Promise<void> => {
  const owner = userId(req);
  if (!owner) { res.status(401).json({ error: "Unauthorized" }); return; }
  const body = req.body ?? {};
  if (typeof body.title !== "string" || !body.song || !Array.isArray(body.arrangement) || !body.musicianMix || !body.assets || typeof body.assets !== "object" || Array.isArray(body.assets)) {
    res.status(400).json({ error: "A complete song project is required" }); return;
  }
  if (!await hasOwnedObjects(owner, projectObjectPaths(body))) {
    res.status(403).json({ error: "A project cannot reference files owned by another account" }); return;
  }
  const values = { userId: owner, title: body.title, song: body.song, arrangement: body.arrangement, lyricCues: body.lyricCues ?? [], musicianMix: body.musicianMix, assets: body.assets, renderHistory: body.renderHistory ?? [] };
  const [existing] = await db.select({ id: songProjectsTable.id }).from(songProjectsTable).where(and(eq(songProjectsTable.id, req.params.id), eq(songProjectsTable.userId, owner)));
  const [project] = existing
    ? await db.update(songProjectsTable).set({ ...values, updatedAt: new Date() }).where(and(eq(songProjectsTable.id, req.params.id), eq(songProjectsTable.userId, owner))).returning()
    : await db.insert(songProjectsTable).values({ id: req.params.id, ...values }).returning();
  res.json(project);
});

router.delete("/studio/projects/:id", async (req, res): Promise<void> => {
  const owner = userId(req);
  if (!owner) { res.status(401).json({ error: "Unauthorized" }); return; }
  await db.delete(songProjectsTable).where(and(eq(songProjectsTable.id, req.params.id), eq(songProjectsTable.userId, owner)));
  res.sendStatus(204);
});

router.put("/studio/packages/:instrumentId", async (req, res): Promise<void> => {
  if (!await requireOwner(req, res)) return;
  const owner = userId(req);
  if (!owner) { res.status(401).json({ error: "Unauthorized" }); return; }
  const body = req.body ?? {};
  if (typeof body.fileName !== "string" || typeof body.sdkFileName !== "string" || typeof body.aimObjectPath !== "string" || typeof body.sdkObjectPath !== "string" || typeof body.layers !== "number") {
    res.status(400).json({ error: "A complete instrument package is required" }); return;
  }
  if (!await hasOwnedObjects(owner, [body.aimObjectPath, body.sdkObjectPath])) {
    res.status(403).json({ error: "An instrument package cannot reference files owned by another account" }); return;
  }
  const [existing] = await db.select({ id: instrumentPackagesTable.id }).from(instrumentPackagesTable).where(and(eq(instrumentPackagesTable.userId, owner), eq(instrumentPackagesTable.instrumentId, req.params.instrumentId)));
  const values = { userId: owner, instrumentId: req.params.instrumentId, fileName: body.fileName, sdkFileName: body.sdkFileName, aimObjectPath: body.aimObjectPath, sdkObjectPath: body.sdkObjectPath, layers: String(body.layers) };
  const [item] = existing
    ? await db.update(instrumentPackagesTable).set({ ...values, updatedAt: new Date() }).where(eq(instrumentPackagesTable.id, existing.id)).returning()
    : await db.insert(instrumentPackagesTable).values(values).returning();
  res.json(item);
});

router.delete("/studio/packages/:instrumentId", async (req, res): Promise<void> => {
  if (!await requireOwner(req, res)) return;
  const owner = userId(req);
  if (!owner) { res.status(401).json({ error: "Unauthorized" }); return; }
  await db.delete(instrumentPackagesTable).where(and(eq(instrumentPackagesTable.userId, owner), eq(instrumentPackagesTable.instrumentId, req.params.instrumentId)));
  res.sendStatus(204);
});

export default router;