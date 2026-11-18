# Vibrations – meditative WebXR-Anwendung

## Ziel
Eine ruhige, meditative VR-Erfahrung für die **Meta Quest 3**, die direkt im Quest-Browser läuft (WebXR, keine App-Installation).

## Technik
- **Vanilla WebGL2 + WebXR**, kein Framework (Wunsch des Nutzers: so lange wie sinnvoll ohne Framework).
  Framework erst vorschlagen, wenn z. B. glTF-Modelle, viele Objekte/Szenengraph, Controller-/Hand-Interaktion mit UI oder Physik dazukommen.
- Reines HTML/JS ohne Build-Schritt: `index.html`, `main.js` (WebGL/XR-Setup, Loop, Einstellungen), `shaders.js` (GLSL), `audio.js` (Summen-Erkennung + Stimmeffekte), `grain-worklet.js` (AudioWorklet für Granular-Effekte), `vrmenu.js` (Menü in VR).
- Rendering: **Antialiasing aus**, **Supersampling 150 %** der nativen Quest-Auflösung
  (`framebufferScaleFactor = getNativeFramebufferScaleFactor() * 1.5`). Testweise änderbar per URL: `?scale=1.0`.
- **Hosting: GitHub Pages** aus dem `main`-Branch (Root). HTTPS ist Pflicht für WebXR – Pages liefert das.
- Mikrofon über Web Audio API (getUserMedia), Freigabe per Button vor dem Start von VR.

## Workflow
1. Änderung machen, **Version `V` in `index.html` erhöhen** (wird oben links angezeigt). Alle Module/Worklet werden mit `?v=V` geladen → kein veralteter Browser-Cache (GitHub Pages cached sonst 10 min).
2. Commit + Push auf `main` → nach ca. 1 Minute live.
3. Auf der Quest die Seite neu laden und an der Versionsnummer prüfen, ob das Update angekommen ist.

## Sprache
- **Alle UI-Bezeichnungen (Browser-UI und VR-Menü) sind und bleiben auf Englisch.** Code-Kommentare und diese Datei dürfen deutsch sein.

## Gestaltungsprinzipien
- Ruhig, langsam, dunkel mit weichem Licht. Keine schnellen Bewegungen, nichts, was Übelkeit auslöst.
- Nutzer steht/sitzt still; keine künstliche Fortbewegung.
- Performance: Quest 3 soll stabil 72–90 fps halten. Wenige Lichter, sparsame Partikel, keine Post-Processing-Ketten.

## Aktueller Stand (v0.13.0) – Szene „Sonne & Wasser“
- Look nach Referenz: Sonnenscheibe wie eine Projektion – in Ruhe tiefrot und gedämpft (untergehende afrikanische Sonne), beim Summen hell orange (`uSunHeat` folgt dem federnden Wachstum), schmaler chromatischer Rand (gelb → orange → rot), gesättigter roter Glow, dunkelroter Grund (Korn wurde entfernt).
- Davor eine transparente, brechende Wasserebene (Quad 16 × 16 m, 5 m vor dem Nutzer, Behälter-Umkreisradius 3 m, Sonnenradius in Ruhe 1,15 m, Fraktal-Grundgröße 1,4 m). Die Sonne liegt 1 m dahinter und wird per Brechung im Shader verzerrt (inkl. Parallaxe).
- Shapes (Untermenü): Objekt im Zentrum = Sonne oder Fraktal.
  Fraktal-Algorithmen: Julia, Phoenix (ersetzt Burning Ship – war zu verrauscht), Tricorn, Kaliset, Mandala (8-fach gefaltete Julia). Entwickeln sich über `morph` (Tempo × (0,25 + Lautstärke × 1,5)).
  Parameter pendeln nur in Bereichen mit sichtbarer Struktur (per Offline-Scan ermittelt; volle Drehung erzeugte lange leere Phasen).
  „Interior“ (Punkte, die nie entkommen): Structure (Orbit-Trap, Standard) oder Hollow (dunkel) – verhindert große helle Flächen. Kaliset entwickelt sich intern 4× schneller.
  Pro Frame in ein RGBA16F-Textur-Array gerendert (`fracFS`, 1–6 Ebenen, Auflösung 512–3072).
  „Stärkste Ebene“ (`fracFocus`): Vorderste (Standard; alle Echos dahinter) oder Mittlere (Echos davor und dahinter; davor = späterer, dahinter = früherer Zustand).
  Stärkste Ebene = Hauptform (volle Deckkraft, Partikel-Quelle). Mit Abstand k: Deckkraft echoFade^|k|, Sättigung +0,5 × |k|, Farbversatz 0,2 × k (fest, `FIXED` in main.js).
  Ebenen-Mischmodi: Normal, Additive, Difference, Soft Light (Pegtop) (`blendLayer()` im Szene-Shader).
  Iterationen 4–96 (Helligkeit auf max. 48 normiert; Kaliset nutzt Iterationen/3).
  Farbe = Sonnenpalette, dann Hue-Shift (YIQ-Rotation, `hueShift()` in `COLOR_GLSL`) nach Tonhöhe (Stärke fest 1); ohne Summen langsam zurück zur Sonnenfarbe. Im Sonnen-Modus bleibt der Wellen-Glow in Sonnenfarben.
  Corona-Partikel entstehen im Fraktal-Modus an zufälligen Orten, sichtbar nur, wo das Fraktal hell ist, in dessen Farbe (Vertex-Shader liest die Fraktal-Textur).
  Auch die Partikel zu mir übernehmen den Farbton.
