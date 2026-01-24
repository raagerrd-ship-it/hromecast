import { ArrowLeft, Download, Terminal, CheckCircle, Copy, Check, Loader2, Globe, Wifi, WifiOff, Monitor, Cpu } from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

type Platform = 'windows' | 'linux' | 'raspberry';

const Setup = () => {
  const [copiedCommand, setCopiedCommand] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [bridgeStatus, setBridgeStatus] = useState<'unknown' | 'online' | 'offline'>('unknown');
  const [selectedPlatform, setSelectedPlatform] = useState<Platform>('windows');
  const { toast } = useToast();

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCommand(true);
    setTimeout(() => setCopiedCommand(false), 2000);
  };

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
        description: "Packa upp filen och följ instruktionerna.",
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

  const testBridgeConnection = async () => {
    setIsTesting(true);
    setBridgeStatus('unknown');
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch('http://localhost:3000/api/status', {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      
      if (response.ok) {
        const data = await response.json();
        setBridgeStatus('online');
        toast({
          title: "Bridge är igång! ✓",
          description: `Device ID: ${data.deviceId || 'okänt'}`,
        });
      } else {
        setBridgeStatus('offline');
        toast({
          title: "Bridge svarar inte korrekt",
          description: "Servern svarade men returnerade ett fel.",
          variant: "destructive",
        });
      }
    } catch (error) {
      setBridgeStatus('offline');
      toast({
        title: "Kunde inte ansluta till bridge",
        description: "Kontrollera att bridge körs på localhost:3000",
        variant: "destructive",
      });
    } finally {
      setIsTesting(false);
    }
  };

  const platforms = [
    { id: 'windows' as Platform, label: 'Windows', icon: Monitor },
    { id: 'linux' as Platform, label: 'Linux', icon: Terminal },
    { id: 'raspberry' as Platform, label: 'Raspberry Pi', icon: Cpu },
  ];

  return (
    <div className="min-h-screen min-h-[100dvh] flex flex-col bg-background text-foreground">
      {/* Header */}
      <header className="flex-shrink-0 px-4 pt-6 pb-4 sm:px-6 sm:pt-8 border-b bg-card/50">
        <div className="max-w-2xl mx-auto">
          <Link 
            to="/" 
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
          >
            <ArrowLeft className="h-4 w-4" />
            Tillbaka
          </Link>
          
          <div className="space-y-2">
            <h1 className="text-2xl font-bold tracking-tight">Installationsguide</h1>
            <p className="text-sm text-muted-foreground">
              Visa valfri webbsida på din Chromecast när datorn är inaktiv – perfekt som digital skyltning, dashboard eller screensaver.
            </p>
            <p className="text-muted-foreground font-medium">Kom igång på 2 minuter</p>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 px-4 py-6 sm:px-6 overflow-auto">
        <div className="max-w-2xl mx-auto space-y-8">
          
          {/* Step 1: Download */}
          <section className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground font-semibold">
                1
              </div>
              <h2 className="text-lg font-semibold">Ladda ner</h2>
            </div>
            
            <Card className="border-primary/50 bg-primary/5">
              <CardContent className="pt-4 pb-4">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div>
                    <p className="font-medium">chromecast-bridge.zip</p>
                    <p className="text-sm text-muted-foreground">Innehåller allt du behöver</p>
                  </div>
                  <Button 
                    onClick={downloadBridge} 
                    disabled={isDownloading}
                    size="lg"
                    className="w-full sm:w-auto gap-2"
                  >
                    {isDownloading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Laddar ner...
                      </>
                    ) : (
                      <>
                        <Download className="h-4 w-4" />
                        Ladda ner
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </section>

          {/* Step 2: Install */}
          <section className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground font-semibold">
                2
              </div>
              <h2 className="text-lg font-semibold">Installera</h2>
            </div>

            {/* Platform tabs */}
            <div className="flex gap-2 p-1 bg-muted rounded-lg">
              {platforms.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setSelectedPlatform(id)}
                  className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    selectedPlatform === id 
                      ? 'bg-background text-foreground shadow-sm' 
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span className="hidden sm:inline">{label}</span>
                </button>
              ))}
            </div>

            {/* Platform-specific instructions */}
            <Card>
              <CardContent className="pt-5 pb-5 space-y-4">
                {selectedPlatform === 'windows' && (
                  <>
                    <h3 className="font-semibold flex items-center gap-2">
                      <Monitor className="h-4 w-4" />
                      Windows
                    </h3>
                    <div className="space-y-3">
                      <div className="flex items-start gap-3">
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground text-sm font-medium">1</div>
                        <p className="text-sm">Packa upp zip-filen</p>
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground text-sm font-medium">2</div>
                        <div>
                          <p className="text-sm">Högerklicka på <code className="bg-muted px-1.5 py-0.5 rounded text-xs">install-windows.ps1</code></p>
                          <p className="text-xs text-muted-foreground mt-0.5">Välj "Kör med PowerShell som administratör"</p>
                        </div>
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-medium">
                          <CheckCircle className="h-3.5 w-3.5" />
                        </div>
                        <p className="text-sm font-medium text-primary">Klart! Bridge startar automatiskt</p>
                      </div>
                    </div>
                    <div className="pt-3 border-t">
                      <p className="text-xs text-muted-foreground">
                        💡 Scriptet installerar Node.js automatiskt om det saknas och skapar autostart vid systemstart.
                      </p>
                    </div>
                  </>
                )}

                {selectedPlatform === 'linux' && (
                  <>
                    <h3 className="font-semibold flex items-center gap-2">
                      <Terminal className="h-4 w-4" />
                      Linux
                    </h3>
                    <div className="space-y-3">
                      <div className="flex items-start gap-3">
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground text-sm font-medium">1</div>
                        <p className="text-sm">Packa upp och öppna en terminal i mappen</p>
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground text-sm font-medium">2</div>
                        <div className="flex-1">
                          <p className="text-sm mb-2">Kör installationsscriptet:</p>
                          <div className="relative">
                            <pre className="bg-muted p-3 rounded-lg text-xs overflow-x-auto pr-12 font-mono">
                              <code>chmod +x install-linux.sh && ./install-linux.sh</code>
                            </pre>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="absolute right-1 top-1 h-8 w-8 p-0"
                              onClick={() => copyToClipboard('chmod +x install-linux.sh && ./install-linux.sh')}
                            >
                              {copiedCommand ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                            </Button>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-medium">
                          <CheckCircle className="h-3.5 w-3.5" />
                        </div>
                        <p className="text-sm font-medium text-primary">Klart! Startar automatiskt vid inloggning</p>
                      </div>
                    </div>
                    <div className="pt-3 border-t">
                      <p className="text-xs text-muted-foreground">
                        💡 Skapar en systemd user service. Kontrollera status med: <code className="bg-muted px-1 rounded">systemctl --user status chromecast-bridge</code>
                      </p>
                    </div>
                  </>
                )}

                {selectedPlatform === 'raspberry' && (
                  <>
                    <h3 className="font-semibold flex items-center gap-2">
                      <Cpu className="h-4 w-4" />
                      Raspberry Pi
                    </h3>
                    <div className="space-y-3">
                      <div className="flex items-start gap-3">
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground text-sm font-medium">1</div>
                        <div>
                          <p className="text-sm">Kopiera zip-filen till din Raspberry Pi</p>
                          <p className="text-xs text-muted-foreground mt-0.5">Via USB, SCP eller SFTP</p>
                        </div>
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground text-sm font-medium">2</div>
                        <div className="flex-1">
                          <p className="text-sm mb-2">Packa upp och kör:</p>
                          <div className="relative">
                            <pre className="bg-muted p-3 rounded-lg text-xs overflow-x-auto pr-12 font-mono">
                              <code>unzip chromecast-bridge.zip{'\n'}cd chromecast-bridge{'\n'}chmod +x install-linux.sh{'\n'}./install-linux.sh</code>
                            </pre>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="absolute right-1 top-1 h-8 w-8 p-0"
                              onClick={() => copyToClipboard('unzip chromecast-bridge.zip && cd chromecast-bridge && chmod +x install-linux.sh && ./install-linux.sh')}
                            >
                              {copiedCommand ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                            </Button>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-medium">
                          <CheckCircle className="h-3.5 w-3.5" />
                        </div>
                        <p className="text-sm font-medium text-primary">Klart! Perfekt som always-on bridge</p>
                      </div>
                    </div>
                    <div className="pt-3 border-t">
                      <p className="text-xs text-muted-foreground">
                        💡 Raspberry Pi är perfekt som dedikerad bridge eftersom den är tyst och drar lite ström.
                      </p>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </section>

          {/* Step 3: Configure */}
          <section className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground font-semibold">
                3
              </div>
              <h2 className="text-lg font-semibold">Öppna & konfigurera</h2>
            </div>

            <Card className="border-primary/50 bg-primary/5">
              <CardContent className="pt-5 pb-5">
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div>
                      <p className="font-medium mb-1">Öppna i webbläsaren:</p>
                      <code className="text-xl text-primary font-mono">localhost:3000</code>
                    </div>
                    <Button 
                      onClick={testBridgeConnection}
                      disabled={isTesting}
                      variant={bridgeStatus === 'online' ? 'default' : bridgeStatus === 'offline' ? 'destructive' : 'outline'}
                    >
                      {isTesting ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Testar...
                        </>
                      ) : bridgeStatus === 'online' ? (
                        <>
                          <Wifi className="h-4 w-4 mr-2" />
                          Online
                        </>
                      ) : bridgeStatus === 'offline' ? (
                        <>
                          <WifiOff className="h-4 w-4 mr-2" />
                          Testa igen
                        </>
                      ) : (
                        <>
                          <Wifi className="h-4 w-4 mr-2" />
                          Testa anslutning
                        </>
                      )}
                    </Button>
                  </div>
                  
                  <div className="pt-3 border-t space-y-2">
                    <p className="text-sm font-medium">I bridge-gränssnittet:</p>
                    <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
                      <li>Välj din Chromecast från listan</li>
                      <li>Ange URL till din screensaver</li>
                      <li>Aktivera och testa!</li>
                    </ol>
                  </div>
                </div>
              </CardContent>
            </Card>
          </section>

          {/* FAQ / Troubleshooting */}
          <section className="space-y-4 pt-4 border-t">
            <h2 className="text-lg font-semibold">Vanliga frågor</h2>
            
            <div className="space-y-3">
              <details className="group">
                <summary className="flex items-center justify-between cursor-pointer text-sm font-medium py-2">
                  Kan jag köra flera bridges?
                  <span className="text-muted-foreground group-open:rotate-180 transition-transform">▼</span>
                </summary>
                <div className="text-sm text-muted-foreground pb-3 pl-4 space-y-2">
                  <p>Ja! Varje bridge har sin egen konfiguration.</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li><strong>Samma dator:</strong> Kör installern igen med unikt namn + port</li>
                    <li><strong>Olika datorer:</strong> Installera på varje dator</li>
                  </ul>
                  <p className="text-xs">Exempel: Vardagsrum :3000, Sovrum :3001, Kök :3002</p>
                </div>
              </details>

              <details className="group">
                <summary className="flex items-center justify-between cursor-pointer text-sm font-medium py-2">
                  Hittar ingen Chromecast
                  <span className="text-muted-foreground group-open:rotate-180 transition-transform">▼</span>
                </summary>
                <div className="text-sm text-muted-foreground pb-3 pl-4">
                  <p>Kontrollera att Chromecast och datorn är på samma nätverk. Klicka "Sök" i bridge-gränssnittet för att söka igen.</p>
                </div>
              </details>

              <details className="group">
                <summary className="flex items-center justify-between cursor-pointer text-sm font-medium py-2">
                  Sidan localhost:3000 laddas inte
                  <span className="text-muted-foreground group-open:rotate-180 transition-transform">▼</span>
                </summary>
                <div className="text-sm text-muted-foreground pb-3 pl-4 space-y-2">
                  <p>Kontrollera att bridge-tjänsten körs:</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li><strong>Windows:</strong> Öppna Task Scheduler → ChromecastBridge</li>
                    <li><strong>Linux:</strong> <code className="bg-muted px-1 rounded">systemctl --user status chromecast-bridge</code></li>
                  </ul>
                </div>
              </details>

              <details className="group">
                <summary className="flex items-center justify-between cursor-pointer text-sm font-medium py-2">
                  Hur avinstallerar jag?
                  <span className="text-muted-foreground group-open:rotate-180 transition-transform">▼</span>
                </summary>
                <div className="text-sm text-muted-foreground pb-3 pl-4">
                  <p>Kör avinstallationsscriptet:</p>
                  <ul className="list-disc list-inside space-y-1 mt-1">
                    <li><strong>Windows:</strong> <code className="bg-muted px-1 rounded">uninstall-windows.ps1</code></li>
                    <li><strong>Linux:</strong> <code className="bg-muted px-1 rounded">./uninstall-linux.sh</code></li>
                  </ul>
                </div>
              </details>
            </div>
          </section>

          {/* Manual install (collapsed) */}
          <details className="group pt-4 border-t">
            <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground transition-colors">
              Manuell installation (avancerat)
            </summary>
            <Card className="mt-4">
              <CardContent className="pt-5 pb-5 space-y-4 text-sm">
                <div>
                  <p className="font-medium mb-1">1. Installera Node.js 18+</p>
                  <p className="text-xs text-muted-foreground">Ladda ner från nodejs.org</p>
                </div>
                <div>
                  <p className="font-medium mb-1">2. Installera dependencies</p>
                  <pre className="bg-muted p-3 rounded-lg text-xs font-mono">cd chromecast-bridge && npm install</pre>
                </div>
                <div>
                  <p className="font-medium mb-1">3. Skapa .env-fil</p>
                  <pre className="bg-muted p-3 rounded-lg text-xs font-mono">DEVICE_ID=mitt-hem{'\n'}PORT=3000</pre>
                </div>
                <div>
                  <p className="font-medium mb-1">4. Starta</p>
                  <pre className="bg-muted p-3 rounded-lg text-xs font-mono">node index.js</pre>
                </div>
              </CardContent>
            </Card>
          </details>

        </div>
      </main>
    </div>
  );
};

export default Setup;
