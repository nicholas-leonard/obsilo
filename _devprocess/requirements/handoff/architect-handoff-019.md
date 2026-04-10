# Architect Handoff: EPIC-019 Knowledge Maintenance

> **Epic**: EPIC-019
> **BA**: _devprocess/analysis/BA-019-knowledge-maintenance.md
> **Erstellt**: 2026-04-08
> **Status**: Ready for Architecture

---

## 1. ASR Summary (alle Features aggregiert)

### Critical ASRs (brauchen ADRs)

| ASR | Feature | Quality Attribute | Beschreibung |
|-----|---------|-------------------|-------------|
| ASR-1 | FEATURE-1900 | Flexibility | **Schema-Erkennung aus Templates**: Skill muss mit beliebigen User-Templates arbeiten, Properties dynamisch erkennen |
| ASR-2 | FEATURE-1900 | Correctness | **Entitaets-Zuordnung**: Bestehende Entitaeten bevorzugen vs. neue erstellen -- Qualitaet der Vorschlaege |
| ASR-3 | FEATURE-1901 | Performance | **Lint als Feature vs. Tool**: Dediziertes vault_health_check Tool vs. Skill mit bestehenden Tools |
| ASR-4 | FEATURE-1901 | Usability | **Badge-UI + Event-Listener**: Automatischer Trigger bei Vault-Open, Badge im UI |
| ASR-5 | FEATURE-1902 | Performance | **Ontologie-Schema**: DB-Tabellen-Design fuer transitive Traversals |
| ASR-6 | FEATURE-1902 | Correctness | **Ontologie-Befuellung**: Aus Vault-Daten vs. LLM-unterstuetzt |
| ASR-7 | FEATURE-1905 | Quality/Privacy | **OCR-Provider-Auswahl**: Chandra vs. Alternativen -- Qualitaet, Kosten, Privacy |

### Moderate ASRs

| ASR | Feature | Quality Attribute | Beschreibung |
|-----|---------|-------------------|-------------|
| ASR-8 | FEATURE-1903 | Usability | Template-Speicherort (Vault vs. Plugin-Verzeichnis) |
| ASR-9 | FEATURE-1903 | Correctness | Sprach-Handling bei Properties (DE Properties + EN Prompts) |
| ASR-10 | FEATURE-1904 | Usability | Button-Placement und Chat-UI-Integration |
| ASR-11 | FEATURE-1904 | Maintainability | Wiederverwendung der Ingest-Logik als Funktion |
| ASR-12 | FEATURE-1906 | Data Integrity | Link-Integritaet bei Attachment-Umbenennung |
| ASR-13 | FEATURE-1905 | Correctness | Markdown-Output-Format nach OCR |

---

## 2. NFR Summary (quantifiziert)

### Performance

| Metrik | Target | Feature |
|--------|--------|---------|
| Ingest-Laufzeit | <30s pro Note | FEATURE-1900 |
| Lint-Scan | <5s fuer 1000 Notes (0 LLM-Tokens) | FEATURE-1901 |
| Ontologie-Query | <100ms transitive Lookup | FEATURE-1902 |
| Ontologie-Update | <500ms pro Ingest | FEATURE-1902 |
| Synthese-Generierung | <10s Klick-to-Editor | FEATURE-1904 |
| OCR-Konvertierung | <30s pro PDF-Seite | FEATURE-1905 |
| Namensableitung | <2s pro Datei (Haiku) | FEATURE-1906 |

### Token-Kosten

| Feature | Tokens/Call | Modell | Trigger |
|---------|------------|--------|---------|
| Ingest | ~4k | Chat-Modell | User-explizit |
| Lint (Scan) | 0 | Keins | Automatisch |
| Lint (Fixes) | ~2-5k | Chat-Modell | User-Klick |
| Synthese | ~3k | Chat-Modell | Button-Klick |
| Umbenennung | ~200/Datei | Haiku | User-explizit |
| OCR | extern | Chandra API | User-explizit |

### Security

- Kein Schreiben ohne User-Bestaetigung (alle Features)
- API-Key fuer OCR via SafeStorageService
- Path-Traversal-Validierung bei Template-Pfaden
- Datenschutz-Hinweis bei erstem OCR-Call (Daten verlassen Geraet)
- Review-Bot Compliance: kein innerHTML, CSS-Klassen, kein inline style

### Scalability

