# Plan Context: EPIC-020 Graph Intelligence

> **Purpose:** Technische Zusammenfassung fuer Claude Code
> **Created by:** Architect
> **Date:** 2026-04-11

---

## Technical Stack

**Runtime:**
- Language: TypeScript (strict)
- Framework: Obsidian Plugin API
- Build: esbuild
- Runtime: Electron (via Obsidian)

**Knowledge Layer:**
- Database: sql.js (SQLite WASM) -- `knowledge.db`
- Graph: GraphStore (edges + tags tables)
- Vectors: VectorStore (Float32Array BLOBs)
- Ontology: OntologyStore (entity clusters, hub/member roles)
- Implicit Connections: ImplicitConnectionService (cosine similarity)
- NEW: graphology + graphology-communities-louvain (Community Detection)

**AI APIs:**
- Embedding: Configurable (OpenAI, OpenRouter, local)
- Chat: Anthropic SDK, OpenAI SDK
- No LLM calls in retrieval path (computation only)

## Architecture Style

- Pattern: Plugin Monolith (Obsidian Plugin API constraint)
- Key Quality Goals:
  1. **User Agency:** System suggests, user decides. No autonomous linking.
  2. **Retrieval Quality:** Confidence-weighted expansion + cluster-aware ranking
  3. **Performance:** Graph analysis <5s for 1000 notes, retrieval <100ms extra
  4. **Token Efficiency:** Deterministic computation where possible, LLM only for semantic decisions

## Key Architecture Decisions (ADR Summary)

| ADR | Title | Vorgeschlagene Entscheidung | Impact |
|-----|-------|-----------------------------|--------|
| ADR-069 | Confidence Storage | `edges` table + `confidence REAL DEFAULT 1.0` column | High |
| ADR-070 | Community Detection Library | graphology + graphology-communities-louvain | High |
| ADR-071 | Retrieval Integration | RRF rank-boost (multiplicative confidence + additive cluster bonus) | High |

**Detail pro ADR:**

1. **ADR-069 Confidence Storage:** Add `confidence REAL DEFAULT 1.0` column to `edges` table.
   Explicit edges (wikilinks, frontmatter) = 1.0. Implicit edges use existing `similarity` as confidence.
   `GraphNeighbor` interface gets unified `confidence: number` field.
   - Rationale: Minimal migration (ALTER TABLE + DEFAULT), zero overhead, SQL-queryable

2. **ADR-070 Community Detection:** Use `graphology` + `graphology-communities-louvain`.
   Louvain is sufficient for PKM graphs. Small bundle (~20KB). Recursive splitting of oversized communities.
   Results stored in OntologyStore with `source='louvain'`.
   - Rationale: Established library, ESM-compatible, covers future graph metrics needs

3. **ADR-071 Retrieval Integration:** Confidence as multiplicative RRF rank-boost:
   `boosted_score = rrf_score * (0.5 + 0.5 * confidence)`. Cluster membership as additive bonus (+0.05).
   Hub-context anchoring for broad queries. Feature-flagged for A/B testing.
   - Rationale: Minimal pipeline change, graceful degradation, testable

## Data Model (Core Entities)

```
edges (EXISTING -- extend)
  source_path: TEXT
  target_path: TEXT
  link_type: TEXT ('body' | 'frontmatter')
  property_name: TEXT | null
  confidence: REAL DEFAULT 1.0  <-- NEW

implicit_edges (EXISTING -- no change)
  source_path: TEXT
  target_path: TEXT
  similarity: REAL  <-- used as confidence
  computed_at: TEXT

ontology (EXISTING -- extend source values)
  entity_path: TEXT
  cluster: TEXT
  role: TEXT ('hub' | 'member' | 'bridge')
  confidence: REAL
  source: TEXT ('moc' | 'implicit' | 'ingest' | 'louvain')  <-- NEW value
  updated_at: TEXT

note_freshness (NEW)
  path: TEXT PRIMARY KEY
  freshness_class: TEXT ('volatile' | 'evolving' | 'stable' | 'manual')
  temporal_marker_count: INTEGER DEFAULT 0
  classified_at: TEXT

dismissed_freshness (NEW)
  note_path: TEXT
  hint_type: TEXT ('staleness' | 'inconsistency' | 'missing-connection')
  dismissed_at: TEXT
  UNIQUE(note_path, hint_type)

GraphNeighbor (TypeScript interface -- extend)
  path: string
  hopDistance: number
  viaPath: string
  linkType: string
  propertyName: string | null
  confidence: number  <-- NEW
```

