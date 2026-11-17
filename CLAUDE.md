# Vibrations – meditative WebXR-Anwendung

## Ziel
Eine ruhige, meditative VR-Erfahrung für die **Meta Quest 3**, die direkt im Quest-Browser läuft (WebXR, keine App-Installation).

## Technik
- **Three.js 0.170** per Import-Map vom CDN (jsDelivr) – kein Build-Schritt, kein npm.
- Reines HTML/JS: `index.html` + `main.js`. Zusätzliche Module als ES-Module daneben.
- **Hosting: GitHub Pages** aus dem `main`-Branch (Root). HTTPS ist Pflicht für WebXR – Pages liefert das.
- Audio über Web Audio API, startet erst mit der VR-Session (Browser erlauben Audio nur nach Nutzerinteraktion).

## Workflow
1. Änderung machen, **`VERSION` in `main.js` erhöhen** (wird oben links angezeigt).
2. Commit + Push auf `main` → nach ca. 1 Minute live.
3. Auf der Quest die Seite neu laden und an der Versionsnummer prüfen, ob das Update angekommen ist.

## Gestaltungsprinzipien
- Ruhig, langsam, dunkel mit weichem Licht. Keine schnellen Bewegungen, nichts, was Übelkeit auslöst.
- Nutzer steht/sitzt still; keine künstliche Fortbewegung.
- Performance: Quest 3 soll stabil 72–90 fps halten. Wenige Lichter, sparsame Partikel, keine Post-Processing-Ketten.

## Aktueller Stand (v0.1.0)
- Farbverlaufs-Himmel, dunkle spiegelnde Bodenfläche, Nebel
- Atem-Kugel vor dem Nutzer: 8-s-Zyklus (4 s ein, 4 s aus)
- Aufsteigende Lichtpartikel
- Sanfter Drone mit leicht verstimmten Sinustönen (Schwebungen)

## Entscheidungen
- Keine Einbindung in epicscapes.de (Adobe Portfolio) vorerst.
