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

// Cache per language
const cache: Record<string, VersionInfo> = {};

export function useLatestVersion(language: 'sv' | 'en' = 'en') {
  const cached = cache[language];
  const [versionInfo, setVersionInfo] = useState<VersionInfo>(() => cached || FALLBACK_VERSION);
  const [isLoading, setIsLoading] = useState(() => !cached);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Skip fetch if already cached for this language
    if (cache[language]) {
      setVersionInfo(cache[language]);
      setIsLoading(false);
      return;
    }

    let isMounted = true;
    setIsLoading(true);

    fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-version?lang=${language}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch version");
        return res.json();
      })
      .then((data) => {
        cache[language] = data;
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
  }, [language]);

  return {
    version: versionInfo.version,
    releasedAt: versionInfo.releasedAt,
    changelog: versionInfo.changelog,
    isLoading,
    error
  };
}
