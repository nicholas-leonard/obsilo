# Architect Handoff: EPIC-020 Graph Intelligence

> **Epic**: EPIC-020
> **BA Reference**: _devprocess/analysis/BA-011-graph-intelligence.md
> **Features**: FEATURE-2001 through FEATURE-2006
> **Date**: 2026-04-11

---

## 1. Executive Context

Graph Intelligence extends Obsilo's knowledge graph with diagnostic and retrieval capabilities. Two value streams: (1) user-facing diagnostics (confidence scoring, cluster discovery, god-node warnings, batch ingest) and (2) agent-facing retrieval improvements (confidence-weighted expansion, cluster-aware ranking, hub-context anchoring).

Core design principle: **"Linking is thinking."** The system shows patterns and suggests improvements but never creates links autonomously. All structural changes require user confirmation.

---

## 2. Aggregated ASRs

### Critical ASRs

| ASR | Feature | Quality Attribute | Impact |
|-----|---------|-------------------|--------|
| Confidence computed inline during extraction (no separate pass) | 2001 | Performance | GraphExtractor must set confidence on write |
| Louvain algorithm must run in Obsidian renderer process (JS/WASM) | 2002 | Feasibility | Library selection critical |
| Cluster results stored in OntologyStore for cross-feature reuse | 2002 | Reusability | Schema extension needed |
| No additional LLM calls in retrieval path | 2004 | Performance, Cost | All retrieval improvements computation-based |
| Batch ingest reuses existing knowledge-ingest skill | 2005 | Maintainability | Orchestration layer, not reimplementation |
| Entity cache shared within batch, not persisted across sessions | 2005 | Correctness | In-memory only, LRU bounded |
| Knowledge freshness must not modify existing notes -- output is inbox review hints only | 2006 | Trust | write_file to inbox only, never edit_file on existing |
| Freshness classification piggybacks on existing enrichment pass -- no separate LLM calls | 2006 | Cost | Extend enrichChunkWithContext prompt, parse freshness tag from response |

### Moderate ASRs

| ASR | Feature | Quality Attribute |
|-----|---------|-------------------|
| VaultHealthService integration for god-node checks | 2003 | Maintainability |
| Backwards-compatible: retrieval works without cluster data | 2004 | Robustness |
| Thematic grouping uses Louvain clusters if available | 2005 | UX Quality |

---

## 3. Aggregated NFRs

### Performance

| Requirement | Feature | Target |
|-------------|---------|--------|
| Confidence assignment | 2001 | Zero overhead (inline during extraction) |
| Community detection | 2002 | <5s for 1000 notes, <1s for 500 notes |
| God-node degree calculation | 2003 | <1s for 5000 edges |
| Retrieval latency increase | 2004 | <100ms additional |
| Pre-scan phase | 2005 | <10s for 100 files |

### Scalability

| Requirement | Feature | Target |
|-------------|---------|--------|
| Edge volume | 2001, 2003 | 10,000+ edges |
| Graph size for clustering | 2002 | 10,000+ edges |
| Entity cache | 2005 | Max 1000 entries, LRU eviction |
| Batch size | 2005 | No artificial limit, groups of 5-15 |

### Cost

| Requirement | Feature | Target |
|-------------|---------|--------|
| Batch ingest per-note cost | 2005 | <$0.15/note (vs ~$0.20 individual) |
| No LLM calls in retrieval | 2004 | Zero additional LLM cost |
| Cluster naming | 2002 | 1 LLM call per cluster (cached) |

### Data Integrity

| Requirement | Feature | Target |
|-------------|---------|--------|
| Confidence migration | 2001 | Existing edges retroactively graded |
| Checkpoint per batch group | 2005 | Independent undo per group |
| Cluster persistence | 2002 | Stored in OntologyStore, survives restart |

---

## 4. Constraints

| Constraint | Source | Impact |
|------------|--------|--------|
| Obsidian Plugin API only | Platform | No custom graph viewer, no native graph extensions |
| Obsidian renderer process | Platform | All computation in main thread or Web Workers (no Node child processes for graph algorithms) |
| Review-Bot compliance | Community | All code must pass obsidianmd ESLint rules |
| No `fetch()` | Community | Use `requestUrl` from obsidian for any network calls |
| No `innerHTML` | Community | Use Obsidian DOM API |
| Existing DB schema (sql.js) | Architecture | SQLite via WASM, schema migrations via version bump |

---

## 5. Technology Decisions Needed

