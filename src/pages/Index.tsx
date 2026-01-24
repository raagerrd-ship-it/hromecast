import { Link } from "react-router-dom";
import { HelpCircle, Download, Loader2, ChevronRight, ExternalLink } from "lucide-react";
import logo from "@/assets/logo.png";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useDownloadBridge } from "@/hooks/use-download-bridge";
import { useLatestVersion } from "@/hooks/use-latest-version";
import { useLanguage } from "@/i18n/LanguageContext";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

const Index = () => {
  const { downloadBridge, isDownloading } = useDownloadBridge();
  const { version, isLoading: isLoadingVersion } = useLatestVersion();
  const { t } = useLanguage();

  return (
    <div className="min-h-screen min-h-[100dvh] flex flex-col safe-top safe-bottom">
      {/* Hero Header */}
      <header className="flex-shrink-0 px-4 pt-8 pb-6 sm:px-6 sm:pt-10 bg-gradient-to-b from-primary/10 to-transparent">
        <div className="max-w-lg mx-auto">
          {/* Language switcher */}
          <div className="flex justify-end mb-4">
            <LanguageSwitcher />
          </div>
          
          <div className="text-center space-y-4">
            <img src={logo} alt="Chromecast Screensaver" className="h-16 w-auto mx-auto" />
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

          {/* Open Dashboard Card */}
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
