import { pgTable, serial, text, varchar, boolean, timestamp, jsonb, integer } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  telegramUserId: integer('telegram_user_id').notNull().unique(),
  name: varchar('name', { length: 255 }).notNull().default('User'),
  timezone: varchar('timezone', { length: 64 }).notNull().default('Asia/Almaty'),
  wakeTime: varchar('wake_time', { length: 5 }).default('08:00'),
  sleepTime: varchar('sleep_time', { length: 5 }).default('23:00'),
  paused: boolean('paused').notNull().default(false),
  preferences: jsonb('preferences').$type<{
    voice_default?: boolean;
    dietary?: string[];
    interests?: string[];
    study_subjects?: string[];
  }>().default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const messages = pgTable('messages', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id).notNull(),
  role: varchar('role', { length: 20 }).notNull(), // user | assistant | system
  content: text('content').notNull(),
  source: varchar('source', { length: 20 }).default('text'), // text | voice | cron
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const jobs = pgTable('jobs', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id).notNull(),
  bullJobId: varchar('bull_job_id', { length: 255 }),
  kind: varchar('kind', { length: 50 }).notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  status: varchar('status', { length: 20 }).notNull().default('scheduled'),
  scheduledAt: timestamp('scheduled_at'),
  processedAt: timestamp('processed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const lessonPlans = pgTable('lesson_plans', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id).notNull(),
  subject: varchar('subject', { length: 255 }).notNull(),
  topic: varchar('topic', { length: 255 }).notNull(),
  materials: jsonb('materials').$type<Record<string, unknown>[]>().default([]),
  plan: text('plan'),
  status: varchar('status', { length: 20 }).notNull().default('draft'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Type exports
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type LessonPlan = typeof lessonPlans.$inferSelect;