| Decision | Options | Recommendation | Feature |
|----------|---------|----------------|---------|
| Louvain JS implementation | graphology-communities-leiden, custom port, WASM | Investigate graphology first | 2002 |
| Confidence storage | Column in `edges` table vs. separate table | Column (simpler, queryable) | 2001 |
| OntologyStore cluster source | `source` field ('moc' vs 'leiden') | Extend existing `source` enum | 2002 |
| RRF confidence integration | Multiplicative boost vs. additive score | Needs experimentation | 2004 |
| Batch orchestration | New tool vs. new skill | Skill (orchestrates existing tools) | 2005 |
| Hub-context anchoring trigger | Automatic (agent detects broad query) vs. explicit | Start with explicit, evolve to automatic | 2004 |

---

## 6. Open Questions

### Architecture
1. Should Louvain run in a Web Worker to avoid blocking the UI thread?
2. How to handle the `graphology` library in esbuild bundling (CommonJS vs ESM)?
3. Incremental re-clustering: is delta-based update feasible or must Louvain run on full graph?
4. Should betweenness centrality be computed alongside degree? (O(n*m) vs O(m) complexity)

### Data Model
5. `implicit_edges` already has `similarity` -- is that effectively confidence, or do we need a separate column?
6. How to distinguish Louvain clusters from MOC clusters in OntologyStore? Separate `source` value?
7. DB migration strategy: ALTER TABLE or recreate?

### UX
8. How does the agent explain clusters conversationally? Pre-generated summaries or on-demand?
9. Batch ingest: should the agent ask "how do you want to handle this?" at the start?

---

## 7. Implementation Order (suggested)

```
Phase 1: FEATURE-2001 (Confidence Scoring)
         Foundation -- all other features depend on confidence data
         Effort: S (1-2 sprints)

Phase 2: FEATURE-2002 (Community Detection)
         Requires FEATURE-2001 for weighted clustering input
         Key risk: Louvain JS library availability
         Effort: M (3-5 sprints)

Phase 3: FEATURE-2003 (God-Node Analysis) + FEATURE-2004 (Retrieval Quality)
         Both depend on FEATURE-2001 + 2002
         Can be developed in parallel
         Effort: S + M

Phase 4: FEATURE-2005 (Batch Ingest) + FEATURE-2006 (Knowledge Freshness)
         Both benefit from FEATURE-2002 (clusters) but can work without
         Can be developed in parallel
         Effort: L + M
```

---

## 8. Existing Components to Extend

| Component | Path | Extension |
|-----------|------|-----------|
| GraphExtractor | `src/core/knowledge/GraphExtractor.ts` | Set confidence on edge write |
| GraphStore | `src/core/knowledge/GraphStore.ts` | Add `confidence` column, extend queries |
| OntologyStore | `src/core/knowledge/OntologyStore.ts` | Store Louvain clusters with source='leiden' |
| VaultHealthService | `src/core/knowledge/VaultHealthService.ts` | New check type: god-node |
| VaultHealthRepairModal | `src/ui/modals/VaultHealthRepairModal.ts` | Display god-node findings |
| SemanticSearchTool | `src/core/tools/vault/SemanticSearchTool.ts` | Confidence-weighted expansion, cluster boost |
| SemanticIndexService | `src/core/semantic/SemanticIndexService.ts` | Pass confidence to graph expansion |
| ImplicitConnectionService | `src/core/knowledge/ImplicitConnectionService.ts` | Preserve similarity as confidence |
| KnowledgeDB | `src/core/knowledge/KnowledgeDB.ts` | Schema migration for confidence column |
| Knowledge-ingest skill | `bundled-skills/knowledge-ingest/SKILL.md` | Batch mode extension |
| Settings | `src/types/settings.ts` | God-node threshold, batch settings |
| EmbeddingsTab | `src/ui/settings/EmbeddingsTab.ts` | New settings UI elements |
| KnowledgeDB | `src/core/knowledge/KnowledgeDB.ts` | Dismissal table for freshness hints |
| WebSearchTool | `src/core/tools/web/WebSearchTool.ts` | Optional: new development detection |

---

## 9. Risk Register (for Architecture Decisions)

| Risk | Feature | Mitigation | ADR Needed? |
|------|---------|-----------|-------------|
| No JS Louvain implementation available | 2002 | Fallback: Label Propagation or Louvain | Yes |
| graphology bundle too large | 2002 | Tree-shake or extract algorithm only | Maybe |
| Confidence not discriminative | 2004 | Use as filter (threshold) instead of weight | No |
| Batch ingest entity cache stale mid-batch | 2005 | Invalidate on stub note creation | No |
| Clustering noise on small graphs (<200 edges) | 2002 | Show "insufficient data" message | No |

---

## 10. Next Steps

```
Architect:
1. ADR for Louvain library selection (graphology vs. alternatives)
2. ADR for confidence storage model
3. ADR for retrieval integration pattern (RRF boost strategy)
4. Generate plan-context.md for Claude Code implementation

Then: /coding takes plan-context.md + Feature specs as input
```
