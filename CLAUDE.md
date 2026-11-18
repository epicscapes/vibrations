# Vibrations – meditative WebXR-Anwendung

## Ziel
**Vibrations** – eine Sammlung ruhiger, meditativer VR-Experiences für die **Meta Quest 3**, direkt im Quest-Browser (WebXR, keine App-Installation).
Experiences (Auswahl per Thumbnail-Karten auf der Startseite, URL `?exp=<id>`):
1. **Soothing Ripples** (`ripples`, Modul `main.js`) – Sonne/Fraktal hinter brechendem Wasser mit Cymatics.
2. **Flow Drift** (`flow`, Modul `flowdrift.js`) – vom Summen angetriebene Kugel rollt durch Level-Landschaften.
Neue Experience: in `index.html` in `EXPERIENCES` eintragen (id, Titel, Modul, Thumbnail unter `thumbs/`, 480×300 JPG) und neue Module in `MODULES` aufnehmen.

## Technik
- **Vanilla WebGL2 + WebXR**, kein Framework (Wunsch des Nutzers: so lange wie sinnvoll ohne Framework).
  Framework erst vorschlagen, wenn z. B. glTF-Modelle, viele Objekte/Szenengraph, Controller-/Hand-Interaktion mit UI oder Physik dazukommen.
- Reines HTML/JS ohne Build-Schritt. `index.html` = Startseite/Loader (Experience-Auswahl, Import-Map mit Versionen).
  Gemeinsam: `audio.js` (Summen-Erkennung + Stimmeffekte, von allen Experiences genutzt), `grain-worklet.js`, `vrmenu.js` (VR-Menü), `mat.js` (Matrix-Helfer).
  Soothing Ripples: `main.js`, `shaders.js`. Flow Drift: `flowdrift.js`, `flowshaders.js`, `flowsound.js`.
  Jede Experience lädt als eigenes Modul (Seitenwechsel per Reload) – keine Aufräum-Logik zwischen Experiences nötig.
- Einstellungen aller Experiences in localStorage (`set.<key>`); Stimm-Einstellungen (`volume`, `dry`, `gateThr`, `fx.*`) sind geteilt, Flow-Drift-Schlüssel beginnen mit `fd`.
- Rendering: **Antialiasing aus**, **Supersampling** standardmäßig 150 % der nativen Quest-Auflösung, im Menü „Display“ pro Sitzung 100–300 %.
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
- Soothing Ripples: Nutzer steht/sitzt still, keine künstliche Fortbewegung.
- Flow Drift: künstliche Fortbewegung (Kamera folgt der Kugel) auf ausdrücklichen Wunsch; Drehung fließend ohne Vignette (Nutzerwahl).
- Performance: Quest 3 soll stabil 72–90 fps halten. Wenige Lichter, sparsame Partikel. Post-Processing nur optional (Flow-Drift-Bloom, standardmäßig aus).

## Soothing Ripples (Stand v0.14.0)
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
- Browser-Vorschau (beide Experiences): kleines abgerundetes Portal in der Mitte (`?fov=` zum Testen), ohne Supersampling, standardmäßig AUS
  (Button „Enable preview“) – entlastet den Quest-Browser. Gedrückt halten = Summen simulieren.

