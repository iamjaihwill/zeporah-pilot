/**
 * The starter vault every household begins with: places to note where things are kept, reviewed in
 * setup step 4. Metadata only; Zeporah never stores the documents. Used by enrollment (decision 66)
 * and by the synthetic dataset.
 */
export const STARTER_VAULT: readonly [
  title: string,
  category: string,
  description: string,
  sensitivity: "standard" | "protected",
][] = [
  ["Hospice contact card", "contacts", "Who to call at the hospice, including the 24-hour line.", "standard"],
  [
    "Insurance cards",
    "coverage",
    "Where the insurance cards are kept, so anyone helping can find them.",
    "standard",
  ],
  [
    "Where the medication list is kept",
    "household",
    "Just where the list is — the care team keeps the list itself.",
    "standard",
  ],
  [
    "Advance directive",
    "wishes",
    "Whether one exists and where the original is kept. Zeporah never stores the document.",
    "protected",
  ],
  [
    "Healthcare agent paperwork",
    "authority",
    "Whether paperwork naming a healthcare agent exists and where it is kept.",
    "protected",
  ],
  [
    "Funeral or memorial wishes",
    "wishes",
    "Whether wishes have been written down, and where. Only if and when the family wants to.",
    "protected",
  ],
];
