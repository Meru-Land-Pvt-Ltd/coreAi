-- Magic-link sign-in.
--
-- codeCipher    : the 6-digit code under AES-256-GCM, so /magic-link can display
--                 it. codeHash (salted scrypt) stays the only value the verify
--                 path trusts and is unchanged.
-- linkTokenHash : SHA-256 of the token carried in the emailed sign-in link.
--                 Deterministic so the row is lookup-able; unique so a token
--                 resolves to exactly one code. Null for email-change codes.

-- AlterTable
ALTER TABLE "EmailVerificationCode" ADD COLUMN     "codeCipher" TEXT,
ADD COLUMN     "linkTokenHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "EmailVerificationCode_linkTokenHash_key" ON "EmailVerificationCode"("linkTokenHash");
