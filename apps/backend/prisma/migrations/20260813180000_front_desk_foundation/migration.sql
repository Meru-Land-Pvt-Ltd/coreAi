-- Front-desk foundation (Triven plan v2.0 build-out). Fully additive:
-- new domains for team/RBAC, customers, shared inbox, rules, reminders,
-- per-step workflow tracking, quality scoring, knowledge versioning, and
-- audit — plus nullable link columns on existing tables. No existing row is
-- modified or dropped.

-- ===== Business team / RBAC =====
CREATE TABLE IF NOT EXISTS "BusinessTeamMember" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "userId" TEXT,
    "displayName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "role" TEXT NOT NULL DEFAULT 'RECEPTIONIST',
    "department" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "handoffEligible" BOOLEAN NOT NULL DEFAULT true,
    "presence" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "permissionsJson" JSONB,
    "lastActiveAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BusinessTeamMember_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "BusinessTeamMember_businessId_userId_key" ON "BusinessTeamMember"("businessId", "userId");
CREATE INDEX IF NOT EXISTS "BusinessTeamMember_businessId_active_handoffEligible_idx" ON "BusinessTeamMember"("businessId", "active", "handoffEligible");
CREATE INDEX IF NOT EXISTS "BusinessTeamMember_userId_idx" ON "BusinessTeamMember"("userId");
ALTER TABLE "BusinessTeamMember" ADD CONSTRAINT "BusinessTeamMember_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BusinessTeamMember" ADD CONSTRAINT "BusinessTeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "BusinessMemberInvite" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'RECEPTIONIST',
    "invitedByUserId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BusinessMemberInvite_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "BusinessMemberInvite_tokenHash_key" ON "BusinessMemberInvite"("tokenHash");
CREATE UNIQUE INDEX IF NOT EXISTS "BusinessMemberInvite_businessId_email_key" ON "BusinessMemberInvite"("businessId", "email");
CREATE INDEX IF NOT EXISTS "BusinessMemberInvite_businessId_status_idx" ON "BusinessMemberInvite"("businessId", "status");
ALTER TABLE "BusinessMemberInvite" ADD CONSTRAINT "BusinessMemberInvite_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "BusinessActivityLog" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorLabel" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "detailJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BusinessActivityLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "BusinessActivityLog_businessId_createdAt_idx" ON "BusinessActivityLog"("businessId", "createdAt");
CREATE INDEX IF NOT EXISTS "BusinessActivityLog_businessId_action_idx" ON "BusinessActivityLog"("businessId", "action");
ALTER TABLE "BusinessActivityLog" ADD CONSTRAINT "BusinessActivityLog_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===== Customer domain =====
CREATE TABLE IF NOT EXISTS "Customer" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "displayName" TEXT,
    "primaryPhone" TEXT,
    "primaryEmail" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "mergedIntoId" TEXT,
    "notes" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Customer_businessId_lastSeenAt_idx" ON "Customer"("businessId", "lastSeenAt");
CREATE INDEX IF NOT EXISTS "Customer_businessId_primaryPhone_idx" ON "Customer"("businessId", "primaryPhone");
CREATE INDEX IF NOT EXISTS "Customer_businessId_status_idx" ON "Customer"("businessId", "status");
CREATE INDEX IF NOT EXISTS "Customer_mergedIntoId_idx" ON "Customer"("mergedIntoId");
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "CustomerIdentity" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "confidence" TEXT NOT NULL DEFAULT 'STRONG',
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomerIdentity_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CustomerIdentity_businessId_kind_value_key" ON "CustomerIdentity"("businessId", "kind", "value");
CREATE INDEX IF NOT EXISTS "CustomerIdentity_customerId_idx" ON "CustomerIdentity"("customerId");
ALTER TABLE "CustomerIdentity" ADD CONSTRAINT "CustomerIdentity_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "CustomerMergeSuggestion" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "customerAId" TEXT NOT NULL,
    "customerBId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "score" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "resolvedByUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomerMergeSuggestion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CustomerMergeSuggestion_businessId_customerAId_customerBId_key" ON "CustomerMergeSuggestion"("businessId", "customerAId", "customerBId");
CREATE INDEX IF NOT EXISTS "CustomerMergeSuggestion_businessId_status_idx" ON "CustomerMergeSuggestion"("businessId", "status");

CREATE TABLE IF NOT EXISTS "CustomerMergeEvent" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "survivingCustomerId" TEXT NOT NULL,
    "mergedCustomerId" TEXT NOT NULL,
    "movedRefsJson" JSONB NOT NULL,
    "mergedByUserId" TEXT,
    "reversedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomerMergeEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "CustomerMergeEvent_businessId_createdAt_idx" ON "CustomerMergeEvent"("businessId", "createdAt");

