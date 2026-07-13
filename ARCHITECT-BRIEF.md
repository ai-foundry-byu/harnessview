# 🏛 ARCHITECT BRIEFING (read before you build)

**What this system is:** JD's file-based AI organization: a CEO orchestrator + 8 domain agents + a fleet of specialist agents, operating over the agent-system repo, the nerve-center-v5 web cockpit (Next.js), and a Supabase backend — driven by ~130 cron jobs and reachable via Telegram. State lives in files, not chat.

**Hard conventions (do not violate — the architect gates these at sign-off):**
- Root-cause first, never bandaid — fix the process that generated the bug, then the symptom.
- Ship to prod: you open the PR, wait for CI, merge, deploy, smoke-test prod. JD reviews in prod, never PRs.
- Parallel/background sub-agents MUST run in a git worktree (isolation), never the shared checkout.
- Inventory before spawning — reuse an existing agent/capability before building a new one.
- RUNBOOK/tooling first — check for an existing generator before hand-writing output.
- File-based state over conversation memory. Log material work via clawd-log.sh.
- Surgical, scope-disciplined changes — don't refactor adjacent code outside the task.

**What ALREADY EXISTS — ground truth (reuse, don't duplicate; don't break):**
**Agents on disk (31, * = has CLI):** agent_browser, ai_foundry, ai_os, analytics_suite*, architect*, chief_of_staff*, counselor*, deck_architect_v4*, evolution, executive_assistant*, finance, gpt-researcher, growth, health, health_coach*, health_expert*, hivehood*, merch, merch_expert*, notification_field*, orchestrator, professor*, qa_agent*, quanta*, regression_diagnostics*, researcher, scrapers, socrates, synthetic_users, tax_strategist*, tracker*
**API surface:** 102 NC5 routes; bridge modules: agents(2), backlog(4), chat(3), fleet(8), health_sync(1), projects(1), runs(1), sessions(20), uploads(1)
**DB tables (202):** account, activities, agent_details, agent_heartbeats, agent_logs, agent_run_events, agent_runs, agent_stream, agent_tasks, agents, ai_foundry_courses, ai_foundry_milestones, ai_foundry_stakeholders, analytics, availability_overrides, bap_admin_audit_log, bap_alumni, bap_alumni_public, bap_event_rsvps, bap_events, bap_jobs, bap_mentorship_connections, bingo_winners, booking_types, bookings, budget_envelopes, budget_vault, calendar_events, calorie_log, chat_messages, chat_sessions, chat_threads, chat_uploads, commitments, crm_contacts, crons, deals, demo_events, demo_rovers, demo_telemetry, diligence_checklist, discord_metrics, documents, domain_metrics, domains, ecr_churn_weights, ecr_employer_champions, ecr_employer_hires, ecr_employer_plan_status, ecr_employer_relationships, ecr_employer_tasks, ecr_employer_touches, ecr_portfolio_health, ecr_recruiter_roi, ecr_score_runs, ecr_tier_plans, email_templates, fleet_plans, foundry_applications, geography_columns, geometry_columns, grades, habits, health_metrics, heartbeat, hivehood_admin_tickets, hivehood_events, hivehood_magic_tokens, hivehood_site_content, hivehood_site_layout, hivehood_site_layout_versions, hivehood_subscribers, hooks, items, leads, mac_app_registry, mac_consent_coverage, mac_feature_flags, mac_privileged_holders, mac_system_health, mac_unified_audit, mbr_admin_audit_log, mbr_bids, mbr_course_clearing_history, mbr_course_terms, mbr_courses, mbr_engagement_events, mbr_preferences, mbr_professors, mbr_reviews, mbr_schedules, mds_audit_log, mds_connector_runs, mds_consent_ledger, mds_field_access_policy, mds_field_provenance, mds_import_batches, mds_people, mds_reconciliation_conflicts, merch_designs, merch_orders, merch_products, moa_audit_log, moa_funnel_events, moa_improvement_experiments, moa_intro_requests, moa_methodology_config, moa_mv_csea_report, moa_mv_employer_roi, moa_mv_funnel_rollup, moa_mv_mentor_followthrough, moa_outcome_records, moa_report_snapshots, moa_survey_responders, mrh_applications, mrh_audit_log, mrh_club_champions, mrh_companies, mrh_event_rsvps, mrh_events, mrh_hub_events, mrh_intros, mrh_jobs, mrh_oci_slots, mrh_people, mrh_recruiters, mrh_resume_book, mrh_shortlist_requests, mwi_admin_audit_log, mwi_alumni, mwi_ask_matches, mwi_asks, mwi_companies, mwi_email_tokens, mwi_funnel_counts, mwi_intro_config, mwi_intro_events, mwi_intro_messages, mwi_jobs, mwi_mentorship_connections, nc_agent_logs, nc_agents, nc_cost_entries, nc_cron_history, nc_events, nc_instances, nc_modules, nc_research, nc_settings, nc_users, network_members, newsletter_issues, newsletter_referrals, newsletter_sends, newsletter_subscribers, notification_field, open_loops, org_agents, org_domains, org_mcps, pipeline_deals, project_proposals, project_status, projects, qa_bypass_audit, sam_admin_chat_log, sam_admin_pages, sam_admin_publish_queue, sam_admin_sites, sam_admin_snapshots, sam_budget_accounts, sam_budget_envelopes, sam_budget_goals, sam_budget_months, sam_budget_todos, sam_budget_transactions, session, shopify_sessions, shopify_webhook_events, skills, spatial_ref_sys, supplement_log, system_health, tasks, telegram_conversations, telegram_conversations_recent_30d, token_spend, user, users, v_directory, v_employer_outcomes, v_mentor_supply, v_outcomes, v_resume_book, verification, weight_log, workout_log, x_metrics, x_posts, x_replies, x_replies_daily, x_videos
**Automation:** 159 cron jobs across 86 scripts
  _(index generated 2026-06-09T15:16:27.706151+00:00, HEAD d6ec5c4f)_

  projects (registry): leland-coaching [active]; x-agent-socrates [planning]; second-brain-infra [active]; plaud-pipeline [archived]; consulting-pipeline [idea]; newsletter-agent-brief [active]; ai-foundry-program [active]; siemens-onboarding [active]; family-budget [archived]; nerve-center-v5 [active]; jarvis-ai-os [archived]; agent-tree-hub [active]; agent-tree-collab [active]; openclaw-marketplace [active]; deck-architect-v4 [planning]; school-overhaul [archived]; byu-alumni-portal [active]; ai-os-system-audit [active]; creditoclaro-demo [active]; loanamigo-demo [paused]; mba-bidding-reviews; slopes-mortgage [paused]; adsbybitcoin [paused]; quanta [complete]; mba-course-catalog-courserank [complete]; study-aide [archived]; voiceclaw [archived]; acquisitor [complete]; pitchgrade [archived]; venture-val [archived]

