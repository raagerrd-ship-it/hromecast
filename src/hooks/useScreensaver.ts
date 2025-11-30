import { useEffect, useCallback, useState } from "react";
import { ScreensaverConfig } from "@/components/ScreensaverSettings";

interface UseScreensaverProps {
  isConnected: boolean;
  isCasting: boolean;
  lastActivityTime: number;
  screensaverConfig: ScreensaverConfig;
  onStartScreensaver: (url: string) => Promise<void>;
}

export const useScreensaver = ({
  isConnected,
  isCasting,
  lastActivityTime,
  screensaverConfig,
  onStartScreensaver,
}: UseScreensaverProps) => {
  const [isScreensaverActive, setIsScreensaverActive] = useState(false);

  const checkIdleStatus = useCallback(async () => {
    console.log('Screensaver check running...', {
      enabled: screensaverConfig.enabled,
      hasUrl: !!screensaverConfig.url,
      url: screensaverConfig.url,
      isScreensaverActive,
      idleTimeMs: Date.now() - lastActivityTime,
      timeoutMs: screensaverConfig.idleTimeout * 60 * 1000
    });

    // In bridge mode, we don't need to be connected to cast
    // The bridge service will handle the Chromecast connection
    if (!screensaverConfig.enabled) {
      console.log('Screensaver disabled, skipping check');
      return;
    }

    if (isScreensaverActive) {
      console.log('Screensaver already active, skipping check');
      return;
    }

    if (!screensaverConfig.url) {
      console.log('No screensaver URL configured, skipping check');
      return;
    }

    const idleTimeMs = Date.now() - lastActivityTime;
    const idleTimeoutMs = screensaverConfig.idleTimeout * 60 * 1000;

    console.log(`Idle check: ${idleTimeMs}ms / ${idleTimeoutMs}ms needed`);

    if (idleTimeMs >= idleTimeoutMs) {
      console.log('✅ TRIGGERING SCREENSAVER NOW!');
      setIsScreensaverActive(true);
      await onStartScreensaver(screensaverConfig.url);
      
      // Reset after a delay to allow re-triggering if needed
      setTimeout(() => {
        console.log('Resetting screensaver active state');
        setIsScreensaverActive(false);
      }, 30000); // Reset after 30 seconds
    }
  }, [
    screensaverConfig,
    isScreensaverActive,
    lastActivityTime,
    onStartScreensaver,
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
