/** In-memory file tree: relative path → raw bytes. */
export type FileTree = Map<string, Uint8Array>;

/** Quiver.yaml parsed shape (V1). */
export interface QuiverMeta {
  name: string;
  description?: string;
}

/** Manifest entry for a single quill inside a packed quiver. */
export interface PackedQuillEntry {
  name: string;
  version: string;
  bundle: string; // e.g. "usaf_memo@1.2.3.def456.zip"
  fonts: Record<string, string>; // path → md5 hash
}

/** Hashed manifest shape (V1). */
export interface PackedManifest {
  version: 1;
  name: string;
  quills: PackedQuillEntry[];
}
