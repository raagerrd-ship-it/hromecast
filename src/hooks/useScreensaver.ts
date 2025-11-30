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
    console.log('[Screensaver] checkIdleStatus called', {
      enabled: screensaverConfig.enabled,
      url: screensaverConfig.url,
      isScreensaverActive,
      lastActivityTime,
      idleTimeout: screensaverConfig.idleTimeout
    });

    // In bridge mode, we don't need to be connected to cast
    // The bridge service will handle the Chromecast connection
    if (!screensaverConfig.enabled) {
      console.log('[Screensaver] Check skipped - disabled');
      onLog?.('connection', 'Screensaver check skipped', 'Screensaver is disabled');
      return;
    }

    if (isScreensaverActive) {
      console.log('[Screensaver] Check skipped - already active');
      return;
    }

    if (!screensaverConfig.url) {
      console.log('[Screensaver] Check failed - no URL');
      onLog?.('error', 'Screensaver check failed', 'No URL configured');
      return;
    }

    const idleTimeMs = Date.now() - lastActivityTime;
    const idleTimeoutMs = screensaverConfig.idleTimeout * 60 * 1000;
    const remainingMs = idleTimeoutMs - idleTimeMs;

    console.log('[Screensaver] Idle calculation', {
      idleTimeMs,
      idleTimeoutMs,
      remainingMs,
      remainingSeconds: Math.floor(remainingMs / 1000)
    });

    // Log the check status
    if (remainingMs > 0) {
      onLog?.('connection', 'Screensaver idle check', `${Math.floor(remainingMs / 1000)}s until activation`);
    } else {
      console.log('[Screensaver] TRIGGERING NOW');
      onLog?.('cast', 'Screensaver idle timeout reached', `Triggering after ${Math.floor(idleTimeMs / 1000)}s idle`);
      setIsScreensaverActive(true);
      await onStartScreensaver(screensaverConfig.url);
      console.log('[Screensaver] onStartScreensaver completed');
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
      onLog?.('connection', 'Screensaver monitoring disabled', 'Enable in settings to activate');
      return;
    }

    // Log monitoring start
    console.log('[Screensaver] Setting up monitoring', screensaverConfig);
    onLog?.('connection', 'Screensaver monitoring started', `Checking every ${screensaverConfig.checkInterval}s, timeout: ${screensaverConfig.idleTimeout}m`);

    // Check at the configured interval
    const intervalMs = screensaverConfig.checkInterval * 1000;
    const interval = setInterval(() => {
      console.log('[Screensaver] Running periodic check');
      checkIdleStatus();
    }, intervalMs);

    // Run check immediately on start
    console.log('[Screensaver] Running initial check');
    checkIdleStatus();

    return () => {
      console.log('[Screensaver] Cleaning up monitoring');
      clearInterval(interval);
    };
  }, [screensaverConfig.enabled, screensaverConfig.checkInterval, screensaverConfig.idleTimeout, screensaverConfig.url]);

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
