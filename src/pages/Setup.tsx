import { ArrowLeft, Download, Terminal, CheckCircle, Copy, Check, Loader2, Wifi, WifiOff, Monitor, Cpu, ChevronDown } from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useDownloadBridge } from "@/hooks/use-download-bridge";
import { useLatestVersion } from "@/hooks/use-latest-version";
import { useLanguage } from "@/i18n/LanguageContext";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import type { TranslationKey } from "@/i18n/translations";

type Platform = 'windows' | 'linux' | 'raspberry';

type ChangelogEntry = {
  version: string;
  date: string;
  changes: string[];
};

const ChangelogList = ({ 
  changelog, 
  currentVersion, 
  t 
}: { 
  changelog: ChangelogEntry[]; 
  currentVersion: string; 
  t: (key: TranslationKey) => string;
}) => {
  const [showAll, setShowAll] = useState(false);
  const displayedChangelog = showAll ? changelog : changelog.slice(0, 5);
  const hasMore = changelog.length > 5;

  return (
    <div className="space-y-4 mt-4">
      {displayedChangelog.map((release) => (
        <Card key={release.version}>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="font-semibold">v{release.version}</span>
              <span className="text-xs text-muted-foreground">{release.date}</span>
              {release.version === currentVersion && (
                <span className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded-full">{t('latest')}</span>
              )}
            </div>
            <ul className="space-y-1.5">
              {release.changes.map((change, index) => (
                <li key={index} className="text-sm text-muted-foreground flex items-start gap-2">
                  <CheckCircle className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                  {change}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
      
      {hasMore && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowAll(!showAll)}
          className="w-full text-muted-foreground hover:text-foreground"
        >
          <ChevronDown className={`h-4 w-4 mr-2 transition-transform ${showAll ? 'rotate-180' : ''}`} />
          {showAll ? t('showLess') : t('showAllVersions')}
        </Button>
      )}
    </div>
  );
};

const Setup = () => {
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [bridgeStatus, setBridgeStatus] = useState<'unknown' | 'online' | 'offline'>('unknown');
  const [selectedPlatform, setSelectedPlatform] = useState<Platform>('windows');
  const { toast } = useToast();
  const { downloadBridge, isDownloading } = useDownloadBridge();
  const { language, t } = useLanguage();
  const { version, changelog, isLoading: isLoadingVersion } = useLatestVersion(language);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCommand(text);
    setTimeout(() => setCopiedCommand(null), 2000);
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
          title: t('bridgeOnline'),
          description: `${t('deviceId')} ${data.deviceId || t('unknown')}`,
        });
      } else {
        setBridgeStatus('offline');
        toast({
          title: t('bridgeNotResponding'),
          description: t('serverError'),
          variant: "destructive",
        });
      }
    } catch (error) {
      setBridgeStatus('offline');
      toast({
        title: t('couldNotConnect'),
        description: t('checkBridgeRunning'),
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
          <div className="flex items-center justify-between mb-4">
            <Link 
              to="/" 
              className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              {t('back')}
            </Link>
            <LanguageSwitcher />
          </div>
          
          <h1 className="text-2xl font-bold tracking-tight">{t('installGuide')}</h1>
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
              <h2 className="text-lg font-semibold">{t('downloadStep')}</h2>
            </div>
            
            <Card className="border-primary/50 bg-primary/5">
              <CardContent className="pt-4 pb-4">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div>
                    <p className="font-medium">chromecast-bridge.zip <span className="text-xs text-muted-foreground font-normal">{isLoadingVersion ? "" : `v${version}`}</span></p>
                    <p className="text-sm text-muted-foreground">{t('containsEverything')}</p>
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
                        {t('downloading')}
                      </>
                    ) : (
                      <>
                        <Download className="h-4 w-4" />
                        {t('download')}
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
              <h2 className="text-lg font-semibold">{t('installStep')}</h2>
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
                        <p className="text-sm">{t('unzipFile')}</p>
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground text-sm font-medium">2</div>
                        <div>
                          <p className="text-sm">{t('rightClickPowershell')} <code className="bg-muted px-1.5 py-0.5 rounded text-xs">install-windows.ps1</code></p>
                          <p className="text-xs text-muted-foreground mt-0.5">{t('runWithPowershell')}</p>
                        </div>
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-medium">
                          <CheckCircle className="h-3.5 w-3.5" />
                        </div>
                        <p className="text-sm font-medium text-primary">{t('done')}</p>
                      </div>
                    </div>
                    <div className="pt-3 border-t">
                      <p className="text-xs text-muted-foreground">
                        💡 {t('windowsTip')}
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
                        <p className="text-sm">{t('unzipAndOpenTerminal')}</p>
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground text-sm font-medium">2</div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm mb-2">{t('runInstallScript')}</p>
                          <div className="flex items-center gap-2">
                            <pre className="flex-1 min-w-0 bg-muted p-3 rounded-lg text-xs overflow-x-auto font-mono">
                              <code>chmod +x install-linux.sh && ./install-linux.sh</code>
                            </pre>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="shrink-0 h-8 w-8 p-0"
                              onClick={() => copyToClipboard('chmod +x install-linux.sh && ./install-linux.sh')}
                            >
                              {copiedCommand === 'chmod +x install-linux.sh && ./install-linux.sh' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                            </Button>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-medium">
                          <CheckCircle className="h-3.5 w-3.5" />
                        </div>
                        <p className="text-sm font-medium text-primary">{t('doneLinux')}</p>
                      </div>
                    </div>
                    <div className="pt-3 border-t">
                      <p className="text-xs text-muted-foreground break-words">
                        💡 {t('linuxTip')} <code className="bg-muted px-1 rounded break-all">systemctl --user status chromecast-bridge</code>
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
                          <p className="text-sm">{t('copyZipToRpi')}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{t('viaUsb')}</p>
                        </div>
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground text-sm font-medium">2</div>
                        <div className="flex-1">
                          <p className="text-sm mb-2">{t('unzipAndRun')}</p>
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
                              {copiedCommand === 'unzip chromecast-bridge.zip && cd chromecast-bridge && chmod +x install-linux.sh && ./install-linux.sh' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                            </Button>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-medium">
                          <CheckCircle className="h-3.5 w-3.5" />
                        </div>
                        <p className="text-sm font-medium text-primary">{t('doneRpi')}</p>
                      </div>
                    </div>
                    <div className="pt-3 border-t">
                      <p className="text-xs text-muted-foreground">
                        💡 {t('rpiTip')}
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
              <h2 className="text-lg font-semibold">{t('configureStep')}</h2>
            </div>

            <Card className="border-primary/50 bg-primary/5">
              <CardContent className="pt-5 pb-5">
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div>
                      <p className="font-medium mb-1">{t('openInBrowser')}</p>
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
                          {t('testing')}
                        </>
                      ) : bridgeStatus === 'online' ? (
                        <>
                          <Wifi className="h-4 w-4 mr-2" />
                          {t('online')}
                        </>
                      ) : bridgeStatus === 'offline' ? (
                        <>
                          <WifiOff className="h-4 w-4 mr-2" />
                          {t('tryAgain')}
                        </>
                      ) : (
                        <>
                          <Wifi className="h-4 w-4 mr-2" />
                          {t('testConnection')}
                        </>
                      )}
                    </Button>
                  </div>
                  
                  <div className="pt-3 border-t space-y-2">
                    <p className="text-sm font-medium">{t('inBridgeInterface')}</p>
                    <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
                      <li>{t('selectChromecast')}</li>
                      <li>{t('enterUrl')}</li>
                      <li>{t('activateAndTest')}</li>
                    </ol>
                  </div>
                </div>
              </CardContent>
            </Card>
          </section>

          {/* FAQ / Troubleshooting */}
          <section className="space-y-4 pt-4 border-t">
            <h2 className="text-lg font-semibold">{t('faq')}</h2>
            
            <div className="space-y-3">
              <details className="group">
                <summary className="flex items-center justify-between cursor-pointer text-sm font-medium py-2">
                  {t('faqMultipleBridges')}
                  <span className="text-muted-foreground group-open:rotate-180 transition-transform">▼</span>
                </summary>
                <div className="text-sm text-muted-foreground pb-3 pl-4 space-y-2">
                  <p>{t('faqMultipleBridgesAnswer1')}</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li><strong>{t('faqMultipleBridgesSameComputer')}</strong> {t('faqMultipleBridgesSameComputerAnswer')}</li>
                    <li><strong>{t('faqMultipleBridgesDifferent')}</strong> {t('faqMultipleBridgesDifferentAnswer')}</li>
                  </ul>
                  <p className="text-xs">{t('faqMultipleBridgesExample')}</p>
                </div>
              </details>

              <details className="group">
                <summary className="flex items-center justify-between cursor-pointer text-sm font-medium py-2">
                  {t('faqNoChromecast')}
                  <span className="text-muted-foreground group-open:rotate-180 transition-transform">▼</span>
                </summary>
                <div className="text-sm text-muted-foreground pb-3 pl-4">
                  <p>{t('faqNoChromecastAnswer')}</p>
                </div>
              </details>

              <details className="group">
                <summary className="flex items-center justify-between cursor-pointer text-sm font-medium py-2">
                  {t('faqLocalhostNotLoading')}
                  <span className="text-muted-foreground group-open:rotate-180 transition-transform">▼</span>
                </summary>
                <div className="text-sm text-muted-foreground pb-3 pl-4 space-y-2">
                  <p>{t('faqLocalhostNotLoadingAnswer')}</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li>
                      <strong>Windows:</strong> {t('faqLocalhostWindows')} <kbd className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">Windows + R</kbd>, {t('faqLocalhostWindowsWrite')} <code className="bg-muted px-1 rounded">taskschd.msc</code> {t('faqLocalhostWindowsEnter')}
                    </li>
                    <li><strong>Linux:</strong> <code className="bg-muted px-1 rounded">systemctl --user status chromecast-bridge</code></li>
                  </ul>
                </div>
              </details>

              <details className="group">
                <summary className="flex items-center justify-between cursor-pointer text-sm font-medium py-2">
                  {t('faqUninstall')}
                  <span className="text-muted-foreground group-open:rotate-180 transition-transform">▼</span>
                </summary>
                <div className="text-sm text-muted-foreground pb-3 pl-4">
                  <p>{t('faqUninstallAnswer')}</p>
                  <ul className="list-disc list-inside space-y-1 mt-1">
                    <li><strong>Windows:</strong> <code className="bg-muted px-1 rounded">uninstall-windows.ps1</code></li>
                    <li><strong>Linux:</strong> <code className="bg-muted px-1 rounded">./uninstall-linux.sh</code></li>
                  </ul>
                </div>
              </details>
            </div>
          </section>

          {/* Changelog */}
          <details className="group pt-4 border-t">
            <summary className="flex items-center justify-between cursor-pointer">
              <h2 className="text-lg font-semibold">{t('changelog')}</h2>
              <span className="text-muted-foreground group-open:rotate-180 transition-transform">▼</span>
            </summary>
            
            {isLoadingVersion ? (
              <div className="text-sm text-muted-foreground mt-4">{t('loading')}</div>
            ) : (
              <ChangelogList 
                changelog={changelog} 
                currentVersion={version} 
                t={t} 
              />
            )}
          </details>

          {/* Manual install (collapsed) */}
          <details className="group pt-4 border-t">
            <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground transition-colors">
              {t('manualInstall')}
            </summary>
            <Card className="mt-4">
              <CardContent className="pt-5 pb-5 space-y-5 text-sm">
                <p className="text-muted-foreground">{t('manualInstallDesc')}</p>
                
                {/* Step 1: Download */}
                <div className="space-y-2">
                  <p className="font-medium">1. {t('downloadBridgePackage')}</p>
                  <p className="text-xs text-muted-foreground">{t('downloadBridgePackageDesc')}</p>
                  <Button 
                    onClick={downloadBridge} 
                    disabled={isDownloading}
                    variant="outline"
                    size="sm"
                    className="gap-2"
                  >
                    {isDownloading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {t('downloading')}
                      </>
                    ) : (
                      <>
                        <Download className="h-4 w-4" />
                        chromecast-bridge.zip
                      </>
                    )}
                  </Button>
                </div>

                {/* Step 2: Install Node.js */}
                <div className="space-y-2">
                  <p className="font-medium">2. {t('installNodejs')}</p>
                  <p className="text-xs text-muted-foreground">{t('downloadFromNodejs')}</p>
                  <p className="text-xs text-muted-foreground mt-2">{t('verifyNodeInstall')}</p>
                  <div className="flex items-center gap-2">
                    <pre className="flex-1 bg-muted p-3 rounded-lg text-xs font-mono overflow-x-auto">node --version</pre>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0 h-8 w-8 p-0"
                      onClick={() => copyToClipboard('node --version')}
                    >
                      {copiedCommand === 'node --version' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>

                {/* Step 3: Extract and navigate */}
                <div className="space-y-2">
                  <p className="font-medium">3. {t('extractAndNavigate')}</p>
                  <div className="flex items-center gap-2">
                    <pre className="flex-1 bg-muted p-3 rounded-lg text-xs font-mono overflow-x-auto">unzip chromecast-bridge.zip && cd chromecast-bridge</pre>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0 h-8 w-8 p-0"
                      onClick={() => copyToClipboard('unzip chromecast-bridge.zip && cd chromecast-bridge')}
                    >
                      {copiedCommand === 'unzip chromecast-bridge.zip && cd chromecast-bridge' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>

                {/* Step 4: Install dependencies */}
                <div className="space-y-2">
                  <p className="font-medium">4. {t('installDependencies')}</p>
                  <div className="flex items-center gap-2">
                    <pre className="flex-1 bg-muted p-3 rounded-lg text-xs font-mono overflow-x-auto">npm install</pre>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0 h-8 w-8 p-0"
                      onClick={() => copyToClipboard('npm install')}
                    >
                      {copiedCommand === 'npm install' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>

                {/* Step 5: Create .env file */}
                <div className="space-y-2">
                  <p className="font-medium">5. {t('createEnvFile')}</p>
                  <p className="text-xs text-muted-foreground">{t('envFileDesc')}</p>
                  <pre className="bg-muted p-3 rounded-lg text-xs font-mono">
                    <code>DEVICE_ID=my-home{'\n'}PORT=3000</code>
                  </pre>
                  <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
                    <li><code className="bg-muted px-1 rounded">DEVICE_ID</code> – {t('deviceIdExplanation')}</li>
                    <li><code className="bg-muted px-1 rounded">PORT</code> – {t('portExplanation')}</li>
                  </ul>
                </div>

                {/* Step 6: Start */}
                <div className="space-y-2">
                  <p className="font-medium">6. {t('start')}</p>
                  <div className="flex items-center gap-2">
                    <pre className="flex-1 bg-muted p-3 rounded-lg text-xs font-mono overflow-x-auto">node index.js</pre>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0 h-8 w-8 p-0"
                      onClick={() => copyToClipboard('node index.js')}
                    >
                      {copiedCommand === 'node index.js' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">{t('startInBackground')}</p>
                  <div className="flex items-center gap-2">
                    <pre className="flex-1 bg-muted p-3 rounded-lg text-xs font-mono overflow-x-auto">nohup node index.js &</pre>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0 h-8 w-8 p-0"
                      onClick={() => copyToClipboard('nohup node index.js &')}
                    >
                      {copiedCommand === 'nohup node index.js &' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>

                {/* Step 7: Verify */}
                <div className="space-y-2">
                  <p className="font-medium">7. {t('verifyRunning')}</p>
                  <div className="flex items-center gap-2">
                    <pre className="flex-1 bg-muted p-3 rounded-lg text-xs font-mono overflow-x-auto">curl http://localhost:3000/api/status</pre>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0 h-8 w-8 p-0"
                      onClick={() => copyToClipboard('curl http://localhost:3000/api/status')}
                    >
                      {copiedCommand === 'curl http://localhost:3000/api/status' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">{t('shouldSeeJson')}</p>
                </div>

                {/* Autostart tip */}
                <div className="pt-3 border-t space-y-1">
                  <p className="font-medium text-xs">{t('autostart')}</p>
                  <p className="text-xs text-muted-foreground">{t('autostartDesc')}</p>
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
