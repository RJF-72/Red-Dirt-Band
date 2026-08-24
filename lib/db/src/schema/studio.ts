import { jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const songProjectsTable = pgTable("song_projects", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull(),
  title: text("title").notNull(),
  song: jsonb("song").notNull(),
  arrangement: jsonb("arrangement").notNull(),
  lyricCues: jsonb("lyric_cues").notNull(),
  musicianMix: jsonb("musician_mix").notNull(),
  assets: jsonb("assets").notNull(),
  renderHistory: jsonb("render_history").notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const instrumentPackagesTable = pgTable("instrument_packages", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull(),
  instrumentId: text("instrument_id").notNull(),
  fileName: text("file_name").notNull(),
  sdkFileName: text("sdk_file_name").notNull(),
  aimObjectPath: text("aim_object_path").notNull(),
  sdkObjectPath: text("sdk_object_path").notNull(),
  layers: text("layers").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const studioObjectsTable = pgTable("studio_objects", {
  objectPath: text("object_path").primaryKey(),
  userId: text("user_id").notNull(),
  contentType: text("content_type").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const referenceLayersTable = pgTable("reference_layers", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull(),
  instrumentId: text("instrument_id").notNull(),
  objectPath: text("object_path").notNull(),
  metadata: jsonb("metadata").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("reference_layers_object_path_unique").on(table.objectPath)]);

export const commerceAccountsTable = pgTable("commerce_accounts", {
  userId: text("user_id").primaryKey(),
  stripeCustomerId: text("stripe_customer_id").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertSongProjectSchema = createInsertSchema(songProjectsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertInstrumentPackageSchema = createInsertSchema(instrumentPackagesTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertStudioObjectSchema = createInsertSchema(studioObjectsTable).omit({ createdAt: true });
export const insertReferenceLayerSchema = createInsertSchema(referenceLayersTable).omit({ id: true, createdAt: true });
export const insertCommerceAccountSchema = createInsertSchema(commerceAccountsTable).omit({ createdAt: true, updatedAt: true });
export type SongProject = typeof songProjectsTable.$inferSelect;
export type InstrumentPackage = typeof instrumentPackagesTable.$inferSelect;
export type StudioObject = typeof studioObjectsTable.$inferSelect;
export type ReferenceLayer = typeof referenceLayersTable.$inferSelect;
export type CommerceAccount = typeof commerceAccountsTable.$inferSelect;
export type InsertSongProject = z.infer<typeof insertSongProjectSchema>;
export type InsertInstrumentPackage = z.infer<typeof insertInstrumentPackageSchema>;
export type InsertCommerceAccount = z.infer<typeof insertCommerceAccountSchema>;