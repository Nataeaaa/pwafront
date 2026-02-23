import { openDB } from "idb";

type DBSchema = {
    tasks: {
        key: string;
        value: any;
    };
    outbox: {
        key: string;
        value: any;
    };
    meta: {
        key: string;
        value: any;
    };
};

let dbp: ReturnType<typeof openDB<DBSchema>>;

export function db() {
    if (!dbp) {
        dbp = openDB<DBSchema>("todo-pwa", 1, {
            upgrade(db) {
                db.createObjectStore("tasks", { keyPath: "id" });
                db.createObjectStore("outbox", { keyPath: "id" });
                db.createObjectStore("meta",   { keyPath: "key" });
            },
        });
    }
    return dbp;
}

/** Garantiza que el objeto siempre tenga id === _id antes de guardarlo en IndexedDB */
function withId(task: any): any {
    const id = String(task?._id ?? task?.id ?? "");
    return { ...task, id, _id: id };
}

export async function cacheTasks(list: any[]) {
    const tx = (await db()).transaction("tasks", "readwrite");
    const s = tx.objectStore("tasks");
    await s.clear();
    for (const t of list) await s.put(withId(t)); // ← withId garantiza keyPath
    await tx.done;
}

export async function putTaskLocal(task: any) {
    await (await db()).put("tasks", withId(task)); // ← withId garantiza keyPath
}

export async function getAllTasksLocal() {
    return (await (await db()).getAll("tasks")) || [];
}

export async function removeTaskLocal(id: string) {
    await (await db()).delete("tasks", id);
}

/** Promueve una tarea de clienteId (UUID) a serverId (Mongo ObjectId) */
export async function promoteLocalToServer(clienteId: string, serverId: string) {
    const d = await db();
    const t = await d.get("tasks", clienteId);
    if (t) {
        await d.delete("tasks", clienteId);
        // Actualiza AMBOS campos para que id === _id === serverId
        const promoted = { ...t, id: serverId, _id: serverId, pending: false };
        await d.put("tasks", promoted);
    }
}

// ── Outbox ────────────────────────────────────────────────────────────────────

export type OutboxOp =
    | { id: string; op: "create";  clienteId: string;             data: any; ts: number }
    | { id: string; op: "update";  serverId?: string; clienteId?: string; data: any; ts: number }
    | { id: string; op: "delete";  serverId?: string; clienteId?: string;            ts: number };

export async function queue(op: OutboxOp) {
    await (await db()).put("outbox", op);
}

export async function getOutbox() {
    return (await (await db()).getAll("outbox")) || [];
}

export async function clearOutbox() {
    const tx = (await db()).transaction("outbox", "readwrite");
    await tx.store.clear();
    await tx.done;
}

// ── Mapeo clienteId <-> serverId ──────────────────────────────────────────────

export async function setMapping(clienteId: string, serverId: string) {
    await (await db()).put("meta", { key: clienteId, value: serverId });
}

export async function getMapping(clienteId: string) {
    return (await (await db()).get("meta", clienteId))?.value as string | undefined;
}