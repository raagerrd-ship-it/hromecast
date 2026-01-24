import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ============================================================================
// VERSION SOURCE OF TRUTH
// Update this when releasing a new version. Everything else reads from here.
// ============================================================================

const VERSION_INFO = {
  version: "1.2.2",
  releasedAt: "2026-01-24",
  changelog: [
    {
      version: "1.2.2",
      date: "2026-01-24",
      changes: [
        "Fix: Tar bort health check som störde aktiva sessioner",
        "Enklare logik: Använder endast screensaverActive-flaggan för att undvika dubbla casts",
      ]
    },
    {
      version: "1.2.1",
      date: "2026-01-24",
      changes: [
        "Fix: Förhindrar att bridge försöker återansluta till redan körande screensaver",
        "Health check: Verifierar att appen fortfarande körs innan idle-check",
        "Konservativ felhantering: Antar att appen körs vid timeout/error",
      ]
    },
    {
      version: "1.2.0",
      date: "2025-01-24",
      changes: [
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
      ]
    },
    {
      version: "1.1.0",
      date: "2025-01-24",
      changes: [
        "Versionsvarning om lokal bridge har äldre version",
        "Senaste version visas i footer",
      ]
    },
    {
      version: "1.0.0",
      date: "2025-01-17",
      changes: [
        "Offline-first arkitektur utan molnberoenden",
        "Lokal dashboard på localhost:3000",
        "Automatisk Chromecast-upptäckt via mDNS",
        "Screensaver-funktion för inaktiva enheter",
        "Custom receiver-app (FE376873)",
      ]
    }
  ]
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  return new Response(JSON.stringify(VERSION_INFO), {
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
});
