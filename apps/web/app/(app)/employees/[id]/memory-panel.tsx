"use client";

import { useMemo, useState } from "react";
import { Card } from "@ate/design/components/Card";

export interface MemoryItem {
  id: string;
  memory: string;
  created_at: string;
  category?: string;
}

function detectCategory(text: string): { label: string; className: string } {
  const lower = text.toLowerCase();
  if (
    lower.includes("can read") ||
    lower.includes("has access") ||
    lower.includes("ability") ||
    lower.includes("allowed to") ||
    lower.includes("scope")
  ) {
    return { label: "Capability", className: "memory-tag-capability" };
  }
  if (
    lower.includes("asked to") ||
    lower.includes("instruction") ||
    lower.includes("always") ||
    lower.includes("never") ||
    lower.includes("rule")
  ) {
    return { label: "Instruction", className: "memory-tag-instruction" };
  }
  return { label: "Task", className: "memory-tag-task" };
}

function formatMemoryTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export function MemoryPanel({
  employeeId,
  firstName,
  initialMemories,
  className = "",
}: {
  employeeId: string;
  firstName: string;
  initialMemories: MemoryItem[] | null;
  className?: string;
}) {
  const [memories, setMemories] = useState<MemoryItem[]>(initialMemories ?? []);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  const filtered = useMemo(() => {
    if (!search.trim()) return memories;
    const q = search.toLowerCase();
    return memories.filter((m) => m.memory.toLowerCase().includes(q));
  }, [memories, search]);

  const handleForget = async (id: string) => {
    // Optimistically remove from state
    setMemories((prev) => prev.filter((m) => m.id !== id));
    try {
      await fetch(`/api/employees/${employeeId}/memories/${id}`, {
        method: "DELETE",
      });
    } catch (err) {
      console.warn("[memory] delete failed", err);
    }
  };

  const handleStartEdit = (item: MemoryItem) => {
    setEditingId(item.id);
    setEditText(item.memory);
  };

  const handleSaveEdit = (id: string) => {
    setMemories((prev) =>
      prev.map((m) => (m.id === id ? { ...m, memory: editText } : m))
    );
    setEditingId(null);
  };

  return (
    <Card className={`profile-card memory-card ${className}`}>
      <div className="memory-head">
        <h2 className="memory-title">Memory</h2>
        <p className="memory-subtitle">
          What {firstName} remembers across every channel
        </p>
      </div>

      <div className="memory-search-wrapper">
        <input
          type="text"
          className="memory-search-input"
          placeholder="Search memory"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {initialMemories === null ? (
        <p className="muted" style={{ margin: "16px 0 0", fontSize: 13 }}>
          Memory is not configured.
        </p>
      ) : filtered.length === 0 ? (
        <p className="muted" style={{ margin: "16px 0 0", fontSize: 13 }}>
          {search ? "No matching memories found." : "No memories recorded yet."}
        </p>
      ) : (
        <div className="memory-items-list">
          {filtered.map((item) => {
            const { label, className: tagClass } = detectCategory(item.memory);
            const isEditing = editingId === item.id;

            return (
              <div key={item.id} className="memory-item">
                <div className="memory-item-top">
                  <span className={`memory-tag ${tagClass}`}>{label}</span>
                  <span className="memory-timestamp">
                    {formatMemoryTime(item.created_at)}
                  </span>
                </div>

                {isEditing ? (
                  <div className="memory-edit-box">
                    <textarea
                      className="memory-edit-textarea"
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                    />
                    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                      <button
                        type="button"
                        className="memory-action-btn"
                        onClick={() => handleSaveEdit(item.id)}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        className="memory-action-btn"
                        onClick={() => setEditingId(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="memory-item-content">{item.memory}</p>
                )}

                {!isEditing && (
                  <div className="memory-item-actions">
                    <button
                      type="button"
                      className="memory-action-btn"
                      onClick={() => handleStartEdit(item)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="memory-action-btn memory-forget-btn"
                      onClick={() => handleForget(item.id)}
                    >
                      Forget
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