### Project: harnessview
**Goal:** TBD — finish this sentence: "When this project is done, we will have ______."
**Open milestones:**
  - [ ] M1: TBD
  - [ ] M2: TBD
  - [ ] M3: TBD
**Recently shipped:**
  - 09:17 — Project scaffolded (status: active, domain: ops).

**This change vs origin/main:** SIGNIFICANT — 4 file(s) touch: api-interface, db-migration
  ⚠ [api-interface] agents/merch/storefront/src/app/api/checkout/route.ts — API route / interface / schema — public contract other code depends on
  ⚠ [api-interface] agents/merch/storefront/src/app/api/health/route.ts — API route / interface / schema — public contract other code depends on
  ⚠ [db-migration] migrations/2026-06-09-merch-orders-retry.sql — database migration / SQL — shared schema contract
  ⚠ [db-migration] migrations/2026-06-08-fleet-workers.sql — database migration / SQL — shared schema contract
  🔺 HIGH blast radius (reused widely — change carefully): agents/merch/design_agent.py (11 referrers), agents/merch/expansion.py (25 referrers), agents/merch/operator.py (42 referrers), agents/merch/printful_client.py (8 referrers), agents/merch/standup.py (9 referrers), agents/merch/state.py (200 referrers)

Reuse what exists. Follow the conventions. Significant (shared-contract) changes will be hard-gated by the architect at sign-off — build coherent from the start so you don't get blocked.