## External Integrations

| System | Type | Protocol | Purpose |
|--------|------|----------|---------|
| graphology | Internal | JS import | Graph construction + Louvain clustering |
| OntologyStore | Internal | SQL | Cluster storage + query |
| VaultHealthService | Internal | Method call | God-node check integration |
| SemanticSearchTool | Internal | Method call | Confidence-weighted expansion |
| WebSearchTool | Internal | requestUrl | Optional: new development detection (FEATURE-2006) |

## Performance & Security

**Performance:**
- Confidence assignment: Zero overhead (inline during GraphExtractor.updateEdges)
- Community detection: <5s for 1000 notes, <1s for 500 notes
- God-node degree: <1s for 5000 edges (SQL COUNT)
- Retrieval boost: <100ms additional (in-memory score adjustment)
- Batch pre-scan: <10s for 100 files
- Freshness scan: <30s for 1000 notes

**Cost:**
- Batch ingest: <$0.15/note (entity cache reduces redundant searches)
- Cluster naming: 1 LLM call per cluster (cached)
- Freshness scan: ~$0.05 per full vault scan (Stage 0-3 free, Stage 4-5 batched)
- Retrieval: Zero additional LLM cost (computation only)

**Security:**
- No new external APIs (graphology is a local JS library)
- No new network calls in retrieval path
- Batch ingest uses existing checkpoint/undo for data safety
- Freshness hints are read-only on existing notes (inbox output only)

---

## Implementation Order

```
Phase 1: FEATURE-2001 (Confidence Scoring)
  - ALTER TABLE edges ADD COLUMN confidence REAL DEFAULT 1.0
  - GraphExtractor sets confidence on write
  - GraphNeighbor interface extended
  - DB version bump (v4)

Phase 2: FEATURE-2002 (Community Detection)
  - npm install graphology graphology-communities-louvain
  - New: CommunityDetectionService.ts
  - GraphStore edges -> graphology Graph -> louvain -> OntologyStore
  - LLM cluster naming (cached)
  - Conversational presentation in chat

Phase 3: FEATURE-2003 + FEATURE-2004 (parallel)
  - God-Node: Degree calculation + VaultHealthService check type
  - Retrieval: Confidence-weighted expansion + cluster bonus in SemanticSearchTool

Phase 4: FEATURE-2005 + FEATURE-2006 (parallel)
  - Batch Ingest: Orchestration skill + entity cache
  - Knowledge Freshness: Staleness + missing connections + new developments
```

## Kontext-Dokumente fuer Claude Code

Claude Code sollte folgende Dokumente als Kontext lesen:

1. `_devprocess/architecture/ADR-069-confidence-storage.md`
2. `_devprocess/architecture/ADR-070-community-detection-library.md`
3. `_devprocess/architecture/ADR-071-retrieval-integration.md`
4. `_devprocess/requirements/features/FEATURE-200*.md` (alle 6 Features)
5. `_devprocess/requirements/epics/EPIC-020-graph-intelligence.md`
6. `_devprocess/analysis/BA-011-graph-intelligence.md`

**Code Review Findings (2026-04-12):**
- `getNeighbors()` only queries `edges` table -- implicit_edges are invisible to retrieval. Needs new `getNeighborsWithImplicit()` method.
- Graph expansion happens AFTER RRF fusion (post-processing), not within RRF. Confidence boost is a score modifier in expansion, not an RRF channel.
- Enrichment response parsing is plain text concat -- needs regex extraction for `<freshness>` tag with fallback.
- DB schema version is currently 6 -- will bump to 7 for confidence column + freshness tables.

Existing code to understand before implementing:
- `src/core/knowledge/GraphStore.ts` -- Edge storage + BFS expansion
- `src/core/knowledge/GraphExtractor.ts` -- Wikilink + frontmatter extraction
- `src/core/knowledge/OntologyStore.ts` -- Cluster storage + hub roles
- `src/core/knowledge/KnowledgeDB.ts` -- Schema definition + migration
- `src/core/knowledge/VaultHealthService.ts` -- Health check pipeline
- `src/core/knowledge/ImplicitConnectionService.ts` -- Cosine similarity edges
- `src/core/semantic/SemanticIndexService.ts` -- Search pipeline
- `src/core/tools/vault/SemanticSearchTool.ts` -- Search tool interface
- `bundled-skills/knowledge-ingest/SKILL.md` -- Ingest workflow
