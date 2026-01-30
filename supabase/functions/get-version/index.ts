import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ============================================================================
// VERSION SOURCE OF TRUTH
// Update this when releasing a new version. Everything else reads from here.
// ============================================================================

type ChangelogEntry = {
  version: string;
  date: string;
  changes: {
    sv: string[];
    en: string[];
  };
};

const VERSION = "1.3.47";
const RELEASED_AT = "2026-01-30";

const CHANGELOG: ChangelogEntry[] = [
  {
    version: "1.3.47",
    date: "2026-01-30",
    changes: {
      sv: [
        "Robust Windows-uppdatering: Avregistrerar task först, retry-loop för fillåsning",
        "Använder taskkill som backup om WMI missar processer",
        "Upp till 5 försök att frigöra filer innan borttagning",
      ],
      en: [
        "Robust Windows update: Unregisters task first, retry loop for file locks",
        "Uses taskkill as backup if WMI misses processes",
        "Up to 5 attempts to release files before removal",
      ],
    }
  },
  {
    version: "1.3.46",
    date: "2026-01-30",
    changes: {
      sv: [
        "Minnesövervakning: Receiver loggar minnesanvändning var 5:e minut",
        "Visar tillväxt sedan start och varnar vid högt minne (>80%)",
        "Sparar minnesstatistik mellan omladdningar för analys",
      ],
      en: [
        "Memory monitoring: Receiver logs memory usage every 5 minutes",
        "Shows growth since start and warns on high memory (>80%)",
        "Saves memory stats between reloads for analysis",
      ],
    }
  },
  {
    version: "1.3.45",
    date: "2026-01-29",
    changes: {
      sv: [
        "Buggfix: Debug-loggar filtreras nu korrekt baserat på level-egenskap",
      ],
      en: [
        "Bugfix: Debug logs now filtered correctly based on level property",
      ],
    }
  },
  {
    version: "1.3.44",
    date: "2026-01-29",
    changes: {
      sv: [
        "URL-refresh synkroniserad med receiver: Skickas 2 min innan auto-refresh",
        "Borttagen separat URL-refresh inställning (nu kopplad till receiver auto-refresh)",
        "Tystare loggar: URL-refresh och recovery-loggar flyttade till debug",
      ],
      en: [
        "URL refresh synchronized with receiver: Sent 2 min before auto-refresh",
        "Removed separate URL refresh setting (now linked to receiver auto-refresh)",
        "Quieter logs: URL refresh and recovery logs moved to debug",
      ],
    }
  },
  {
    version: "1.3.43",
    date: "2026-01-28",
    changes: {
      sv: [
        "Loggfiltrering: Välj vilka loggtyper som visas (Cast, Status, Debug, Fel, System)",
        "Debug-loggar dolda som standard för renare vy",
        "Filterinställningar sparas i webbläsaren",
      ],
      en: [
        "Log filtering: Choose which log types to display (Cast, Status, Debug, Error, System)",
        "Debug logs hidden by default for cleaner view",
        "Filter settings saved in browser",
      ],
    }
  },
  {
    version: "1.3.42",
    date: "2026-01-28",
    changes: {
      sv: [
        "Smart heartbeat-logg: Bevarar historik vid statusändringar",
        "Förbättrad deduplicering: Endast aktiv heartbeat uppdateras",
        "Ny isHeartbeat-flagga ersätter isStatusCheck",
      ],
      en: [
        "Smart heartbeat log: Preserves history on status changes",
        "Improved deduplication: Only active heartbeat is updated",
        "New isHeartbeat flag replaces isStatusCheck",
      ],
    }
  },
  {
    version: "1.3.36",
    date: "2026-01-27",
    changes: {
      sv: [
        "Debug: Global felhantering i receiver för att fånga okända krascher",
        "Debug: Detaljerad loggning i bridge vid Cast-kommunikation",
        "Förbättrad diagnostik för CAST_INIT_TIMEOUT-fel",
      ],
      en: [
        "Debug: Global error handling in receiver to catch unknown crashes",
        "Debug: Detailed logging in bridge during Cast communication",
        "Improved diagnostics for CAST_INIT_TIMEOUT errors",
      ],
    }
  },
  {
    version: "1.3.35",
    date: "2026-01-27",
    changes: {
      sv: [
        "Auto-update: Receiver uppdaterar sig själv automatiskt vid ny version",
        "Versionskontroll var 5:e minut mot server",
        "Tystare loggning: Health check och heartbeat loggar endast vid ändring",
        "maxInactivity=0: Receiver stängs inte vid sender disconnect",
      ],
      en: [
        "Auto-update: Receiver now updates itself automatically on new version",
        "Version check every 5 minutes against server",
        "Quieter logging: Health check and heartbeat only log on change",
        "maxInactivity=0: Receiver doesn't close on sender disconnect",
      ],
    }
  },
  {
    version: "1.3.34",
    date: "2026-01-27",
    changes: {
      sv: [
        "Smart URL-refresh: Receiver laddar inte om sidan om samma URL redan är aktiv",
        "Ändrat standardvärde för URL-refresh från 5 till 30 minuter",
      ],
      en: [
        "Smart URL refresh: Receiver no longer reloads page if same URL is already active",
        "Changed default URL refresh interval from 5 to 30 minutes",
      ],
    }
  },
  {
    version: "1.3.33",
    date: "2026-01-27",
    changes: {
      sv: [
        "URL skickas automatiskt till receiver (konfigurerbart intervall)",
        "Ny funktion refreshMediaOnReceiver()",
        "Förhindrar 'Ready to cast...' efter receivers auto-refresh",
      ],
      en: [
        "URL sent automatically to receiver (configurable interval)",
        "New function refreshMediaOnReceiver()",
        "Prevents 'Ready to cast...' after receiver auto-refresh",
      ],
    }
  },
  {
    version: "1.3.32",
    date: "2026-01-27",
    changes: {
      sv: [
        "Ny 'Kontrollera' knapp: Manuell statuskontroll och återanslutning",
        "Loggsortering: Loggar sorteras nu korrekt efter tidsstämpel (senaste överst)",
        "Ny API endpoint /api/check för manuell kontroll",
      ],
      en: [
        "New 'Check' button: Manual status check and reconnection",
        "Log sorting: Logs now sorted correctly by timestamp (newest first)",
        "New API endpoint /api/check for manual checking",
      ],
    }
  },
  {
    version: "1.3.31",
    date: "2026-01-27",
    changes: {
      sv: [
        "Buggfix: Permanenta loggar (Cast successful, Loading URL) uppdateras inte längre varje minut",
        "Förbättrad deduplicering: Endast status-check-poster får sin tidsstämpel uppdaterad",
        "Ny isStatusCheck-flagga skiljer på historik och löpande statusloggar",
      ],
      en: [
        "Bugfix: Permanent logs (Cast successful, Loading URL) no longer update every minute",
        "Improved deduplication: Only status-check entries get their timestamp updated",
        "New isStatusCheck flag distinguishes history from ongoing status logs",
      ],
    }
  },
  {
    version: "1.3.30",
    date: "2026-01-27",
    changes: {
      sv: [
        "Full detaljloggning: Visar alla detaljer (Device apps, status, etc.)",
        "Smart uppdatering: Om exakt samma info upprepas, uppdateras bara tidsstämplarna",
        "Nya rader skapas endast vid faktisk ändring",
      ],
      en: [
        "Full detail logging: Shows all details (Device apps, status, etc.)",
        "Smart update: When same info repeats, only timestamps are updated",
        "New lines created only on actual change",
      ],
    }
  },
  {
    version: "1.3.29",
    date: "2026-01-27",
    changes: {
      sv: [
        "Förenklad loggning: Skriver över senaste raden om status är oförändrad",
        "Borttagen sticky-funktion - enklare och renare loggvy",
        "Ny loggpost skapas endast vid faktisk statusändring",
      ],
      en: [
        "Simplified logging: Overwrites last line when status unchanged",
        "Removed sticky function - simpler and cleaner log view",
        "New log entry created only on actual status change",
      ],
    }
  },
  {
    version: "1.3.28",
    date: "2026-01-27",
    changes: {
      sv: [
        "Tystare loggning: Status uppdateras nu tyst utan nya loggrader varje minut",
        "Endast tidsstämpel uppdateras vid oförändrad status",
        "Renare loggvy utan repetitiv 'Device apps' och 'Checking status' info",
      ],
      en: [
        "Quieter logging: Status now updates silently without new log lines every minute",
        "Only timestamp updates when status is unchanged",
        "Cleaner log view without repetitive 'Device apps' and 'Checking status' info",
      ],
    }
  },
  {
    version: "1.3.27",
    date: "2026-01-27",
    changes: {
      sv: [
        "Buggfix: Återställd discoveryTimeout-inställning i dashboard",
        "Buggfix: Alla inställningsfält synkade mellan HTML och JavaScript",
        "Förbättrad reset-funktion för sökningsinställningar",
      ],
      en: [
        "Bugfix: Restored discoveryTimeout setting in dashboard",
        "Bugfix: All settings fields synced between HTML and JavaScript",
        "Improved reset function for discovery settings",
      ],
    }
  },
  {
    version: "1.3.26",
    date: "2026-01-27",
    changes: {
      sv: [
        "Auto zombie-rensning: Rensar automatiskt stale sessions vid ECONNRESET",
        "Auto-återanslutning: Återansluter automatiskt efter force-stop",
        "Förbättrad retry-logik: ECONNRESET och EPIPE nu retryable fel",
        "Diagnostisk loggning: Visar exakt vilka appar som körs på Chromecast",
        "Förbättrad UI: Tydligare tidsinställningar i dashboarden",
      ],
      en: [
        "Auto zombie cleanup: Automatically clears stale sessions on ECONNRESET",
        "Auto-reconnect: Automatically reconnects after force-stop",
        "Improved retry logic: ECONNRESET and EPIPE are now retryable errors",
        "Diagnostic logging: Shows exactly which apps are running on Chromecast",
        "Improved UI: Clearer time settings in dashboard",
      ],
    }
  },
  {
    version: "1.3.25",
    date: "2026-01-26",
    changes: {
      sv: [
        "Säkerhet: Body size limit (10KB) för att förhindra överbelastning",
        "Säkerhet: Path traversal-skydd för statiska filer",
        "Säkerhet: Vitlista för tillåtna filtyper",
        "Säkerhet: X-Content-Type-Options, X-Frame-Options, X-XSS-Protection headers",
        "Förbättrad felhantering i parseBody med request error-lyssnare",
      ],
      en: [
        "Security: Body size limit (10KB) to prevent overload",
        "Security: Path traversal protection for static files",
        "Security: Whitelist for allowed file types",
        "Security: X-Content-Type-Options, X-Frame-Options, X-XSS-Protection headers",
        "Improved error handling in parseBody with request error listener",
      ],
    }
  },
  {
    version: "1.3.24",
    date: "2026-01-26",
    changes: {
      sv: [
        "Buggfix: config-variabel deklarerad innan användning i main()",
        "Borttagen oanvänd isChromecastIdle() legacy-funktion",
        "Förbättrad startlogg: Visar nu config-baserade värden",
      ],
      en: [
        "Bugfix: config variable declared before use in main()",
        "Removed unused isChromecastIdle() legacy function",
        "Improved startup log: Now shows config-based values",
      ],
    }
  },
  {
    version: "1.3.23",
    date: "2026-01-26",
    changes: {
      sv: [
        "Kodrensning: Borttagen oanvänd discoveryInterval från config",
        "Borttagen oanvänd periodicDiscoveryWithReconnect-funktion",
        "Borttagen duplicerad castMediaWithRetry-wrapper",
        "Fixat: Cooldown använder nu config istället för odefinierad konstant",
      ],
      en: [
        "Code cleanup: Removed unused discoveryInterval from config",
        "Removed unused periodicDiscoveryWithReconnect function",
        "Removed duplicate castMediaWithRetry wrapper",
        "Fixed: Cooldown now uses config instead of undefined constant",
      ],
    }
  },
  {
    version: "1.3.22",
    date: "2026-01-26",
    changes: {
      sv: [
        "Optimerad discovery: Söker endast vid start, återanslutning och manuellt",
        "Sparar nätverksresurser: Ingen löpande 30-sekunders skanning längre",
      ],
      en: [
        "Optimized discovery: Only scans at start, on reconnect, and manually",
        "Saves network resources: No more periodic 30-second scanning",
      ],
    }
  },
  {
    version: "1.3.21",
    date: "2026-01-26",
    changes: {
      sv: [
        "Fixat: 60-sekunders statusloggning fungerar nu även efter bufferrotation",
        "Robust sökning: Använder findIndex istället för sårbar indexspårning",
      ],
      en: [
        "Fixed: 60-second status logging now works even after buffer rotation",
        "Robust search: Uses findIndex instead of vulnerable index tracking",
      ],
    }
  },
  {
    version: "1.3.20",
    date: "2026-01-26",
    changes: {
      sv: [
        "Städning: Borttagen onödig mDNS-publicering av bridge-tjänsten",
        "Renare dashboard: mDNS-URL visas inte längre (användes aldrig)",
      ],
      en: [
        "Cleanup: Removed unnecessary mDNS publishing of bridge service",
        "Cleaner dashboard: mDNS URL no longer displayed (was never used)",
      ],
    }
  },
  {
    version: "1.3.19",
    date: "2026-01-26",
    changes: {
      sv: [
        "Smartare loggning: Ny post skapas vid statusändring, sedan uppdateras bara tidsstämpeln",
        "Renare loggvy: Senaste kontrollens post visas alltid överst med CHECK-etikett",
      ],
      en: [
        "Smarter logging: New entry created on status change, then only timestamp updates",
        "Cleaner log view: Latest check entry always shown at top with CHECK label",
      ],
    }
  },
  {
    version: "1.3.15",
    date: "2026-01-26",
    changes: {
      sv: [
        "Brandväggsautomatik: Windows-installern lägger nu till brandväggsregel automatiskt",
        "Synkad logguppdatering: Dashboard hämtar loggar i takt med screensaver-kontrollen",
        "Förbättrad LIVE-logg: Sticky 'Senaste kontroll' med tydlig LIVE-indikator",
      ],
      en: [
        "Firewall automation: Windows installer now adds firewall rule automatically",
        "Synchronized log updates: Dashboard fetches logs in sync with screensaver check",
        "Improved LIVE log: Sticky 'Last check' with clear LIVE indicator",
      ],
    }
  },
  {
    version: "1.3.14",
    date: "2026-01-26",
    changes: {
      sv: [
        "Ny loggfunktion: 'Senaste kontroll' visas högst upp med löpande uppdaterad tid",
        "Statusändringar loggas separat för tydlig tidslinje",
        "Fixat: Bridge lyssnar nu på alla nätverksgränssnitt (0.0.0.0)",
        "Mobil-åtkomst: Nu kan du ansluta från andra enheter på nätverket",
      ],
      en: [
        "New log feature: 'Last check' shown at top with continuously updated time",
        "Status changes logged separately for clear timeline",
        "Fixed: Bridge now listens on all network interfaces (0.0.0.0)",
        "Mobile access: You can now connect from other devices on the network",
      ],
    }
  },
  {
    version: "1.3.13",
    date: "2026-01-26",
    changes: {
      sv: [
        "Toast-notifikationer för feedback vid åtgärder",
        "Visuell nedräkning under omstart av bridge",
        "Konfigurerbart auto-refresh intervall för receiver",
      ],
      en: [
        "Toast notifications for action feedback",
        "Visual countdown during bridge restart",
        "Configurable auto-refresh interval for receiver",
      ],
    }
  },
  {
    version: "1.3.12",
    date: "2026-01-26",
    changes: {
      sv: [
        "Ren installation: Konfiguration bevaras inte längre vid uppdatering",
        "Alla nya standardvärden appliceras automatiskt",
      ],
      en: [
        "Clean install: Configuration no longer preserved on update",
        "All new default values applied automatically",
      ],
    }
  },
  {
    version: "1.3.11",
    date: "2026-01-26",
    changes: {
      sv: [
        "Alla timing-inställningar nu konfigurerbara i dashboarden",
        "Nya inställningar: cooldown efter takeover, recovery-intervall, circuit breaker",
        "Grupperade inställningar: Sökning, Cast & Session, Återhämtning",
        "Förbättrade beskrivningar med standardvärden för varje inställning",
      ],
      en: [
        "All timing settings now configurable in dashboard",
        "New settings: cooldown after takeover, recovery interval, circuit breaker",
        "Grouped settings: Search, Cast & Session, Recovery",
        "Improved descriptions with default values for each setting",
      ],
    }
  },
  {
    version: "1.3.10",
    date: "2026-01-26",
    changes: {
      sv: [
        "Förbättrad enhetsökning: Automatisk retry (upp till 3 försök) vid tom sökning",
        "Bevarar cachade enheter: Enhetslistan töms inte längre vid misslyckad sökning",
        "Automatisk återanslutning: Återansluter direkt till sparad enhet efter IP-byte",
        "Längre söktimeout: 10s (tidigare 8s) för mer tid åt enheter att svara",
        "Omedelbar recovery: Kontrollerar enhetsstatus direkt vid tappad anslutning",
      ],
      en: [
        "Improved device discovery: Automatic retry (up to 3 attempts) on empty search",
        "Preserves cached devices: Device list no longer empties on failed discovery",
        "Automatic reconnection: Immediately reconnects to saved device after IP change",
        "Longer discovery timeout: 10s (was 8s) for more time for devices to respond",
        "Immediate recovery: Checks device status immediately on connection loss",
      ],
    }
  },
  {
    version: "1.3.9",
    date: "2026-01-25",
    changes: {
      sv: [
        "KRITISK FIX: Återställd enkel heartbeat-logik från v1.0.19",
        "Borttagen aggressiv watchdog som orsakade falska disconnects",
        "Heartbeat skickar nu bara PING utan PONG-validering",
        "Stabilare långvariga sessioner",
      ],
      en: [
        "CRITICAL FIX: Restored simple heartbeat logic from v1.0.19",
        "Removed aggressive watchdog that caused false disconnects",
        "Heartbeat now only sends PING without PONG validation",
        "More stable long-running sessions",
      ],
    }
  },
  {
    version: "1.3.8",
    date: "2026-01-25",
    changes: {
      sv: [
        "Bevarar konfiguration vid uppdatering: URL och inställningar sparas",
      ],
      en: [
        "Preserves configuration on update: URL and settings are saved",
      ],
    }
  },
  {
    version: "1.3.7",
    date: "2026-01-25",
    changes: {
      sv: [
        "Återställd idle-kontroll som i v1.0.19 - kontrollerar alltid enhetsstatus",
        "Fixat: 'Silent disconnect' som inte upptäcktes",
      ],
      en: [
        "Restored idle check behavior from v1.0.19 - always checks device status",
        "Fixed: 'Silent disconnect' not detected",
      ],
    }
  },
  {
    version: "1.3.5",
    date: "2026-01-25",
    changes: {
      sv: [
        "Graceful update: Bridge pausar nu casting innan uppdatering",
        "Nytt API: /api/prepare-update stoppar screensaver och rensar anslutningar",
        "Förbättrade installationsskript: Anropar prepare-update innan tjänsten stoppas",
        "Fixat: 'Ready to cast' som visades under uppdateringar",
      ],
      en: [
        "Graceful update: Bridge now pauses casting before update",
        "New API: /api/prepare-update stops screensaver and cleans up connections",
        "Improved install scripts: Calls prepare-update before stopping service",
        "Fixed: 'Ready to cast' appearing during updates",
      ],
    }
  },
  {
    version: "1.3.4",
    date: "2026-01-24",
    changes: {
      sv: [
        "Omedelbar återanslutning: Vid nätverksfel försöker bridge nu återansluta direkt",
        "Snabbare recovery: Skippar recovery-loopen vid nätverksavbrott",
        "Förbättrad logik: Kontrollerar enhetsstatus innan återanslutning",
        "Fixat: 'Ready to cast' som visades efter tillfälliga nätverksavbrott",
      ],
      en: [
        "Immediate reconnection: On network errors, bridge now attempts to reconnect immediately",
        "Faster recovery: Skips recovery loop on network interruptions",
        "Improved logic: Checks device status before reconnecting",
        "Fixed: 'Ready to cast' appearing after temporary network interruptions",
      ],
    }
  },
  {
    version: "1.3.3",
    date: "2026-01-24",
    changes: {
      sv: [
        "Förbättrad watchdog: Separat timer som aktivt övervakar anslutningen",
        "Bättre PING/PONG-spårning: Räknar obesvarade PINGs korrekt",
        "Channel close-lyssnare: Detekterar när kanalerna stängs",
        "Fixat: Stale connections som inte triggade recovery",
      ],
      en: [
        "Improved watchdog: Separate timer actively monitors connection",
        "Better PING/PONG tracking: Correctly counts unanswered PINGs",
        "Channel close listener: Detects when channels are closed",
        "Fixed: Stale connections that didn't trigger recovery",
      ],
    }
  },
  {
    version: "1.3.2",
    date: "2026-01-24",
    changes: {
      sv: [
        "Crash protection: uncaughtException och unhandledRejection handlers",
        "HTTP server error handling: Servern kraschar inte längre på fel",
        "Fixat: Webbservern tappar inte anslutningen vid castv2-fel",
      ],
      en: [
        "Crash protection: uncaughtException and unhandledRejection handlers",
        "HTTP server error handling: Server no longer crashes on errors",
        "Fixed: Web server no longer drops connection on castv2 errors",
      ],
    }
  },
  {
    version: "1.3.1",
    date: "2026-01-24",
    changes: {
      sv: [
        "Heartbeat PONG-validering: Upptäcker döda anslutningar",
        "Connection close-hantering: Startar recovery automatiskt",
        "Fixat: Session-disconnects efter lång tid",
      ],
      en: [
        "Heartbeat PONG validation: Detects dead connections",
        "Connection close handling: Triggers recovery automatically",
        "Fixed: Session disconnects after extended periods",
      ],
    }
  },
  {
    version: "1.3.0",
    date: "2026-01-24",
    changes: {
      sv: [
        "Recovery-logik: Automatisk återhämtning vid nätverksavbrott",
        "Circuit breaker: Pausar försök efter 5 misslyckanden (5 min)",
        "IP-recovery: Hittar enhet igen om IP ändras (DHCP)",
        "Cooldown: 30s paus efter att annan app tar över",
        "Exponentiell backoff: Intelligenta retry-intervall",
        "Förbättrad stabilitet för långvariga sessioner",
      ],
      en: [
        "Recovery logic: Automatic recovery on network interruptions",
        "Circuit breaker: Pauses attempts after 5 failures (5 min)",
        "IP recovery: Finds device again if IP changes (DHCP)",
        "Cooldown: 30s pause after another app takes over",
        "Exponential backoff: Intelligent retry intervals",
        "Improved stability for long-running sessions",
      ],
    }
  },
  {
    version: "1.2.3",
    date: "2026-01-24",
    changes: {
      sv: [
        "Flerspråksstöd: Svenska och engelska med språkväljare",
        "Dynamisk översättning av ändringslogg via API",
        "Utökad manuell installationsguide med nedladdningssteg",
        "Ändringslogg kollapsad som standard, visar 5 senaste",
      ],
      en: [
        "Multi-language support: Swedish and English with language switcher",
        "Dynamic changelog translation via API",
        "Extended manual installation guide with download step",
        "Changelog collapsed by default, shows 5 most recent",
      ],
    }
  },
  {
    version: "1.2.2",
    date: "2026-01-24",
    changes: {
      sv: [
        "Fix: Tar bort health check som störde aktiva sessioner",
        "Enklare logik: Använder endast screensaverActive-flaggan för att undvika dubbla casts",
      ],
      en: [
        "Fix: Removed health check that was disrupting active sessions",
        "Simpler logic: Uses only the screensaverActive flag to avoid duplicate casts",
      ],
    }
  },
  {
    version: "1.2.1",
    date: "2026-01-24",
    changes: {
      sv: [
        "Fix: Förhindrar att bridge försöker återansluta till redan körande screensaver",
        "Health check: Verifierar att appen fortfarande körs innan idle-check",
        "Konservativ felhantering: Antar att appen körs vid timeout/error",
      ],
      en: [
        "Fix: Prevents bridge from trying to reconnect to already running screensaver",
        "Health check: Verifies the app is still running before idle check",
        "Conservative error handling: Assumes app is running on timeout/error",
      ],
    }
  },
  {
    version: "1.2.0",
    date: "2025-01-24",
    changes: {
      sv: [
        "Loggpanel: Se bridge-aktivitet i realtid",
        "Versionsvisning i dashboardens header",
        "Omstartsknapp i dashboarden för att starta om bridge-tjänsten",
        "Raw castv2-protokoll istället för chromecasts-bibliotek",
        "Duplikat-LOAD-förebyggande med mediaLoaded-flagga",
        "Förbättrad idle-detektering och retry-logik",
        "Strukturerad loggning med tidsstämplar",
        "Snabbare discovery med early-resolve",
        "Auto-elevation för Windows-installer",
        "Versionerat filnamn för ZIP",
      ],
      en: [
        "Log panel: See bridge activity in real-time",
        "Version display in dashboard header",
        "Restart button in dashboard to restart the bridge service",
        "Raw castv2 protocol instead of chromecasts library",
        "Duplicate LOAD prevention with mediaLoaded flag",
        "Improved idle detection and retry logic",
        "Structured logging with timestamps",
        "Faster discovery with early-resolve",
        "Auto-elevation for Windows installer",
        "Versioned filename for ZIP",
      ],
    }
  },
  {
    version: "1.1.0",
    date: "2025-01-24",
    changes: {
      sv: [
        "Versionsvarning om lokal bridge har äldre version",
        "Senaste version visas i footer",
      ],
      en: [
        "Version warning if local bridge has older version",
        "Latest version shown in footer",
      ],
    }
  },
  {
    version: "1.0.0",
    date: "2025-01-17",
    changes: {
      sv: [
        "Offline-first arkitektur utan molnberoenden",
        "Lokal dashboard på localhost:3000",
        "Automatisk Chromecast-upptäckt via mDNS",
        "Screensaver-funktion för inaktiva enheter",
        "Custom receiver-app (FE376873)",
      ],
      en: [
        "Offline-first architecture without cloud dependencies",
        "Local dashboard at localhost:3000",
        "Automatic Chromecast discovery via mDNS",
        "Screensaver function for idle devices",
        "Custom receiver app (FE376873)",
      ],
    }
  }
];

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Detect language from Accept-Language header or query param
  const url = new URL(req.url);
  const langParam = url.searchParams.get("lang");
  const acceptLanguage = req.headers.get("Accept-Language") || "";
  
  let lang: "sv" | "en" = "en"; // Default to English
  if (langParam === "sv" || langParam === "en") {
    lang = langParam;
  } else if (acceptLanguage.startsWith("sv")) {
    lang = "sv";
  }

  // Transform changelog to single-language format
  const localizedChangelog = CHANGELOG.map(entry => ({
    version: entry.version,
    date: entry.date,
    changes: entry.changes[lang],
  }));

  const response = {
    version: VERSION,
    releasedAt: RELEASED_AT,
    changelog: localizedChangelog,
  };

  return new Response(JSON.stringify(response), {
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
});