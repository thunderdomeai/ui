import { useCallback, useEffect, useMemo, useState } from "react";
import { formatCredentialLabel } from "../../utils/credentials.js";

function sortEntries(entries) {
  return [...entries].sort((a, b) => {
    if (a.createdAt && b.createdAt) {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    }
    if (a.createdAt) return -1;
    if (b.createdAt) return 1;
    return a.label.localeCompare(b.label);
  });
}

function mapStoreToEntries(store) {
  const entriesObject = store?.entries ?? {};
  const entriesArray = Object.entries(entriesObject).map(([id, value]) => ({
    id,
    label: formatCredentialLabel(id, value),
    createdAt: value?.createdAt ?? null,
    credential: value?.credential ?? null,
    status: value?.status || "unverified",
    projectId: value?.projectId || value?.credential?.project_id || "",
    verifiedAt: value?.verifiedAt,
    primedAt: value?.primedAt,
    lastCheck: value?.lastCheck,
    lastPrimeResult: value?.lastPrimeResult,
  }));

  return sortEntries(entriesArray);
}

export function useCredentialStore(type, { autoLoad = true } = {}) {
  const [entries, setEntries] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(Boolean(autoLoad));
  const [error, setError] = useState(null);
  const canActivate = useCallback(
    (entry) => {
      if (!entry) return false;
      if (entry.status === "primed") return true;
      if (type === "source" && entry.status === "verified") return true;
      return false;
    },
    [type]
  );

  const loadStore = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/credential-store/${type}`);
      if (!response.ok) {
        throw new Error(`Unable to load ${type} credential store.`);
      }
      const store = await response.json();
      setEntries(mapStoreToEntries(store));
      setSelectedId(store?.selectedId ?? null);
      setError(null);
    } catch (loadError) {
      console.error(`Failed to load ${type} credential store:`, loadError);
      setError(loadError.message || "Unexpected error while loading credential store.");
      setEntries([]);
      setSelectedId(null);
    } finally {
      setLoading(false);
    }
  }, [type]);

  useEffect(() => {
    if (!autoLoad) {
      return;
    }
    loadStore();
  }, [loadStore, autoLoad]);

  const addEntry = useCallback(
    async ({ label, credential }) => {
      const response = await fetch(`/api/credential-store/${type}/entries`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ label, credential }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || `Unable to store ${type} credential.`);
      }

      const data = await response.json();
      const newEntry = {
        id: data.id,
        label: formatCredentialLabel(data.id, data),
        createdAt: data?.createdAt ?? null,
        credential: data?.credential ?? null,
        status: data?.status || "unverified",
        projectId: data?.projectId || data?.credential?.project_id || "",
        verifiedAt: data?.verifiedAt,
        primedAt: data?.primedAt,
        lastCheck: data?.lastCheck,
        lastPrimeResult: data?.lastPrimeResult,
      };

      setEntries((prev) => sortEntries([newEntry, ...prev.filter((entry) => entry.id !== newEntry.id)]));

      setSelectedId(data?.selectedId ?? data.id ?? null);
      return data;
    },
    [type]
  );

  const removeEntry = useCallback(
    async (entryId) => {
      const response = await fetch(`/api/credential-store/${type}/entries/${encodeURIComponent(entryId)}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || `Unable to delete credential ${entryId}.`);
      }

      const store = await response.json();
      setEntries(mapStoreToEntries(store));
      setSelectedId(store?.selectedId ?? null);
    },
    [type]
  );

  const selectEntry = useCallback(
    async (entryId) => {
      if (entryId) {
        const entry = entries.find((e) => e.id === entryId);
        if (entry && !canActivate(entry)) {
          if (type === "source") {
            throw new Error("Verify the source credential before activation.");
          }
          throw new Error("Prime the target credential before activation.");
        }
      }
      const response = await fetch(`/api/credential-store/${type}/selection`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ selectedId: entryId }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || "Unable to update active credential.");
      }

      setSelectedId(entryId ?? null);
    },
    [type, entries, canActivate]
  );

  return useMemo(
    () => ({
      entries,
      selectedId,
      loading,
      error,
      reload: loadStore,
      addEntry,
      removeEntry,
      selectEntry,
    }),
    [entries, selectedId, loading, error, loadStore, addEntry, removeEntry, selectEntry]
  );
}

export function useCredentialStoreBridge() {
  const source = useCredentialStore("source");
  const target = useCredentialStore("target");

  const hasActiveSource = Boolean(source.selectedId);
  const hasActiveTarget = Boolean(target.selectedId);

  const activeSource = useMemo(
    () => source.entries.find((entry) => entry.id === source.selectedId) ?? null,
    [source.entries, source.selectedId]
  );
  const activeTarget = useMemo(
    () => target.entries.find((entry) => entry.id === target.selectedId) ?? null,
    [target.entries, target.selectedId]
  );

  return useMemo(
    () => ({
      source,
      target,
      hasActiveSource,
      hasActiveTarget,
      activeSource,
      activeTarget,
      hasAllActive: hasActiveSource && hasActiveTarget,
      isLoading: source.loading || target.loading,
    }),
    [source, target, hasActiveSource, hasActiveTarget, activeSource, activeTarget]
  );
}

export function useCredentialStatus() {
  const bridge = useCredentialStoreBridge();
  return useMemo(
    () => ({
      hasAllActive: bridge.hasAllActive,
      activeSourceLabel: bridge.activeSource?.label ?? null,
      activeTargetLabel: bridge.activeTarget?.label ?? null,
      isLoading: bridge.isLoading,
      refresh: () => {
        bridge.source.reload();
        bridge.target.reload();
      },
    }),
    [bridge]
  );
}

export function useCredentialSelections() {
  const bridge = useCredentialStoreBridge();
  return useMemo(
    () => ({
      sourceCredential: bridge.activeSource?.credential ?? null,
      targetCredential: bridge.activeTarget?.credential ?? null,
      sourceId: bridge.source.selectedId,
      targetId: bridge.target.selectedId,
      reloadAll: () => {
        bridge.source.reload();
        bridge.target.reload();
      },
    }),
    [bridge]
  );
}
