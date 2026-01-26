# Plan: Automatisk synkronisering mellan bridge/ och download-bridge

## ✅ SLUTFÖRD

**Implementerad:** 2026-01-26

---

## Vad som gjordes

### 1. Skapade Storage bucket `bridge-files`
- Publik läsåtkomst för alla
- Skrivåtkomst för admin

### 2. Laddade upp alla bridge-filer till Storage
Filer under `current/`:
- `index.js` (50.2KB)
- `package.json`
- `.env.example`
- `README.md`
- `public/index.html`
- `public/style.css`
- `public/app.js`
- `install-linux.sh`
- `install-windows.ps1`
- `uninstall-linux.sh`
- `uninstall-windows.ps1`

### 3. Skrev om download-bridge Edge Function
Ny arkitektur:
1. Hämtar version från `get-version` endpoint
2. Hämtar alla filer från Storage bucket dynamiskt
3. Injicerar version i `index.js`
4. Genererar och returnerar ZIP-fil

---

## Resultat

| Aspekt | Före | Efter |
|--------|------|-------|
| download-bridge storlek | ~2923 rader | ~220 rader |
| Synkroniseringsrisk | Hög | **Ingen** |
| Underhåll | Två ställen | **Ett ställe** |
| Fil-källa | Strängliteraler | Storage bucket |

---

## Arbetsflöde för uppdateringar

När du ändrar bridge-koden:

1. **Redigera filer i `bridge/`** - detta är källkoden
2. **Ladda upp till Storage** - använd `supabase--storage-upload` för varje ändrad fil
3. **Uppdatera version** - ändra i `get-version` Edge Function
4. **Nedladdning fungerar automatiskt** - Edge Function hämtar alltid från Storage

### Exempel: Uppdatera index.js

```typescript
// I Lovable:
await supabase.storage
  .from('bridge-files')
  .upload('current/index.js', fileContent, { upsert: true });
```

---

## Storage-struktur

```
bridge-files/
└── current/
    ├── index.js
    ├── package.json
    ├── .env.example
    ├── README.md
    ├── public/
    │   ├── index.html
    │   ├── style.css
    │   └── app.js
    ├── install-linux.sh
    ├── install-windows.ps1
    ├── uninstall-linux.sh
    └── uninstall-windows.ps1
```

---

## Framtida förbättringar (valfritt)

- **Versionerade mappar**: `v1.3.25/`, `v1.3.26/` för att behålla historik
- **Automatisk upload**: GitHub Action eller script som synkar `bridge/` till Storage
- **Cache-invalidering**: Lägg till version i Storage-path för CDN-cache
