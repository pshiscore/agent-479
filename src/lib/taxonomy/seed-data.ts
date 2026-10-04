/**
 * Starting categories and tags (plan section 3, "Events and taxonomy").
 * New rows are seeded active; re-seeding never changes `active`, so a category
 * or tag the owner switched off stays off.
 */

export interface CategorySeed {
  slug: string;
  name: string;
  sort: number;
}

export interface TagSeed {
  slug: string;
  name: string;
}

/** The classifier's catch-all. Picking it requires a "closest missing category" hint (step 13). */
export const COMMUNITY_SLUG = "community";

export const CATEGORY_SEEDS: CategorySeed[] = [
  { slug: "music", name: "Music", sort: 10 },
  { slug: "arts-theater", name: "Arts & Theater", sort: 20 },
  { slug: "comedy", name: "Comedy", sort: 30 },
  { slug: "film", name: "Film", sort: 40 },
  { slug: "family-kids", name: "Family & Kids", sort: 50 },
  { slug: "food-drink", name: "Food & Drink", sort: 60 },
  { slug: "outdoors-fitness", name: "Outdoors & Fitness", sort: 70 },
  { slug: "sports", name: "Sports", sort: 80 },
  { slug: "festivals-markets", name: "Festivals & Markets", sort: 90 },
  { slug: "talks-learning", name: "Talks & Learning", sort: 100 },
  { slug: COMMUNITY_SLUG, name: "Community", sort: 110 },
  { slug: "nightlife", name: "Nightlife", sort: 120 },
];

export const TAG_SEEDS: TagSeed[] = [
  { slug: "free", name: "Free" },
  { slug: "outdoor", name: "Outdoor" },
  { slug: "family-friendly", name: "Family-friendly" },
  { slug: "21-plus", name: "21+" },
  { slug: "dog-friendly", name: "Dog-friendly" },
  { slug: "biking", name: "Biking" },
  // Owner, 2026-10-04: blood drives, cleanups, volunteer shifts.
  { slug: "volunteer", name: "Volunteer" },
  // Set in code from extraction, never by the classifier.
  { slug: "registration-required", name: "Registration required" },
];
