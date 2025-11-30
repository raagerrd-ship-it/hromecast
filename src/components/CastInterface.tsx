import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Wifi, Cast, Square, Loader2, AlertCircle } from "lucide-react";

interface ChromecastHook {
  isAvailable: boolean;
  isConnected: boolean;
  currentDevice: { friendlyName: string; id?: string } | null;
  isCasting: boolean;
  lastActivityTime: number;
  requestSession: () => void;
  loadMedia: (url: string) => void;
  stopCasting: () => void;
}

interface CastInterfaceProps {
  onCast: (url: string) => Promise<string | null>;
  chromecast: ChromecastHook;
}

export const CastInterface = ({ onCast, chromecast }: CastInterfaceProps) => {
  const [url, setUrl] = useState("");
  const [isCasting, setIsCasting] = useState(false);
  const {
    isAvailable,
    isConnected,
    currentDevice,
    requestSession,
    loadMedia,
    stopCasting,
  } = chromecast;

  const handleConnect = () => {
    requestSession();
  };

  const handleCast = async () => {
    if (!url) {
      return;
    }

    // Queue cast command for bridge service
    setIsCasting(true);
    await onCast(url);
  };

  const handleStop = () => {
    setIsCasting(false);
    stopCasting();
  };

  return (
    <div className="w-full max-w-2xl mx-auto space-y-6">
      {/* Cast SDK Status */}
      {!isAvailable && (
        <Card className="p-4 border-destructive/50 bg-destructive/10">
          <div className="flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <div>
              <p className="text-sm font-medium">Chromecast Not Available</p>
              <p className="text-xs text-muted-foreground">
                Make sure your Chromecast is on the same network as this device.
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Connection Status */}
      <Card className="p-6 border-border/50 backdrop-blur-sm bg-card/80">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${isConnected ? 'bg-primary/20' : 'bg-muted'}`}>
              <Wifi className={`h-5 w-5 ${isConnected ? 'text-primary' : 'text-muted-foreground'}`} />
            </div>
            <div>
              <h3 className="font-semibold">Chromecast Status</h3>
              <p className="text-sm text-muted-foreground">
                {isConnected ? `Connected to ${currentDevice?.friendlyName}` : "Not Connected"}
              </p>
            </div>
          </div>
          <Button
            onClick={handleConnect}
            disabled={!isAvailable || isConnected}
            variant="outline"
            size="sm"
          >
            {isConnected ? "Connected" : "Connect"}
          </Button>
        </div>
      </Card>

      {/* URL Input */}
      <Card className="p-6 border-border/50 backdrop-blur-sm bg-card/80">
        <div className="space-y-4">
          <div>
            <label htmlFor="url" className="text-sm font-medium mb-2 block">
              Website URL
            </label>
            <Input
              id="url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com"
              disabled={!isConnected || isCasting}
              className="bg-background/50 border-border/50 focus:border-primary"
            />
          </div>
          <Button
            onClick={handleCast}
            disabled={!isConnected || isCasting}
            variant="cast"
            size="lg"
            className="w-full"
          >
            <Cast className="h-5 w-5" />
            Start Casting
          </Button>
        </div>
      </Card>

      {/* Playback Controls */}
      {isCasting && (
        <Card className="p-6 border-border/50 backdrop-blur-sm bg-card/80 animate-in fade-in slide-in-from-bottom-4">
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
              <p className="text-sm font-medium">Now Casting</p>
            </div>
            <p className="text-sm text-muted-foreground truncate">{url}</p>
            <div className="flex gap-2">
              <Button variant="destructive" size="sm" onClick={handleStop} className="w-full">
                <Square className="h-4 w-4" />
                Stop Casting
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
};
