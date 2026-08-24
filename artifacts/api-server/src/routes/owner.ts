import { clerkClient, getAuth } from "@clerk/express";
import { Router, type IRouter, type Request, type Response } from "express";

const router: IRouter = Router();

function normalizedEmails(value: string) {
  return value
    .split(/[,\s;]+/)
    .map((email) => email.trim().toLowerCase().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
}

export async function isOwner(req: Request) {
  const { userId } = getAuth(req);
  const ownerEmails = process.env.AIM_OWNER_EMAIL ? normalizedEmails(process.env.AIM_OWNER_EMAIL) : [];
  if (!userId || !ownerEmails.length) return false;

  try {
    const user = await clerkClient.users.getUser(userId);
    const emails = user.emailAddresses.map((email) => email.emailAddress.trim().toLowerCase());
    return emails.some((email) => ownerEmails.includes(email));
  } catch (error) {
    req.log.error({ err: error }, "Unable to verify owner access");
    throw error;
  }
}

export async function requireOwner(req: Request, res: Response) {
  if (!getAuth(req).userId) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  if (!process.env.AIM_OWNER_EMAIL || !normalizedEmails(process.env.AIM_OWNER_EMAIL).length) {
    res.status(503).json({ error: "Owner access has not been configured." });
    return false;
  }
  try {
    if (await isOwner(req)) return true;
    res.status(403).json({ error: "The private AIM workbench is available to the owner only." });
    return false;
  } catch {
    res.status(503).json({ error: "Owner access could not be verified." });
    return false;
  }
}

router.get("/owner-access", async (req, res) => {
  if (!getAuth(req).userId) {
    res.status(401).json({ isOwner: false });
    return;
  }
  if (!process.env.AIM_OWNER_EMAIL || !normalizedEmails(process.env.AIM_OWNER_EMAIL).length) {
    res.json({ isOwner: false });
    return;
  }
  try {
    res.json({ isOwner: await isOwner(req) });
  } catch {
    res.json({ isOwner: false });
  }
});

export default router;