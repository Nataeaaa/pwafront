import { useEffect, useMemo, useState } from "react";
import { api, setAuth } from "../api";

import { 
  cacheTasks,
  getAllTasksLocal,
  putTaskLocal,
  removeTaskLocal,
  queue,
  type OutboxOp,
 } from "../offline/db";

import { syncNow, setupOnlineSync } from "../offline/sync";

// ─── TYPES ────────────────────────────────────────────────────
type Status   = "Pendiente" | "En Progreso" | "Completada";
type Priority = "bajo" | "medio" | "alto";
type SortMode = "priority" | "date_asc" | "date_desc" | "created";

type Task = {
  _id: string;
  title: string;
  description?: string;
  status: Status;
  priority: Priority;
  dueDate?: string | null;
  clienteId?: string;
  createdAt?: string;
  deleted?: boolean;
  pending?: boolean;
};

// ─── CONSTANTS ────────────────────────────────────────────────
const PRIORITY_RANK: Record<Priority, number> = { alto: 0, medio: 1, bajo: 2 };

const PRIORITY_STYLE: Record<Priority, { label: string; color: string; bg: string }> = {
  alto:  { label: "Alta",  color: "#dc2626", bg: "#fef2f2" },
  medio: { label: "Media", color: "#d97706", bg: "#fffbeb" },
  bajo:  { label: "Baja",  color: "#16a34a", bg: "#f0fdf4" },
};

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: "priority",  label: "🔴 Por prioridad"      },
  { value: "date_asc",  label: "📅 Fecha (próximas)"   },
  { value: "date_desc", label: "📅 Fecha (lejanas)"    },
  { value: "created",   label: "🕐 Creadas recientemente" },
];

const isLocalId = (id: string) => !/^[a-f0-9]{24}$/i.test(id);

// ─── NORMALIZE ────────────────────────────────────────────────
function normalizeTasks(x: any): Task {
  const id = String(x?._id ?? x?.id);
  return {
    _id: id,
    title: String(x?.title ?? "Sin título"),
    description: x?.description ?? "",
    status:
      x?.status === "Completada" || x?.status === "En Progreso" || x?.status === "Pendiente"
        ? x.status : "Pendiente",
    priority:
      x?.priority === "alto" || x?.priority === "medio" || x?.priority === "bajo"
        ? x.priority : "medio",
    dueDate:   x?.dueDate ?? null,
    clienteId: x?.clienteId,
    createdAt: x?.createdAt,
    deleted:   !!x?.deleted,
    pending:   !!x?.pending,
  };
}

function sortTasks(tasks: Task[], mode: SortMode): Task[] {
  const copy = [...tasks];

  if (mode === "priority")
    return copy.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);

  if (mode === "date_asc")
    return copy.sort((a, b) => {
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    });

  if (mode === "date_desc")
    return copy.sort((a, b) => {
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return new Date(b.dueDate).getTime() - new Date(a.dueDate).getTime();
    });

  // created
  return copy.sort((a, b) =>
    new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()
  );
}

// ─── DUE DATE BADGE ───────────────────────────────────────────
function DueBadge({ dueDate }: { dueDate?: string | null }) {
  if (!dueDate) return null;
  const diffDays = Math.ceil((new Date(dueDate).getTime() - Date.now()) / 86_400_000);
  const isOverdue = diffDays < 0;
  const isSoon    = diffDays >= 0 && diffDays <= 3;
  const color = isOverdue ? "#dc2626" : isSoon ? "#d97706" : "#64748b";
  const bg    = isOverdue ? "#fef2f2" : isSoon  ? "#fffbeb" : "#f1f5f9";
  const text  = isOverdue
    ? `Venció hace ${Math.abs(diffDays)}d`
    : diffDays === 0 ? "Hoy"
    : `${diffDays}d restantes`;
  return (
    <span className="badge" style={{ background: bg, color, width: "fit-content" }}>
      📅 {text}
    </span>
  );
}

