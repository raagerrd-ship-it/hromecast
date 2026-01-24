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

export function useLatestVersion() {
  const [versionInfo, setVersionInfo] = useState<VersionInfo>(FALLBACK_VERSION);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchVersion = async () => {
      try {
        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-version`
        );
        
        if (!response.ok) {
          throw new Error("Failed to fetch version");
        }
        
        const data = await response.json();
        setVersionInfo(data);
        setError(null);
      } catch (err) {
        console.error("Error fetching version:", err);
        setError(err instanceof Error ? err.message : "Unknown error");
        // Keep fallback version
      } finally {
        setIsLoading(false);
      }
    };

    fetchVersion();
  }, []);

  return {
    version: versionInfo.version,
    releasedAt: versionInfo.releasedAt,
    changelog: versionInfo.changelog,
    isLoading,
    error
  };
}
