# Plan Context: EPIC-019 Knowledge Maintenance

> **Purpose:** Technische Zusammenfassung fuer Claude Code
> **Created by:** Architect
> **Date:** 2026-04-08

---

## Technical Stack

**Runtime:**
- Language: TypeScript (strict)
- Framework: Obsidian Plugin API
- Build: esbuild mit Deploy-Plugin
- Runtime: Electron (via Obsidian)

**Data Layer:**
- Database: sql.js WASM (SQLite, ADR-050)
- Existing Tables: vectors, edges, tags, implicit_edges, dismissed_pairs, checkpoint
- New Table: ontology (ADR-065)
- Storage: vault.adapter (writeBinary/readBinary)

**AI/ML:**
- Chat: Anthropic SDK, OpenAI SDK (konfigurierbar)
- Embeddings: qwen3-embedding-8b via OpenRouter
- Batch-Rename: Haiku (kleines Modell)
- OCR: Chandra OCR API (extern, opt-in)

**Existing Infrastructure (EPIC-015, nicht aendern):**
- SemanticIndexService: Vektor-Index mit Contextual Retrieval
- GraphStore: Wikilink + MOC-Property Graphen
- GraphExtractor: Automatische Link-/Property-Extraktion
- ImplicitConnectionService: Paarweise Cosine-Similarity
- KnowledgeDB: SQLite-Wrapper mit Schema-Migrations
- VectorStore: Float32Array BLOB Cosine-Similarity

## Architecture Style

- Pattern: Modular Monolith (Obsidian Plugin)
- Key Quality Goals:
  1. **User-Kontrolle**: Kein Schreiben ohne Bestaetigung
  2. **Token-Effizienz**: 0 Tokens fuer Scans, minimal fuer Aktionen
  3. **Graceful Degradation**: Jedes Feature funktioniert ohne die anderen

## Key Architecture Decisions (ADR Summary)

| ADR | Title | Vorgeschlagene Entscheidung | Impact |
|-----|-------|-----------------------------|--------|
| ADR-065 | Ontologie-Schema | Cluster-basiert (flach, Multi-Zugehoerigkeit) | High |
| ADR-066 | Ingest-Strategie | mocPropertyNames aus Settings, Cascade-Zuordnung | High |
| ADR-067 | Lint-Architektur | vault_health_check Tool + VaultHealthService + Badge | High |
| ADR-068 | OCR-Provider | Hybrid: pdfjs-dist primary, Chandra OCR Fallback | Medium |

**Detail pro ADR:**

1. **ADR-065 Ontologie-Schema:** Neue `ontology` Tabelle in KnowledgeDB mit Cluster-Zugehoerigkeit (entity_path, cluster, role, confidence, source). Multi-Zugehoerigkeit statt Baum. Bootstrapping aus MOC-Properties (kein LLM). Transitiver Lookup via `WHERE cluster IN (...)`.
   - Rationale: Multi-Zugehoerigkeit passt zum Zettelkasten, Bootstrapping kostet 0 Tokens

2. **ADR-066 Ingest-Strategie:** Bestehende `mocPropertyNames` Settings als Entitaets-Definition (nicht Templates). Verbesserte Settings-UI. Entitaets-Zuordnung via Cascade (Ontologie → Semantic Search → GraphStore). Ingest-Logik als `IngestService` Klasse.
   - Rationale: Entitaet vs. Metadatum nicht aus Templates ableitbar, User muss explizit definieren. Bestehende Settings-Infrastruktur nutzen statt neue bauen.

3. **ADR-067 Lint-Architektur:** VaultHealthService (Hintergrund, DB-Queries bei Vault-Open) + vault_health_check Tool (Chat-nutzbar) + Badge-UI. 5 Checks als SQL-Queries.
   - Rationale: Automatischer Trigger braucht Service, 0 Token-Kosten braucht dediziertes Tool

4. **ADR-068 OCR-Provider:** pdfjs-dist bleibt primary. Chandra OCR als Fallback nur bei gescannten PDFs (kein Text-Layer erkannt). Opt-in Toggle, Kosten-Transparenz.
   - Rationale: 80%+ PDFs brauchen kein OCR, Chandra nur bei Bedarf

## Data Model (Core Entities)

```
ontology (NEU - ADR-065)
  entity_path: TEXT NOT NULL
  cluster: TEXT NOT NULL
  role: TEXT DEFAULT 'member'    -- 'hub', 'member', 'bridge'
  confidence: REAL DEFAULT 1.0
  source: TEXT NOT NULL           -- 'moc', 'implicit', 'ingest'
  updated_at: TEXT NOT NULL
  UNIQUE(entity_path, cluster)
  INDEX: idx_ontology_cluster, idx_ontology_entity

Settings-Erweiterung (NEU - ADR-066)
  mocPropertyNames: string[]        -- bereits vorhanden, = Entity Properties
  categoryProperty: string          -- NEU, z.B. "Kategorie"
  summaryProperty: string           -- NEU, z.B. "Zusammenfassung"
  sourceNamingConvention: string    -- NEU, z.B. "Autor-Jahr_Titel"

vault_health_findings (in Memory, nicht persistent)
  check: string
  severity: 'high' | 'medium' | 'low'
  paths: string[]
  suggestion: string
```

## External Integrations