## Flow Drift (Stand v0.18.0)
- Look nach Unreal-Referenz des Nutzers (Video): sehr dunkel, Magenta/Violett/Indigo, low-key.
  Himmel: Aurora-Schleier rundherum, keine Sterne; zum Horizont im Nebel, kein sichtbarer Horizont (`SKY_GLSL`).
  Die Schleier sind parallel zur Lichtstrahl-Richtung `SHAFT_DIR` = normalize(0.35, 1, 0.15): Muster hängt nur vom Winkel um diese Achse ab
  → in jeder Blickrichtung dieselbe Schräge wie die Strahlen. Nur über dem Horizont bis etwa 30° Höhe sichtbar, zum Pol weich ausgeblendet (dort liefen Linien zusammen).
  Intensität `fdAuroraInt` (0 = aus, dann nur Nebelverlauf) → `uAurora` in Himmel, Boden-Spiegelung und Murmel.
  Lichtstrahlen (`fdShafts`, Untermenü „Atmosphere“): wie gestreute Planes in Unreal – zustandsloses Raster 13×13 Zellen à 8 m um den Spieler (Hash: 62 % der Zellen
  haben einen Strahl), schräge Bänder (eine Lichtrichtung), zylindrisch zur Kamera gedreht, additiv, langsam pulsierend + wanderndes Streifen-Noise;
  blenden unten per Nähe-Maske zum Gelände (0–3 m über `terrainH`) und zur Kamera (3–11 m) aus. Jeder Strahl blendet als Ganzes nach seinem Abstand zur
  (ungerasteten) Spielerposition ein/aus (21–40 m, `uFade`), vollständig bevor seine Zelle das Raster verlässt → kein Aufpoppen.
  Quer-Profil Gauß × (1 − x²)² → am Quad-Rand exakt 0.
  Bloom (`fdBloom`, Stärke, Weichheit; `flowpost.js`): Szene in eigenen Puffer (RGBA8 + Tiefe), Hellpass mit weichem Knick auf ¼ Auflösung (RGBA16F),
  trennbare Gauß-Weichzeichnung (Weichheit > 0,5 = zwei Durchgänge), pro Auge begrenzt; danach Komposition in den XR-Puffer, dann das VR-Menü (bleibt scharf).
  Kostet auf der Quest einen zusätzlichen Vollbild-Durchgang → standardmäßig aus.
  Dithering (`DITHER_GLSL`, ±½ Farbstufe) in Himmel, Boden, Murmel, Bloom gegen Treppenstufen in weichen Verläufen.
  Additive Effekte (Ribbon, Ringe, Flügel, Lichtstrahlen) nutzen `ditherAdd()`: Rauschen skaliert mit dem Signal → wo nichts leuchtet, exakt schwarz
  (sonst erhöht das auf 0 geklemmte Rauschen die ganze Fläche und Quad-Ränder werden sichtbar).
  Boden: fast schwarz, weiche Marmorierung, feine Körnung als Bump (`fdGrain`, blendet mit Entfernung aus), Fake-Spiegelung des Himmels (Fresnel),
  leuchtende Höhenlinien, die langsam nach oben wandern, maskiert mit großem weichem wanderndem Noise (`fdLines`); Abstand unregelmäßig (Höhe per Noise verzogen),
  Helligkeit und Breite je Linie per Hash, weiche Kanten. Dezenter Boden-Fresnel in Szenenfarbe (`fdFresnel`, 0 = aus),
  Höhennebel (am Boden am dichtesten, Szenenfarbe), Geländerand komplett im Nebel.
  Grundfarben `GLOW`/`AUR_*`/`FOG` in `BASE_GLSL` (JS-Kopie `GLOW` in flowdrift.js) – alles per Hue-Shift nach Stimmfrequenz.
- Level 1 „Rolling Hills“: unendliches Sinus-Hügel-Gelände (`terrainH` identisch in `flowshaders.js` TERRAIN_GLSL und `flowdrift.js` – beide gleich halten),
  Gitter 180² über 110 m, mitwandernd und auf Zellen gerastet. Weitere Levels: Option `fdLevel` – brauchen eigene Höhenfunktion in JS und GLSL.
- Hauptkugel (r = 0,3 m) = Glasmurmel, im Fragment-Shader verfolgt (deckend, nur Vorderseiten → kein sichtbares Inneres mehr):
  Fresnel-Spiegelung, Brechung (`fdIOR`), Ripples auf der Oberfläche ab der Rückseite (Warp-Austritt, laufen nach vorn):
  Intensität `fdRipples`, Frequenz `fdRipFreq` (Neigung so normiert, dass die Stärke gleich bleibt), Ausklingzeit `fdRipFade` (Hüllkurve `ripEnv`: schnell an, exponentiell aus).
  0–3 eingeschlossene Schalen (`fdLayers`) mit gravurartigen Julia-Wirbellinien; Größe `fdLayerScale` (Radius (0,8 − 0,22·k)·Skala, max. 0,95).
  Jede Schale hat eine eigene Drehung (`uShellRot[3]`, CPU): gleiche Achse wie die Kugel, Tempo 1 + (1/Radius − 1)·`fdLayerSpin` → kleinere drehen schneller.
  Innenlicht, Austritt + Hintergrund-Näherung. Roughness (`fdRough`) mit Qualität `fdRoughQ`: Fast = weichere Muster (alte Näherung),
  (Die Mehrstrahl-Variante „Realistic rays“ aus v0.17 wurde auf Wunsch wieder entfernt.) Dezenter Fresnel-Saum in Szenenfarbe (`fdBallFresnel`).
