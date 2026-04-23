import { pgTable, serial, text, varchar, boolean, timestamp, jsonb, integer, bigint, unique, index } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  telegramUserId: bigint('telegram_user_id', { mode: 'number' }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull().default('User'),
  timezone: varchar('timezone', { length: 64 }).notNull().default('Asia/Almaty'),
  wakeTime: varchar('wake_time', { length: 5 }).default('08:00'),
  sleepTime: varchar('sleep_time', { length: 5 }).default('23:00'),
  weekendWakeTime: varchar('weekend_wake_time', { length: 5 }),
  weekendSleepTime: varchar('weekend_sleep_time', { length: 5 }),
  breakfastTime: varchar('breakfast_time', { length: 5 }),
  lunchTime: varchar('lunch_time', { length: 5 }),
  dinnerTime: varchar('dinner_time', { length: 5 }),
  phoneNumber: varchar('phone_number', { length: 20 }),
  paused: boolean('paused').notNull().default(false),
  onboardingComplete: boolean('onboarding_complete').notNull().default(false),
  googleRefreshToken: text('google_refresh_token'),
  preferences: jsonb('preferences').$type<{
    voice_default?: boolean;
    dietary?: string[];
    interests?: string[];
    study_subjects?: string[];
    message_length?: 'short' | 'normal' | 'detailed';
    followup_max_attempts?: number;
    followup_by_kind?: Record<string, number>;
  }>().default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const messages = pgTable('messages', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id).notNull(),
  role: varchar('role', { length: 20 }).notNull(), // user | assistant | system
  content: text('content').notNull(),
  source: varchar('source', { length: 20 }).default('text'), // text | voice | photo
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('idx_messages_user_created').on(t.userId, t.createdAt),
]);

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
}, (t) => [
  index('idx_jobs_bull_id').on(t.bullJobId),
  index('idx_jobs_user_kind').on(t.userId, t.kind),
]);

export const lessonPlans = pgTable('lesson_plans', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id).notNull(),
  subject: varchar('subject', { length: 255 }).notNull(),
  topic: varchar('topic', { length: 255 }).notNull(),
  materials: jsonb('materials').$type<Record<string, unknown>[]>().default([]),
  plan: text('plan'),
  status: varchar('status', { length: 20 }).notNull().default('draft'),
  scheduledDays: jsonb('scheduled_days').$type<number[]>().default([]),
  scheduledTime: varchar('scheduled_time', { length: 10 }),
  durationMinutes: integer('duration_minutes').default(45),
  deadline: timestamp('deadline'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const repeatingJobs = pgTable('repeating_jobs', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id).notNull(),
  schedulerId: varchar('scheduler_id', { length: 255 }).notNull().unique(),
  kind: varchar('kind', { length: 50 }).notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  cronPattern: varchar('cron_pattern', { length: 100 }).notNull(),
  timezone: varchar('timezone', { length: 64 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('idx_repeating_jobs_user').on(t.userId),
]);

export const habits = pgTable('habits', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  targetDays: jsonb('target_days').$type<number[]>().default([0, 1, 2, 3, 4, 5, 6]),
  streak: integer('streak').default(0),
  lastLoggedDate: varchar('last_logged_date', { length: 10 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const habitLogs = pgTable('habit_logs', {
  id: serial('id').primaryKey(),
  habitId: integer('habit_id').references(() => habits.id, { onDelete: 'cascade' }).notNull(),
  date: varchar('date', { length: 10 }).notNull(),
  done: boolean('done').notNull(),
}, (t) => [unique('habit_logs_habit_date_unique').on(t.habitId, t.date)]);

export const expenses = pgTable('expenses', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id).notNull(),
  amount: text('amount').notNull(), // stored as string to avoid float precision issues
  currency: varchar('currency', { length: 10 }).notNull().default('KZT'),
  category: varchar('category', { length: 100 }),
  note: varchar('note', { length: 500 }),
  date: varchar('date', { length: 10 }).notNull(), // YYYY-MM-DD
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('idx_expenses_user_date').on(t.userId, t.date),
]);

export const todos = pgTable('todos', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id).notNull(),
  text: varchar('text', { length: 1000 }).notNull(),
  done: boolean('done').notNull().default(false),
  deadline: timestamp('deadline'),
  doneAt: timestamp('done_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('idx_todos_user_done').on(t.userId, t.done),
]);

export const jobSkipOnce = pgTable('job_skip_once', {
  id: serial('id').primaryKey(),
  schedulerId: varchar('scheduler_id', { length: 255 }).notNull().unique(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const jobExecutions = pgTable('job_executions', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id).notNull(),
  schedulerId: varchar('scheduler_id', { length: 255 }),
  kind: varchar('kind', { length: 50 }).notNull(),
  attemptNumber: integer('attempt_number'),
  wasSkipped: boolean('was_skipped').notNull().default(false),
  skipReason: varchar('skip_reason', { length: 100 }),
  userRepliedWithin30Min: boolean('user_replied_within_30min'),
  executedAt: timestamp('executed_at').defaultNow().notNull(),
}, (t) => [
  index('idx_job_exec_user_kind_executed_at').on(t.userId, t.kind, t.executedAt),
  index('idx_job_exec_scheduler_id').on(t.schedulerId),
]);

// Type exports
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type LessonPlan = typeof lessonPlans.$inferSelect;
export type RepeatingJob = typeof repeatingJobs.$inferSelect;
export type Habit = typeof habits.$inferSelect;
export type HabitLog = typeof habitLogs.$inferSelect;
export type Expense = typeof expenses.$inferSelect;
export type Todo = typeof todos.$inferSelect;
export type JobSkipOnce = typeof jobSkipOnce.$inferSelect;
export type NewJobSkipOnce = typeof jobSkipOnce.$inferInsert;
export type JobExecution = typeof jobExecutions.$inferSelect;
export type NewJobExecution = typeof jobExecutions.$inferInsert;
