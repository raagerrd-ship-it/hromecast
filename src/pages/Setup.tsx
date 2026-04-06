import { ArrowLeft, Copy, Check, ChevronDown, Terminal, Cpu, RefreshCw, Wrench, HelpCircle, Globe } from "lucide-react";
import { Link } from "react-router-dom";
import { useState } from "react";
import { useLanguage } from "@/i18n/LanguageContext";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

const CopyBlock = ({ command, multiline = false }: { command: string; multiline?: boolean }) => {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group rounded-lg border border-foreground/5 bg-muted/50">
      <pre className={`p-3 pr-12 text-xs font-mono overflow-x-auto scrollbar-thin ${multiline ? 'whitespace-pre' : 'whitespace-nowrap'}`}>
        <code>{command}</code>
      </pre>
      <button
        onClick={copy}
        className="absolute right-2 top-2 p-1.5 rounded-md bg-background/80 border border-foreground/10 opacity-70 hover:opacity-100 transition-opacity"
        aria-label="Copy"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
};

const Setup = () => {
  const { t } = useLanguage();

  return (
    <div className="min-h-screen min-h-[100dvh] flex flex-col bg-background text-foreground">
      {/* Header */}
      <header className="flex-shrink-0 px-4 pt-6 pb-4 sm:px-6 sm:pt-8 border-b border-foreground/5">
        <div className="max-w-xl mx-auto">
          <div className="flex items-center justify-between mb-3">
            <Link
              to="/"
              className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              {t('back')}
            </Link>
            <LanguageSwitcher />
          </div>
          <div className="flex items-center gap-2.5">
            <Cpu className="h-5 w-5 text-primary" />
            <h1 className="text-xl font-bold tracking-tight">{t('setupTitle')}</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1">{t('setupSubtitle')}</p>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 px-4 py-6 sm:px-6 overflow-auto">
        <div className="max-w-xl mx-auto space-y-6">

          {/* SSH Help - expandable */}
          <details className="group rounded-lg border border-foreground/5">
            <summary className="flex items-center gap-2 cursor-pointer px-4 py-3 text-sm font-medium">
              <HelpCircle className="h-4 w-4 text-muted-foreground" />
              {t('sshHelp')}
              <ChevronDown className="h-4 w-4 text-muted-foreground ml-auto group-open:rotate-180 transition-transform" />
            </summary>
            <div className="px-4 pb-4 space-y-3 text-sm text-muted-foreground">
              <div>
                <p className="font-medium text-foreground mb-1">{t('sshEnableTitle')}</p>
                <p>{t('sshEnableDesc')} <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">sudo raspi-config</code> → Interface Options → SSH → Enable.</p>
                <p className="text-xs mt-1">{t('sshEnableAlt')} <code className="bg-muted px-1 rounded text-xs font-mono">ssh</code> {t('sshEnableAltSuffix')}</p>
              </div>
              <div>
                <p className="font-medium text-foreground mb-1">{t('sshFindIpTitle')}</p>
                <p>{t('sshFindIpDesc')}</p>
                <CopyBlock command="hostname -I" />
              </div>
              <div>
                <p className="font-medium text-foreground mb-1">{t('sshConnectTitle')}</p>
                <CopyBlock command="ssh pi@<pi-ip>" />
                <p className="text-xs mt-1">{t('sshDefaultPassword')} <code className="bg-muted px-1 rounded text-xs font-mono">raspberry</code> {t('sshChangePassword')} <code className="bg-muted px-1 rounded text-xs font-mono">passwd</code>)</p>
              </div>
            </div>
          </details>

          {/* Step 1 */}
          <section className="space-y-2">
            <div className="flex items-center gap-2.5">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-semibold">1</div>
              <h2 className="text-sm font-semibold">{t('setupStep1')}</h2>
            </div>
            <CopyBlock command="ssh pi@<pi-ip>" />
          </section>

          {/* Step 2 */}
          <section className="space-y-2">
            <div className="flex items-center gap-2.5">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-semibold">2</div>
              <h2 className="text-sm font-semibold">{t('setupStep2')}</h2>
            </div>
            <CopyBlock command={`git clone https://github.com/raagerrd-ship-it/hromecast.git && cd hromecast/bridge-pi && chmod +x install-linux.sh && ./install-linux.sh`} />
            <p className="text-xs text-muted-foreground">{t('setupStep2Note')}</p>
          </section>

          {/* Step 3 */}
          <section className="space-y-2">
            <div className="flex items-center gap-2.5">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-semibold">3</div>
              <h2 className="text-sm font-semibold">{t('setupStep3')}</h2>
            </div>
            <div className="rounded-lg border border-foreground/5 px-4 py-3 space-y-2">
              <div className="flex items-center gap-2">
                <Globe className="h-4 w-4 text-muted-foreground" />
                <code className="text-sm font-mono text-primary">http://&lt;pi-ip&gt;:3000</code>
              </div>
              <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
                <li>{t('setupStep3Item1')}</li>
                <li>{t('setupStep3Item2')}</li>
                <li>{t('setupStep3Item3')}</li>
              </ol>
            </div>
          </section>

          {/* What the script does */}
          <div className="rounded-lg border border-foreground/5 px-4 py-3 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Wrench className="h-4 w-4 text-muted-foreground" />
              {t('scriptExplainerTitle')}
            </div>
            <ul className="text-xs text-muted-foreground space-y-1">
              <li className="flex items-start gap-2">
                <span className="text-primary mt-0.5">•</span>
                {t('scriptExplainerNode')}
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary mt-0.5">•</span>
                {t('scriptExplainerCopy')} <code className="bg-muted px-1 rounded font-mono">~/.local/share/chromecast-bridge</code>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary mt-0.5">•</span>
                {t('scriptExplainerSystemd')}
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary mt-0.5">•</span>
                <div className="flex items-center gap-1">
                  <RefreshCw className="h-3 w-3 shrink-0" />
                  {t('scriptExplainerAutoUpdate')}
                </div>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary mt-0.5">•</span>
                {t('scriptExplainerRestart')}
              </li>
            </ul>
          </div>

          {/* Troubleshooting - expandable */}
          <details className="group rounded-lg border border-foreground/5">
            <summary className="flex items-center gap-2 cursor-pointer px-4 py-3 text-sm font-medium">
              <Terminal className="h-4 w-4 text-muted-foreground" />
              {t('troubleshooting')}
              <ChevronDown className="h-4 w-4 text-muted-foreground ml-auto group-open:rotate-180 transition-transform" />
            </summary>
            <div className="px-4 pb-4 space-y-3">
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">{t('troubleshootingStatus')}</p>
                <CopyBlock command="systemctl --user status chromecast-bridge" />
              </div>
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">{t('troubleshootingLogs')}</p>
                <CopyBlock command="journalctl --user -u chromecast-bridge -f" />
              </div>
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">{t('troubleshootingRestart')}</p>
                <CopyBlock command="systemctl --user restart chromecast-bridge" />
              </div>
            </div>
          </details>

        </div>
      </main>
    </div>
  );
};

export default Setup;
