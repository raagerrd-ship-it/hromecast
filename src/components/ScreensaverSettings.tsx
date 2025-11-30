import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Monitor, Save } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";

interface ScreensaverSettingsProps {
  onSave: (settings: ScreensaverConfig) => void;
  currentSettings: ScreensaverConfig;
}

export interface ScreensaverConfig {
  enabled: boolean;
  url: string;
  idleTimeout: number; // in minutes
  checkInterval: number; // in seconds
}

export const ScreensaverSettings = ({ onSave, currentSettings }: ScreensaverSettingsProps) => {
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
