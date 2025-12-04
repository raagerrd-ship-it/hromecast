import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Link } from "lucide-react";
import { useState, useEffect } from "react";

interface ScreensaverSettingsProps {
  onSave: (settings: ScreensaverConfig) => void;
  currentSettings: ScreensaverConfig;
  isActive?: boolean;
}

export interface ScreensaverConfig {
  enabled: boolean;
  url: string;
  idleTimeout: number;
  checkInterval: number;
}

export const ScreensaverSettings = ({ onSave, currentSettings, isActive = false }: ScreensaverSettingsProps) => {
  const [enabled, setEnabled] = useState(currentSettings.enabled);
  const [url, setUrl] = useState(currentSettings.url);
  const [idleTimeout, setIdleTimeout] = useState(currentSettings.idleTimeout);
  const [checkInterval, setCheckInterval] = useState(currentSettings.checkInterval);
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  useEffect(() => {
    setEnabled(currentSettings.enabled);
    setUrl(currentSettings.url);
    setIdleTimeout(currentSettings.idleTimeout);
    setCheckInterval(currentSettings.checkInterval);
    setIsInitialLoad(false);
  }, [currentSettings]);

  useEffect(() => {
    if (isInitialLoad) return;
    
    if (!enabled || (enabled && url)) {
      onSave({ enabled, url, idleTimeout, checkInterval });
    }
  }, [enabled, url, idleTimeout, checkInterval]);

  const getStatusText = () => {
    if (!enabled) return 'Disabled';
    if (isActive) return 'On TV';
    return 'Waiting';
  };

  return (
    <div className="space-y-4">
      {/* Enable Toggle */}
      <div className="flex items-center justify-between p-4 rounded-xl bg-secondary/50 border border-border">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
            enabled ? 'bg-primary/20' : 'bg-muted'
          }`}>
            {enabled && isActive ? (
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-primary" />
              </span>
            ) : (
              <div className={`w-3 h-3 rounded-full transition-colors ${
                enabled ? 'bg-primary' : 'bg-muted-foreground'
              }`} />
            )}
          </div>
          <div>
            <p className="text-sm font-medium">Screensaver</p>
            <p className={`text-xs ${enabled && isActive ? 'text-primary' : 'text-muted-foreground'}`}>
              {getStatusText()}
            </p>
          </div>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={setEnabled}
          className="data-[state=checked]:bg-primary"
        />
      </div>

      {enabled && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Link className="h-4 w-4 text-primary" />
            URL
          </div>
          <Input
            type="url"
            placeholder="https://example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="h-12 rounded-xl bg-secondary/50 border-border placeholder:text-muted-foreground/50"
          />
        </div>
      )}
    </div>
  );
};
