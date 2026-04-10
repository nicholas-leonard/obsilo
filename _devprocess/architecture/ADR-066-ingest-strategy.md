# ADR-066: Ingest-Strategie (Schema-Erkennung und Entitaets-Zuordnung)

**Status:** Accepted (modified by review: Option 1 statt Option 3, Settings statt Schema-Cache)
**Date:** 2026-04-08
**Deciders:** Sebastian Hanke

## Context

Der Knowledge Ingest Skill (FEATURE-1900) muss neue Notes in die bestehende Vault-Struktur einordnen. Zwei zentrale Herausforderungen:

1. **Schema-Erkennung**: Der Skill muss wissen welche Frontmatter-Properties der User nutzt (Themen, Konzepte, Personen, Projekte...). Das Schema ist nicht fest -- jeder User hat eigene Templates.

2. **Entitaets-Zuordnung**: Der Skill muss entscheiden ob eine Note bestehenden Entitaeten zugeordnet werden kann oder ob neue erstellt werden muessen. Der User will wenige starke Hub-Themen, nicht viele schwache.

**Triggering ASRs:**
- ASR-1 (FEATURE-1900): Schema-Erkennung aus Templates -- Flexibility
- ASR-2 (FEATURE-1900): Entitaets-Zuordnung bestehend vs. neu -- Correctness

## Decision Drivers

- **Template-Agnostik**: Muss mit beliebigen User-Templates arbeiten, nicht nur mit dem Default-Schema
- **Bestehende Entitaeten bevorzugen**: User will Hub-Themen, nicht Fragmentierung
- **Keine stille Modifikation**: Alle Aenderungen benoetigen User-Bestaetigung
- **Token-Effizienz**: Minimaler LLM-Aufwand pro Ingest (~4k Tokens)
- **Wiederverwendbarkeit**: Ingest-Logik muss auch fuer Synthese-Button (FEATURE-1904) nutzbar sein

## Considered Options

### Option 1: Schema aus Settings (mocPropertyNames)

Bestehende Settings `mocPropertyNames` als alleinige Quelle fuer das Property-Schema.

- Pro: Bereits implementiert in FEATURE-1502
- Pro: Keine zusaetzliche Konfiguration noetig
- Con: Nur MOC-Properties, nicht das vollstaendige Template-Schema (Zusammenfassung, Tags, Kategorie fehlen)
- Con: User muss Settings pflegen statt Templates
- Con: Widerspricht BA-Entscheidung: "Templates als .md, nicht Settings"

### Option 2: Schema dynamisch aus Templates lesen (bei jedem Ingest)

Agent liest bei jedem Ingest 2-3 Templates und leitet das Schema ab.

- Pro: Immer aktuell -- Template-Aenderungen wirken sofort
- Pro: Kein Caching noetig
- Con: 2-3 zusaetzliche read_file Calls pro Ingest
- Con: Template-Ordner muss bekannt sein (Onboarding-Abhaengigkeit)
- Con: Parsing-Logik fuer beliebige YAML-Frontmatter noetig

### Option 3: Schema beim Onboarding cachen und bei Aenderung aktualisieren

Onboarding (FEATURE-1903) parst Templates einmalig, speichert erkanntes Schema in einer Konfigurationsdatei. Agent liest nur den Cache.

- Pro: Schnell -- ein File-Read statt mehrerer Template-Reads
- Pro: Schema-Erkennung laeuft nur einmal (oder bei explizitem Refresh)
- Pro: Cache kann auch Cluster-Namen und Kategorie-Mappings enthalten
- Pro: Validierung beim Onboarding: "Erkannte Properties: Themen, Konzepte, Personen -- korrekt?"
- Con: Cache kann veralten wenn User Templates aendert ohne Refresh
- Con: Zusaetzliche Datei im Plugin-Verzeichnis

## Decision

**Vorgeschlagene Option:** Option 1 -- Schema aus Settings (mocPropertyNames), mit verbesserter UI

**Begruendung:**

Die zentrale Frage ist: Welche Properties sind Entitaeten (Wikilinks) und welche sind Metadaten? Diese Unterscheidung laesst sich nicht aus Templates ableiten -- der User muss sie explizit treffen.

Genau dafuer existiert bereits `mocPropertyNames` in den Settings (FEATURE-1502). Die bestehende Infrastruktur ist korrekt, braucht aber eine bessere UI:

1. **Option 1 ist ausreichend** weil die Entitaets-Properties (`mocPropertyNames`) die einzige Information sind die der Ingest-Skill ueber das Schema braucht. Alles andere (Zusammenfassung, Tags, Kategorie) ist Template-Wissen das der Agent aus der konkreten Note ableiten kann.

2. **Option 3 (Cache) ist ueberfluessig** weil die zentrale Information -- welche Properties sind Entitaeten -- sowieso in den Settings definiert werden muss. Ein Cache waere nur eine Duplikation.

