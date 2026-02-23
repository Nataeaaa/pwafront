import { api } from "../api";
import {
  getOutbox, clearOutbox, setMapping, getMapping,
  removeTaskLocal, promoteLocalToServer
} from "./db";

export async function syncNow() {
  if (!navigator.onLine) return;
  const ops = (await getOutbox() as any[]).sort((a, b) => a.ts - b.ts);
  if (!ops.length) return;

  // Crea/Actualiza por bulksync (para items con clienteId)
  const toSync: any[] = [];
  for (const op of ops) {
    if (op.op === "create") {
      toSync.push({
        clienteId: op.clienteId,
        title: op.data.title,
        description: op.data.description ?? "",
        status: op.data.status ?? "Pendiente",
      });
    } else if (op.op === "update") {
      const cid = op.clienteId;
      if (cid) {
        toSync.push({
          clienteId: cid,
          title: op.data.title,
          description: op.data.description,
          status: op.data.status,
        });
      } else if (op.serverId) {
        try { await api.put(`/tasks/${op.serverId}`, op.data); } catch {}
      }
    }
  }

  // Ejecuta bulksync y PROMUEVE ids locales
  if (toSync.length) {
    try {
      const { data } = await api.post("/tasks/bulksync", { tasks: toSync });
      for (const map of data?.mapping || []) {
        await setMapping(map.clienteId, map.serverId);
        await promoteLocalToServer(map.clienteId, map.serverId);
      }
    } catch {
      /* si falla, continuamos a deletes */
    }
  }

  // Borra pendientes (necesita serverId)
  for (const op of ops) {
    if (op.op !== "delete") continue;
    const serverId = op.serverId ?? (op.clienteId ? await getMapping(op.clienteId) : undefined);
    if (!serverId) continue;
    try {
      await api.delete(`/tasks/${serverId}`);
      await removeTaskLocal(op.clienteId || serverId);
    } catch {}
  }

  await clearOutbox();
}

// ✅ setupOnlineSync ya NO llama syncNow — el Dashboard lo maneja en su propio handler "online"
//    para evitar que syncNow corra dos veces en paralelo y genere duplicados
export function setupOnlineSync() {
  // Retorna función de limpieza vacía para mantener la misma interfaz
  return () => {};
}