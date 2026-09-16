# Knowledge-base scale: research benchmarks and regulated domains

This note puts numbers behind the phrase "realistic scale." It compares the
knowledge used by common knowledge-base question-answering (KBQA) benchmarks
with public proxies for banking, pharmaceuticals, and telecom. It is a sizing
note, not a claim that any public dataset is a deployable enterprise knowledge
base.

The short answer is that **raw entity count is not the main discontinuity**.
The research benchmarks already sit over a very large graph, but their question
sets touch small, mostly static slices. A regulated deployment adds obligations
that are weakly represented by those benchmarks: designated authority,
effective dates, versions that must remain replayable, jurisdiction, customer
scope, negative completeness, and a safe answer when the complete support set
was not retrieved.

All web counts below were checked on 2026-09-16. Counts that we derived from a
download name the artifact and method so that they can be reproduced.

## 1. What is being counted

"Entities and relationships" hides three different scale measures. They must
not be put in one column without labels:

1. **Instance scale** — entity records and relationship assertions (graph
   nodes and edges, database rows, labels, or documents).
2. **Schema scale** — entity types, relation or property types, fields, and
   constraints. This approximates the semantic vocabulary the router and
   verifier must understand.
3. **Question scale** — how much of that graph a benchmark actually exercises:
   unique entities and relations mentioned, logical-form diversity, joins or
   hops, and operators such as count or comparison.

A fourth measure, more important in production, is **change scale**: versions,
update cadence, conflicting authorities, and the number of old decisions that
must still replay. None of the headline benchmark entity counts captures it.

## 2. Prior KBQA research

The benchmark slice is much smaller than the graph beneath it.

| Corpus | Questions | Entities exercised | Relation vocabulary | Structural complexity |
| --- | ---: | ---: | ---: | --- |
| WebQSP | 4,737 | 2,461 | 628 | 34 logical-form skeletons; questions are at most two hops in the GSR preprocessing |
| ComplexWebQuestions (CWQ) | 34,689 | 11,422 | 845 | 174 skeletons; up to four-hop questions |
| GrailQA | 64,331 | 32,585 | 3,720 relations and 1,534 types | 4,969 canonical logical forms across 86 domains; up to four relations plus count, comparative, and superlative operators |

