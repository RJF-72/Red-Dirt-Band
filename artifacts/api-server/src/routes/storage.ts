import { getAuth } from "@clerk/express";
import { and, eq } from "drizzle-orm";
import { Router } from "express";
import { db, studioObjectsTable } from "@workspace/db";
import { objectStorage, ObjectNotFoundError } from "../lib/objectStorage";

const router = Router();

router.post("/storage/uploads/request-url", async (req, res): Promise<void> => {
  const owner = getAuth(req).userId;
  if (!owner) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const { name, size, contentType } = req.body ?? {};
  if (typeof name !== "string" || typeof size !== "number" || size < 1 || size > 100_000_000 || typeof contentType !== "string") {
    res.status(400).json({ error: "name, size, and contentType are required" });
    return;
  }
  try {
    const signed = await objectStorage.requestUploadUrl();
    await db.insert(studioObjectsTable).values({
      objectPath: signed.objectPath,
      userId: owner,
      contentType,
    });
    res.json({ ...signed, metadata: { name, size, contentType } });
  } catch (error) {
    req.log.error({ err: error }, "Unable to create object upload URL");
    res.status(500).json({ error: "Unable to create upload URL" });
  }
});

router.get("/storage/objects/*path", async (req, res): Promise<void> => {
  const owner = getAuth(req).userId;
  if (!owner) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const raw = req.params.path;
  const objectPath = `/objects/${Array.isArray(raw) ? raw.join("/") : raw}`;
  try {
    const [record] = await db.select({ objectPath: studioObjectsTable.objectPath }).from(studioObjectsTable).where(and(
      eq(studioObjectsTable.objectPath, objectPath),
      eq(studioObjectsTable.userId, owner),
    ));
    if (!record) {
      res.status(404).json({ error: "Object not found" });
      return;
    }
    const file = await objectStorage.download(objectPath);
    res.setHeader("Content-Type", file.contentType);
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.send(file.bytes);
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Object not found" });
      return;
    }
    req.log.error({ err: error }, "Unable to serve object");
    res.status(500).json({ error: "Unable to serve object" });
  }
});

export default router;