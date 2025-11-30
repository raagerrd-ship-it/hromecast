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
      onLog?.('connection', 'Screensaver check skipped', 'Screensaver is disabled');
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
    const remainingMs = idleTimeoutMs - idleTimeMs;

    // Log the check status
    if (remainingMs > 0) {
      onLog?.('connection', 'Screensaver idle check', `${Math.floor(remainingMs / 1000)}s until activation`);
    } else {
      onLog?.('cast', 'Screensaver idle timeout reached', `Triggering after ${Math.floor(idleTimeMs / 1000)}s idle`);
      setIsScreensaverActive(true);
      await onStartScreensaver(screensaverConfig.url);
      // Don't auto-reset - only reset when casting state changes or user interacts
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

    // Log monitoring start only once
    onLog?.('connection', 'Screensaver monitoring started', `Checking every ${screensaverConfig.checkInterval}s, timeout: ${screensaverConfig.idleTimeout}m`);

    // Check at the configured interval
    const intervalMs = screensaverConfig.checkInterval * 1000;
    const interval = setInterval(checkIdleStatus, intervalMs);

    // Run check immediately on start
    checkIdleStatus();

    return () => {
      clearInterval(interval);
    };
  }, [screensaverConfig.enabled, screensaverConfig.checkInterval]);

  // Reset screensaver state when casting starts or connection changes
  useEffect(() => {
    if (isCasting) {
      setIsScreensaverActive(false);
      onLog?.('connection', 'Screensaver reset', 'Casting activity detected');
    }
  }, [isCasting, onLog]);

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
