-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('RUNNING', 'WAITING', 'DONE', 'FAILED', 'ABORTED');

-- CreateTable
CREATE TABLE "Run" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'sardor',
    "graph" TEXT NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'RUNNING',
    "currentNode" TEXT,
    "state" JSONB NOT NULL,
    "interrupt" JSONB,
    "steps" INTEGER NOT NULL DEFAULT 0,
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "error" TEXT,
    "threadKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Checkpoint" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "node" TEXT NOT NULL,
    "state" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Checkpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Step" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "node" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Step_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ToolCall" (
    "id" TEXT NOT NULL,
    "runId" TEXT,
    "node" TEXT,
    "tool" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "output" JSONB,
    "error" TEXT,
    "durationMs" INTEGER,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ToolCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LlmCall" (
    "id" TEXT NOT NULL,
    "runId" TEXT,
    "node" TEXT,
    "model" TEXT NOT NULL,
    "effort" TEXT,
    "purpose" TEXT,
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "cacheReadIn" INTEGER NOT NULL DEFAULT 0,
    "cacheWriteIn" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "durationMs" INTEGER,
    "stopReason" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LlmCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureSnapshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'sardor',
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "featureSet" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "values" JSONB NOT NULL,
    "runId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeatureSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Outcome" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'sardor',
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "value" DOUBLE PRECISION,
    "source" TEXT NOT NULL DEFAULT 'sardor',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Outcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MlModel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "algo" TEXT NOT NULL,
    "featureSet" TEXT NOT NULL,
    "featureVersion" INTEGER NOT NULL,
    "params" JSONB NOT NULL,
    "metrics" JSONB NOT NULL,
    "artifact" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "trainedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MlModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prediction" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "runId" TEXT,
    "score" DOUBLE PRECISION NOT NULL,
    "decision" TEXT,
    "shadow" BOOLEAN NOT NULL DEFAULT true,
    "actual" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Prediction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Run_tenantId_graph_status_idx" ON "Run"("tenantId", "graph", "status");

-- CreateIndex
CREATE INDEX "Run_threadKey_status_idx" ON "Run"("threadKey", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Checkpoint_runId_seq_key" ON "Checkpoint"("runId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "Step_runId_seq_key" ON "Step"("runId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "ToolCall_idempotencyKey_key" ON "ToolCall"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ToolCall_runId_tool_idx" ON "ToolCall"("runId", "tool");

-- CreateIndex
CREATE INDEX "LlmCall_runId_idx" ON "LlmCall"("runId");

-- CreateIndex
CREATE INDEX "LlmCall_model_createdAt_idx" ON "LlmCall"("model", "createdAt");

-- CreateIndex
CREATE INDEX "FeatureSnapshot_subjectType_subjectId_idx" ON "FeatureSnapshot"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "FeatureSnapshot_featureSet_version_createdAt_idx" ON "FeatureSnapshot"("featureSet", "version", "createdAt");

-- CreateIndex
CREATE INDEX "Outcome_subjectType_subjectId_idx" ON "Outcome"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "Outcome_label_createdAt_idx" ON "Outcome"("label", "createdAt");

-- CreateIndex
CREATE INDEX "MlModel_name_active_idx" ON "MlModel"("name", "active");

-- CreateIndex
CREATE UNIQUE INDEX "MlModel_name_version_key" ON "MlModel"("name", "version");

-- CreateIndex
CREATE INDEX "Prediction_subjectType_subjectId_idx" ON "Prediction"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "Prediction_modelId_createdAt_idx" ON "Prediction"("modelId", "createdAt");

-- AddForeignKey
ALTER TABLE "Checkpoint" ADD CONSTRAINT "Checkpoint_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Step" ADD CONSTRAINT "Step_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolCall" ADD CONSTRAINT "ToolCall_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LlmCall" ADD CONSTRAINT "LlmCall_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prediction" ADD CONSTRAINT "Prediction_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "MlModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
