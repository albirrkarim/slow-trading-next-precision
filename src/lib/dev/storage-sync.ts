import fs from "fs-extra";
import path from "path";

import storageRoot from "@/lib/system/storage/root";

const DEFAULT_ONLINE_BASE_URL = "https://fast.reinventwp.com";
const SYNC_BACKUP_SUFFIX = "-sync-backups";

export interface PersistentStorageExportFile {
  contentBase64: string;
  path: string;
}

export interface PersistentStorageExportBundle {
  directories: string[];
  exportedAt: string;
  files: PersistentStorageExportFile[];
  rootName: string;
  schemaVersion: 1;
}

export interface PersistentStorageImportResult {
  backupPath: string | null;
  directoriesImported: number;
  filesImported: number;
  storageRoot: string;
}

function normalizeRelativePath(input: string): string {
  const normalized = path.posix.normalize(
    String(input || "").replace(/\\/g, "/"),
  );

  if (
    !normalized ||
    normalized === "." ||
    normalized.startsWith("../") ||
    normalized === ".." ||
    path.isAbsolute(normalized)
  ) {
    throw new Error(`Unsafe storage bundle path: ${input}`);
  }

  return normalized;
}

function toBundlePath(root: string, filePath: string): string {
  return path.relative(root, filePath).split(path.sep).join("/");
}

async function walkPersistentStorage(root: string) {
  const files: string[] = [];
  const directories: string[] = [];

  if (!(await fs.pathExists(root))) {
    return { directories, files };
  }

  async function walk(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        directories.push(toBundlePath(root, fullPath));
        await walk(fullPath);
        continue;
      }

      if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }

  await walk(root);

  return { directories, files };
}

function getSyncBackupRoot(storageRootPath: string) {
  return path.join(
    path.dirname(storageRootPath),
    `${path.basename(storageRootPath)}${SYNC_BACKUP_SUFFIX}`,
  );
}

function makeTimestamp(now = new Date()) {
  return now.toISOString().replace(/[:.]/g, "-");
}

function makeBackupPath(storageRootPath: string, stamp = makeTimestamp()) {
  return path.join(getSyncBackupRoot(storageRootPath), stamp);
}

function makeStagingPath(storageRootPath: string, stamp = makeTimestamp()) {
  return path.join(
    path.dirname(storageRootPath),
    `${path.basename(storageRootPath)}-sync-staging-${stamp}`,
  );
}

export function isLocalPersistentStorageSyncAllowed(host?: string | null) {
  if (process.env.RAILWAY_ENVIRONMENT) {
    return false;
  }

  const normalizedHost = String(host || "").toLowerCase();
  return (
    normalizedHost.startsWith("localhost") ||
    normalizedHost.startsWith("127.0.0.1") ||
    normalizedHost.startsWith("[::1]") ||
    normalizedHost.startsWith("::1")
  );
}

export function isLocalAppName(appName = process.env.APP_NAME) {
  return String(appName ?? "").trim().toLocaleLowerCase() === "localhost";
}

export function isLocalCoinMetadataManualSyncAllowed(host?: string | null) {
  return isLocalAppName() && isLocalPersistentStorageSyncAllowed(host);
}

export function getOnlinePersistentStorageExportUrl(baseUrl?: string) {
  const source =
    baseUrl?.trim() ||
    process.env.SLOW_SYNC_ONLINE_BASE_URL?.trim() ||
    DEFAULT_ONLINE_BASE_URL;
  return new URL("/api/system/debug/export", source).toString();
}

export function getOnlinePersistentStorageImportUrl(baseUrl?: string) {
  const source =
    baseUrl?.trim() ||
    process.env.SLOW_SYNC_ONLINE_BASE_URL?.trim() ||
    DEFAULT_ONLINE_BASE_URL;
  return new URL("/api/system/debug/import", source).toString();
}

export async function exportPersistentStorageBundle(
  root = storageRoot.resolve(),
): Promise<PersistentStorageExportBundle> {
  const { directories, files } = await walkPersistentStorage(root);
  const bundleFiles: PersistentStorageExportFile[] = [];

  for (const file of files) {
    bundleFiles.push({
      path: toBundlePath(root, file),
      contentBase64: (await fs.readFile(file)).toString("base64"),
    });
  }

  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    rootName: path.basename(root),
    directories: directories.sort(),
    files: bundleFiles.sort((a, b) => a.path.localeCompare(b.path)),
  };
}

