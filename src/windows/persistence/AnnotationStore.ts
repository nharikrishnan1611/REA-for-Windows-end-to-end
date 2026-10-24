import {
  readFile,
  writeFile,
  mkdir,
  rm,
  copyFile,
  stat,
} from "node:fs/promises";
import { join } from "node:path";

export interface TargetIdentity {
  readonly path: string;
  readonly sha256: string;
  readonly architecture?: string | undefined;
}

export interface FunctionAnnotation {
  readonly address: string;
  readonly name?: string | undefined;
  readonly comment?: string | undefined;
  readonly inlineComment?: string | undefined;
  readonly provenance: string;
  readonly updatedAt: string;
}

export interface SymbolAnnotation {
  readonly address: string;
  readonly name: string;
  readonly provenance: string;
  readonly updatedAt: string;
}

export interface TargetAnnotations {
  readonly schemaVersion: "1.0.0";
  readonly targetSha256: string;
  readonly targetPath: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly functions: Record<string, FunctionAnnotation>;
  readonly symbols: Record<string, SymbolAnnotation>;
  readonly tags: Record<string, readonly string[]>;
}

export class TargetHashMismatchError extends Error {
  constructor(expectedSha256: string, actualSha256: string) {
    super(
      `Target binary hash mismatch: annotations are bound to ${expectedSha256}, but active target is ${actualSha256}. Refusing to apply stale annotations.`,
    );
    this.name = "TargetHashMismatchError";
  }
}

/**
 * Durable annotation persistence store keyed strictly by stable target identity (SHA-256).
 * Annotations are stored separately from binary bytes, avoiding database mutations.
 */
export class AnnotationStore {
  readonly #storageDirectory: string;

  constructor(storageDirectory: string) {
    this.#storageDirectory = storageDirectory;
  }

  get storageDirectory(): string {
    return this.#storageDirectory;
  }

  #getFilePath(targetSha256: string): string {
    return join(this.#storageDirectory, `${targetSha256.toLowerCase()}.json`);
  }

  #getBackupPath(targetSha256: string): string {
    return join(this.#storageDirectory, `${targetSha256.toLowerCase()}.bak`);
  }

  async #ensureDir(): Promise<void> {
    await mkdir(this.#storageDirectory, { recursive: true });
  }

  /**
   * Check if annotations exist for a given target digest.
   */
  async has(targetSha256: string): Promise<boolean> {
    try {
      const s = await stat(this.#getFilePath(targetSha256));
      return s.isFile();
    } catch {
      return false;
    }
  }

  /**
   * Load annotations for a target, validating target SHA-256 hash.
   */
  async load(target: TargetIdentity): Promise<TargetAnnotations | null> {
    const filePath = this.#getFilePath(target.sha256);
    try {
      const content = await readFile(filePath, "utf8");
      const parsed = JSON.parse(content) as TargetAnnotations;

      if (parsed.targetSha256.toLowerCase() !== target.sha256.toLowerCase()) {
        throw new TargetHashMismatchError(parsed.targetSha256, target.sha256);
      }
      return parsed;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw err;
    }
  }

  /**
   * Initialize or update annotations for a target.
   */
  async save(
    target: TargetIdentity,
    updates: Partial<Omit<TargetAnnotations, "schemaVersion" | "targetSha256">>,
  ): Promise<TargetAnnotations> {
    await this.#ensureDir();
    const existing = await this.load(target);
    const now = new Date().toISOString();

    const merged: TargetAnnotations = {
      schemaVersion: "1.0.0",
      targetSha256: target.sha256.toLowerCase(),
      targetPath: target.path,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      functions: { ...existing?.functions, ...updates.functions },
      symbols: { ...existing?.symbols, ...updates.symbols },
      tags: { ...existing?.tags, ...updates.tags },
    };

    const filePath = this.#getFilePath(target.sha256);
    await writeFile(filePath, JSON.stringify(merged, null, 2), "utf8");
    return merged;
  }

  /**
   * Annotate a function (rename, comment, inline comment).
   */
  async annotateFunction(
    target: TargetIdentity,
    address: string,
    data: {
      readonly name?: string | undefined;
      readonly comment?: string | undefined;
      readonly inlineComment?: string | undefined;
      readonly provenance?: string | undefined;
    },
  ): Promise<FunctionAnnotation> {
    const existing = (await this.load(target)) ?? {
      schemaVersion: "1.0.0" as const,
      targetSha256: target.sha256.toLowerCase(),
      targetPath: target.path,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      functions: {},
      symbols: {},
      tags: {},
    };

    const now = new Date().toISOString();
    const prevFn = existing.functions[address];
    const updatedFn: FunctionAnnotation = {
      address,
      name: data.name !== undefined ? data.name : prevFn?.name,
      comment: data.comment !== undefined ? data.comment : prevFn?.comment,
      inlineComment:
        data.inlineComment !== undefined
          ? data.inlineComment
          : prevFn?.inlineComment,
      provenance: data.provenance ?? prevFn?.provenance ?? "user-annotation",
      updatedAt: now,
    };

    await this.save(target, {
      functions: { [address]: updatedFn },
    });

    return updatedFn;
  }

  /**
   * Rename an arbitrary mapped address / label.
   */
  async setAddressName(
    target: TargetIdentity,
    address: string,
    name: string,
    provenance = "user-annotation",
  ): Promise<SymbolAnnotation> {
    const now = new Date().toISOString();
    const symbol: SymbolAnnotation = {
      address,
      name,
      provenance,
      updatedAt: now,
    };

    await this.save(target, {
      symbols: { [address]: symbol },
    });

    return symbol;
  }

  /**
   * Create a backup (.bak) of the current annotations.
   */
  async backup(targetSha256: string): Promise<string> {
    const source = this.#getFilePath(targetSha256);
    const destination = this.#getBackupPath(targetSha256);
    await copyFile(source, destination);
    return destination;
  }

  /**
   * Restore annotations from backup.
   */
  async restore(targetSha256: string): Promise<TargetAnnotations> {
    const backupPath = this.#getBackupPath(targetSha256);
    const filePath = this.#getFilePath(targetSha256);
    await copyFile(backupPath, filePath);
    const content = await readFile(filePath, "utf8");
    return JSON.parse(content) as TargetAnnotations;
  }

  /**
   * Export serialized JSON string.
   */
  async export(targetSha256: string): Promise<string> {
    const filePath = this.#getFilePath(targetSha256);
    return await readFile(filePath, "utf8");
  }

  /**
   * Import serialized JSON string, ensuring target digest agreement.
   */
  async import(
    jsonContent: string,
    targetSha256: string,
  ): Promise<TargetAnnotations> {
    await this.#ensureDir();
    const parsed = JSON.parse(jsonContent) as TargetAnnotations;
    if (parsed.targetSha256.toLowerCase() !== targetSha256.toLowerCase()) {
      throw new TargetHashMismatchError(parsed.targetSha256, targetSha256);
    }
    const filePath = this.#getFilePath(targetSha256);
    await writeFile(filePath, JSON.stringify(parsed, null, 2), "utf8");
    return parsed;
  }

  /**
   * Delete annotations for a target.
   */
  async clear(targetSha256: string): Promise<void> {
    const filePath = this.#getFilePath(targetSha256);
    const backupPath = this.#getBackupPath(targetSha256);
    try {
      await rm(filePath, { force: true });
      await rm(backupPath, { force: true });
    } catch {
      // Ignore if absent
    }
  }
}
