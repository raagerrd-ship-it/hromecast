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
  version: "1.2.3",
  releasedAt: "2025-01-24",
  changelog: [
    {
      version: "1.2.3",
      date: "2025-01-24",
      changes: [
        "Auto-stäng första fönstret: Det icke-eleverade fönstret stängs nu automatiskt",
      ]
    },
    {
      version: "1.2.2",
      date: "2025-01-24",
      changes: [
        "Fixat npm install: Ändrat deprecated --production till --omit=dev",
      ]
    },
    {
      version: "1.2.1",
      date: "2025-01-24",
      changes: [
        "Fixat PowerShell param-fel: param() måste vara först i scriptet",
        "Förbättrad felhantering: try-catch runt hela scriptet",
      ]
    },
    {
      version: "1.2.0",
      date: "2025-01-24",
      changes: [
        "Förbättrad idle-detektering: Fixat kritiskt logikfel som kunde störa aktiva sessioner",
        "Retry-logik: Automatiska omförsök med exponentiell backoff vid castingfel",
        "Bättre keep-alive: Detekterar förlorade sessioner och flaggar för återanslutning",
        "Strukturerad loggning: Tidsstämplade loggar med [INFO], [WARN], [ERROR] nivåer",
        "Snabbare discovery: Early-resolve efter 3 sekunder om enheter hittats",
        "Auto-elevation: Windows-installer begär automatiskt admin-rättigheter",
        "Bättre felhantering: Fönstret stannar öppet vid fel med tydligt meddelande",
        "Versionerat filnamn: ZIP-filen inkluderar nu versionsnummer",
      ]
    },
    {
      version: "1.1.0",
      date: "2025-01-24",
      changes: [
        "Versionsvisning: Bridge-tjänsten returnerar nu sin version via /api/status",
        "Versionsvarning: Webb-appen visar en varning om din lokala bridge har en äldre version",
        "Senaste version i footer: Startsidan visar nu senaste tillgängliga version",
        "Refaktorerat downloadBridge-funktionen till en gemensam hook",
      ]
    },
    {
      version: "1.0.0",
      date: "2025-01-17",
      changes: [
        "Offline-first arkitektur: Helt lokal drift utan molnberoenden",
        "Lokal dashboard: Webb-baserat gränssnitt på localhost:3000",
        "Chromecast-upptäckt: Automatisk upptäckt av Chromecasts via mDNS/Bonjour",
        "Screensaver-funktion: Visa automatiskt en webbsida när Chromecast är inaktiv",
        "Custom receiver: Egen Chromecast-app (FE376873) för att visa webbsidor",
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
