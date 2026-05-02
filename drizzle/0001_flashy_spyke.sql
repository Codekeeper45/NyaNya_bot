CREATE TABLE "graph_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" integer NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "graph_entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"last_used_at" timestamp,
	"use_count" integer DEFAULT 0 NOT NULL,
	"importance_score" integer DEFAULT 10 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "graph_entity_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" integer NOT NULL,
	"entity_id" uuid NOT NULL,
	"alias" varchar(255) NOT NULL,
	"normalized_alias" varchar(255) NOT NULL,
	"source" varchar(50) DEFAULT 'extracted' NOT NULL,
	"confidence" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "graph_entity_aliases_user_normalized_unique" UNIQUE("user_id","normalized_alias")
);
--> statement-breakpoint
CREATE TABLE "graph_entity_mentions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"chunk_id" uuid NOT NULL,
	CONSTRAINT "entity_chunk_unique" UNIQUE("entity_id","chunk_id")
);
--> statement-breakpoint
CREATE TABLE "graph_entity_usages" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"entity_id" uuid NOT NULL,
	"message_id" integer NOT NULL,
	"used_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "graph_fact_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fact_id" uuid NOT NULL,
	"chunk_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "graph_fact_sources_fact_chunk_unique" UNIQUE("fact_id","chunk_id")
);
--> statement-breakpoint
CREATE TABLE "graph_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" integer NOT NULL,
	"subject_id" uuid NOT NULL,
	"predicate" varchar(255) NOT NULL,
	"object_id" uuid,
	"object_text" text NOT NULL,
	"statement" text NOT NULL,
	"fact_key" varchar(700) NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"confidence" integer DEFAULT 80 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "graph_facts_user_key_unique" UNIQUE("user_id","fact_key")
);
--> statement-breakpoint
CREATE TABLE "graph_index_state" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"last_indexed_message_id" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "graph_index_state_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "graph_relationships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" integer NOT NULL,
	"source_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"description" text NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_executions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"scheduler_id" varchar(255),
	"kind" varchar(50) NOT NULL,
	"attempt_number" integer,
	"was_skipped" boolean DEFAULT false NOT NULL,
	"skip_reason" varchar(100),
	"user_replied_within_30min" boolean,
	"executed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_skip_once" (
	"id" serial PRIMARY KEY NOT NULL,
	"scheduler_id" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "job_skip_once_scheduler_id_unique" UNIQUE("scheduler_id")
);
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "telegram_user_id" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "graph_chunks" ADD CONSTRAINT "graph_chunks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_entities" ADD CONSTRAINT "graph_entities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_entity_aliases" ADD CONSTRAINT "graph_entity_aliases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_entity_aliases" ADD CONSTRAINT "graph_entity_aliases_entity_id_graph_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."graph_entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_entity_mentions" ADD CONSTRAINT "graph_entity_mentions_entity_id_graph_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."graph_entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_entity_mentions" ADD CONSTRAINT "graph_entity_mentions_chunk_id_graph_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."graph_chunks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_entity_usages" ADD CONSTRAINT "graph_entity_usages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_entity_usages" ADD CONSTRAINT "graph_entity_usages_entity_id_graph_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."graph_entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_entity_usages" ADD CONSTRAINT "graph_entity_usages_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_fact_sources" ADD CONSTRAINT "graph_fact_sources_fact_id_graph_facts_id_fk" FOREIGN KEY ("fact_id") REFERENCES "public"."graph_facts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_fact_sources" ADD CONSTRAINT "graph_fact_sources_chunk_id_graph_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."graph_chunks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_facts" ADD CONSTRAINT "graph_facts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_facts" ADD CONSTRAINT "graph_facts_subject_id_graph_entities_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."graph_entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_facts" ADD CONSTRAINT "graph_facts_object_id_graph_entities_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."graph_entities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_index_state" ADD CONSTRAINT "graph_index_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_relationships" ADD CONSTRAINT "graph_relationships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_relationships" ADD CONSTRAINT "graph_relationships_source_id_graph_entities_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."graph_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_relationships" ADD CONSTRAINT "graph_relationships_target_id_graph_entities_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."graph_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_executions" ADD CONSTRAINT "job_executions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_graph_chunks_user" ON "graph_chunks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_graph_entities_user" ON "graph_entities" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_graph_entities_name" ON "graph_entities" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "idx_graph_entity_aliases_entity" ON "graph_entity_aliases" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "idx_entity_usages_user_entity" ON "graph_entity_usages" USING btree ("user_id","entity_id");--> statement-breakpoint
CREATE INDEX "idx_entity_usages_message" ON "graph_entity_usages" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "idx_graph_fact_sources_chunk" ON "graph_fact_sources" USING btree ("chunk_id");--> statement-breakpoint
CREATE INDEX "idx_graph_facts_user_subject" ON "graph_facts" USING btree ("user_id","subject_id");--> statement-breakpoint
CREATE INDEX "idx_graph_rel_user_source" ON "graph_relationships" USING btree ("user_id","source_id");--> statement-breakpoint
CREATE INDEX "idx_graph_rel_user_target" ON "graph_relationships" USING btree ("user_id","target_id");--> statement-breakpoint
CREATE INDEX "idx_job_exec_user_kind_executed_at" ON "job_executions" USING btree ("user_id","kind","executed_at");--> statement-breakpoint
CREATE INDEX "idx_job_exec_scheduler_id" ON "job_executions" USING btree ("scheduler_id");--> statement-breakpoint
CREATE INDEX "idx_expenses_user_date" ON "expenses" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "idx_jobs_bull_id" ON "jobs" USING btree ("bull_job_id");--> statement-breakpoint
CREATE INDEX "idx_jobs_user_kind" ON "jobs" USING btree ("user_id","kind");--> statement-breakpoint
CREATE INDEX "idx_messages_user_created" ON "messages" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_messages_content_fts" ON "messages" USING gin (to_tsvector('russian', "content"));--> statement-breakpoint
CREATE INDEX "idx_repeating_jobs_user" ON "repeating_jobs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_todos_user_done" ON "todos" USING btree ("user_id","done");