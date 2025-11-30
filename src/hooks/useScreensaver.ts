import { useEffect, useCallback, useState } from "react";
import { ScreensaverConfig } from "@/components/ScreensaverSettings";

interface UseScreensaverProps {
  isConnected: boolean;
  isCasting: boolean;
  lastActivityTime: number;
  screensaverConfig: ScreensaverConfig;
  onStartScreensaver: (url: string) => Promise<void>;
  onLog?: (type: 'connection' | 'cast' | 'bridge' | 'error', message: string, details?: string) => void;
}

export const useScreensaver = ({
  isConnected,
  isCasting,
  lastActivityTime,
  screensaverConfig,
  onStartScreensaver,
  onLog,
}: UseScreensaverProps) => {
  const [isScreensaverActive, setIsScreensaverActive] = useState(false);

  const checkIdleStatus = useCallback(async () => {
    // In bridge mode, we don't need to be connected to cast
    // The bridge service will handle the Chromecast connection
    if (!screensaverConfig.enabled) {
      return;
    }

    if (isScreensaverActive) {
      return;
    }

    if (!screensaverConfig.url) {
      onLog?.('error', 'Screensaver check failed', 'No URL configured');
      return;
    }

    const idleTimeMs = Date.now() - lastActivityTime;
    const idleTimeoutMs = screensaverConfig.idleTimeout * 60 * 1000;

    if (idleTimeMs >= idleTimeoutMs) {
      onLog?.('cast', 'Screensaver idle timeout reached', `Triggering after ${Math.floor(idleTimeMs / 1000)}s idle`);
      setIsScreensaverActive(true);
      await onStartScreensaver(screensaverConfig.url);
      
      // Reset after a delay to allow re-triggering if needed
      setTimeout(() => {
        setIsScreensaverActive(false);
      }, 30000); // Reset after 30 seconds
    }
  }, [
    screensaverConfig,
    isScreensaverActive,
    lastActivityTime,
    onStartScreensaver,
    onLog,
  ]);

  useEffect(() => {
    if (!screensaverConfig.enabled) {
      return;
    }

    // Check at the configured interval
    const intervalMs = screensaverConfig.checkInterval * 1000;
    const interval = setInterval(checkIdleStatus, intervalMs);

    return () => clearInterval(interval);
  }, [checkIdleStatus, screensaverConfig.enabled, screensaverConfig.checkInterval]);

  // Reset screensaver state when casting starts or connection changes
  useEffect(() => {
    if (isCasting) {
      setIsScreensaverActive(false);
    }
  }, [isCasting]);

  // Calculate status information
  const idleTimeMs = Date.now() - lastActivityTime;
  const idleTimeoutMs = screensaverConfig.idleTimeout * 60 * 1000;
  const timeUntilScreensaver = Math.max(0, idleTimeoutMs - idleTimeMs);

  return { 
    isScreensaverActive,
    idleTimeSeconds: Math.floor(idleTimeMs / 1000),
    timeUntilScreensaverSeconds: Math.floor(timeUntilScreensaver / 1000),
    checkIntervalSeconds: screensaverConfig.checkInterval,
  };
};
