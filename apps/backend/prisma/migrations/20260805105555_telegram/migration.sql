/*
  Warnings:

  - You are about to drop the `MemoryChunk` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "MemoryChunk" DROP CONSTRAINT "MemoryChunk_recordId_fkey";

-- DropTable
DROP TABLE "MemoryChunk";
