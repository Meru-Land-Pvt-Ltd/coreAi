-- Magic-link auto sign-in.
--
-- originDeviceHash: SHA-256 of the device id held by the browser that started
-- the login. When the emailed link is opened in that same browser the link
-- signs the user in directly; opened anywhere else it falls back to showing the
-- 6-digit code so the login can be finished on the original device.

-- AlterTable
ALTER TABLE "EmailVerificationCode" ADD COLUMN     "originDeviceHash" TEXT;
