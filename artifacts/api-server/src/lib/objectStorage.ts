import { File, Storage } from "@google-cloud/storage";

const SIDECAR = "http://127.0.0.1:1106";
const storage = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${SIDECAR}/token`,
    type: "external_account",
    credential_source: { url: `${SIDECAR}/credential`, format: { type: "json", subject_token_field_name: "access_token" } },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

function parsePath(path: string) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const parts = normalized.split("/");
  if (parts.length < 3 || !parts[1] || !parts.slice(2).join("/")) throw new Error("Invalid object path");
  return { bucket: parts[1], name: parts.slice(2).join("/") };
}

export class ObjectNotFoundError extends Error {}

export class ObjectStorageService {
  private privateDir() {
    const value = process.env.PRIVATE_OBJECT_DIR;
    if (!value) throw new Error("PRIVATE_OBJECT_DIR is not configured");
    return value.replace(/\/$/, "");
  }

  async requestUploadUrl() {
    const { bucket, name } = parsePath(`${this.privateDir()}/uploads/${crypto.randomUUID()}`);
    const response = await fetch(`${SIDECAR}/object-storage/signed-object-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bucket_name: bucket, object_name: name, method: "PUT", expires_at: new Date(Date.now() + 15 * 60_000).toISOString() }),
    });
    if (!response.ok) throw new Error(`Unable to sign upload URL (${response.status})`);
    const body = await response.json() as { signed_url: string };
    return { uploadURL: body.signed_url, objectPath: `/objects/${name.slice(name.indexOf("/") + 1)}` };
  }

  async getFile(objectPath: string): Promise<File> {
    if (!objectPath.startsWith("/objects/")) throw new ObjectNotFoundError("Object not found");
    const { bucket, name } = parsePath(`${this.privateDir()}/${objectPath.slice("/objects/".length)}`);
    const file = storage.bucket(bucket).file(name);
    const [exists] = await file.exists();
    if (!exists) throw new ObjectNotFoundError("Object not found");
    return file;
  }

  async download(objectPath: string) {
    const file = await this.getFile(objectPath);
    const [metadata] = await file.getMetadata();
    const [bytes] = await file.download();
    return { bytes, contentType: metadata.contentType ?? "application/octet-stream" };
  }
}

export const objectStorage = new ObjectStorageService();