The WebQSP and CWQ counts come from the dataset statistics in
[ChatKBQA](https://aclanthology.org/2024.findings-acl.122/). The GrailQA counts
come from the dataset table in
[GrailQAbility](https://aclanthology.org/2023.acl-long.576/) and the
[GrailQA project description](https://dki-lab.github.io/GrailQA/). "Entities
exercised" means entities appearing in the benchmark questions or logical
forms, not every entity available to retrieval.

All three use Freebase-derived knowledge. The archived
[official Freebase dump](https://developers.google.com/freebase) is roughly
1.9 billion RDF triples (22 GB compressed, 250 GB uncompressed). Google also
warns that it is historical, no longer maintained, and may be inaccurate. The
important ratio is therefore not "4,737 questions over 2,461 entities." It is
a few thousand question-linked entities and hundreds of predicates selected
from a billion-triple substrate.

### What the retrieval numbers mean

[GSR](https://aclanthology.org/2024.findings-emnlp.927/) reports subgraph
retrieval recall of **85.5% on WebQSP and 72.3% on CWQ** for its base model.
Its best reported end-to-end configuration reaches F1 **80.1 on WebQSP and
64.4 on CWQ**. The paper also states an important experimental advantage: the
topic entity is assumed to be known, which is often not true in a customer
conversation.

[ChatKBQA](https://aclanthology.org/2024.findings-acl.122/) reports strict
accuracy of **73.8 on WebQSP and 73.3 on CWQ** without oracle entity linking.
Its WebQSP error analysis attributes 27.17% of failures to entity retrieval
and 19.48% to relation retrieval, in addition to logical-form and conversion
errors.

For a consumer search product, a 70–85% retrieval result can be an interesting
research result. For a regulated assistant it exposes a hard availability
ceiling: if the complete proof bundle is absent, a sound system must ask,
route, or abstain. It must not let the generator fill the gap. The 72.3%
subgraph-retrieval result therefore leaves a 27.7-point retrieval gap under
that paper's metric. That gap must not be naively equated with a 27.7%
question-failure rate, but any missing certified support can fail the request
*before answer generation*.

These numbers also understate the production problem. Benchmark relations are
stable identifiers; enterprise users name aliases, old product names, account
suffixes, brands, jurisdictions, and effective dates. "Right fact, wrong
entity/version" can be perfectly faithful to the retrieved subgraph and still
be operationally wrong.

## 3. Public scale proxies for regulated industries

There is no defensible universal number for "a bank KB" or "a pharma KB."
Each row below is a named public proxy with a different purpose. The point is
to bound orders of magnitude and expose the missing dimensions, not to pretend
that unlike datasets are interchangeable.

| Domain and proxy | Instance scale | Schema or relationship scale | What makes the operational problem harder |
| --- | --- | --- | --- |
| Banking — GLEIF legal-entity graph | 3,231,144 LEI records; 2,990,623 active entities | 136,729 parent relationships plus 154,401 fund relationships (291,130 total) | Entity lifecycle, ownership exceptions, corroboration, jurisdiction, and history |
| Banking — FIBO production ontology | An ontology, not customer/account instances | 2,247 named classes; 588 object properties; 175 datatype properties; 2,547 restrictions across 223 Turtle modules | A broad financial semantic model, quarterly releases, inference and constraint semantics; a bank still has to map its products, documents, customers, and policies into it |
| Pharma — customer-facing drug labels | DailyMed exposes 159,179 current/in-use labeling submissions; openFDA reports 262,595 drug-label records | The FDA openFDA label schema has 179 top-level fields, including a nested 24-field identifier/classification block | Label version and status, product/NDC/RxCUI/ingredient joins, route and population qualifiers, contraindications, warnings, provenance, and incomplete source coverage |
| Pharma — research knowledge (ChEMBL) | ChEMBL 36 has 2.8 million distinct compounds and 17,803 targets | An official training page reports more than 18 million compound-effect records in an earlier release, a lower bound on relationship volume rather than a current-release count | Assay context, target identity, units and uncertainty; this is valuable discovery evidence but is not the authority for an approved customer-facing drug claim |
| Telecom — TM Forum information/API model | A schema suite, not subscriber or network instances | A public repository snapshot contains 1,099 schema files (1,093 unique names) and 2,821 cross-schema references across ten schema directories; TM Forum now reports 100+ Open APIs | Product-service-resource decomposition, inventory and order state, legacy mappings, API version coexistence, and cross-domain joins |
| Telecom — FCC broadband fabric | Approximately 114 million U.S. broadband-serviceable locations representing 163 million units in the June 2024 fabric | Availability overlays relate providers, locations, technology, and advertised speeds; the FCC does not publish one comparable total edge count in the cited order | Location identity is challenged and revised; providers file twice yearly; effective vintage matters; enterprise and mass-market locations differ |

### Banking sources and measurement

The February 2026
[GLEIF Global LEI Data Quality Report](https://www.gleif.org/lei-data/gleif-data-quality-management/quality-reports/download-data-quality-report-february-2026/2026-03-06-lei-data-quality-report-february-2026.pdf)
provides the instance and relationship counts. It also reports 235 countries,
39 LEI issuers, and 87.64% fully corroborated records — a useful reminder that
even a governed global identifier system represents evidence quality
explicitly rather than assuming every record is equivalent.

[FIBO](https://edmcouncil.org/frameworks/industry-models/fibo/) is an
industry ontology, expressed in RDF/OWL and released quarterly. We downloaded
the official
[production Turtle archive](https://spec.edmcouncil.org/fibo/ontology/master/latest/prod.ttl.zip)
dated 2026-09-12. The counts above are unique named subjects immediately
declared as `owl:Class`, `owl:ObjectProperty`, `owl:DatatypeProperty`, plus
occurrences of `owl:Restriction`; anonymous restrictions are constraints, not
instance edges. These are ontology-breadth numbers. They say nothing about how
many accounts, transactions, product variants, documents, or dated terms one
bank would load.

### Pharma sources and measurement

[DailyMed](https://dailymed.nlm.nih.gov/dailymed/) says its count is labeling
submitted to FDA and currently in use, and explicitly says it is not a
complete listing of all FDA-regulated product labeling. The
[openFDA statistics page](https://open.fda.gov/about/statistics/) uses a
different record boundary, so its count must not be treated as a duplicate
measurement of the same entity set.

The field count is from FDA's
[`druglabel_schema.json`](https://github.com/FDA/openfda/blob/a8455760dc4f3a25b8362ed6e7b866399982d271/schemas/druglabel_schema.json)
at commit `a845576`; `jq '.properties | length'` gives 179 and
`jq '.properties.openfda.properties | length'` gives 24. The schema revision
is older than the live record count; it is a reproducible lower-fidelity proxy
for semantic breadth, not a claim that the live API has never evolved.

The current compound and target counts come from the
[ChEMBL 36 release announcement](https://www.ebi.ac.uk/about/news/updates-from-data-resources/chembl-36/).
The more-than-18-million activity figure comes from EMBL-EBI's
[ChEMBL training description](https://www.ebi.ac.uk/training/online/courses/chembl-quick-tour/what-is-chembl/)
and is intentionally labelled as an older lower bound.

### Telecom sources and measurement

TM Forum describes the current
[Information Framework (SID)](https://www.tmforum.org/open-digital-architecture/information-framework-sid/)
as ten business domains and says business entities carry attributes and
relationships. Its current
[Open API page](https://www.tmforum.org/oda/open-apis) reports more than 100
APIs. To obtain a reproducible schema count, we measured the older public
[`Open_Api_And_Data_Model`](https://github.com/tmforum-apis/Open_Api_And_Data_Model/tree/cf5770b2ecafb2c8ae15a931ae8351fa04db467e)
snapshot: `find` yields 1,099 `*.schema.json` files and `rg` yields 2,821
`$ref` occurrences within them. The snapshot predates the current v26 SID and
is a public lower-bound/proxy, not a count of the member-only current model.

The FCC's 114-million-location and 163-million-unit figures are in its
[January 2025 order on the Broadband Serviceable Location Fabric](https://docs.fcc.gov/public/attachments/DA-25-32A1_Rcd.pdf).
The FCC describes each location as a versioned identifier and releases an
updated fabric for each semiannual filing round. That is closer to an
enterprise operational graph than a QA benchmark: identity, reported service,
and corrections all vary with time.

## 4. Where this prototype sits

The Center snapshot contains **384 primary entity records**: 151 species, 163
moves, and 70 items. Its principal explicit relationship assertions are:

| Relationship family | Assertions |
| --- | ---: |
| Species → move learnset entries | 4,128 |
| Species → evolution | 77 |
| Species → type membership | 213 |
| Species → encounter area | 545 |
| Attacking type → defending type multiplier | 225 |
| **Total across these five families** | **5,188** |

That is about six times smaller than WebQSP's exercised entity set and roughly
three to five orders of magnitude below most public industry instance proxies.
More important, its ambiguity, authority, and change surfaces are deliberately
small: one designated source, one era, a closed fact grammar, and mostly
one-hop lookups plus deterministic aggregates.

It is therefore a good proof of the enforcement mechanism and a poor proof of
large-domain recall. The project should say both without apology.

## 5. The comparative conclusion

The evidence suggests five conclusions for the research programme:

1. **WebQSP is not a scale test for enterprise curation.** It is a semantic
   parsing and retrieval test over 2,461 question-linked entities and 628
   relations, even though its substrate is enormous.
2. **CWQ and GrailQA stress composition more credibly.** Four-hop queries,
   thousands of relation types, and compositional splits are useful tests of
   routing. They still do not test designated authority, effective-time
   correctness, or governed updates.
3. **Industry instance scale is already millions to hundreds of millions.**
   The public proxies range from 3.2 million legal entities to 159 thousand
   live label submissions, 2.8 million compounds, and 114 million serviceable
   locations.
4. **Industry schema scale is not necessarily larger than GrailQA, but it is
   more consequential.** FIBO has thousands of classes and hundreds of
   properties; the measured telecom model has about a thousand schemas. The
   difficult part is selecting the correct product, version, jurisdiction,
   customer, and authority — not merely traversing another edge.
5. **A zero-error architecture turns retrieval misses into availability
   losses.** That is the right failure mode, but 70% recall would still be a
   bad product. The research target must therefore be two-dimensional: zero
   invalid commits *and* high demand-weighted stable resolution.

## 6. A scale ladder for this project

The next tests should not jump directly from 384 records to "all enterprise
knowledge." They should increase independent axes and preserve the guarantee
at every step. These are proposed load-test tiers, not estimates of a typical
company:

| Tier | Primary entities | Relationship assertions | Schema | Query/change stress |
| --- | ---: | ---: | ---: | --- |
| Current forge | 384 | 5.2k measured families | roughly tens of predicates | one-hop lookup, deterministic aggregate, two frozen worlds |
| Catalogue test | 10k | 100k+ | 100+ relation/field types | aliases, top-k nomination, two-hop joins, dated facts |
| Portfolio test | 100k–1m | 1m–10m | 500+ types | four-hop proof bundles, jurisdiction and customer scope, rolling versions |
| Federated test | 10m+ | 100m+ | several governed source schemas | source precedence, delta certification, hot/cold versions, recorded semantic retrieval |

At every tier, report a funnel rather than one accuracy number:

- demand inside the declared assurance envelope;
- answer-support recall@k — whether the complete proof bundle was nominated;
- entity-and-version binding accuracy;
- routing accuracy given complete support;
- stable resolution, clarification, and abstention rates;
- invalid commits, which remain exactly zero;
- snapshot age, changed facts, review queue, and replay failures.

This makes the curation thesis falsifiable. If complete-support recall cannot
approach the product's required resolution rate without an impractical review
queue, latency, or index size, then the enrolled assurance envelope is too
broad. Narrow it by claim family, product, jurisdiction, and time — or reject
the deployment. Do not average that failure away with a fluent answer model.