- Vault-Groesse: 1000-5000+ Notes
- Batch-Umbenennung: 100+ Dateien pro Durchlauf
- Ontologie: Unbegrenzte Cluster-Anzahl, Top-N fuer Retrieval

---

## 3. Constraints

| Constraint | Begruendung | Impact |
|------------|-------------|--------|
| Skill-basiert (kein Hintergrund-Agent) | Token-Kosten, User-Kontrolle | Ingest + Rename sind Skills, kein Auto-Trigger |
| Template-gesteuert (nicht Settings) | User editiert .md direkt | Kein Property-Editor in Settings |
| Obsidian Review-Bot | Plugin muss Review bestehen | CSS-Klassen, kein innerHTML, vault.configDir |
| Bestehende Infrastruktur nutzen | EPIC-015 steht, keine Aenderungen | SemanticIndex, GraphStore, KnowledgeDB bleiben ungeaendert |
| Bestaetigung vor Schreibzugriff | User-Kontrolle ueber Wissensnetz | Trockenlauf oder Batch-Bestaetigung |

---

## 4. Feature-Dependency-Graph

```
FEATURE-1903 (Onboarding)
    ↓ Template-Schema
FEATURE-1900 (Ingest Skill) ←→ FEATURE-1902 (Ontologie)
    ↓ Ingest-Logik                    ↑ Befuellung
FEATURE-1904 (Synthese)               |
    ↓ nutzt Ingest-Logik              |
FEATURE-1905 (OCR) ──────────────────→|
    ↓ Sub-Schritt von Ingest          |
FEATURE-1906 (Rename) ──────────────→ |
                                      |
FEATURE-1901 (Lint) ─────────────────→  (liest Ontologie)

FEATURE-1907 (UI Polish) -- unabhaengig, parallel ausfuehrbar
```

### Empfohlene Reihenfolge

1. **FEATURE-1903** (Onboarding) -- Voraussetzung fuer Schema-Erkennung
2. **FEATURE-1902** (Ontologie) -- Infrastruktur-Basis
3. **FEATURE-1900** (Ingest) -- Kern-Feature, nutzt 1903 + 1902
4. **FEATURE-1901** (Lint) -- Nutzt 1902, unabhaengig von 1900
5. **FEATURE-1904** (Synthese) -- Nutzt Ingest-Logik aus 1900
6. **FEATURE-1905** (OCR) -- Sub-Feature von 1900
7. **FEATURE-1906** (Rename) -- Eigenstaendiger Skill
8. **FEATURE-1907** (UI Polish) -- Parallel zu allem

---

## 5. Open Questions fuer Architekt

### Architektur-Entscheidungen (brauchen ADRs)

1. **Ontologie-Schema**: Hierarchisch (Parent-Child) oder flach (Cluster)? Wie interagiert es mit bestehendem Graph Expansion?
2. **OCR-Provider**: Chandra OCR vs. Tesseract WASM (lokal) vs. Hybrid?
3. **Lint-Tool**: Dediziertes `vault_health_check` Tool oder Skill mit bestehenden Tools?
4. **Template-System**: Templates im Vault (User-sichtbar) oder im Plugin-Verzeichnis?

### Technische Fragen

5. Wie wird die Ingest-Logik als wiederverwendbare Funktion extrahiert (fuer Synthese-Button)?
6. Ontologie-Bootstrapping: Kann sie initial aus MOC-Properties + ImplicitEdges befuellt werden (ohne LLM)?
7. Badge-UI: Wo im UI? Sidebar-Header? Status-Bar? Notification?
8. Minimum-Breite Sidebar: Fester Wert oder dynamisch?
9. Task-Anlage bei "spaeter": Obsidian-URI, TaskNotes-API oder eigenes Task-System?

---

## 6. Bestehende Architektur-Referenzen

| Artefakt | Relevanz |
|----------|----------|
| ADR-050: SQLite Knowledge DB | Basis fuer Ontologie-Tabelle |
| ADR-051: 4-Stufen Retrieval Pipeline | Ontologie als 5. Stufe? |
| FEATURE-1502: Graph Extraction & Expansion | mocPropertyNames, GraphStore |
| FEATURE-1503: Implicit Connections | Datenquelle fuer Ontologie-Bootstrapping |
| FEATURE-1505: Knowledge Data Consolidation | KnowledgeDB Schema-Erweiterung |