-- ===== Handoff attempts =====
CREATE TABLE IF NOT EXISTS "HandoffAttempt" (
    "id" TEXT NOT NULL,
    "handoffEventId" TEXT NOT NULL,
    "teamMemberId" TEXT,
    "destination" TEXT NOT NULL,
    "attemptOrder" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "connectedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "outcome" TEXT,
    CONSTRAINT "HandoffAttempt_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "HandoffAttempt_handoffEventId_attemptOrder_idx" ON "HandoffAttempt"("handoffEventId", "attemptOrder");
ALTER TABLE "HandoffAttempt" ADD CONSTRAINT "HandoffAttempt_handoffEventId_fkey" FOREIGN KEY ("handoffEventId") REFERENCES "HandoffEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===== Rules engine =====
CREATE TABLE IF NOT EXISTS "BusinessAgentRule" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "installedAgentId" TEXT,
    "title" TEXT NOT NULL,
    "instruction" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'CUSTOM',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BusinessAgentRule_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "BusinessAgentRule_businessId_active_idx" ON "BusinessAgentRule"("businessId", "active");
CREATE INDEX IF NOT EXISTS "BusinessAgentRule_installedAgentId_idx" ON "BusinessAgentRule"("installedAgentId");
ALTER TABLE "BusinessAgentRule" ADD CONSTRAINT "BusinessAgentRule_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "BusinessAgentRuleVersion" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "instruction" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "priority" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "changedByUserId" TEXT,
    "changeNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BusinessAgentRuleVersion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "BusinessAgentRuleVersion_ruleId_version_key" ON "BusinessAgentRuleVersion"("ruleId", "version");
ALTER TABLE "BusinessAgentRuleVersion" ADD CONSTRAINT "BusinessAgentRuleVersion_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "BusinessAgentRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "RuleInjectionAttempt" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "installedAgentId" TEXT,
    "channel" TEXT NOT NULL,
    "callId" TEXT,
    "excerpt" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RuleInjectionAttempt_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "RuleInjectionAttempt_businessId_createdAt_idx" ON "RuleInjectionAttempt"("businessId", "createdAt");

-- ===== Knowledge gaps =====
CREATE TABLE IF NOT EXISTS "UnansweredQuestion" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "installedAgentId" TEXT,
    "channel" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "normalizedKey" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "lastAskedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolvedByFileId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UnansweredQuestion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "UnansweredQuestion_businessId_normalizedKey_key" ON "UnansweredQuestion"("businessId", "normalizedKey");
CREATE INDEX IF NOT EXISTS "UnansweredQuestion_businessId_status_idx" ON "UnansweredQuestion"("businessId", "status");
ALTER TABLE "UnansweredQuestion" ADD CONSTRAINT "UnansweredQuestion_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===== Appointment reminders =====
CREATE TABLE IF NOT EXISTS "AppointmentReminder" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "offsetMinutes" INTEGER NOT NULL,
    "sendAt" TIMESTAMP(3) NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'SMS',
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "providerId" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AppointmentReminder_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AppointmentReminder_dedupeKey_key" ON "AppointmentReminder"("dedupeKey");
CREATE INDEX IF NOT EXISTS "AppointmentReminder_status_sendAt_idx" ON "AppointmentReminder"("status", "sendAt");
CREATE INDEX IF NOT EXISTS "AppointmentReminder_businessId_idx" ON "AppointmentReminder"("businessId");
CREATE INDEX IF NOT EXISTS "AppointmentReminder_appointmentId_idx" ON "AppointmentReminder"("appointmentId");
ALTER TABLE "AppointmentReminder" ADD CONSTRAINT "AppointmentReminder_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===== Per-step workflow execution =====
CREATE TABLE IF NOT EXISTS "WorkflowStepRun" (
    "id" TEXT NOT NULL,
    "workflowRunId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "label" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "providerId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkflowStepRun_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "WorkflowStepRun_idempotencyKey_key" ON "WorkflowStepRun"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "WorkflowStepRun_workflowRunId_idx" ON "WorkflowStepRun"("workflowRunId");
CREATE INDEX IF NOT EXISTS "WorkflowStepRun_status_idx" ON "WorkflowStepRun"("status");
ALTER TABLE "WorkflowStepRun" ADD CONSTRAINT "WorkflowStepRun_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===== Quality scoring =====
CREATE TABLE IF NOT EXISTS "ConversationEvaluation" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "installedAgentId" TEXT,
    "vapiCallId" TEXT,
    "conversationId" TEXT,
    "handledBy" TEXT NOT NULL DEFAULT 'AI',
    "rubricVersion" TEXT NOT NULL,
    "overallScore" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "dimensionsJson" JSONB NOT NULL,
    "coachingJson" JSONB,
    "missedOpportunitiesJson" JSONB,
    "evaluator" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SCORED',
    "adjustedScore" DOUBLE PRECISION,
    "reviewNote" TEXT,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ConversationEvaluation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ConversationEvaluation_vapiCallId_key" ON "ConversationEvaluation"("vapiCallId");
CREATE INDEX IF NOT EXISTS "ConversationEvaluation_businessId_createdAt_idx" ON "ConversationEvaluation"("businessId", "createdAt");
CREATE INDEX IF NOT EXISTS "ConversationEvaluation_businessId_overallScore_idx" ON "ConversationEvaluation"("businessId", "overallScore");
CREATE INDEX IF NOT EXISTS "ConversationEvaluation_businessId_status_idx" ON "ConversationEvaluation"("businessId", "status");
ALTER TABLE "ConversationEvaluation" ADD CONSTRAINT "ConversationEvaluation_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===== Additive columns on existing tables =====
ALTER TABLE "Business"
  ADD COLUMN IF NOT EXISTS "recordingRetentionDays" INTEGER;

ALTER TABLE "Conversation"
  ADD COLUMN IF NOT EXISTS "aiState" TEXT NOT NULL DEFAULT 'AI_ACTIVE',
  ADD COLUMN IF NOT EXISTS "assignedTeamMemberId" TEXT,
  ADD COLUMN IF NOT EXISTS "waitingSince" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "humanSince" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "slaEscalatedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "customerId" TEXT,
  ADD COLUMN IF NOT EXISTS "outcome" TEXT,
  ADD COLUMN IF NOT EXISTS "sentiment" TEXT,
  ADD COLUMN IF NOT EXISTS "summary" TEXT,
  ADD COLUMN IF NOT EXISTS "lastInboundAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastOutboundAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "Conversation_businessId_aiState_idx" ON "Conversation"("businessId", "aiState");
CREATE INDEX IF NOT EXISTS "Conversation_customerId_idx" ON "Conversation"("customerId");

ALTER TABLE "VapiCall"
  ADD COLUMN IF NOT EXISTS "outcome" TEXT,
  ADD COLUMN IF NOT EXISTS "sentiment" TEXT,
  ADD COLUMN IF NOT EXISTS "customerId" TEXT,
  ADD COLUMN IF NOT EXISTS "twilioCallSid" TEXT,
  ADD COLUMN IF NOT EXISTS "providerDeletionState" TEXT,
  ADD COLUMN IF NOT EXISTS "recordingDeletedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "VapiCall_customerId_idx" ON "VapiCall"("customerId");
CREATE INDEX IF NOT EXISTS "VapiCall_twilioCallSid_idx" ON "VapiCall"("twilioCallSid");

ALTER TABLE "HandoffEvent"
  ADD COLUMN IF NOT EXISTS "assignedTeamMemberId" TEXT,
  ADD COLUMN IF NOT EXISTS "connectedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "attemptsCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "conversationId" TEXT,
  ADD COLUMN IF NOT EXISTS "customerId" TEXT;
CREATE INDEX IF NOT EXISTS "HandoffEvent_customerId_idx" ON "HandoffEvent"("customerId");

ALTER TABLE "Lead"
  ADD COLUMN IF NOT EXISTS "customerId" TEXT;

ALTER TABLE "Appointment"
  ADD COLUMN IF NOT EXISTS "customerId" TEXT;
CREATE INDEX IF NOT EXISTS "Appointment_customerId_idx" ON "Appointment"("customerId");

ALTER TABLE "BusinessKnowledgeFile"
  ADD COLUMN IF NOT EXISTS "lifecycle" TEXT NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS "visibility" TEXT NOT NULL DEFAULT 'CUSTOMER_VISIBLE',
  ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "supersedesId" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceType" TEXT NOT NULL DEFAULT 'UPLOAD',
  ADD COLUMN IF NOT EXISTS "sourceUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "pageCount" INTEGER;

ALTER TABLE "WhatsAppConnection"
  ADD COLUMN IF NOT EXISTS "installedAgentId" TEXT;

ALTER TABLE "EmailMessage"
  ADD COLUMN IF NOT EXISTS "customerId" TEXT,
  ADD COLUMN IF NOT EXISTS "conversationId" TEXT;
CREATE INDEX IF NOT EXISTS "EmailMessage_customerId_idx" ON "EmailMessage"("customerId");
CREATE INDEX IF NOT EXISTS "EmailMessage_conversationId_idx" ON "EmailMessage"("conversationId");
