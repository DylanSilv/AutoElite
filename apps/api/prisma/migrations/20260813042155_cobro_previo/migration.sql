-- AlterTable
ALTER TABLE `Order` ADD COLUMN `paidAt` DATETIME(3) NULL,
    ADD COLUMN `paymentNote` TEXT NULL,
    ADD COLUMN `paymentReviewedByUserId` INTEGER NULL,
    ADD COLUMN `paymentStatus` ENUM('NOT_REQUIRED', 'PENDING', 'PROOF_SUBMITTED', 'CONFIRMED', 'REJECTED') NOT NULL DEFAULT 'NOT_REQUIRED';

-- AlterTable
ALTER TABLE `OutboundMessage` MODIFY `kind` ENUM('ORDER_RECEIVED', 'PAYMENT_REQUESTED', 'PAYMENT_CONFIRMED', 'PAYMENT_REJECTED', 'ORDER_CONFIRMED', 'ORDER_READY_PICKUP', 'ORDER_READY_DINE_IN', 'ORDER_ON_THE_WAY', 'ORDER_DELIVERED', 'ORDER_CANCELLED') NOT NULL;

-- AlterTable
ALTER TABLE `PaymentMethod` ADD COLUMN `allowedOrderTypes` JSON NULL,
    ADD COLUMN `instructions` TEXT NULL,
    ADD COLUMN `qrImageUrl` VARCHAR(191) NULL,
    ADD COLUMN `requiresPrepayment` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `PaymentProof` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `publicId` VARCHAR(191) NOT NULL,
    `commerceId` INTEGER NOT NULL,
    `orderId` INTEGER NOT NULL,
    `mediaUrl` VARCHAR(191) NULL,
    `whatsappMediaId` VARCHAR(191) NULL,
    `mimeType` VARCHAR(191) NULL,
    `note` TEXT NULL,
    `submittedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PaymentProof_publicId_key`(`publicId`),
    INDEX `PaymentProof_commerceId_idx`(`commerceId`),
    INDEX `PaymentProof_orderId_idx`(`orderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Order_commerceId_paymentStatus_idx` ON `Order`(`commerceId`, `paymentStatus`);

-- AddForeignKey
ALTER TABLE `PaymentProof` ADD CONSTRAINT `PaymentProof_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