- Sonne wächst beim Summen um bis zu 40 % (gedämpfte Feder) und wird dabei hell; Rand wabert organisch (`sunRadius()` in `SUN_GLSL`). Fraktale atmen nur mit 30 % davon.
- Wellen: 2D-Wellengleichung auf der GPU (RGBA16F Ping-Pong: Höhe, vorherige Höhe, Hüllkurve), Auflösung 512–1536.
  Ausbreitungs-Tempo: c² = 0,25·speed² (max. 0,45), darüber mehr Schritte/s (max. 48 pro Frame). Abklingzeit als Halbwertszeit → Dämpfung pro Schritt.
  IOR-Regler 0,5–2,2 (unter 1: Totalreflexion wird gespiegelt weitergeführt). Optische Randausblendung `edgeSoft` (fest 0,6): Wellen-Neigung, Glow und Sand blenden zum Rand aus, die Simulation reflektiert unverändert. Behälterform in `BOUNDARY_GLSL` (gemeinsam für Simulation, Glow, Sand; `edgeFade()` blendet zum Rand aus).
  Sichtbarkeit: „Leuchtende Wellen“ (|Höhe| leuchtet) und „Sand-Muster“ (Float32-Partikelzustand; Körner springen in Schwingungsbäuchen
  und rutschen entlang des Hüllkurven-Gefälles in die Knotenlinien; sichtbar beim Summen, verschwinden danach über „Nachleuchten“). Sand-Wind: Körner wandern über ihre Lebenszeit auf den Betrachter zu (Stärke `sandWind`, ungleichmäßig durch Noise im Maßstab der Corona-Emittermaske, leichte seitliche Verwirbelung), Ausblenden kurz vor der Kamera.
  Anregung: `waveGain * amp^waveDyn` (Dynamik-Kurve: leises Summen = schwache Wellen). Tonhöhe → Wellenlänge, „Wellen-Frequenz“ verkürzt sie.
  Behälterformen (`uShape`): Kreis, 3/4/5/6/8-Eck, Blüte 5/6/8. Optional folgt der Anregungsort verzögert dem Blick (Folge-Tempo fest 2,0) (Kopf-Vorwärtsrichtung ∩ Wasserebene; in der 2D-Vorschau dem Zeiger).
- Corona: zustandslose GPU-Partikel, Emission entlang des Randes über wanderndes Noise (Noise-Größe einstellbar, ganzzahlige Frequenzen → nahtlos).
  Geburtsfarbe = Sonnenfarbe am Ort, glühen ins Rot aus. Drei Tiefenebenen (vor / auf / hinter der Sonne, je eigene RGBA16F-Textur mit Schweifen durch Teil-Löschen pro Frame),
  vormultipliziert „über“ die Szene komponiert, hintere Ebene von der Scheibe verdeckt; alle werden mit dem Wasser gebrochen → Parallaxe.
- Partikel zu mir: 3D-Punkte von der Sonnenscheibe auf den Betrachter zu, Tempo ~ Lautstärke, Ausblenden 0,8–2,2 m vor der Kamera.
  Schweife als Geometrie (6 Segmente entlang der Flugbahn, spitz zulaufend, seitlich schlängelnd wie Spermien).
- Stimmeffekte: Reverb, Echo, Grain Delay, Shimmer, Harmonics (Schalter); Effekt-Lautstärke, trockene Stimme, Gate-Schwelle.
  Gate folgt der rohen Lautstärke (RMS-Schwelle, schnell auf / langsam zu). Kompressor am Ausgang.
- Feedback-Risiko: Quest-Lautsprecher + Mikro ohne Echounterdrückung. Bei Pfeifen Lautstärke senken oder Kopfhörer nutzen.
- UI: ⚙︎ blendet das Panel ein/aus; Untermenüs „Voice & Effects“, „Shapes“, „Sun & Corona“, „Incoming Particles“, „Water & Cymatics“.
  Definiert in `SECTIONS` in `main.js`, alles in localStorage; Werte ändern immer über `setSetting()` / `setEffect()` (synchronisiert Browser-UI und VR-Menü).
  Gespeicherte Werte entfernter Optionen fallen beim Laden auf den Standard zurück.
- VR-Menü (`vrmenu.js`): X-Taste links öffnet/schließt; schwebt über der linken Hand, immer zum Kopf gedreht; Canvas-Textur (nur bei Änderung neu gezeichnet).
  Rechter Laser + Trigger: Sektion auf/zu (Akkordeon), Schalter, Auswahl (◂ links zurück / rechts ▸ weiter), Regler ziehen.
  Zeigt der Laser aufs Menü, erzeugt der rechte Trigger keine Wellen.
- Controller (VR): beide Trigger analog = Wellenstärke (voll gedrückt = 1/3 der Summ-Maximalstärke, `TRIGGER_MAX`),
  Anregungsort = unsichtbarer Strahl der fester gedrückten Hand ∩ Wasserebene. (Relief und Trigger-Ton wurden auf Wunsch wieder entfernt.)
- Browser-Vorschau: kleines abgerundetes Portal in der Mitte (Blickwinkel ~43°, `?fov=` zum Testen), ohne Supersampling, standardmäßig AUS
  (Button „Enable preview“) – entlastet den Quest-Browser. Gedrückt halten = Summen simulieren.

## Entscheidungen
- Keine Einbindung in epicscapes.de (Adobe Portfolio) vorerst.