// ─── COMPONENT ────────────────────────────────────────────────
export default function Dashboard() {
  const [loading, setLoading]   = useState(true);
  const [tasks,   setTasks]     = useState<Task[]>([]);
  const [online,  setOnline]    = useState<boolean>(navigator.onLine);

  // form crear
  const [title,       setTitle]       = useState("");
  const [description, setDescription] = useState("");
  const [priority,    setPriority]    = useState<Priority>("medio");
  const [dueDate,     setDueDate]     = useState("");

  // form editar
  const [editingId,          setEditingId]       = useState<string | null>(null);
  const [editingTitle,       setEditingTitle]       = useState("");
  const [editingDescription, setEditingDescription] = useState("");
  const [editingPriority,    setEditingPriority]    = useState<Priority>("medio");
  const [editingDueDate,     setEditingDueDate]     = useState("");

  // controles
  const [search,   setSearch]   = useState("");
  const [filter,   setFilter]   = useState<"all" | "active" | "completed">("all");
  const [sortMode, setSortMode] = useState<SortMode>("priority");

  useEffect(() => {
    setAuth(localStorage.getItem("token"));
    const unsubscribe = setupOnlineSync();
    const on = async () => {
      setOnline(true);
      await syncNow();
      await loadFromServer();
    };
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    
    (async () => {
      const local = await getAllTasksLocal();
      if(local?.length) setTasks(local.map(normalizeTasks));
      await loadFromServer();
      await syncNow();
      await loadFromServer();
    })();
    
    return () => {
      unsubscribe?.();
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  async function loadFromServer() {
    try {
      const { data } = await api.get("/tasks");
      const raw  = Array.isArray(data?.items) ? data.items : [];
      const list = raw.map(normalizeTasks);
      setTasks(list);
      await cacheTasks(list);
    } catch {
      // mantener cache local
    } finally {
      setLoading(false);
    }
  }

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    const d = description.trim();
    if (!t) return;

    const clienteId = crypto.randomUUID();
    const localTask = normalizeTasks({
      _id: clienteId,
      title: t,
      description: d,
      status: "Pendiente" as Status,
      priority,
      dueDate: dueDate || null,
      pending: !navigator.onLine,
    });

    setTasks((prev) => [localTask, ...prev]);
    await putTaskLocal(localTask);
    setTitle("");
    setDescription("");
    setPriority("medio");
    setDueDate("");

    if(!navigator.onLine) {
      const op: OutboxOp = { id: "op-" + clienteId, op: "create", clienteId, data: localTask, ts: Date.now() };
      await queue(op);
      return;
    }

    try {
      const { data } = await api.post("/tasks", { title: t, description: d, priority, dueDate: dueDate || null, clienteId });
      const created  = normalizeTasks(data?.task ?? data);
      setTasks((prev) => prev.map((x) => (x._id === clienteId ? created : x)));
      await putTaskLocal(created);
    } catch {
      const op: OutboxOp = { id: "op-" + clienteId, op: "create", clienteId, data: localTask, ts: Date.now() };
      await queue(op);
    }
  }

  function startEdit(task: Task) {
    setEditingId(task._id);
    setEditingTitle(task.title);
    setEditingDescription(task.description ?? "");
    setEditingPriority(task.priority);
    setEditingDueDate(task.dueDate ? task.dueDate.slice(0, 10) : "");
  }

  async function saveEdit(taskId: string) {
    const newTitle = editingTitle.trim();
    const newDesc  = editingDescription.trim();
    if (!newTitle) return;

    const before  = tasks.find((t) => t._id === taskId);
    const patched = { ...before, title: newTitle, description: newDesc, priority: editingPriority, dueDate: editingDueDate || null } as Task;

    setTasks((prev) => prev.map((t) => (t._id === taskId ? patched : t)));
    await putTaskLocal(patched);
    setEditingId(null);

    const payload = { title: newTitle, description: newDesc, priority: editingPriority, dueDate: editingDueDate || null };

    if(!navigator.onLine) {
      await queue({ id: "upd-" + taskId, op: "update", clienteId: isLocalId(taskId) ? taskId : undefined, serverId: isLocalId(taskId) ? undefined : taskId, data: payload, ts: Date.now() } as OutboxOp);
      return;
    }

    try {
      await api.put(`/tasks/${taskId}`, payload);
    } catch {
      await queue({ id: "upd-" + taskId, op: "update", serverId: taskId, data: payload, ts: Date.now() } as OutboxOp);
    }
  }

  async function handleStatusChange(task: Task, newStatus: Status) {
    const updated = { ...task, status: newStatus };
    setTasks((prev) => prev.map((x) => (x._id === task._id ? updated : x)));  
    await putTaskLocal(updated);
  
    if(!navigator.onLine){
      await queue({ id: "upd-" + task._id, op: "update", serverId: isLocalId(task._id) ? undefined : task._id, clienteId: isLocalId(task._id) ? task._id : undefined, data: { status: newStatus }, ts: Date.now() });
      return;
    }

    try {
      await api.put(`/tasks/${task._id}`, { status: newStatus });
    } catch {
      await queue({ id: "upd-" + task._id, op: "update", serverId: task._id, data: { status: newStatus }, ts: Date.now() });
    }
  }

  async function removeTask(taskId: string) {
    const backup = tasks;
    setTasks((prev) => prev.filter((t) => t._id !== taskId));
    await removeTaskLocal(taskId);

    if (!navigator.onLine) {
      await queue({ id: "del-" + taskId, op: "delete", serverId: isLocalId(taskId) ? undefined : taskId, clienteId: isLocalId(taskId) ? taskId : undefined, ts: Date.now() });
      return;
    }

    try {
      await api.delete(`/tasks/${taskId}`);
    } catch {
      setTasks(backup);
      for (const t of backup) await putTaskLocal(t);
      await queue({ id: "del-" + taskId, op: "delete", serverId: taskId, clienteId: isLocalId(taskId) ? taskId : undefined, ts: Date.now() });
    }
  }

  function logout() {
    localStorage.removeItem("token");
    setAuth(null);
    window.location.href = "/";
  }

  // ── computed ─────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = tasks;
    if (search.trim()) {
      const s = search.toLowerCase();
      list = list.filter(
        (t) => (t.title || "").toLowerCase().includes(s) || (t.description || "").toLowerCase().includes(s)
      );
    }
    if (filter === "active")    list = list.filter((t) => t.status !== "Completada");
    if (filter === "completed") list = list.filter((t) => t.status === "Completada");
    return sortTasks(list, sortMode);
  }, [tasks, search, filter, sortMode]);

  const stats = useMemo(() => {
    const total = tasks.length;
    const done  = tasks.filter((t) => t.status === "Completada").length;
    return { total, done, pending: total - done };
  }, [tasks]);

  return (
    <div className="wrap">
      <header className="topbar">
        <h1>To-Do PWA</h1>
        <div className="spacer" />
        <div className="stats">
          <span>Total: {stats.total}</span>
          <span>Hechas: {stats.done}</span>
          <span>Pendientes: {stats.pending}</span>
          <span className="badge" style={{ marginLeft: 8, background: online ? "#1f6feb" : "#b45309" }}>
            {online ? "Online" : "Offline"}
          </span>
        </div>
        <button className="btn danger" onClick={logout}>Salir</button>
      </header>

      <main>
        {/* ===== Crear ===== */}
        <form className="add add-grid" onSubmit={addTask}>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Título de la tarea…"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Descripción (opcional)…"
            rows={2}
          />

          {/* ── NUEVO: prioridad + fecha ── */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 13, color: "var(--fg2, #888)" }}>Prioridad:</span>
              {(["alto", "medio", "bajo"] as Priority[]).map((p) => {
                const s   = PRIORITY_STYLE[p];
                const sel = priority === p;
                return (
                  <button
                    key={p} type="button" onClick={() => setPriority(p)}
                    style={{
                      fontSize: 12, fontWeight: 600, padding: "4px 12px",
                      borderRadius: 20, cursor: "pointer", transition: "all .15s",
                      background: sel ? s.color : s.bg,
                      color:      sel ? "#fff"  : s.color,
                      border:     `1.5px solid ${s.color}50`,
                    }}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", marginLeft: "auto" }}>
              <span style={{ fontSize: 13, color: "var(--fg2, #888)" }}>Fecha límite:</span>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border, #333)", background: "var(--bg2, #161b22)", color: "inherit", fontSize: 13 }}
              />
            </div>
          </div>
          {/* ──────────────────────────── */}

          <button className="btn">Agregar</button>
        </form>

        {/* ===== Toolbar ===== */}
        <div className="toolbar">
          <input
            className="search"
            placeholder="Buscar por título o descripción…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          {/* ── NUEVO: sort selector ── */}
          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
            style={{
              padding: "6px 10px", borderRadius: 8,
              border: "1px solid var(--border, #333)",
              background: "var(--bg2, #161b22)",
              color: "inherit", fontSize: 13, cursor: "pointer",
            }}
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {/* ──────────────────────── */}

          <div className="filters">
            <button className={filter === "all"       ? "chip active" : "chip"} onClick={() => setFilter("all")}       type="button">Todas</button>
            <button className={filter === "active"    ? "chip active" : "chip"} onClick={() => setFilter("active")}    type="button">Activas</button>
            <button className={filter === "completed" ? "chip active" : "chip"} onClick={() => setFilter("completed")} type="button">Hechas</button>
          </div>
        </div>



        {/* ===== Lista ===== */}
        {loading ? (
          <p>Cargando…</p>
        ) : filtered.length === 0 ? (
          <p className="empty">Sin tareas</p>
        ) : (
          <ul className="list">
            {filtered.map((t) => (
              <li key={t._id} className={t.status === "Completada" ? "item done" : "item"}>
                {/* Select de estado */}
                <select
                  value={t.status}
                  onChange={(e) => handleStatusChange(t, e.target.value as Status)}
                  className="status-select"
                  title="Estado"
                >
                  <option value="Pendiente">Pendiente</option>
                  <option value="En Progreso">En Progreso</option>
                  <option value="Completada">Completada</option>
                </select>

                <div className="content">
                  {editingId === t._id ? (
                    <>
                      <input
                        className="edit"
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        placeholder="Título"
                        autoFocus
                      />
                      <textarea
                        className="edit"
                        value={editingDescription}
                        onChange={(e) => setEditingDescription(e.target.value)}
                        placeholder="Descripción"
                        rows={2}
                      />
                      {/* ── NUEVO: editar prioridad + fecha ── */}
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 6 }}>
                        {(["alto", "medio", "bajo"] as Priority[]).map((p) => {
                          const s   = PRIORITY_STYLE[p];
                          const sel = editingPriority === p;
                          return (
                            <button
                              key={p} type="button" onClick={() => setEditingPriority(p)}
                              style={{
                                fontSize: 11, fontWeight: 600, padding: "3px 10px",
                                borderRadius: 20, cursor: "pointer",
                                background: sel ? s.color : s.bg,
                                color:      sel ? "#fff"  : s.color,
                                border:     `1.5px solid ${s.color}50`,
                              }}
                            >
                              {s.label}
                            </button>
                          );
                        })}
                        <input
                          type="date"
                          value={editingDueDate}
                          onChange={(e) => setEditingDueDate(e.target.value)}
                          style={{ padding: "4px 8px", borderRadius: 8, border: "1px solid var(--border, #333)", background: "var(--bg2, #161b22)", color: "inherit", fontSize: 12, marginLeft: "auto" }}
                        />
                      </div>
                      {/* ─────────────────────────────────── */}
                    </>
                  ) : (
                    <>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span className="title" onDoubleClick={() => startEdit(t)}>
                          {t.title}
                        </span>
                        {/* ── NUEVO: badge de prioridad ── */}
                        <span style={{
                          fontSize: 10, fontWeight: 700, padding: "2px 8px",
                          borderRadius: 20, textTransform: "uppercase", flexShrink: 0,
                          background: PRIORITY_STYLE[t.priority].bg,
                          color:      PRIORITY_STYLE[t.priority].color,
                        }}>
                          {PRIORITY_STYLE[t.priority].label}
                        </span>
                        {/* ─────────────────────────────── */}
                      </div>

                      {t.description && <p className="desc">{t.description}</p>}

                      {/* ── NUEVO: due date badge ── */}
                      <DueBadge dueDate={t.dueDate} />
                      {/* ─────────────────────────── */}

                      {(t.pending || isLocalId(t._id)) && (
                        <span className="badge" title="Aún no sincronizada" style={{ background: "#b45309", width: "fit-content" }}>
                          Falta sincronizar
                        </span>
                      )}
                    </>
                  )}
                </div>

                <div className="actions">
                  {editingId === t._id ? (
                    <button className="btn" onClick={() => saveEdit(t._id)}>Guardar</button>
                  ) : (
                    <button className="icon" title="Editar" onClick={() => startEdit(t)}>✏️</button>
                  )}
                  <button className="icon danger" title="Eliminar" onClick={() => removeTask(t._id)}>
                    🗑️
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}