# Vendored data

Two certified worlds, both narrow checksummed projections of
[PokeAPI/api-data](https://github.com/PokeAPI/api-data) at the same pinned
commit. Worlds are versioned like the Accord pack: a filed record pins its
snapshot by digest, so an existing world is never edited — a new one is a
new file, and the old stays on the shelf for replay (IA-10).

- **`snapshots/kanto-red-blue.json`** — the original world: species, moves,
  the type chart. Frozen; the filed evidence base pins it.
- **`snapshots/kanto-center.json`** — the Center world (epic #94, slice 3):
  the same species/move projection plus the 70 generation-I non-machine
  items, joined at build time against the reviewed extraction sheet in
  `certification/center-items.v1.json`. Structured fields (category, cost,
  usability flags, effect text) come from upstream as data; era facts (what
  an item restores, cures, revives; repel steps; catch multipliers;
  stone evolutions; generation-I names) enter **only** from the sheet — a
  model may propose an extraction, a human certifies it in review, and the
  snapshot only ever contains certified values (generalization.md §4). The
  build refuses, by name: a sheet entry upstream does not carry, a
  generation-I item the sheet never reviewed, and a certification whose
  provenance sentence no longer matches upstream (stale review). The loader
  re-checks the vendored bytes against themselves: closed condition
  vocabulary, stone evolutions cross-checked against the species records'
  own edges, ids that collide with other entities.

`snapshots/kanto-red-blue.json` is the certified registry the kernel reasons
over (IA-2). It is a narrow, checksummed projection of
[PokeAPI/api-data](https://github.com/PokeAPI/api-data), pinned to one commit
and committed to this repository so that tests are deterministic, key-free,
and offline. `LICENSE.pokeapi` is the upstream BSD-3-Clause text, preserved
here as the NOTICE promises.

## Regenerating

```
npm run snapshot:fetch                       # rebuild from the pinned commit
npm run snapshot:fetch -- --world center     # rebuild the Center world (items)
npm run snapshot:fetch -- --check            # verify the vendored file, write nothing
npm run snapshot:fetch -- --commit <40-sha>  # re-pin to a different commit
```

`scripts/fetch-snapshot.ts` is the only code in the repository that touches
the network, and it never runs in CI. CI reads the vendored bytes.

The build is deterministic: the same upstream commit always yields the same
`contentDigest`, regardless of request scheduling. Two digests are recorded —
`contentDigest` over the certified content alone (id, scope, species, moves)
and `source.documentsDigest` over every upstream document consumed. The first
detects tampering with the snapshot; the second detects upstream drift even
when the projection happens to be unchanged.

## What is in it

One Pokédex, one version group: Kanto, Red/Blue, generation I. 151 species,
163 moves, built from 500 upstream documents. Per species: Pokédex number,
types, base stats, rarity flags, and the full Red/Blue learnset with method
and level. Per move: type, damage class, power, accuracy, PP, priority, and
the short effect text.

Deliberately excluded: artwork and sprites (never, under any circumstances),
flavour text, localisation, encounters, evolution chains, and every version
group after Red/Blue. The projection is closed — the kernel may assert what
is written here and nothing else. A question the snapshot cannot answer is
not "unknown", it is unprovable, and it is refused.

## What the snapshot does and does not certify

Version pinning is applied where upstream supports it, and stated plainly
where it does not. The same list is carried inside the file under
`source.caveats`, so a snapshot separated from this README still declares its
own limits.

| Fact | Pinned to Red/Blue? | How |
| --- | --- | --- |
| Types | yes | upstream `past_types` (Magnemite is Electric, not Electric/Steel; Clefairy is Normal, not Fairy) |
| Move legality | yes | learnset entries scoped to the `red-blue` version group |
| Move power, accuracy, PP, type | yes | upstream `past_values` (Selfdestruct is 130 power, not 200; Explosion 170, not 250) |
| Base stats | **no** | upstream publishes present-day values only |
| Move effect text | **no** | upstream publishes present-day wording only |

The base-stat gap is the one that matters: several Kanto species were
re-statted in generation VI, so a stat comparison here is certified against
*this snapshot*, not against the original cartridge. That is a limitation of
the source, not a licence to round off — claims over stats must say what they
are computed from, and the manifest verifier recomputes them from these bytes.

## Attribution

Data derived from the PokeAPI project, BSD-3-Clause, copyright the PokeAPI
contributors; the upstream licence is preserved in `LICENSE.pokeapi`. PokeAPI
is community-maintained and is this project's designated data source; it is
not an official Pokémon authority. Pokémon and Pokémon character names are
trademarks of Nintendo, Creatures Inc., and GAME FREAK; see the repository
`NOTICE`.
