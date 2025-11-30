import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Monitor, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

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
  const { toast } = useToast();

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

            <div className="space-y-2">
              <Label htmlFor="check-interval">
                Check Interval (seconds)
              </Label>
              <Input
                id="check-interval"
                type="number"
                min="5"
                max="300"
                value={checkInterval}
                onChange={(e) => setCheckInterval(parseInt(e.target.value) || 10)}
              />
              <p className="text-sm text-muted-foreground">
                Check for idle status every {checkInterval} second{checkInterval !== 1 ? 's' : ''}
              </p>
            </div>
          </>
        )}

        <Button onClick={handleSave} className="w-full">
          <Save className="h-4 w-4 mr-2" />
          Save Settings
        </Button>
      </CardContent>
    </Card>
  );
};
