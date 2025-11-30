import { useCallback, useEffect, useMemo, useState } from "react";

export function useServerCredentialStore(type) {
  const [entries, setEntries] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/credential-store/${type}`);
      if (!res.ok) throw new Error(`Failed to load ${type} credentials`);
      const data = await res.json();
      const mapped = Object.entries(data.entries || {}).map(([id, value]) => ({
        id,
        label: value.label || id,
        credential: value.credential,
        createdAt: value.createdAt,
        status: value.status || "unverified",
        projectId: value.projectId || value.credential?.project_id || "",
        verifiedAt: value.verifiedAt,
        primedAt: value.primedAt,
        lastCheck: value.lastCheck,
        lastPrimeResult: value.lastPrimeResult,
      }));
      setEntries(mapped);
      setSelectedId(data.selectedId || null);
    } catch (e) {
      setError(e.message);
      setEntries([]);
      setSelectedId(null);
    } finally {
      setLoading(false);
    }
  }, [type]);

  useEffect(() => {
    load();
  }, [load]);

  const addEntry = useCallback(
    async ({ label, credential }) => {
      const res = await fetch(`/api/credential-store/${type}/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, credential }),
      });
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(detail || "Failed to add credential");
      }
      const data = await res.json();
      await load();
      return data;
    },
    [type, load]
  );

  const selectEntry = useCallback(
    async (id) => {
      if (id) {
        const entry = entries.find((e) => e.id === id);
        if (entry && entry.status !== "primed") {
          throw new Error("Only primed credentials can be activated.");
        }
      }
      const res = await fetch(`/api/credential-store/${type}/selection`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedId: id }),
      });
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(detail || "Failed to select credential");
      }
      setSelectedId(id);
    },
    [type, entries]
  );

  const removeEntry = useCallback(
    async (id) => {
      const res = await fetch(`/api/credential-store/${type}/entries/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(detail || "Failed to delete credential");
      }
      await load();
    },
    [type, load]
  );

  const activeEntry = useMemo(() => entries.find((e) => e.id === selectedId) || null, [entries, selectedId]);

  return {
    entries,
    selectedId,
    activeEntry,
    loading,
    error,
    addEntry,
    selectEntry,
    removeEntry,
    reload: load,
  };
}
