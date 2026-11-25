# Lehrer-Assistent

Ein persönlicher Assistent für den Lehreralltag als Web-App (PWA), optimiert für das iPad Pro.
Er läuft im Browser, lässt sich wie eine App auf den Home-Bildschirm legen und funktioniert auch offline.

## Funktionen

| Bereich | Was es kann |
|---|---|
| **Heute** | Heutige Stunden mit dem nächsten geplanten Thema und dem Materialstand, fällige Aufgaben, fehlendes Material der nächsten 14 Tage, Wochenarbeitszeit, Projekte |
| **Stundenplan & WebUntis** | Import der iCal-Datei aus WebUntis (optional über den Abo-Link). Nach jedem Import werden Änderungen erkannt: Ausfall, Vertretung, Raumwechsel. Wochenansicht und ein Wochenraster, das sich aus WebUntis übernehmen lässt. |
| **Klassenleitung** | Pro Klasse: Termine (Elternabend, Elternsprechtag …), To-dos, Dokumente mit Rücklauf-Zähler (z. B. 19/27 Einverständniserklärungen), Elternkontakte mit Wiedervorlage, Zeiterfassung für Elternarbeit |
| **Fächer** | Übersicht pro Fach: Unterrichtsreihen, Materialstand in Prozent, Material-Bibliothek, Logineo-Kurslink |
| **Reihenplanung** | Stunden einer Reihe mit Datum, Thema und verknüpftem Material. Ampel pro Stunde (Material da / teilweise / fehlt). *Termine füllen* berechnet Daten aus dem Stundenplan. *Kopieren* übernimmt eine Reihe für eine Parallelklasse. |
| **Material** | Dateien vom iPad (PDF, Bilder …), Links (Logineo, OneDrive, Videos) oder Notizen mit Status. Ein Material kann mit mehreren Stunden verknüpft werden. |
| **Aufgaben** | To-dos mit Fälligkeit, gruppiert nach überfällig, heute, Woche und später, verknüpfbar mit Fach oder Projekt |
| **Projekte** | Raum für Erasmus+, Fachschaft, AGs, Fahrten: Aufgaben, Dokumente, Kontakte, Protokoll-Notizen, investierte Zeit |
| **Arbeitszeit** | Stoppuhr per Fingertipp nach Tätigkeit (Unterricht, Korrektur …), Nachtragen, Wochenübersicht mit Soll/Ist, CSV-Export für Excel |
| **Logineo NRW LMS** | Direktlinks zur Logineo-Startseite und zu jedem Kurs |

## Datenschutz

Alle Daten liegen ausschließlich lokal auf dem Gerät, in localStorage und IndexedDB. Es gibt keinen Server.
Unter *Einstellungen → Sicherung exportieren* lässt sich eine Sicherungsdatei (inklusive Dateien) erstellen.
In der Klassenleitung möglichst Kürzel statt Namen verwenden. In NRW regelt die VO-DV I, welche Schülerdaten auf privaten Geräten verarbeitet werden dürfen; dafür braucht es eine Genehmigung der Schulleitung.

## WebUntis

Eine reine Web-App darf WebUntis meist nicht direkt abfragen, weil der Browser das blockiert. Deshalb gibt es diesen Weg:
1. In WebUntis (Safari) den eigenen Stundenplan als **iCal** exportieren und die Datei in der Dateien-App sichern.
2. Im Assistenten unter *Stundenplan → iCal-Datei importieren* einlesen.
3. Wenn du später erneut importierst, zeigt der Assistent alle Änderungen gegenüber dem letzten Stand.

Bei jedem Fach das **WebUntis-Kürzel** (z. B. `M`) eintragen, damit Stunden den Fächern und Reihen zugeordnet werden.

## Auf das iPad bringen

1. Die App muss einmal im Internet erreichbar sein, zum Beispiel über **GitHub Pages**:
   Repository → *Settings → Pages* → *Deploy from a branch* → Branch `main`, Ordner `/ (root)`.
2. Die Seite auf dem iPad in **Safari** öffnen.
3. **Teilen → Zum Home-Bildschirm** wählen. Danach startet die App im Vollbild und funktioniert offline.

## Technik

Reines HTML, CSS und JavaScript ohne Build-Schritt und ohne Abhängigkeiten:
`index.html`, `styles.css`, `app.js`, `sw.js` (Offline-Cache), `manifest.webmanifest`.
Lokal testen: `python3 -m http.server` und dann `http://localhost:8000` öffnen.
