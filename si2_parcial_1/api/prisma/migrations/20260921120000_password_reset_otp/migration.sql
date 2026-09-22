-- Los tokens (hash) anteriores dejan de ser válidos: se reemplazan por el OTP de 6 dígitos
ALTER TABLE "users" DROP COLUMN "resetPasswordToken",
ADD COLUMN     "resetPasswordAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "resetPasswordOtp" TEXT;