3. **Option 2 (Template-Lesen pro Ingest) ist fragil** weil Templates nicht zwischen Entitaets- und Metadaten-Properties unterscheiden. `tags`, `Permanent`, `uid` sind keine Entitaeten -- das kann man nicht automatisch erkennen.

### Verbesserte Settings-UI

Die bestehende `mocPropertyNames` Einstellung wird erweitert:

```
Knowledge Maintenance
├── Entity Properties (Wikilinks)
│   Welche Properties verlinken auf andere Notes?
│   [Themen] [Konzepte] [Personen] [Projekte] [Quellen] [+]
│   
├── Category Property
│   Welche Property definiert den Note-Typ?
│   [Kategorie]
│   
├── Summary Property  
│   Welche Property enthaelt die Zusammenfassung?
│   [Zusammenfassung]
│
└── Source Naming Convention
    Wie sollen Quellen-Dateien benannt werden?
    [Autor-Jahr_Titel]
```

Dies ist eine Erweiterung der bestehenden Settings, kein neuer Konfigurationsmechanismus.
Der Agent liest `mocPropertyNames` (= Entity Properties) und weiss damit:
- Welche Properties er beim Ingest befuellen soll (Entitaeten)
- Welche er ignorieren kann (Metadaten wie tags, uid, Permanent)
- Wo er bestehende Entitaeten im Vault suchen muss

### Entitaets-Zuordnungs-Strategie

```
1. BESTEHENDE SUCHEN (immer zuerst)
   - Ontologie-Query: Welche Cluster passen? (FEATURE-1902)
   - Semantic Search: Top-5 aehnlichste Entitaets-Notes
   - GraphStore: Direkt verlinkte Entitaeten

2. ZUORDNUNG BEWERTEN
   - Fuer jede erkannte Entitaet im Text:
     a) Gibt es eine bestehende Note? → Property setzen (automatisch)
     b) Gibt es einen aehnlichen Cluster? → dem Cluster zuordnen (automatisch)
     c) Beides nicht? → Neue Entitaet vorschlagen (mit Bestaetigung)

3. NEUE ENTITAET ERSTELLEN (nur nach Bestaetigung)
   - Stub-Note aus passendem Template generieren
   - Inhaltlich anreichern (Agent-Wissen + Vault-Kontext)
   - Ontologie-Eintrag: Neuer Cluster-Hub
   - Dialog: "Jetzt vertiefen oder spaeter?"
```

**Hinweis:** Dies ist ein VORSCHLAG. Claude Code entscheidet final basierend auf dem realen Zustand der Codebase.

## Consequences

### Positive
- Nutzt bestehende Infrastruktur (`mocPropertyNames`) statt neue zu bauen
- User hat explizite Kontrolle darueber welche Properties Entitaeten sind
- Bestehende Entitaeten werden bevorzugt (weniger Fragmentierung)
- Ingest-Logik ist als Funktion extrahierbar (fuer FEATURE-1904 Synthese)
- Kein Cache der veralten kann -- Settings sind immer aktuell

### Negative
- User muss Settings pflegen (nicht nur Templates) -- aber Settings-UI macht es einfach
- Wenn `mocPropertyNames` leer ist, kann der Ingest keine Entitaeten zuordnen

### Risks
- **Falsche Zuordnung**: Agent ordnet Note falschem Thema zu. Mitigation: User bestaetigt alle Zuordnungen; Vorschlag-Akzeptanzrate als Qualitaetsmass.
- **Settings nicht konfiguriert**: User hat `mocPropertyNames` nicht gesetzt. Mitigation: Onboarding (FEATURE-1903) fragt danach; Default-Werte aus Default-Templates ableiten.

## Implementation Notes

- Bestehende `mocPropertyNames` Setting erweitern um `categoryProperty`, `summaryProperty`, `sourceNamingConvention`
- Ingest-Logik als `IngestService` Klasse (nicht nur Skill-Text), damit FEATURE-1904 sie nutzen kann
- Entitaets-Suche: OntologyStore.getClusterMembers() → SemanticSearch → GraphStore (Cascade)
- Settings-UI: Verbesserte Darstellung der Entity-Properties (Tags statt Komma-separierte Liste)
- Onboarding (FEATURE-1903) setzt Default-Werte fuer `mocPropertyNames` wenn leer

## Related Decisions

- ADR-065: Ontologie-Schema (Cluster-basiert, fuer Entitaets-Zuordnung)
- FEATURE-1903: Template-Onboarding (setzt Default-Werte in Settings)
- FEATURE-1904: Synthese → Zettel (nutzt Ingest-Logik als Funktion)
- FEATURE-1502: Graph Extraction (bestehende `mocPropertyNames`)
