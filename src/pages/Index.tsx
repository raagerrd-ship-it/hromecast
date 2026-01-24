import { Link } from "react-router-dom";
import { Tv, HelpCircle, Info } from "lucide-react";
import { BridgeDiscovery } from "@/components/BridgeDiscovery";
import { Card, CardContent } from "@/components/ui/card";

const Index = () => {
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
          
          {/* Info banner */}
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="pt-4 pb-4">
              <div className="flex gap-3">
                <Info className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium mb-1">Hur det fungerar</p>
                  <p className="text-muted-foreground">
                    Bridge-tjänsten körs på din lokala dator och styr Chromecast-enheter på ditt nätverk.
                    All konfiguration sker via bridge:ens egna webbgränssnitt.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Bridge Discovery */}
          <section>
            <BridgeDiscovery />
          </section>

          {/* Setup help */}
          <Card className="border-dashed">
            <CardContent className="pt-4 pb-4">
              <div className="text-center space-y-2">
                <p className="text-sm text-muted-foreground">
                  Har du inte installerat en bridge ännu?
                </p>
                <Link 
                  to="/setup"
                  className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
                >
                  <HelpCircle className="h-4 w-4" />
                  Visa installationsguiden
                </Link>
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
