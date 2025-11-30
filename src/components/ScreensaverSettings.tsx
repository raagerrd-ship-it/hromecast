import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Monitor, Save, Wifi, WifiOff, Clock } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";

interface ChromecastHook {
  isAvailable: boolean;
  isConnected: boolean;
  currentDevice: { friendlyName: string; id: string } | null;
  isCasting: boolean;
  lastActivityTime: number;
  idleTimeSeconds: number;
  timeUntilScreensaverSeconds: number;
  progressPercentage: number;
  requestSession: () => void;
  loadMedia: (url: string) => void;
  stopCasting: () => void;
}

interface ScreensaverSettingsProps {
  onSave: (settings: ScreensaverConfig) => void;
  currentSettings: ScreensaverConfig;
  chromecast: ChromecastHook;
}

export interface ScreensaverConfig {
  enabled: boolean;
  url: string;
  idleTimeout: number; // in minutes
  checkInterval: number; // in seconds
}

export const ScreensaverSettings = ({ onSave, currentSettings, chromecast }: ScreensaverSettingsProps) => {
  const [enabled, setEnabled] = useState(currentSettings.enabled);
  const [url, setUrl] = useState(currentSettings.url);
  const [idleTimeout, setIdleTimeout] = useState(currentSettings.idleTimeout);
  const [checkInterval, setCheckInterval] = useState(currentSettings.checkInterval);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const { toast } = useToast();

  // Sync local state with prop changes (e.g., when loaded from database)
  useEffect(() => {
    setEnabled(currentSettings.enabled);
    setUrl(currentSettings.url);
    setIdleTimeout(currentSettings.idleTimeout);
    setCheckInterval(currentSettings.checkInterval);
    setIsInitialLoad(false);
  }, [currentSettings]);

  const handleSave = () => {
    if (enabled && !url) {
      toast({
        title: "URL Required",
        description: "Please enter a screensaver URL",
        variant: "destructive",
      });
      return;
    }

    onSave({ enabled, url, idleTimeout, checkInterval });
    toast({
      title: "Settings Saved",
      description: "Screensaver settings have been updated",
    });
  };

  // Auto-save when settings change (but not on initial load)
  useEffect(() => {
    if (isInitialLoad) return;
    
    // Only auto-save if we have a valid URL or screensaver is disabled
    if (!enabled || (enabled && url)) {
      onSave({ enabled, url, idleTimeout, checkInterval });
    }
  }, [enabled, url, idleTimeout, checkInterval]);

  return (
    <Card className="bg-card/50 border-border/50 backdrop-blur-sm">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Monitor className="h-5 w-5 text-primary" />
          <CardTitle>Screensaver Mode</CardTitle>
        </div>
        <CardDescription>
          Automatically cast a page when your Chromecast is idle
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Chromecast Device Selection */}
        <div className="space-y-2">
          <Label>Chromecast Device</Label>
          {chromecast.isConnected && chromecast.currentDevice ? (
            <div className="flex items-center justify-between p-3 bg-primary/10 border border-primary/20 rounded-lg">
              <div className="flex items-center gap-3">
                <Wifi className="h-4 w-4 text-primary" />
                <div>
                  <p className="text-sm font-medium">{chromecast.currentDevice.friendlyName}</p>
                  <p className="text-xs text-muted-foreground">Connected</p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={chromecast.stopCasting}
              >
                Disconnect
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-between p-3 bg-muted/50 border border-border/50 rounded-lg">
              <div className="flex items-center gap-3">
                <WifiOff className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Not Connected</p>
                  <p className="text-xs text-muted-foreground">
                    {chromecast.isAvailable ? 'Click to select device' : 'No devices available'}
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={chromecast.requestSession}
                disabled={!chromecast.isAvailable}
              >
                Connect
              </Button>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between">
          <Label htmlFor="screensaver-enabled" className="flex flex-col gap-1">
            <span>Enable Screensaver</span>
            <span className="text-sm text-muted-foreground font-normal">
              Start casting when idle
            </span>
          </Label>
          <Switch
            id="screensaver-enabled"
            checked={enabled}
            onCheckedChange={setEnabled}
          />
        </div>

        {enabled && (
          <>
            {/* Timeline Progress Bar */}
            <div className="space-y-2 p-4 bg-muted/50 rounded-lg border">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  Next check in
                </span>
                <span className="font-mono font-medium">
                  {Math.floor(chromecast.timeUntilScreensaverSeconds / 60)}m {chromecast.timeUntilScreensaverSeconds % 60}s
                </span>
              </div>
              
              <Progress 
                value={chromecast.progressPercentage} 
                className="h-2"
              />
              
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Idle: {Math.floor(chromecast.idleTimeSeconds / 60)}m {chromecast.idleTimeSeconds % 60}s</span>
                <span>Timeout: {idleTimeout}m</span>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="screensaver-url">Screensaver URL</Label>
              <Input
                id="screensaver-url"
                type="url"
                placeholder="https://example.com/screensaver"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="idle-timeout">
                Idle Timeout (minutes)
              </Label>
              <Input
                id="idle-timeout"
                type="number"
                min="1"
                max="60"
                value={idleTimeout}
                onChange={(e) => setIdleTimeout(parseInt(e.target.value) || 5)}
              />
              <p className="text-sm text-muted-foreground">
                Start screensaver after {idleTimeout} minute{idleTimeout !== 1 ? 's' : ''} of inactivity
              </p>
            </div>
          </>
        )}

        <Button onClick={handleSave} className="w-full" variant="outline">
          <Save className="h-4 w-4 mr-2" />
          Save Now
        </Button>
      </CardContent>
    </Card>
  );
};
