import { Card, CardContent } from "@/components/ui/card";
import { Wifi, WifiOff, Monitor } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface ConnectionStatusProps {
  isConnected: boolean;
  deviceName?: string;
  hasAutoConnect: boolean;
}

export const ConnectionStatus = ({ isConnected, deviceName, hasAutoConnect }: ConnectionStatusProps) => {
  if (isConnected && deviceName) {
    return (
      <Card className="bg-primary/10 border-primary/20">
        <CardContent className="p-4 flex items-center gap-3">
          <Wifi className="h-5 w-5 text-primary" />
          <div className="flex-1">
            <p className="text-sm font-medium">Connected to {deviceName}</p>
            <p className="text-xs text-muted-foreground">Screensaver ready</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (hasAutoConnect) {
    return (
      <Alert>
        <Monitor className="h-4 w-4" />
        <AlertDescription>
          Auto-connecting to your last Chromecast device...
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Card className="bg-muted/50 border-border/50">
      <CardContent className="p-4 flex items-center gap-3">
        <WifiOff className="h-5 w-5 text-muted-foreground" />
        <div className="flex-1">
          <p className="text-sm font-medium text-muted-foreground">Not connected</p>
          <p className="text-xs text-muted-foreground">Connect to enable screensaver</p>
        </div>
      </CardContent>
    </Card>
  );
};