export async function importPersistentStorageBundle(
  bundle: PersistentStorageExportBundle,
  root = storageRoot.resolve(),
): Promise<PersistentStorageImportResult> {
  if (bundle?.schemaVersion !== 1 || !Array.isArray(bundle.files)) {
    throw new Error("Invalid persistent storage export bundle");
  }

  const stamp = makeTimestamp();
  const stagingPath = makeStagingPath(root, stamp);
  let backupPath: string | null = null;

  try {
    await fs.remove(stagingPath);
    await fs.ensureDir(stagingPath);

    for (const directory of bundle.directories ?? []) {
      const relativePath = normalizeRelativePath(directory);
      await fs.ensureDir(path.join(stagingPath, relativePath));
    }

    for (const file of bundle.files) {
      const relativePath = normalizeRelativePath(file.path);
      const targetPath = path.join(stagingPath, relativePath);
      await fs.ensureDir(path.dirname(targetPath));
      await fs.writeFile(targetPath, Buffer.from(file.contentBase64, "base64"));
    }

    if (await fs.pathExists(root)) {
      backupPath = makeBackupPath(root, stamp);
      await fs.ensureDir(path.dirname(backupPath));
      await fs.copy(root, backupPath, {
        overwrite: false,
        errorOnExist: true,
      });
      await fs.remove(root);
    }

    await fs.move(stagingPath, root, {
      overwrite: false,
    });

    return {
      backupPath,
      directoriesImported: bundle.directories?.length ?? 0,
      filesImported: bundle.files.length,
      storageRoot: root,
    };
  } catch (error) {
    await fs.remove(stagingPath).catch(() => undefined);
    throw error;
  }
}

export async function fetchOnlinePersistentStorageBundle(
  params: {
    onlineBaseUrl?: string;
    token?: string;
  } = {},
) {
  const response = await fetch(
    getOnlinePersistentStorageExportUrl(params.onlineBaseUrl),
    {
      headers: params.token
        ? {
            "x-sync-token": params.token,
          }
        : undefined,
    },
  );

  if (!response.ok) {
    throw new Error(
      `Online persistent storage export failed: ${response.status} ${response.statusText}`,
    );
  }

  return (await response.json()) as PersistentStorageExportBundle;
}

export async function syncOnlinePersistentStorageToLocal(
  params: {
    onlineBaseUrl?: string;
    token?: string;
  } = {},
) {
  const bundle = await fetchOnlinePersistentStorageBundle(params);
  return importPersistentStorageBundle(bundle);
}

/** Pushes this server's persistent storage bundle to a remote dashboard. */
export async function pushLocalPersistentStorageToOnline(
  params: {
    onlineBaseUrl?: string;
    token?: string;
  } = {},
) {
  const bundle = await exportPersistentStorageBundle();
  const response = await fetch(
    getOnlinePersistentStorageImportUrl(params.onlineBaseUrl),
    {
      body: JSON.stringify(bundle),
      headers: {
        "content-type": "application/json",
        ...(params.token ? { "x-sync-token": params.token } : {}),
      },
      method: "POST",
    },
  );

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(
      `Online persistent storage import failed: ${response.status} ${response.statusText}${message ? ` — ${message.slice(0, 300)}` : ""}`,
    );
  }

  return (await response.json()) as PersistentStorageImportResult;
}

/**
 * Grouped debug-sync API for persistent storage transfer between servers.
 */
const storageSync = {
  exportPersistentStorageBundle,
  fetchOnlinePersistentStorageBundle,
  getOnlinePersistentStorageExportUrl,
  getOnlinePersistentStorageImportUrl,
  importPersistentStorageBundle,
  isLocalAppName,
  isLocalCoinMetadataManualSyncAllowed,
  isLocalPersistentStorageSyncAllowed,
  pushLocalPersistentStorageToOnline,
  syncOnlinePersistentStorageToLocal,
} as const;

export default storageSync;
export { storageSync };
