import { ScreensaverSettings } from "@/components/ScreensaverSettings";
import { Link } from "react-router-dom";
import { ChromecastSelector } from "@/components/ChromecastSelector";
import { ActivityLog } from "@/components/ActivityLog";
import { IPRecoveryStatus } from "@/components/IPRecoveryStatus";
import { Play, Tv, HelpCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useCallback } from "react";
import { useActivityLog } from "@/hooks/use-activity-log";
import { useScreensaverSettings } from "@/hooks/use-screensaver-settings";
import { useBridgeStatus } from "@/hooks/use-bridge-status";
import { usePreviewScale } from "@/hooks/use-preview-scale";

const DEVICE_ID = "device-1764517968693-qxx7xr08y";

const Index = () => {
  const { toast } = useToast();
  
  // Custom hooks
  const { activityLog } = useActivityLog(DEVICE_ID);
  const {
    screensaverConfig,
    selectedChromecastId,
    screensaverActive,
    handleConfigChange,
    handleChromecastSelected,
  } = useScreensaverSettings(DEVICE_ID);
  const bridgeStatus = useBridgeStatus(activityLog);
  const [previewScale, previewContainerRef] = usePreviewScale();

  // Cast handler
  const handleStartScreensaver = useCallback(async (url: string) => {
    try {
      const { data: renderData, error: renderError } = await supabase.functions.invoke('render-website', {
        body: { url, action: 'cast' }
      });

      if (renderError) {
        toast({
          title: "Failed",
          description: renderError.message || "Could not start cast",
          variant: "destructive",
        });
        return;
      }

      const viewerUrl = renderData.viewerUrl;
      
      const { error: queueError } = await supabase.functions.invoke('queue-cast', {
        body: { 
          deviceId: DEVICE_ID,
          url: viewerUrl,
          commandType: 'cast'
        }
      });

      if (queueError) {
        toast({
          title: "Failed",
          description: "Could not queue cast",
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "Cast started",
        description: "Sending to your TV",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Something went wrong",
        variant: "destructive",
      });
    }
  }, [toast]);

  return (
    <div className="min-h-screen min-h-[100dvh] flex flex-col safe-top safe-bottom">
      {/* Header */}
      <header className="flex-shrink-0 px-4 pt-6 pb-4 sm:px-6 sm:pt-8">
        <div className="max-w-lg mx-auto">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-primary/20 flex items-center justify-center">
                <Tv className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h1 className="text-xl font-semibold tracking-tight">Screensaver</h1>
                <p className="text-xs text-muted-foreground">Auto-cast when idle</p>
              </div>
            </div>
            <Link 
              to="/setup" 
              className="p-2 rounded-lg hover:bg-muted transition-colors"
              title="Installationsguide"
            >
              <HelpCircle className="h-5 w-5 text-muted-foreground" />
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 px-4 pb-4 sm:px-6 overflow-auto">
        <div className="max-w-lg mx-auto space-y-6">
          
          {/* Device Selection */}
          <section>
            <ChromecastSelector
              deviceId={DEVICE_ID}
              selectedChromecastId={selectedChromecastId}
              onChromecastSelected={handleChromecastSelected}
            />
          </section>

          {/* Settings */}
          <section>
            <ScreensaverSettings
              currentSettings={screensaverConfig}
              onSave={handleConfigChange}
              isActive={screensaverActive}
            />
          </section>

          {/* Preview */}
          {screensaverConfig.enabled && screensaverConfig.url && (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Preview</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">1920×1080</span>
                  <button
                    onClick={() => handleStartScreensaver(screensaverConfig.url!)}
                    className="p-1.5 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary transition-colors"
                    title="Test cast"
                  >
                    <Play className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <div 
                ref={previewContainerRef}
                className="relative w-full aspect-video bg-black rounded-2xl overflow-hidden ring-1 ring-border"
              >
                <div 
                  className="absolute top-0 left-0"
                  style={{
                    width: '1920px',
                    height: '1080px',
                    transform: `scale(${previewScale})`,
                    transformOrigin: 'top left',
                  }}
                >
                  <iframe
                    src={screensaverConfig.url}
                    width="1920"
                    height="1080"
                    title="Preview"
                    loading="lazy"
                    sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
                    style={{ border: 'none' }}
                  />
                </div>
              </div>
            </section>
          )}

          {/* IP Recovery Status */}
          <IPRecoveryStatus activityLog={activityLog} />

          {/* Activity */}
          <ActivityLog activityLog={activityLog} screensaverActive={screensaverActive} />

        </div>
      </main>

      {/* Bridge status */}
      <footer className={`flex-shrink-0 px-4 py-3 sm:px-6 border-t transition-colors ${
        bridgeStatus.hasActivity 
          ? bridgeStatus.isOnline 
            ? 'bg-green-600/90 border-green-500' 
            : 'bg-red-600/90 border-red-500'
          : 'bg-card/50 border-border'
      }`}>
        <div className="max-w-lg mx-auto flex items-center justify-center gap-2">
          <span className={`h-1.5 w-1.5 rounded-full ${
            bridgeStatus.isOnline ? 'bg-white' : 'bg-white/70'
          }`} />
          <p className={`text-xs ${bridgeStatus.hasActivity ? 'text-white' : 'text-muted-foreground'}`}>
            {bridgeStatus.hasActivity 
              ? `Bridge ${bridgeStatus.isOnline ? 'online' : 'offline'}${bridgeStatus.version ? ` - v${bridgeStatus.version}` : ''}, Last seen: ${bridgeStatus.timeStr}`
              : 'No bridge activity'}
          </p>
        </div>
      </footer>
    </div>
  );
};

export default Index;