| System | Type | Protocol | Purpose |
|--------|------|----------|---------|
| Chandra OCR API | Outbound | REST (requestUrl) | PDF-zu-Markdown OCR (opt-in) |
| TaskNotes Plugin | Outbound | Obsidian URI/API | Task-Anlage bei "spaeter" (optional) |
| Enhanced Canvas Plugin | Inbound | Obsidian Event | Wikilinks in Canvas-Notes (optional) |

## Performance & Security

**Performance:**
- Lint-Scan: <5s fuer 1000 Notes (reine DB-Queries)
- Ontologie-Query: <100ms transitive Lookup
- Ontologie-Update: <500ms pro Ingest
- Ingest-Laufzeit: <30s pro Note (LLM-Call + Vault-Queries)
- Synthese: <10s Klick-to-Editor
- Batch-Rename: <2s pro Datei (Haiku-Call)

**Token-Kosten (monatlich, typische Nutzung):**
- Ingest: 5x/Woche x 4k = 80k Tokens
- Lint (Fixes): 5x/Woche x 2k = 40k Tokens
- Synthese: 2x/Woche x 3k = 24k Tokens
- Rename: 1x/Monat x 5k = 5k Tokens
- Total: ~149k Tokens/Monat (~$0.04 Haiku, ~$0.45 Sonnet)

**Security:**
- Vault-Integritaet: Kein Schreiben ohne User-Bestaetigung
- API-Key: SafeStorageService (Chandra)
- Path-Traversal: Template-Pfad validieren
- Datenschutz: Expliziter Hinweis bei erstem OCR-Call
- Review-Bot: CSS-Klassen, kein innerHTML, requestUrl statt fetch

---

## Feature-Implementierungsreihenfolge

```
Phase 1 (Infrastruktur):
  FEATURE-1902 Ontologie               -- DB-Tabelle + Bootstrapping (Voraussetzung)
  FEATURE-1907 Chat UI Polish          -- Parallel, unabhaengig

Phase 2 (Kern-Features):
  FEATURE-1900 Ingest Skill            -- Nutzt mocPropertyNames + Ontologie
  FEATURE-1901 Vault Health Check      -- Nutzt Ontologie + GraphStore
  FEATURE-1903 Template-Onboarding     -- Parallel, setzt Settings-Defaults

Phase 3 (Erweiterungen):
  FEATURE-1904 Synthese → Zettel       -- Nutzt IngestService
  FEATURE-1905 OCR-Integration         -- Sub-Schritt von Ingest
  FEATURE-1906 Batch-Umbenennung       -- Eigenstaendiger Skill
```

Aenderung gegenueber Entwurf: FEATURE-1903 ist nicht mehr Voraussetzung fuer
FEATURE-1900 (kein Schema-Cache mehr, Settings werden direkt gelesen).
FEATURE-1903 setzt nur Default-Werte wenn mocPropertyNames leer ist.

## Neue Dateien (geschaetzt)

```
src/core/knowledge/OntologyStore.ts          -- Ontologie CRUD + Queries
src/core/knowledge/VaultHealthService.ts     -- Lint-Checks + Badge
src/core/tools/vault/VaultHealthCheckTool.ts -- Tool-Wrapper (ToolGroup: vault)
src/core/services/IngestService.ts           -- Wiederverwendbare Ingest-Logik
src/core/document-parsers/OcrService.ts      -- OCR-Interface
src/core/document-parsers/ChandraOcrProvider.ts -- Chandra-Implementation
src/ui/sidebar/VaultHealthBadge.ts           -- Badge-UI
src/ui/modals/OnboardingModal.ts             -- Template-Onboarding (Settings-Defaults)
src/ui/sidebar/SynthesisButton.ts            -- Chat-Button

Skills (als .skill.md in {pluginDir}/skills/):
  knowledge-ingest/SKILL.md                  -- Ingest-Skill Anleitung
  knowledge-rename/SKILL.md                  -- Batch-Rename Anleitung

Nicht mehr noetig (nach ADR-066 Review):
  ~~src/core/services/TemplateSchemaService.ts~~ -- Schema kommt aus Settings
```

## Settings (neue Eintraege)

```typescript
enableVaultHealthCheck: boolean;    // Lint bei Vault-Open
enableSynthesisButton: boolean;     // Synthese → Zettel Button
enableOcrIngest: boolean;           // Chandra OCR opt-in
chandraApiKey: string;              // SafeStorage
templateFolder: string;             // Aus Onboarding
templateLanguage: string;           // 'de' | 'en'
```

---

## Kontext-Dokumente fuer Claude Code

Claude Code sollte folgende Dokumente als Kontext lesen:

1. `_devprocess/architecture/ADR-065-ontologie-schema.md`
2. `_devprocess/architecture/ADR-066-ingest-strategy.md`
3. `_devprocess/architecture/ADR-067-lint-architecture.md`
4. `_devprocess/architecture/ADR-068-ocr-provider.md`
5. `_devprocess/requirements/features/FEATURE-190*.md` (alle 8 Features)
6. `_devprocess/requirements/epics/EPIC-019-knowledge-maintenance.md`
7. `_devprocess/analysis/BA-019-knowledge-maintenance.md`
8. `src/core/knowledge/KnowledgeDB.ts` (bestehendes Schema)
9. `src/core/knowledge/GraphStore.ts` (bestehende Graph-Logik)
10. `src/core/semantic/SemanticIndexService.ts` (bestehende Index-Logik)
