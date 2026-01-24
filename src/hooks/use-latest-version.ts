import { useState, useEffect } from "react";

export interface VersionInfo {
  version: string;
  releasedAt: string;
  changelog: {
    version: string;
    date: string;
    changes: string[];
  }[];
}

const FALLBACK_VERSION: VersionInfo = {
  version: "1.1.0",
  releasedAt: "2025-01-24",
  changelog: []
};

// Simple module-level cache
let cache: VersionInfo | null = null;

export function useLatestVersion() {
  // Always initialize with cache or fallback - consistent hook order
  const [versionInfo, setVersionInfo] = useState<VersionInfo>(() => cache || FALLBACK_VERSION);
  const [isLoading, setIsLoading] = useState(() => cache === null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Skip fetch if already cached
    if (cache) {
      setVersionInfo(cache);
      setIsLoading(false);
      return;
    }

    let isMounted = true;

    fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-version`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch version");
        return res.json();
      })
      .then((data) => {
        cache = data;
        if (isMounted) {
          setVersionInfo(data);
          setIsLoading(false);
        }
      })
      .catch((err) => {
        console.error("Error fetching version:", err);
        if (isMounted) {
          setError(err instanceof Error ? err.message : "Unknown error");
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  return {
    version: versionInfo.version,
    releasedAt: versionInfo.releasedAt,
    changelog: versionInfo.changelog,
    isLoading,
    error
  };
}
