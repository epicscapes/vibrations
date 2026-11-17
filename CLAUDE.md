# Vibrations – meditative WebXR-Anwendung

## Ziel
Eine ruhige, meditative VR-Erfahrung für die **Meta Quest 3**, die direkt im Quest-Browser läuft (WebXR, keine App-Installation).

## Technik
- **Vanilla WebGL2 + WebXR**, kein Framework (Wunsch des Nutzers: so lange wie sinnvoll ohne Framework).
  Framework erst vorschlagen, wenn z. B. glTF-Modelle, viele Objekte/Szenengraph, Controller-/Hand-Interaktion mit UI oder Physik dazukommen.
- Reines HTML/JS ohne Build-Schritt: `index.html`, `main.js` (WebGL/XR-Setup, Loop), `shaders.js` (GLSL), `audio.js` (Mikrofon/Summen).
- Rendering: **Antialiasing aus**, **Supersampling 150 %** der nativen Quest-Auflösung
  (`framebufferScaleFactor = getNativeFramebufferScaleFactor() * 1.5`). Testweise änderbar per URL: `?scale=1.0`.
- **Hosting: GitHub Pages** aus dem `main`-Branch (Root). HTTPS ist Pflicht für WebXR – Pages liefert das.
- Mikrofon über Web Audio API (getUserMedia), Freigabe per Button vor dem Start von VR.

## Workflow
1. Änderung machen, **`VERSION` in `main.js` erhöhen** (wird oben links angezeigt).
2. Commit + Push auf `main` → nach ca. 1 Minute live.
3. Auf der Quest die Seite neu laden und an der Versionsnummer prüfen, ob das Update angekommen ist.

## Gestaltungsprinzipien
- Ruhig, langsam, dunkel mit weichem Licht. Keine schnellen Bewegungen, nichts, was Übelkeit auslöst.
- Nutzer steht/sitzt still; keine künstliche Fortbewegung.
- Performance: Quest 3 soll stabil 72–90 fps halten. Wenige Lichter, sparsame Partikel, keine Post-Processing-Ketten.

## Aktueller Stand (v0.2.0) – Szene „Sonne & Wasser“
- Look nach Referenz: orange Sonnenscheibe wie eine Projektion, chromatischer Rand (gelb → orange → rot), gesättigter roter Glow, dunkelroter Grund mit feinem Korn.
- Davor eine transparente, brechende Wasserebene (Quad 8 × 8 m, 2,5 m vor dem Nutzer). Die Sonne liegt 0,5 m dahinter und wird per Raytracing-Brechung im Shader verzerrt (inkl. Parallaxe).
- Wellen: 2D-Wellengleichung auf der GPU (512², RG16F Ping-Pong, 480 Schritte/s). Anregung im Zentrum, Rand reflektiert.
  Rand leicht sechszählig gewellt (`sym`, `lobe`) → blütenartige Interferenzmuster wie Cymatics.
- Summen ins Mikro regt die Wellen an: Lautstärke = Amplitude, Tonhöhe (Autokorrelation 70–500 Hz) = Wellenlänge.
- Zum Testen ohne Mikro: Controller-Trigger halten (VR) bzw. Bildschirm gedrückt halten (2D-Vorschau).

## Entscheidungen
- Keine Einbindung in epicscapes.de (Adobe Portfolio) vorerst.
