import { Card, CardContent } from "@/components/ui/card";
import { Wifi, WifiOff, Monitor, RotateCw } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

interface ConnectionStatusProps {
  isConnected: boolean;
  deviceName?: string;
  hasAutoConnect: boolean;
  screensaverEnabled?: boolean;
  idleTimeSeconds?: number;
  timeUntilScreensaverSeconds?: number;
  lastSavedDeviceName?: string;
  onReconnect?: () => void;
}

export const ConnectionStatus = ({ 
  isConnected, 
  deviceName, 
  hasAutoConnect,
  screensaverEnabled,
  idleTimeSeconds,
  timeUntilScreensaverSeconds,
  lastSavedDeviceName,
  onReconnect,
}: ConnectionStatusProps) => {
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins > 0) {
      return `${mins}m ${secs}s`;
    }
    return `${secs}s`;
  };

  if (isConnected && deviceName) {
    return (
      <Card className="bg-primary/10 border-primary/20">
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center gap-3">
            <Wifi className="h-5 w-5 text-primary" />
            <div className="flex-1">
              <p className="text-sm font-medium">Connected to {deviceName}</p>
              {screensaverEnabled && (
                <p className="text-xs text-muted-foreground">
                  Screensaver enabled • Idle timeout monitoring active
                </p>
              )}
              {!screensaverEnabled && (
                <p className="text-xs text-muted-foreground">Screensaver disabled</p>
              )}
            </div>
          </div>
          {screensaverEnabled && idleTimeSeconds !== undefined && timeUntilScreensaverSeconds !== undefined && (
            <div className="text-xs text-muted-foreground pl-8 space-y-1">
              <p>Idle time: {formatTime(idleTimeSeconds)}</p>
              <p>Screensaver in: {formatTime(timeUntilScreensaverSeconds)}</p>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-muted/50 border-border/50">
      <CardContent className="p-4 flex items-center gap-3">
        <WifiOff className="h-5 w-5 text-muted-foreground" />
        <div className="flex-1">
          <p className="text-sm font-medium text-muted-foreground">Not connected</p>
          {lastSavedDeviceName ? (
            <p className="text-xs text-muted-foreground">
              Last device: {lastSavedDeviceName}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">Connect to enable screensaver</p>
          )}
        </div>
        {lastSavedDeviceName && onReconnect && (
          <Button 
            size="sm" 
            variant="outline" 
            onClick={onReconnect}
            className="gap-2"
          >
            <RotateCw className="h-4 w-4" />
            Reconnect
          </Button>
        )}
      </CardContent>
    </Card>
  );
};
