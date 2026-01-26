
# Testa GPU-acceleration och iframe-optimering

## Ändringar i `public/chromecast-receiver.html`

### 1. Aktivera GPU-acceleration via CSS

Lägger till följande CSS-egenskaper på `#content` iframe:

```css
#content {
  border: none;
  position: absolute;
  top: 0;
  left: 0;
  /* GPU Acceleration */
  transform: translate3d(0, 0, 0);
  will-change: transform, contents;
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
  /* Förhindra onödig layout-beräkning */
  contain: strict;
}
```

**Vad detta gör:**
- `transform: translate3d(0,0,0)` - Tvingar GPU-rendering istället för CPU
- `will-change` - Talar om för webbläsaren att elementet kommer ändras, så den kan förbereda sig
- `backface-visibility: hidden` - Optimerar 3D-rendering
- `contain: strict` - Isolerar iframe från resten av layouten för snabbare rendering

### 2. Optimera iframe-attribut

Ändrar iframe-elementet från:
```html
<iframe id="content" style="display:none;"></iframe>
```

Till:
```html
<iframe 
  id="content" 
  allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
  loading="eager"
  style="display:none;"
></iframe>
```

**Vad detta gör:**
- `allow="..."` - Aktiverar hårdvarufunktioner som autoplay och accelerometer
- `loading="eager"` - Laddar innehållet omedelbart utan lazy-loading fördröjning

---

## Fil som ändras

| Fil | Ändring |
|-----|---------|
| `public/chromecast-receiver.html` | GPU-acceleration CSS + iframe-attribut |

---

## Testning

Efter publicering kan du testa genom att casta en sida med animationer och jämföra smoothness innan/efter.
