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

## Aktueller Stand (v0.10.0) – Szene „Sonne & Wasser“
- Look nach Referenz: Sonnenscheibe wie eine Projektion – in Ruhe tiefrot und gedämpft (untergehende afrikanische Sonne), beim Summen hell orange (`uSunHeat` folgt dem federnden Wachstum), schmaler chromatischer Rand (gelb → orange → rot), gesättigter roter Glow, dunkelroter Grund mit feinem Korn.
- Davor eine transparente, brechende Wasserebene (Quad 16 × 16 m, 5 m vor dem Nutzer, Behälter-Umkreisradius 3 m, Sonnenradius in Ruhe 1,15 m, Fraktal-Grundgröße 1,4 m). Die Sonne liegt 1 m dahinter und wird per Brechung im Shader verzerrt (inkl. Parallaxe).
- Shapes (Untermenü): Objekt im Zentrum = Sonne oder Fraktal.
  Fraktal-Algorithmen: Julia, Phoenix (ersetzt Burning Ship – war zu verrauscht), Tricorn, Kaliset, Mandala (8-fach gefaltete Julia). Entwickeln sich über `morph` (Tempo × (0,25 + Lautstärke × 1,5)).
  Parameter pendeln nur in Bereichen mit sichtbarer Struktur (per Offline-Scan ermittelt; volle Drehung erzeugte lange leere Phasen).
  Innenflächen (Punkte, die nie entkommen) wahlweise „Struktur“ (Orbit-Trap, Standard), „Hohl“ (dunkel) oder „Hell“ – verhindert große helle Flächen.
  Pro Frame in ein RGBA16F-Textur-Array gerendert (`fracFS`, 1–6 Ebenen, Auflösung 512–3072). Ebenen symmetrisch um die innerste verteilt (davor = späterer, dahinter = früherer Zustand, Abstand `fracDepth`).
  Innerste Ebene = Hauptform (volle Deckkraft, Relief, Partikel-Quelle). Nach außen: Deckkraft echoFade^Abstand, Sättigung +echoSat × Abstand, Farbversatz echoHue × k (vorne/hinten gegenläufig).
  Ebenen-Mischmodi: Normal, Additiv, Screen, Difference, Aufhellen (`blendLayer()` im Szene-Shader).
  Iterationen 4–96 (Helligkeit auf max. 48 normiert; Kaliset nutzt Iterationen/3).
  Relief (optional, Standard aus): Parallax-Occlusion-Mapping im Szene-Shader – Helligkeit der innersten Ebene = Höhe, Strahl wird in N Schritten
  durch die Höhenschicht verfolgt, plus Licht aus der Steigung. Nur aktiv, wenn Relief > 0 und Pixel im Fraktal-Radius; keine zusätzliche Geometrie.
  Farbe = Sonnenpalette, dann Hue-Shift (YIQ-Rotation, `hueShift()` in `COLOR_GLSL`) nach Tonhöhe; ohne Summen langsam zurück zur Sonnenfarbe.
  Corona-Partikel entstehen im Fraktal-Modus an zufälligen Orten, sichtbar nur, wo das Fraktal hell ist, in dessen Farbe (Vertex-Shader liest die Fraktal-Textur).
  Auch die Partikel zu mir übernehmen den Farbton.
- Hintergrund (Untermenü): animiertes Korn (Zellen driften und funkeln weich), bis zu 3 Tiefenebenen hinter dem Objekt (verdeckt), Stärke/Größe/Bewegung/Ebenen/Abstand, abschaltbar.
- Sonne wächst beim Summen um bis zu 40 % (gedämpfte Feder) und wird dabei hell; Rand wabert organisch (`sunRadius()` in `SUN_GLSL`). Fraktale atmen nur mit 30 % davon.
- Wellen: 2D-Wellengleichung auf der GPU (RG16F Ping-Pong), Auflösung 512–1536, Schritte/s = 480 × Auflösung/512.
  Anregung: `waveGain * amp^waveDyn` (Dynamik-Kurve: leises Summen = schwache Wellen). Tonhöhe → Wellenlänge, „Wellen-Frequenz“ verkürzt sie.
  Behälterformen (`uShape`): Kreis, 3/4/5/6/8-Eck, Blüte 5/6/8. Optional folgt der Anregungsort verzögert dem Blick (Kopf-Vorwärtsrichtung ∩ Wasserebene; in der 2D-Vorschau dem Zeiger).
- Corona: zustandslose GPU-Partikel, Emission entlang des Randes über wanderndes Noise (Noise-Größe einstellbar, ganzzahlige Frequenzen → nahtlos).
  Geburtsfarbe = Sonnenfarbe am Ort, glühen ins Rot aus. Drei Tiefenebenen (vor / auf / hinter der Sonne, je eigene RGBA16F-Textur mit Schweifen durch Teil-Löschen pro Frame),
  vormultipliziert „über“ die Szene komponiert, hintere Ebene von der Scheibe verdeckt; alle werden mit dem Wasser gebrochen → Parallaxe.
- Partikel zu mir: 3D-Punkte von der Sonnenscheibe auf den Betrachter zu, Tempo ~ Lautstärke, Ausblenden 0,8–2,2 m vor der Kamera.
  Schweife als Geometrie (6 Segmente entlang der Flugbahn, spitz zulaufend, seitlich schlängelnd wie Spermien).
- Stimmeffekte: Hall, Echo, Grain Delay, Shimmer, Obertöne (Schalter); Effekt-Lautstärke, trockene Stimme, Gate-Schwelle.
  Gate folgt der rohen Lautstärke (RMS-Schwelle, schnell auf / langsam zu). Kompressor am Ausgang.
- Feedback-Risiko: Quest-Lautsprecher + Mikro ohne Echounterdrückung. Bei Pfeifen Lautstärke senken oder Kopfhörer nutzen.
- UI: ⚙︎ blendet das Panel ein/aus; Untermenüs (`<details>`) „Stimme & Effekte“, „Sonne & Corona“, „Partikel zu mir“, „Wasser & Cymatics“.
  Definiert in `SECTIONS` in `main.js`, alles in localStorage.
- Zum Testen ohne Mikro: Controller-Trigger halten (VR) bzw. Bildschirm gedrückt halten (2D-Vorschau).

## Entscheidungen
- Keine Einbindung in epicscapes.de (Adobe Portfolio) vorerst.
