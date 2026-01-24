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

const VERSION = "1.3.3";
const RELEASED_AT = "2026-01-24";

const CHANGELOG: ChangelogEntry[] = [
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