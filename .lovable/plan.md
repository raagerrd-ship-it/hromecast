

# Plan: Automatisk synkronisering vid kodändringar

## Problemet

När du ändrar kod i `bridge/` via Lovable-chatten måste filerna manuellt laddas upp till Storage innan nedladdningen fungerar. Du vill att detta ska ske automatiskt.

## Lösningsalternativ

### Alternativ A: Edge Function läser direkt från projektfiler via GitHub (Rekommenderat)

Om projektet synkas till GitHub kan Edge Function hämta filerna direkt från GitHub raw URLs:

```text
bridge/index.js → GitHub → Edge Function → ZIP
```

**Fördelar:**
- Helt automatiskt - ändra kod, pusha, färdigt
- Ingen manuell uppladdning
- Ingen Storage-bucket behövs

**Nackdelar:**
- Kräver att GitHub-sync är aktiverat
- Kräver att repot är publikt (eller en GitHub-token)

---

### Alternativ B: Hårdkodade filer i Edge Function (Original-stil, men bättre)

Gå tillbaka till att ha filerna inbäddade i Edge Function, men med bättre struktur:

```typescript
// Import files as modules or fetch from Lovable CDN
const INDEX_JS = await import("./files/index.js.ts").then(m => m.default);
```

**Fördelar:**
- Allt i samma kodbas - Lovable-ändringar deployar automatiskt
- Ingen extern beroende

**Nackdelar:**
- Edge Function blir stor igen
- Fortfarande manuell synk mellan `bridge/` och Edge Function

---

### Alternativ C: Lovable-intern webhook för auto-upload (Ej möjligt)

Lovable har ingen inbyggd "post-edit hook" som kan trigga en uppladdning. Detta är inte genomförbart utan extern automation.

---

## Rekommendation: GitHub-baserad lösning

### Så här fungerar det

1. **Aktivera GitHub-sync** i Lovable-projektinställningar
2. **Uppdatera Edge Function** att hämta från GitHub raw URLs
3. **Vid varje ändring**: Lovable pushar till GitHub → Edge Function hämtar senaste

### Teknisk implementation

```typescript
// supabase/functions/download-bridge/index.ts

const GITHUB_RAW_BASE = "https://raw.githubusercontent.com/OWNER/REPO/main/bridge/";

const FILES = [
  "index.js",
  "package.json",
  ".env.example",
  "README.md",
  "public/index.html",
  "public/style.css", 
  "public/app.js",
  "install-linux.sh",
  "install-windows.ps1",
  "uninstall-linux.sh",
  "uninstall-windows.ps1"
];

serve(async (req) => {
  const version = await fetchVersion();
  const fileContents = {};
  
  for (const file of FILES) {
    const response = await fetch(`${GITHUB_RAW_BASE}${file}`);
    let content = await response.text();
    
    if (file === "index.js") {
      content = content.replace(/const BRIDGE_VERSION = '[^']+';/, 
        `const BRIDGE_VERSION = '${version}';`);
    }
    
    fileContents[file] = content;
  }
  
  return createZipResponse(fileContents, version);
});
```

---

## Arbetsflöde efter implementation

```text
1. Du ändrar bridge/index.js i Lovable-chatten
2. Lovable sparar och pushar till GitHub automatiskt
3. Användare klickar "Ladda ner bridge"
4. Edge Function hämtar senaste från GitHub
5. ZIP genereras med aktuell version
```

**Ingen manuell uppladdning krävs!**

---

## Förutsättningar

- GitHub-sync måste vara aktiverat för projektet
- Repot måste vara publikt (för raw.githubusercontent.com åtkomst)
- Alternativt: Använd GitHub-token som hemlighet för privata repon

---

## Filer som ändras

| Fil | Ändring |
|-----|---------|
| `supabase/functions/download-bridge/index.ts` | Byter från Storage till GitHub raw URLs |
| `.lovable/plan.md` | Uppdateras med nytt flöde |

---

## Fråga innan implementation

Är GitHub-sync aktiverat för projektet? Om inte, vill du aktivera det eller föredrar du en annan lösning?

