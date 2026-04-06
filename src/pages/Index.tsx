import { useState } from "react";
import { Link } from "react-router-dom";
import { HelpCircle, Download, Loader2, ChevronRight, ExternalLink, Cpu, Copy, Check, RefreshCw } from "lucide-react";
import logo from "@/assets/logo.png";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useDownloadBridge } from "@/hooks/use-download-bridge";
import { useLatestVersion } from "@/hooks/use-latest-version";
import { useLanguage } from "@/i18n/LanguageContext";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

const Index = () => {
  const [copiedPi, setCopiedPi] = useState(false);
  const { downloadBridge, isDownloading } = useDownloadBridge();
  const { language, t } = useLanguage();
  const { version, isLoading: isLoadingVersion } = useLatestVersion(language);

  const piCommand = 'git clone https://github.com/raagerrd-ship-it/hromecast.git && cd hromecast/bridge-pi && chmod +x install-linux.sh && ./install-linux.sh';
  
  const copyPiCommand = () => {
    navigator.clipboard.writeText(piCommand);
    setCopiedPi(true);
    setTimeout(() => setCopiedPi(false), 2000);
  };

  return (
    <div className="min-h-screen min-h-[100dvh] flex flex-col safe-top safe-bottom">
      {/* Hero Header */}
      <header className="flex-shrink-0 px-4 pt-8 pb-6 sm:px-6 sm:pt-10 bg-gradient-to-b from-primary/10 to-transparent">
        <div className="max-w-lg mx-auto">
          <div className="text-center space-y-4">
            {/* Logo centered, language switcher absolute right */}
            <div className="relative flex items-center justify-center">
              <img src={logo} alt="Chromecast Screensaver" className="h-16 w-auto" />
              <div className="absolute right-0 top-1/2 -translate-y-1/2">
                <LanguageSwitcher />
              </div>
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{t('heroTitle')}</h1>
              <p className="text-sm text-muted-foreground leading-relaxed max-w-md mx-auto">
                {t('heroDescription')}<br />
                {t('heroDescriptionSub')}
              </p>
            </div>
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
                    <h2 className="font-semibold text-base">{t('getStarted')}</h2>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {t('getStartedDesc')}
                    </p>
                  </div>
                </div>

                {/* Steps */}
                <div className="space-y-2 pl-1">
                  <div className="flex items-center gap-3 text-sm">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-medium">1</div>
                    <span>{t('step1')}</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-medium">2</div>
                    <span>{t('step2')}</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-medium">3</div>
                    <span className="flex items-center gap-1">
                      {t('step3Open')} <code className="bg-background/50 px-1.5 py-0.5 rounded text-xs">localhost:3000</code>
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
                      {t('downloading')}
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4" />
                      {t('downloadForPlatforms')}
                    </>
                  )}
                </Button>

                <Link 
                  to="/setup"
                  className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <HelpCircle className="h-3.5 w-3.5" />
                  {t('detailedInstructions')}
                  <ChevronRight className="h-3 w-3" />
                </Link>
              </div>
            </CardContent>
          </Card>

          {/* Raspberry Pi Card */}
          <Card className="bg-primary/10 border-primary/30">
            <CardContent className="pt-5 pb-5">
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center flex-shrink-0">
                    <Cpu className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h2 className="font-semibold text-base">{t('rpiLandingTitle')}</h2>
                    <p className="text-sm text-muted-foreground mt-0.5">{t('rpiLandingDesc')}</p>
                  </div>
                </div>

                {/* Steps */}
                <div className="space-y-2 pl-1">
                  <div className="flex items-center gap-3 text-sm">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-medium">1</div>
                    <span className="font-mono text-xs">ssh pi@&lt;pi-ip&gt;</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-medium">2</div>
                    <span>Kör installationskommandot</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-medium">3</div>
                    <span className="flex items-center gap-1">
                      Öppna <code className="bg-background/50 px-1.5 py-0.5 rounded text-xs">&lt;pi-ip&gt;:3000</code>
                    </span>
                  </div>
                </div>

                {/* Copy command block */}
                <div className="relative bg-muted rounded-lg p-3 overflow-hidden">
                  <pre className="text-xs font-mono text-muted-foreground leading-relaxed whitespace-pre overflow-x-auto scrollbar-thin pr-10">
                    <code><span className="text-primary/70">$</span> git clone https://github.com/raagerrd-ship-it/hromecast.git{'\n'}<span className="text-primary/70">$</span> cd hromecast/bridge-pi{'\n'}<span className="text-primary/70">$</span> chmod +x install-linux.sh && ./install-linux.sh</code>
                  </pre>
                  <button
                    onClick={copyPiCommand}
                    className="absolute right-2 top-2 p-1.5 rounded-md bg-background/80 border border-foreground/10 opacity-70 hover:opacity-100 transition-opacity"
                    aria-label="Kopiera"
                  >
                    {copiedPi ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>

                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <RefreshCw className="h-3 w-3 text-primary/50" />
                    {t('rpiLandingAutoUpdate')}
                  </p>
                  <Link to="/setup" className="text-xs text-primary hover:underline">
                    {t('detailedInstructions')} →
                  </Link>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-card/50 border-dashed">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <h3 className="font-medium text-sm">{t('alreadyInstalled')}</h3>
                  <p className="text-xs text-muted-foreground">{t('openLocalDashboard')}</p>
                </div>
                <Button 
                  variant="outline" 
                  size="sm"
                  className="gap-1.5"
                  onClick={() => window.open('http://localhost:3000', '_blank')}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  localhost:3000
                </Button>
              </div>
            </CardContent>
          </Card>

        </div>
      </main>

      {/* Footer */}
      <footer className="flex-shrink-0 px-4 py-3 sm:px-6 border-t bg-card/50">
        <div className="max-w-lg mx-auto flex items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground">
            {t('runsLocally')}
          </p>
          <p className="text-xs text-muted-foreground">
            {t('latestVersion')}: <span className="font-medium text-foreground">
              {isLoadingVersion ? "..." : `v${version}`}
            </span>
          </p>
        </div>
      </footer>
    </div>
  );
};

export default Index;
