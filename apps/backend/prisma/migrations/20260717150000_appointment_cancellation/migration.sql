-- AlterEnum
ALTER TYPE "SmsMessageType" ADD VALUE 'APPOINTMENT_CANCELLATION';

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "cancellationCallId" TEXT,
ADD COLUMN     "cancellationReason" TEXT,
ADD COLUMN     "cancellationSource" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3);

