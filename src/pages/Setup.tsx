import { ArrowLeft, Download, Terminal, CheckCircle, Copy, Check, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const Setup = () => {
  const [copiedLinux, setCopiedLinux] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  const deviceIdExample = "datornamn";

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedLinux(true);
    setTimeout(() => setCopiedLinux(false), 2000);
  };

  const downloadBridge = async () => {
    setIsDownloading(true);
    try {
      const { data, error } = await supabase.functions.invoke('download-bridge', {
        method: 'GET',
      });
      
      if (error) throw error;
      
      // Convert the response to blob and download
      const blob = new Blob([data], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'chromecast-bridge.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Download failed:', error);
      // Fallback: direct fetch
      try {
        const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/download-bridge`);
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'chromecast-bridge.zip';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (fallbackError) {
        console.error('Fallback download failed:', fallbackError);
      }
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground p-4 md:p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <Link 
          to="/" 
          className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Tillbaka
        </Link>

        <div>
          <h1 className="text-2xl font-bold">Installationsguide</h1>
          <p className="text-muted-foreground">Sätt upp Chromecast-screensaver på 2 minuter</p>
        </div>

        {/* Quick Install - Windows */}
        <Card className="border-primary">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Download className="h-5 w-5" />
              Windows - Snabbinstallation
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-medium">1</div>
                <div>
                  <p className="font-medium">Ladda ner bridge</p>
                  <Button 
                    onClick={downloadBridge} 
                    disabled={isDownloading}
                    size="sm" 
                    className="mt-2"
                  >
                    {isDownloading ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Laddar ner...
                      </>
                    ) : (
                      <>
                        <Download className="h-4 w-4 mr-2" />
                        Ladda ner chromecast-bridge.zip
                      </>
                    )}
                  </Button>
                </div>
              </div>
              
              <div className="flex items-start gap-3">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-medium">2</div>
                <div>
                  <p className="font-medium">Packa upp och kör installern</p>
                  <p className="text-sm text-muted-foreground">Högerklicka på <code className="bg-muted px-1 rounded">install-windows.ps1</code> → "Kör med PowerShell"</p>
                </div>
              </div>
              
              <div className="flex items-start gap-3">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-medium">3</div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-primary" />
                  <p className="font-medium">Klart!</p>
                </div>
              </div>
            </div>

            <div className="pt-2 border-t">
              <p className="text-xs text-muted-foreground mb-2">Scriptet installerar Node.js (om det saknas), konfigurerar bridge och skapar autostart.</p>
              <p className="text-xs text-muted-foreground">Device ID genereras automatiskt från datornamnet (t.ex. <code className="bg-muted px-1 rounded">{deviceIdExample}</code>)</p>
            </div>
          </CardContent>
        </Card>

        {/* Quick Install - Linux */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Terminal className="h-5 w-5" />
              Linux / Raspberry Pi
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground text-sm font-medium">1</div>
                <div className="flex-1">
                  <p className="font-medium mb-2">Ladda ner och kör</p>
                  <div className="relative">
                    <pre className="bg-muted p-3 rounded-md text-xs overflow-x-auto pr-12">
                      <code>{`cd chromecast-bridge && chmod +x install-linux.sh && ./install-linux.sh`}</code>
                    </pre>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="absolute right-1 top-1 h-8 w-8 p-0"
                      onClick={() => copyToClipboard('cd chromecast-bridge && chmod +x install-linux.sh && ./install-linux.sh')}
                    >
                      {copiedLinux ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              </div>
              
              <div className="flex items-start gap-3">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground text-sm font-medium">2</div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-primary" />
                  <p className="font-medium">Klart!</p>
                </div>
              </div>
            </div>

            <div className="pt-2 border-t">
              <p className="text-xs text-muted-foreground">Skapar en systemd user service som startar automatiskt vid inloggning.</p>
            </div>
          </CardContent>
        </Card>

        {/* After Installation */}
        <Card>
          <CardHeader>
            <CardTitle>Efter installation</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
              <li>Öppna webbappen och välj din Chromecast i dropdown-menyn</li>
              <li>Aktivera screensaver och ange URL</li>
              <li>Klicka "Spara" - klart!</li>
            </ol>
            <p className="text-xs text-muted-foreground mt-4">
              💡 Bridge körs automatiskt i bakgrunden och startar vid varje omstart av datorn.
            </p>
          </CardContent>
        </Card>

        {/* Troubleshooting */}
        <Card>
          <CardHeader>
            <CardTitle>Felsökning</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm space-y-3">
              <div className="flex gap-4">
                <span className="font-medium min-w-40">Hittar ingen Chromecast</span>
                <span className="text-muted-foreground">Kontrollera att enheten är på samma nätverk som datorn</span>
              </div>
              <div className="flex gap-4">
                <span className="font-medium min-w-40">Bridge startar inte</span>
                <span className="text-muted-foreground">Kör scriptet igen eller kontrollera Activity Log i webbappen</span>
              </div>
              <div className="flex gap-4">
                <span className="font-medium min-w-40">Avinstallera</span>
                <span className="text-muted-foreground">Kör <code className="bg-muted px-1 rounded">uninstall-windows.ps1</code> eller <code className="bg-muted px-1 rounded">uninstall-linux.sh</code></span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Manual Installation (collapsed) */}
        <details className="group">
          <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground transition-colors">
            Visa manuell installation (för avancerade användare)
          </summary>
          <Card className="mt-4">
            <CardContent className="pt-6 space-y-4">
              <div>
                <p className="text-sm font-medium mb-2">1. Installera Node.js 18+</p>
                <p className="text-xs text-muted-foreground">Ladda ner från nodejs.org</p>
              </div>
              <div>
                <p className="text-sm font-medium mb-2">2. Installera dependencies</p>
                <pre className="bg-muted p-3 rounded-md text-xs overflow-x-auto">
                  <code>{`cd bridge && npm install`}</code>
                </pre>
              </div>
              <div>
                <p className="text-sm font-medium mb-2">3. Skapa .env-fil</p>
                <pre className="bg-muted p-3 rounded-md text-xs overflow-x-auto">
                  <code>{`SUPABASE_URL=https://umxwaxzmoxwasryjibhe.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
DEVICE_ID=mitt-hem
POLL_INTERVAL=5000`}</code>
                </pre>
              </div>
              <div>
                <p className="text-sm font-medium mb-2">4. Starta bridge</p>
                <pre className="bg-muted p-3 rounded-md text-xs overflow-x-auto">
                  <code>{`node index.js`}</code>
                </pre>
              </div>
            </CardContent>
          </Card>
        </details>
      </div>
    </div>
  );
};

export default Setup;
