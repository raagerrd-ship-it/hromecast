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
    if (!screensaverConfig.enabled || !isConnected || isCasting || isScreensaverActive) {
      return;
    }

    const idleTimeMs = Date.now() - lastActivityTime;
    const idleTimeoutMs = screensaverConfig.idleTimeout * 60 * 1000;

    if (idleTimeMs >= idleTimeoutMs && screensaverConfig.url) {
      console.log('Starting screensaver after idle timeout');
      setIsScreensaverActive(true);
      await onStartScreensaver(screensaverConfig.url);
    }
  }, [
    screensaverConfig,
    isConnected,
    isCasting,
    isScreensaverActive,
    lastActivityTime,
    onStartScreensaver,
  ]);

  useEffect(() => {
    if (!screensaverConfig.enabled) {
      return;
    }

    // Check every 10 seconds
    const interval = setInterval(checkIdleStatus, 10000);

    return () => clearInterval(interval);
  }, [checkIdleStatus, screensaverConfig.enabled]);

  // Reset screensaver state when casting starts
  useEffect(() => {
    if (isCasting) {
      setIsScreensaverActive(false);
    }
  }, [isCasting]);

  return { isScreensaverActive };
};
