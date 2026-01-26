

# Plan: Automatisk synkronisering mellan bridge/ och download-bridge

## Nuvarande problem

Projektet har två kopior av samma kod:

1. **Källkod** (`bridge/`): Den faktiska arbetskoden med ~1522 rader i `index.js` plus ~1600 rader i dashboard-filer
2. **Edge Function** (`download-bridge/`): Innehåller all kod som strängliteraler (~2923 rader), duplicerad för ZIP-distribution

### Problem med nuvarande arkitektur
- Manuell synkronisering krävs vid varje ändring
- Risk för att koden glider isär (de har redan skillnader)
- Edge Function-filen är extremt stor och svårläst
- Ändringar måste göras på två ställen

---

## Lösning: Dynamisk fil-hämtning via Supabase Storage

### Ny arkitektur

Istället för att lagra all kod som strängliteraler i Edge Function, flytta bridge-filerna till Supabase Storage och låt Edge Function hämta dem dynamiskt vid nedladdning.

```text
┌─────────────────────────────────────────────────────────────────┐
│                        NUVARANDE FLÖDE                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  bridge/index.js ───[manuell kopia]──► download-bridge/index.ts │
│       1522 rader                        ~2800 rader strängar    │
│                                                                 │
│  Användare ──► Edge Function ──► Genererar ZIP från strängar    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                          NYTT FLÖDE                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  bridge/index.js ───[upload]──► Supabase Storage (bridge-files) │
│       1522 rader                                                │
│                                                                 │
│  Användare ──► Edge Function ──► Hämtar filer från Storage      │
│                                  ──► Genererar ZIP              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Fördelar
- **Single source of truth**: `bridge/` är den enda platsen för kod
- **Enkel synkronisering**: Upload-script eller manuell uppladdning
- **Mindre Edge Function**: Från ~2900 till ~200 rader
- **Versionskontroll**: Storage kan versioneras via mappar

---

## Implementationsplan

### Steg 1: Skapa Storage bucket
Skapa en publik bucket `bridge-files` för att lagra bridge-koden.

### Steg 2: Definiera filstruktur i Storage
```
bridge-files/
├── current/
│   ├── index.js
│   ├── package.json
│   ├── public/
│   │   ├── index.html
│   │   ├── style.css
│   │   └── app.js
│   ├── install-linux.sh
│   ├── install-windows.ps1
│   ├── uninstall-linux.sh
│   ├── uninstall-windows.ps1
│   └── README.md
└── .env.example
```

### Steg 3: Omskriven download-bridge Edge Function
Ny Edge Function som:
1. Hämtar aktuell version från `get-version`
2. Hämtar alla filer från Storage bucket
3. Injicerar version i `index.js`
4. Genererar och returnerar ZIP-fil

### Steg 4: Skapa upload-hjälpscript
Ett enkelt script eller endpoint för att synka `bridge/` till Storage.

---

## Tekniska detaljer

### Ny download-bridge/index.ts (förenklad)
```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BUCKET = "bridge-files";
const FILES = [
  "index.js",
  "package.json",
  ".env.example",
  "public/index.html",
  "public/style.css",
  "public/app.js",
  "install-linux.sh",
  "install-windows.ps1",
  "uninstall-linux.sh",
  "uninstall-windows.ps1",
  "README.md"
];

serve(async (req) => {
  // Hämta version
  const version = await fetchVersion();
  
  // Hämta filer från Storage
  const supabase = createClient(...);
  const files = {};
  
  for (const file of FILES) {
    const { data } = await supabase.storage
      .from(BUCKET)
      .download(`current/${file}`);
    files[file] = await data.text();
  }
  
  // Injicera version
  files["index.js"] = files["index.js"]
    .replace("__BRIDGE_VERSION__", version);
  
  // Generera ZIP
  const zip = createZip(files);
  return new Response(zip, {...});
});
```

### Storage RLS-policy
```sql
-- Publik läsåtkomst för bridge-filer
CREATE POLICY "Public read access for bridge files"
ON storage.objects FOR SELECT
USING (bucket_id = 'bridge-files');
```

---

## Migrationsstrategi

1. **Fas 1**: Skapa bucket och ladda upp nuvarande filer
2. **Fas 2**: Uppdatera Edge Function att läsa från Storage
3. **Fas 3**: Ta bort strängliteralerna från Edge Function
4. **Fas 4**: Dokumentera upload-processen

---

## Alternativ: GitHub Raw-filer

Ett enklare alternativ om Storage känns överkill:

```typescript
const BASE_URL = "https://raw.githubusercontent.com/user/repo/main/bridge/";

const indexJs = await fetch(`${BASE_URL}index.js`).then(r => r.text());
```

**Nackdel**: Kräver att repot är publikt eller en GitHub-token.

---

## Rekommendation

Jag rekommenderar **Supabase Storage-lösningen** eftersom:
- Projektet redan använder Lovable Cloud
- Ingen extern beroende (GitHub)
- Enkel att uppdatera via Cloud View
- Fungerar även om GitHub-sync inte är aktiv

---

## Uppskattad påverkan

| Aspekt | Före | Efter |
|--------|------|-------|
| download-bridge storlek | ~2900 rader | ~150 rader |
| Synkroniseringsrisk | Hög | Ingen |
| Underhåll | Två ställen | Ett ställe |

