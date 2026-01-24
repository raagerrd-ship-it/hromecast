import { useState, useEffect, useRef } from "react";

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

// Cache to avoid multiple API calls
let cachedVersionInfo: VersionInfo | null = null;
let fetchPromise: Promise<VersionInfo> | null = null;

async function fetchVersionInfo(): Promise<VersionInfo> {
  // Return cached data if available
  if (cachedVersionInfo) {
    return cachedVersionInfo;
  }
  
  // Return existing promise if fetch is in progress
  if (fetchPromise) {
    return fetchPromise;
  }
  
  // Start new fetch
  fetchPromise = (async () => {
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-version`
      );
      
      if (!response.ok) {
        throw new Error("Failed to fetch version");
      }
      
      const data = await response.json();
      cachedVersionInfo = data;
      return data;
    } catch (err) {
      console.error("Error fetching version:", err);
      return FALLBACK_VERSION;
    } finally {
      fetchPromise = null;
    }
  })();
  
  return fetchPromise;
}

export function useLatestVersion() {
  const [versionInfo, setVersionInfo] = useState<VersionInfo>(cachedVersionInfo || FALLBACK_VERSION);
  const [isLoading, setIsLoading] = useState(!cachedVersionInfo);
  const [error, setError] = useState<string | null>(null);
  const hasFetched = useRef(false);

  useEffect(() => {
    // Only fetch once per component mount, and skip if already cached
    if (hasFetched.current) return;
    hasFetched.current = true;
    
    if (cachedVersionInfo) {
      setVersionInfo(cachedVersionInfo);
      setIsLoading(false);
      return;
    }

    fetchVersionInfo()
      .then((data) => {
        setVersionInfo(data);
        setError(null);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Unknown error");
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  return {
    version: versionInfo.version,
    releasedAt: versionInfo.releasedAt,
    changelog: versionInfo.changelog,
    isLoading,
    error
  };
}