- Begleiter (r = 0,12 m): leuchtende Kugeln (innen hell Lavendel, zum Rand Glow-Farbton), keine Fraktale, kein Halo-Sprite mehr (auf Wunsch entfernt).
  Innenlichter (max. 9 Punktlichter `MAX_LIGHTS`) sitzen tief in den Kugeln (Hauptkugel 0,8 r, Begleiter 0,75 r unter der Mitte, dicht über dem Boden)
  und beleuchten den Boden: weich umgreifendes Kontaktlicht (Lambert × 0,6 + 0,4) + Glanzfleck (Fake-Spiegelung);
  Rauheit des Glanzflecks `fdSpecRough` (Exponent 60 → 3, energieerhaltend, Reflexion zusätzlich per Noise gestreut).
- Physik: Hangabtrieb nur am Boden (5/7 g × 0,6), Antrieb = Summen (alternativ Trigger / W / gedrückt halten) × Thrust, Reibung, Höchsttempo; Rollen über 3×3-Rotation.
  Sprung: A/B rechts oder Y links (X = Menü), Vorschau: Leertaste. Landung mit kleinem Rückprall + Aufprallklang.
  Flügel: Arme ausbreiten (Hände > ~1,1 m auseinander, etwa Schulterhöhe; Vorschau: F halten) → Federfächer wachsen, Kugel schwebt ~1,1 m über dem
  geglätteten Boden (Feder + sanftes Auf und Ab), folgt den Hügeln weich; in der Luft kein Hangabtrieb, kein Pfad, kein Rollgeräusch.
- Begleiter-Physik: rollen immer am Boden, magnetisch zur Hauptkugel (Zug ∝ Abstand × (1 + 0,35·Abstand), `fdMagnet`), nahe dran Bremsen relativ zur Hauptkugel;
  unabhängig von Blick/Kamera. Weiche Kollisionen (Hauptkugel schwerer, Rückprall 0,25) mit leisem räumlichem Glas-Klicken.
  Stoß Begleiter ↔ Hauptkugel erzeugt kleine helle Splitter (`sparkChips`, Menge `fdSparks`): fliegen fächerförmig weg, leichte Schwerkraft,
  ein kleiner Abpraller, bleiben 2–4 s am Boden liegen und verglimmen (eigener Punkt-Puffer `chips`).
- Richtung/Kamera: Blickrichtung + rechter Stick lenkt; linker Stick dreht die Ansicht um die Kugel. `fdCam` 0 = POV über der Kugel … 1 = Third Person.
  Weltansicht = XR-Ansicht × inverse(Rig); VR-Menü mit lokaler Ansicht.
- Effekte: Partikelpfad (nur am Boden; kleine, scharfe Punkte, die glitzern: `uGlitter` → meist gedämpft, kurze helle Aufblitzer je Partikel), Warp-Ringe (starten klein, wachsen, dicht, dezent), Ribbon (blendet vor der Kamera aus), Goals, Explosionen, Flügel.
  Weiche Schnitte (`SOFT_GLSL`): Ribbon, Ringe, Leucht-Sprites und Flügel blenden analytisch aus, je näher sie Gelände (`terrainH`) oder Hauptkugel kommen
  (kein Tiefenpuffer nötig; Sprites rekonstruieren ihre Pixel-Weltposition über die Kamera-Achsen).
- Klang (`flowsound.js`, synthetisiert, je Klang eine Methode → später gegen Dateien tauschbar), alles außer Musik binaural (HRTF-PannerNode, Hörer = Kopf):
  Rollen am Auflagepunkt, Chime am Goal, Aufprall bei Landung, Klicken bei Kollisionen, Schnurren je Begleiter.
  Nur die 4 neuesten Begleiter schnurren (`limitPurrs`): ältere blenden ~4 s aus und werden abgebaut (viele HRTF-Quellen erzeugten Knacken);
  Positionen der Schnurr-Quellen werden nur ~25×/s nachgeführt (weniger Automations-Ereignisse). Musik generativ, nicht räumlich, lauter mit Tempo.
- Depth-Buffer an (XR-Layer `depth: true`), Reihenfolge: Himmel → Gelände → Kugeln (deckend) → additive Effekte.
- Tests: `?debug=1` legt den Zustand als `window.__fd` offen.

## Gemeinsam: Display
- Untermenü „Display“ in jeder Experience: Supersampling 100–300 % (Standard 150 %). Wird NICHT gespeichert – jede Experience/jedes Laden startet mit 150 %
  (`session: true` in der Einstellung). Änderung in VR legt den XR-Bildpuffer kurz nach dem letzten Reglerschritt neu an. `?scale=` setzt den Startwert.

## Entscheidungen
- Keine Einbindung in epicscapes.de (Adobe Portfolio) vorerst.
