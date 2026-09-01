/**
 * The things Maddie stores, and the Zod schemas that guard every API boundary.
 */
import { z } from "zod";

export const LatLngSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const ReportCategorySchema = z.enum([
  "harassment",
  "following",
  "assault",
  "lighting",
  "feltUnsafe",
  "feltSafe",
  "other",
]);
export type ReportCategory = z.infer<typeof ReportCategorySchema>;

export const REPORT_CATEGORY_LABELS: Record<ReportCategory, string> = {
  harassment: "Harassed or catcalled",
  following: "Followed",
  assault: "Assaulted",
  lighting: "Badly lit",
  feltUnsafe: "Felt unsafe",
  feltSafe: "Felt safe",
  other: "Something else",
};

export const ReportInputSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  category: ReportCategorySchema,
  /** Local hour the thing happened, 0–23, or null if the reporter did not say. */
  hour: z.number().int().min(0).max(23).nullable().default(null),
  text: z.string().max(2_000).default(""),
  placeName: z.string().max(200).default(""),
  /** Reporters choose this; nothing identifying is ever required. */
  contactBack: z.boolean().default(false),
});
export type ReportInput = z.infer<typeof ReportInputSchema>;

export interface CommunityReport {
  id: string;
  createdAt: string;
  lat: number;
  lng: number;
  category: ReportCategory;
  hour: number | null;
  text: string;
  placeName: string;
  /** Salted hash of the reporter's network identity. Never the identity. */
  anonHash: string;
  status: "published" | "held";
  moderation: { flagged: boolean; reason: string; byModel: boolean } | null;
}

export const InterviewInputSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  title: z.string().min(1).max(200),
  pseudonym: z.string().max(80).default(""),
  transcript: z.string().min(1).max(60_000),
  consent: z.literal(true),
  locationLabel: z.string().max(200).default(""),
});
export type InterviewInput = z.infer<typeof InterviewInputSchema>;

export interface Interview {
  id: string;
  createdAt: string;
  lat: number;
  lng: number;
  title: string;
  pseudonym: string;
  locationLabel: string;
  transcript: string;
  themes: string[];
  summary: string;
  /** Whether the qualitative pass ran, and how far to trust it. */
  analysed: boolean;
}

export const JourneyInputSchema = z.object({
  from: LatLngSchema,
  to: LatLngSchema,
  fromLabel: z.string().max(200).default(""),
  toLabel: z.string().max(200).default(""),
  watcherName: z.string().max(120).default(""),
  expectedMinutes: z.number().int().min(1).max(600).default(45),
});
export type JourneyInput = z.infer<typeof JourneyInputSchema>;

export const JourneyUpdateSchema = z.object({
  token: z.string().min(10).max(120),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  status: z.enum(["walking", "arrived", "help"]).default("walking"),
  note: z.string().max(500).default(""),
});

export interface JourneyPing {
  at: string;
  lat: number;
  lng: number;
  status: "walking" | "arrived" | "help";
  note: string;
}

export interface Journey {
  token: string;
  createdAt: string;
  expiresAt: string;
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
  fromLabel: string;
  toLabel: string;
  watcherName: string;
  expectedMinutes: number;
  status: "walking" | "arrived" | "help" | "expired";
  pings: JourneyPing[];
}
