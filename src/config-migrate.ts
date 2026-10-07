/**
 * Config schema versioning and migration.
 *
 * Exists because an upgrade can change what a config key MEANS, and a config
 * written against the old meaning fails in the worst possible way: quietly. The
 * measured case (2026-08-05) is `audio.micSource` — a device name committed to a
 * project config, cloned onto a second machine, where it resolves to nothing and
 * the capture streams zero bytes with no error from any layer. Nobody edits a
 * config they believe is correct, so the engine has to come and get it.
 *
 * Two rules shape this file:
 *
 * **The migration is pure; only the caller writes.** `migrateConfigDocs` takes
 * documents and returns documents. Every decision is therefore unit-testable
 * against a fixture, which matters more here than usual — this code rewrites
 * files a user did not ask it to touch, one of them git-tracked.
 *
 * **Cross-file moves are first-class.** A per-file migration could not express
 * "this key belongs in the OTHER file", which is exactly what the first
 * migration does. So the unit of migration is the whole set of participating
 * documents, not one file.
 */

/** Bump when a migration is added. A file with no `configVersion` is version 0. */
export const CONFIG_VERSION = 1;

export type ConfigRole = "user" | "project";

export interface ConfigDoc {
  role: ConfigRole;
  path: string;
  /** Parsed contents. `{}` for a file that does not exist yet. */
  data: Record<string, unknown>;
  exists: boolean;
}

export interface MigrationNote {
  level: "info" | "warn";
  message: string;
}

export interface MigrationResult {
  docs: ConfigDoc[];
  /** Paths whose contents changed and must be written back. */
  changed: string[];
  notes: MigrationNote[];
}

interface Migration {
  /** The version a document reaches once this step has run. */
  to: number;
  name: string;
  apply(docs: ConfigDoc[], notes: MigrationNote[]): void;
}

