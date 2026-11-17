# Vibrations – meditative WebXR-Anwendung

## Ziel
Eine ruhige, meditative VR-Erfahrung für die **Meta Quest 3**, die direkt im Quest-Browser läuft (WebXR, keine App-Installation).

## Technik
- **Vanilla WebGL2 + WebXR**, kein Framework (Wunsch des Nutzers: so lange wie sinnvoll ohne Framework).
  Framework erst vorschlagen, wenn z. B. glTF-Modelle, viele Objekte/Szenengraph, Controller-/Hand-Interaktion mit UI oder Physik dazukommen.
- Reines HTML/JS ohne Build-Schritt: `index.html`, `main.js` (WebGL/XR-Setup, Loop), `shaders.js` (GLSL), `audio.js` (Summen-Erkennung + Stimmeffekte), `grain-worklet.js` (AudioWorklet für Granular-Effekte).
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

## Aktueller Stand (v0.5.0) – Szene „Sonne & Wasser“
- Look nach Referenz: orange Sonnenscheibe wie eine Projektion, schmaler chromatischer Rand (gelb → orange → rot), gesättigter roter Glow, dunkelroter Grund mit feinem Korn.
- Davor eine transparente, brechende Wasserebene (Quad 16 × 16 m, 5 m vor dem Nutzer, Wasserbehälter-Radius 3 m, Sonnenradius 1,4 m). Die Sonne liegt 1 m dahinter und wird per Raytracing-Brechung im Shader verzerrt (inkl. Parallaxe).
- Sonne wächst beim Summen um bis zu 12 % (gedämpfte Feder, leichtes Nachschwingen); Rand wabert organisch (`sunRadius()` in `SUN_GLSL`, Uniforms `uSunScale`, `uSunWob`).
- Wellen: 2D-Wellengleichung auf der GPU (RG16F Ping-Pong). Auflösung im UI 512–1536 (Standard 768), Schritte/s = 480 × Auflösung/512. „Wellen-Frequenz“ im UI verkürzt die Wellenlänge (min. 5 Texel). Anregung im Zentrum, Rand reflektiert.
  Rand leicht sechszählig gewellt (`sym`, `lobe`) → blütenartige Interferenzmuster wie Cymatics.
- Summen ins Mikro regt die Wellen an: Lautstärke = Amplitude, Tonhöhe (Autokorrelation 70–500 Hz) = Wellenlänge.
- Sonnenwind: 6000 zustandslose GPU-Partikel strömen turbulent von der Sonne weg, Tempo und Turbulenz steigen mit der Lautstärke.
  Jede Lebensrunde neuer Geburtsort; Emission entlang des Randes über langsam wanderndes, feines Noise (Frequenzen 7–61) -> schmale dichtere Strähnen.
  Bei der Geburt haben sie die Farbe der Sonne an dieser Stelle (gemeinsame GLSL-Funktion `sunDisc`) und glühen ins Rot aus.
  Gezeichnet in eine eigene Textur (Sonnenebene, vormultipliziert mit Alpha, Schweife) und "über" die Sonne komponiert, nicht additiv –
  so verschmelzen sie am Rand mit der Scheibe. Liegen hinter dem Wasser und werden mit gebrochen.
- Partikel zu mir: zustandslose 3D-Punkte (additiv) starten auf der Sonnenscheibe und fliegen aufgefächert auf den Startpunkt zu, Tempo ~ Lautstärke, Ausblenden 0,8–2,2 m vor der Kamera. Anzahl und Größe im UI.
- UI-Panel (⚙︎ ein/aus): Effekte, Effekt-/Stimm-Lautstärke, Partikel zu mir (Anzahl, Größe), Wasser-Auflösung, Wellen-Frequenz – alles in localStorage.
- Stimmeffekte (Gate öffnet nur beim Summen; Kompressor am Ausgang; Regler „Eigene Stimme“ mischt die trockene Stimme dazu, Standard 0):
  Hall (Faltungshall, ~7 s), Echo (Ping-Pong), Grain Delay, Shimmer (Körner eine Oktave höher in den Hall), Obertöne (Sinus-Unteroktave/Quinte/Oktave folgen der Tonhöhe).
  Schalter + Effekt-Lautstärke in der Browser-UI, Einstellungen in localStorage gespeichert.
- Feedback-Risiko: Quest-Lautsprecher + Mikro ohne Echounterdrückung. Bei Pfeifen Effekt-Lautstärke senken oder Kopfhörer nutzen.
- Zum Testen ohne Mikro: Controller-Trigger halten (VR) bzw. Bildschirm gedrückt halten (2D-Vorschau).

## Entscheidungen
- Keine Einbindung in epicscapes.de (Adobe Portfolio) vorerst.
