import { Link } from "react-router-dom";
import { useState } from "react";
import { Tv, HelpCircle, Download, Loader2, ChevronRight, Monitor, Check } from "lucide-react";
import { BridgeDiscovery } from "@/components/BridgeDiscovery";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

const Index = () => {
  const [isDownloading, setIsDownloading] = useState(false);
  const { toast } = useToast();

  const downloadBridge = async () => {
    setIsDownloading(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/download-bridge`);
      if (!response.ok) throw new Error('Download failed');
      
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'chromecast-bridge.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      toast({
        title: "Nedladdning startad",
        description: "Packa upp filen och kör installern.",
      });
    } catch (error) {
      console.error('Download failed:', error);
      toast({
        title: "Nedladdning misslyckades",
        description: "Försök igen eller kontrollera anslutningen.",
        variant: "destructive",
      });
    } finally {
      setIsDownloading(false);
    }
  };

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
                <h1 className="text-xl font-semibold tracking-tight">Chromecast Screensaver</h1>
                <p className="text-xs text-muted-foreground">Lokalt kontrollpanel</p>
              </div>
            </div>
            <Link 
              to="/setup" 
              className="p-2 rounded-lg hover:bg-muted transition-colors"
              title="Fullständig installationsguide"
            >
              <HelpCircle className="h-5 w-5 text-muted-foreground" />
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 px-4 pb-4 sm:px-6 overflow-auto">
        <div className="max-w-lg mx-auto space-y-6">
          
          {/* Quick Install Card */}
          <Card className="border-primary bg-gradient-to-br from-primary/10 to-primary/5 overflow-hidden">
            <CardContent className="pt-5 pb-5">
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center flex-shrink-0">
                    <Download className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h2 className="font-semibold text-base">Kom igång på 2 minuter</h2>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      Ladda ner och installera bridge-tjänsten på din dator
                    </p>
                  </div>
                </div>

                {/* Steps */}
                <div className="space-y-2 pl-1">
                  <div className="flex items-center gap-3 text-sm">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-medium">1</div>
                    <span>Ladda ner bridge-paketet</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-medium">2</div>
                    <span>Packa upp och kör installern</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-medium">3</div>
                    <span className="flex items-center gap-1">
                      Öppna <code className="bg-background/50 px-1.5 py-0.5 rounded text-xs">localhost:3000</code>
                    </span>
                  </div>
                </div>

                {/* Download button */}
                <Button 
                  onClick={downloadBridge} 
                  disabled={isDownloading}
                  size="lg"
                  className="w-full gap-2"
                >
                  {isDownloading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Laddar ner...
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4" />
                      Ladda ner för Windows / Linux
                    </>
                  )}
                </Button>

                <Link 
                  to="/setup"
                  className="flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Detaljerade instruktioner
                  <ChevronRight className="h-3 w-3" />
                </Link>
              </div>
            </CardContent>
          </Card>

          {/* Already installed section */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Monitor className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium text-muted-foreground">Redan installerat?</span>
            </div>
            
            {/* Bridge Discovery */}
            <BridgeDiscovery />
          </div>

          {/* How it works - compact */}
          <Card className="border-dashed">
            <CardContent className="pt-4 pb-4">
              <div className="space-y-3">
                <p className="text-sm font-medium">Så fungerar det</p>
                <div className="grid gap-2 text-xs text-muted-foreground">
                  <div className="flex items-start gap-2">
                    <Check className="h-3.5 w-3.5 text-primary mt-0.5 flex-shrink-0" />
                    <span>Bridge-tjänsten körs lokalt på din dator</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Check className="h-3.5 w-3.5 text-primary mt-0.5 flex-shrink-0" />
                    <span>Hittar Chromecast-enheter på ditt nätverk automatiskt</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Check className="h-3.5 w-3.5 text-primary mt-0.5 flex-shrink-0" />
                    <span>Ingen molnanslutning – helt privat</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

        </div>
      </main>

      {/* Footer */}
      <footer className="flex-shrink-0 px-4 py-3 sm:px-6 border-t bg-card/50">
        <div className="max-w-lg mx-auto">
          <p className="text-xs text-muted-foreground text-center">
            Varje bridge fungerar helt lokalt utan molnanslutning.
          </p>
        </div>
      </footer>
    </div>
  );
};

export default Index;