/** A document's schema version. Absent `configVersion` means "predates versioning". */
export function docVersion(doc: ConfigDoc): number {
  const v = doc.data.configVersion;
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function audioSection(doc: ConfigDoc): Record<string, unknown> | undefined {
  const a = doc.data.audio;
  return a && typeof a === "object" && !Array.isArray(a) ? (a as Record<string, unknown>) : undefined;
}

const MIGRATIONS: Migration[] = [
  {
    to: 1,
    name: "device-names-are-machine-level",
    /**
     * `audio.micSource` / `audio.monitorSource` name hardware, so they belong to
     * the machine (the user config), never to the repo. A committed device name
     * wins on every clone, because the project config outranks the user one.
     *
     * Move rather than delete: on the machine that wrote it, the name is correct
     * and losing it would break a working setup. But never overwrite a device the
     * machine has already declared — that one is, by construction, the right one
     * for this hardware.
     */
    apply(docs, notes) {
      const project = docs.find((d) => d.role === "project" && d.exists);
      const user = docs.find((d) => d.role === "user");
      if (!project) return;
      const projectAudio = audioSection(project);
      if (!projectAudio) return;

      for (const key of ["micSource", "monitorSource"] as const) {
        const value = projectAudio[key];
        // An empty string is not a pinned device — it already means "system default".
        if (typeof value !== "string" || value.length === 0) continue;
        delete projectAudio[key];

        if (!user) {
          notes.push({
            level: "warn",
            message: `audio.${key}="${value}" eltávolítva a projekt configból; nincs hova átvinni — add meg a gép configjában, ha kell`,
          });
          continue;
        }
        const userAudio = audioSection(user);
        const existing = userAudio?.[key];
        if (typeof existing === "string" && existing.length > 0) {
          notes.push({
            level: "info",
            message: `audio.${key}="${value}" eldobva a projekt configból — a gép configja már mást deklarál ("${existing}"), az a mérvadó`,
          });
          continue;
        }
        const target = userAudio ?? {};
        target[key] = value;
        user.data.audio = target;
        notes.push({
          level: "info",
          message: `audio.${key}="${value}" átvivé a gép configjába (${user.path}) — eszköznév nem a repóba való`,
        });
      }

      // A section emptied by the move is noise; drop it rather than leave `"audio": {}`.
      if (Object.keys(projectAudio).length === 0) delete project.data.audio;
    },
  },
];

/**
 * Apply every migration the documents have not yet reached, and stamp the result.
 *
 * Pure: the returned docs are new objects, and `changed` names the files the
 * caller must write. A document that needed nothing is not listed, so an
 * up-to-date install writes nothing and leaves no `.bak` behind.
 */
export function migrateConfigDocs(input: ConfigDoc[]): MigrationResult {
  const docs: ConfigDoc[] = input.map((d) => ({ ...d, data: structuredClone(d.data) }));
  const notes: MigrationNote[] = [];
  const before = new Map(docs.map((d) => [d.path, JSON.stringify(d.data)]));

  for (const migration of MIGRATIONS) {
    // Run the step if ANY participating document predates it: a cross-file move
    // reads one file and writes another, so "has this file reached v1" is not a
    // question a single document can answer for the set.
    const behind = docs.some((d) => d.exists && docVersion(d) < migration.to);
    if (behind) migration.apply(docs, notes);
  }

  for (const doc of docs) {
    // Only stamp files that exist, or that a migration just gave content to —
    // versioning must never conjure a config file that the user never had.
    if (!doc.exists && before.get(doc.path) === JSON.stringify(doc.data)) continue;
    if (docVersion(doc) !== CONFIG_VERSION) doc.data.configVersion = CONFIG_VERSION;
  }

  const changed = docs
    .filter((d) => before.get(d.path) !== JSON.stringify(d.data))
    .map((d) => d.path);

  return { docs, changed, notes };
}

/** One thing `moveMachineLocalKeys` did, as `doctor --fix` prints it. */
export interface MachineKeyAction {
  /** `moved`: into the user config. `dropped`: the machine already declares one. `removed`: an empty placeholder. */
  kind: "moved" | "dropped" | "removed";
  key: string;
  value: unknown;
  /** The machine's own value, for `dropped`. */
  kept?: unknown;
}

export interface MachineKeyMove {
  docs: ConfigDoc[];
  changed: string[];
  actions: MachineKeyAction[];
}

function section(data: Record<string, unknown>, name: string): Record<string, unknown> | undefined {
  const v = data[name];
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

const isEmptyValue = (v: unknown): boolean => v === null || (typeof v === "string" && v.trim() === "");
const isDeclared = (v: unknown): boolean => v !== undefined && !isEmptyValue(v);

/**
 * Move the per-machine keys (`MACHINE_LOCAL_KEYS`: every `audio` key, `transcript.speakers.mic`)
 * out of the project config — what `doctor --fix` runs. Deliberately NOT a registered migration:
 * migrations apply themselves on every command, and this would then rewrite every consumer's
 * tracked config the next time anything ran there. It runs when the project's owner asks.
 *
 * Same contract as `migrateConfigDocs`: pure, returns new documents and the paths that changed.
 * Same rule as the v1 move: a value the machine already declares is never overwritten — it is,
 * by construction, the right one for this hardware and this person — so the project value is
 * dropped, and the action says so with both values.
 */
export function moveMachineLocalKeys(input: ConfigDoc[]): MachineKeyMove {
  const docs: ConfigDoc[] = input.map((d) => ({ ...d, data: structuredClone(d.data) }));
  const before = new Map(docs.map((d) => [d.path, JSON.stringify(d.data)]));
  const actions: MachineKeyAction[] = [];
  const project = docs.find((d) => d.role === "project" && d.exists);
  const user = docs.find((d) => d.role === "user");
  if (!project || !user || project.path === user.path) return { docs, changed: [], actions };

  /** Move one leaf: `from[key]` (project) → `to()[key]` (user), creating the target lazily. */
  const moveLeaf = (from: Record<string, unknown>, key: string, label: string, to: () => Record<string, unknown>) => {
    const value = from[key];
    if (value === undefined) return;
    delete from[key];
    if (isEmptyValue(value)) { actions.push({ kind: "removed", key: label, value }); return; }
    const target = to();
    if (isDeclared(target[key])) { actions.push({ kind: "dropped", key: label, value, kept: target[key] }); return; }
    target[key] = value;
    actions.push({ kind: "moved", key: label, value });
  };

  const projAudio = section(project.data, "audio");
  if (projAudio) {
    for (const key of Object.keys(projAudio)) {
      moveLeaf(projAudio, key, `audio.${key}`, () => {
        const a = section(user.data, "audio") ?? {};
        user.data.audio = a;
        return a;
      });
    }
    if (Object.keys(projAudio).length === 0) delete project.data.audio;
  }

  const projTranscript = section(project.data, "transcript");
  const projSpeakers = projTranscript && section(projTranscript, "speakers");
  if (projTranscript && projSpeakers && "mic" in projSpeakers) {
    moveLeaf(projSpeakers, "mic", "transcript.speakers.mic", () => {
      const t = section(user.data, "transcript") ?? {};
      user.data.transcript = t;
      const sp = section(t, "speakers") ?? {};
      t.speakers = sp;
      return sp;
    });
    if (Object.keys(projSpeakers).length === 0) delete projTranscript.speakers;
    if (Object.keys(projTranscript).length === 0) delete project.data.transcript;
  }

  const changed = docs.filter((d) => before.get(d.path) !== JSON.stringify(d.data)).map((d) => d.path);
  return { docs, changed, actions };
}

/**
 * A config document with the per-machine keys taken out — what project-mode `init` writes from
 * the example config. Pure; the caller writes. The example's `audio: { micSource: "", … }`
 * placeholder is exactly what once replaced a machine's microphone (2026-08-27), and every audio
 * key is per-machine anyway.
 */
export function withoutMachineLocalKeys(data: Record<string, unknown>): Record<string, unknown> {
  const doc: ConfigDoc = { role: "project", path: "<project>", data, exists: true };
  const moved = moveMachineLocalKeys([doc, { role: "user", path: "<user>", data: {}, exists: false }]);
  return moved.docs[0].data;
}
