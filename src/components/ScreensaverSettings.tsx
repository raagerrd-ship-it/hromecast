import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Link, Clock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";

interface ScreensaverSettingsProps {
  onSave: (settings: ScreensaverConfig) => void;
  currentSettings: ScreensaverConfig;
}

export interface ScreensaverConfig {
  enabled: boolean;
  url: string;
  idleTimeout: number;
  checkInterval: number;
}

export const ScreensaverSettings = ({ onSave, currentSettings }: ScreensaverSettingsProps) => {
  const [enabled, setEnabled] = useState(currentSettings.enabled);
  const [url, setUrl] = useState(currentSettings.url);
  const [idleTimeout, setIdleTimeout] = useState(currentSettings.idleTimeout);
  const [checkInterval, setCheckInterval] = useState(currentSettings.checkInterval);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const { toast } = useToast();

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

  return (
    <div className="space-y-4">
      {/* Enable Toggle */}
      <div className="flex items-center justify-between p-4 rounded-xl bg-secondary/50 border border-border">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
            enabled ? 'bg-primary/20' : 'bg-muted'
          }`}>
            <div className={`w-3 h-3 rounded-full transition-colors ${
              enabled ? 'bg-primary' : 'bg-muted-foreground'
            }`} />
          </div>
          <div>
            <p className="text-sm font-medium">Screensaver</p>
            <p className="text-xs text-muted-foreground">
              {enabled ? 'Active' : 'Disabled'}
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
        <>
          {/* URL Input */}
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

          {/* Idle Timeout */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Clock className="h-4 w-4 text-primary" />
              Idle timeout
            </div>
            <div className="flex items-center gap-3">
              <Input
                type="number"
                min="1"
                max="60"
                value={idleTimeout}
                onChange={(e) => setIdleTimeout(parseInt(e.target.value) || 5)}
                className="h-12 w-20 rounded-xl bg-secondary/50 border-border text-center"
              />
              <span className="text-sm text-muted-foreground">minutes</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
